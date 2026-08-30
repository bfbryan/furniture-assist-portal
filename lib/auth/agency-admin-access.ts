// lib/auth/agency-admin-access.ts
//
// Ownership guard for the agency-facing /api/admin/staff/[id]/* handlers,
// the sibling of lib/auth/agency-referral-access.ts.
//
// Every one of those routes changes another person's portal access — invite,
// revoke, deactivate, role — and the record id comes straight from the URL.
// The role check ("you are an org:admin of SOME agency") is not enough on its
// own: without the agency-scope check below, an admin of agency A could pass
// the record id of a user at agency B and act on them. POST
// /api/admin/staff/[id]/invite already carried an inline version of this; the
// other routes did not.
//
// The rules:
//   1. Signed in.
//   2. org:admin (the Clerk org role — the same gate the routes used).
//   3. The Clerk user maps to an Agency Users row (so we know their agency).
//   4. The target row belongs to that same agency — compared on the linked
//      record id, not the name, because Agency Name is not unique in the base
//      (see the note in agency-referral-access.ts).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getAgencyUserById, getAgencyUserByClerkId } from '@/lib/airtable'

type Staff = NonNullable<Awaited<ReturnType<typeof getAgencyUserById>>>
type Admin = NonNullable<Awaited<ReturnType<typeof getAgencyUserByClerkId>>>

export type AgencyAdminAccess =
  | { denied: NextResponse; staff?: undefined; admin?: undefined; orgId?: undefined }
  | { denied?: undefined; staff: Staff; admin: Admin; orgId: string }

/**
 * Resolve and authorize a target Agency Users row for the signed-in agency
 * admin. Returns either `{ denied }` — return it immediately — or the loaded
 * staff row, the admin's own row, and the Clerk org id.
 */
export async function requireAgencyAdmin(
  staffRecordId: string,
): Promise<AgencyAdminAccess> {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (orgRole !== 'org:admin' || !orgId) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = await getAgencyUserByClerkId(userId)
  if (!admin?.agencyId) {
    return { denied: NextResponse.json({ error: 'No agency linked' }, { status: 403 }) }
  }

  const staff = await getAgencyUserById(staffRecordId)
  if (!staff) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  if (staff.agencyId !== admin.agencyId) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { staff, admin, orgId }
}
