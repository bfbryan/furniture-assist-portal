// app/api/admin/staff/[id]/status/route.ts
//
// PATCH — status / membership mutator. Accepts:
//   { status: 'Active' | 'Inactive' }              → deactivate / reactivate + revoke/restore Clerk
//   { membershipStatus: 'Confirmed' }              → vouch: this person works at our office
//   { membershipStatus: 'Not At This Office' }     → they don't — hide their referrals + revoke Clerk
//
// Membership is a SEPARATE axis from the account lifecycle (Status) and the
// invite lifecycle (Portal Invite Status). 'Confirmed' is what gates
// agency-facing referral visibility; blank (the default) hides everything.
// 'Not At This Office' is this branch's replacement for the old
// Portal-Invite-Status 'Wrong Agency' flag.
//
// requireAgencyAdmin enforces: signed in, org:admin, and the target row is at
// the caller's own agency. An admin can't deactivate their own row or flag
// themselves 'Not At This Office' — either would lock the agency out of its
// own team page.

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
  const nextMembership = body.membershipStatus as
    | 'Confirmed'
    | 'Not At This Office'
    | undefined

  if (!nextStatus && !nextMembership) {
    return NextResponse.json({ error: 'No change specified' }, { status: 400 })
  }

  const isSelf = !!staff.clerkUserId && staff.clerkUserId === admin.clerkUserId
  if (isSelf && (nextStatus === 'Inactive' || nextMembership === 'Not At This Office')) {
    return NextResponse.json(
      { error: "You can't remove your own access." },
      { status: 400 },
    )
  }

  // --- Path 1a: Confirm membership ---
  // Pure assertion — no Clerk change, no Status change. This is what makes the
  // person's referrals visible to the agency. Also the undo for 1b.
  if (nextMembership === 'Confirmed') {
    await updateAgencyUserPortalInvite(recordId, {
      membershipStatus: 'Confirmed',
      membershipDecidedBy: admin.name,
      membershipDecidedAt: new Date().toISOString(),
    })
    return NextResponse.json({ ok: true })
  }

  // --- Path 1b: Not at this office ---
  // Destructive: hides every past referral this person made from the agency's
  // view (the visibility gate keys on Membership Status = 'Confirmed'). Revokes
  // the Clerk org membership too. Recoverable via Path 1a.
  if (nextMembership === 'Not At This Office') {
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
    await updateAgencyUserPortalInvite(recordId, {
      membershipStatus: 'Not At This Office',
      membershipDecidedBy: admin.name,
      membershipDecidedAt: new Date().toISOString(),
    })
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
