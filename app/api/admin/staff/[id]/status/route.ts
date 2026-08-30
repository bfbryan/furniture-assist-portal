// app/api/admin/staff/[id]/status/route.ts
//
// PATCH — status / flag mutator. Accepts:
//   { status: 'Active' | 'Inactive' }        → deactivate / reactivate + revoke/restore Clerk
//   { portalInviteStatus: 'Wrong Agency' }   → "Not at this office" (Furniture Assist-facing)
//
// requireAgencyAdmin enforces: signed in, org:admin, and the target row is at
// the caller's own agency. An admin can't deactivate or wrong-agency their own
// row — that would lock the agency out of its own team page.

import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { updateAgencyUserStatus, updateAgencyUserPortalInvite } from '@/lib/airtable'
import { requireAgencyAdmin } from '@/lib/auth/agency-admin-access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: recordId } = await params
  const access = await requireAgencyAdmin(recordId)
  if (access.denied) return access.denied
  const { staff, admin, orgId } = access

  const body = await req.json().catch(() => ({}))
  const nextStatus = body.status as 'Active' | 'Inactive' | undefined
  const nextInviteFlag = body.portalInviteStatus as 'Wrong Agency' | undefined

  if (!nextStatus && !nextInviteFlag) {
    return NextResponse.json({ error: 'No change specified' }, { status: 400 })
  }

  const isSelf = !!staff.clerkUserId && staff.clerkUserId === admin.clerkUserId
  if (isSelf && (nextStatus === 'Inactive' || nextInviteFlag === 'Wrong Agency')) {
    return NextResponse.json(
      { error: "You can't remove your own access." },
      { status: 400 },
    )
  }

  // --- Path 1: Wrong Agency flag ---
  if (nextInviteFlag === 'Wrong Agency') {
    if (staff.clerkUserId) {
      try {
        const client = await clerkClient()
        await client.organizations.deleteOrganizationMembership({
          organizationId: orgId,
          userId: staff.clerkUserId,
        })
      } catch {
        // Not a member or already removed — fine
      }
    }
    await updateAgencyUserPortalInvite(recordId, { portalInviteStatus: 'Wrong Agency' })
    return NextResponse.json({ ok: true })
  }

  // --- Path 2: Active / Inactive toggle ---
  if (nextStatus === 'Active' || nextStatus === 'Inactive') {
    const client = await clerkClient()

    if (nextStatus === 'Inactive' && staff.clerkUserId) {
      try {
        await client.organizations.deleteOrganizationMembership({
          organizationId: orgId,
          userId: staff.clerkUserId,
        })
      } catch {
        // Already removed — fine
      }
    }

    if (nextStatus === 'Active' && staff.clerkUserId) {
      try {
        await client.organizations.createOrganizationMembership({
          organizationId: orgId,
          userId: staff.clerkUserId,
          role: staff.role === 'Admin' ? 'org:admin' : 'org:member',
        })
      } catch (err) {
        const code = (err as { errors?: { code?: string }[] })?.errors?.[0]?.code
        if (code !== 'organization_membership_exists') {
          return NextResponse.json(
            { error: 'Failed to restore access', detail: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      }
    }

    await updateAgencyUserStatus(recordId, nextStatus)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid change' }, { status: 400 })
}
