// app/api/admin/staff/[id]/cancel-invite/route.ts
//
// POST — Cancel a pending invitation. Reverts the AT row to Unclaimed / Not Invited
// and revokes the Clerk org membership so the magic link stops working.

import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { getAgencyUserById, updateAgencyUserPortalInvite } from '@/lib/airtable'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (orgRole !== 'org:admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: recordId } = await params
  const staff = await getAgencyUserById(recordId)
  if (!staff) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (staff.status !== 'Invited') {
    return NextResponse.json(
      { error: `Cannot cancel invite for staff with status ${staff.status}` },
      { status: 400 }
    )
  }

  // Revoke Clerk org access if we have a linked user
  if (staff.clerkUserId) {
    try {
      const client = await clerkClient()
      await client.organizations.deleteOrganizationMembership({
        organizationId: orgId!,
        userId: staff.clerkUserId,
      })
    } catch {
      // Not a member — fine, keep going
    }
  }

  // Revert AT row
  await updateAgencyUserPortalInvite(recordId, {
    status: 'Unclaimed',
    portalInviteStatus: 'Not Invited',
    invitedDate: null,
    invitedBy: null,
    // Intentionally do NOT clear clerkUserId — reuse on next invite avoids duplicate Clerk users
  })

  return NextResponse.json({ ok: true })
}
