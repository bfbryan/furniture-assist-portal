// app/api/admin/staff/[id]/status/route.ts
//
// PATCH — Unified status/flag mutator. Accepts:
//   { status: 'Active' | 'Inactive' }              → deactivate / reactivate + revoke/restore Clerk
//   { portalInviteStatus: 'Wrong Agency' }         → flag as wrong-agency (Dawson-facing)

import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import {
  getAgencyUserById,
  updateAgencyUserStatus,
  updateAgencyUserPortalInvite,
} from '@/lib/airtable'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (orgRole !== 'org:admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: recordId } = await params
  const body = await req.json().catch(() => ({}))
  const nextStatus = body.status as 'Active' | 'Inactive' | undefined
  const nextInviteFlag = body.portalInviteStatus as 'Wrong Agency' | undefined

  if (!nextStatus && !nextInviteFlag) {
    return NextResponse.json({ error: 'No change specified' }, { status: 400 })
  }

  const staff = await getAgencyUserById(recordId)
  if (!staff) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // --- Path 1: Wrong Agency flag ---
  if (nextInviteFlag === 'Wrong Agency') {
    // If they have Clerk access, revoke it too — safer than leaving orphaned access
    if (staff.clerkUserId) {
      try {
        const client = await clerkClient()
        await client.organizations.deleteOrganizationMembership({
          organizationId: orgId!,
          userId: staff.clerkUserId,
        })
      } catch {
        // Not a member or already removed — fine
      }
    }
    await updateAgencyUserPortalInvite(recordId, {
      portalInviteStatus: 'Wrong Agency',
    })
    return NextResponse.json({ ok: true })
  }

  // --- Path 2: Active / Inactive toggle ---
  if (nextStatus === 'Active' || nextStatus === 'Inactive') {
    const client = await clerkClient()

    if (nextStatus === 'Inactive' && staff.clerkUserId) {
      try {
        await client.organizations.deleteOrganizationMembership({
          organizationId: orgId!,
          userId: staff.clerkUserId,
        })
      } catch {
        // Already removed — fine
      }
    }

    if (nextStatus === 'Active' && staff.clerkUserId) {
      try {
        await client.organizations.createOrganizationMembership({
          organizationId: orgId!,
          userId: staff.clerkUserId,
          role: staff.role === 'Admin' ? 'org:admin' : 'org:member',
        })
      } catch (err: any) {
        if (err?.errors?.[0]?.code !== 'organization_membership_exists') {
          return NextResponse.json(
            { error: 'Failed to restore access', detail: err?.message ?? String(err) },
            { status: 500 }
          )
        }
      }
    }

    await updateAgencyUserStatus(recordId, nextStatus)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid change' }, { status: 400 })
}
