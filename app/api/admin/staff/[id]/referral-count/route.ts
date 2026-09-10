// app/api/admin/staff/[id]/referral-count/route.ts
//
// GET — how many referrals this staff member has that are CURRENTLY VISIBLE to
// the caller's agency. Feeds the "Not at this office" confirmation dialog on
// the Team page: "This will hide N past referrals from your agency's view."
//
// "Currently visible" is the whole point: the count must use the SAME
// predicate the Active list and History use — {Referring Agency ID} +
// {Referring Staff} name + {Referring Staff Membership} = "Confirmed". That is
// exactly getReferralsByStaffName, so this reuses it rather than reimplementing
// the formula and letting the two drift. At dialog-open time the row is still
// Confirmed (the admin is about to un-confirm it), so this returns the real
// number that is about to disappear; call it again after and it would be 0.
//
// The row itself shows no count — this is fetched only when the dialog opens.

import { NextRequest, NextResponse } from 'next/server'
import { getReferralsByStaffName } from '@/lib/airtable'
import { requireAgencyAdmin } from '@/lib/auth/agency-admin-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: recordId } = await params
  const access = await requireAgencyAdmin(recordId)
  if (access.denied) return access.denied
  const { staff, admin } = access

  // admin.agencyId is guaranteed non-null by requireAgencyAdmin; staff.name is
  // "First Last". A row with no name can have no matching referrals anyway.
  const referrals = await getReferralsByStaffName(admin.agencyId!, staff.name)
  return NextResponse.json({ count: referrals.length })
}
