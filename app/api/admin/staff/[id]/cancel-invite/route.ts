// app/api/admin/staff/[id]/cancel-invite/route.ts
//
// POST — Revoke a pending invitation. Reverts the Agency Users row to
// Unclaimed / Not Invited, clears Invited Date and Invited By, and deletes the
// Clerk org membership so the outstanding magic link stops working.
//
// requireAgencyAdmin enforces signed-in + org:admin + the row is at the
// caller's own agency.

import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { updateAgencyUserPortalInvite } from '@/lib/airtable'
import { requireAgencyAdmin } from '@/lib/auth/agency-admin-access'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: recordId } = await params
  const access = await requireAgencyAdmin(recordId)
  if (access.denied) return access.denied
  const { staff, orgId } = access

  if (staff.status !== 'Invited') {
    return NextResponse.json(
      { error: `Cannot revoke an invite for staff with status ${staff.status}` },
      { status: 400 },
    )
  }

  if (staff.clerkUserId) {
    try {
      const client = await clerkClient()
      await client.organizations.deleteOrganizationMembership({
        organizationId: orgId,
        userId: staff.clerkUserId,
      })
    } catch {
      // Not a member — fine, keep going
    }
  }

  await updateAgencyUserPortalInvite(recordId, {
    status: 'Unclaimed',
    portalInviteStatus: 'Not Invited',
    invitedDate: null,
    invitedBy: null,
    // Keep clerkUserId — reused on the next invite to avoid a duplicate Clerk user.
  })

  return NextResponse.json({ ok: true })
}
