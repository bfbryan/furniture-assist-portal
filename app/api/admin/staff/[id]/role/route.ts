// app/api/admin/staff/[id]/role/route.ts
//
// PATCH { role: 'Admin' | 'Staff' } — toggle a staff member's portal role.
//
// NOT CALLED FROM THE UI YET. The Team page's Make Admin / Remove Admin menu
// items were removed — role changes go through Furniture Assist for now. This
// route is left in place, fully working, to be wired back up when self-service
// role management returns. The client actions ('make-admin' / 'remove-admin'
// in components/agency/StaffList.tsx) are likewise kept but unsurfaced.
//
// Writes Role on the Agency Users row and updates the Clerk org membership
// (org:admin / org:member) so the change takes effect on their next request.
//
// This is NOT the Agency record's "Primary Admin" — the designated contact —
// which has no self-service path and is changed by Furniture Assist.
//
// An admin cannot change their own role here: demoting yourself is one of the
// two ways to lock an agency out of its own team page (deactivating yourself
// is the other), so both are refused server-side, not just hidden in the UI.

import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { updateAgencyUserRole } from '@/lib/airtable'
import { requireAgencyAdmin } from '@/lib/auth/agency-admin-access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const access = await requireAgencyAdmin(id)
  if (access.denied) return access.denied
  const { staff, admin, orgId } = access

  const body = await req.json().catch(() => ({}))
  const role = body.role as 'Admin' | 'Staff' | undefined
  if (role !== 'Admin' && role !== 'Staff') {
    return NextResponse.json({ error: 'role must be Admin or Staff' }, { status: 400 })
  }

  if (staff.clerkUserId && staff.clerkUserId === admin.clerkUserId) {
    return NextResponse.json(
      { error: "You can't change your own role." },
      { status: 400 },
    )
  }

  if (staff.role === role) {
    return NextResponse.json({ ok: true })
  }

  if (staff.clerkUserId) {
    try {
      const client = await clerkClient()
      await client.organizations.updateOrganizationMembership({
        organizationId: orgId,
        userId: staff.clerkUserId,
        role: role === 'Admin' ? 'org:admin' : 'org:member',
      })
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to update portal role', detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  }

  await updateAgencyUserRole(id, role)
  return NextResponse.json({ ok: true })
}
