// app/api/admin/staff/[id]/referral-count/route.ts
//
// GET — how many referrals this staff member has that are CURRENTLY VISIBLE to
// the caller's agency, split by whether the appointment is still upcoming.
// Feeds the "Not at this office" confirmation dialog on the Team page: "Hides
// N referrals, including M with upcoming appointments" — hiding closed
// history is a different decision from hiding a client who has a Saturday
// booked, and the old wording ("this will hide N past referrals") undersold
// that when some of the N had a future appointment.
//
// "Currently visible" is the whole point: the count must use the SAME
// predicate the Active list and History use — {Referring Agency ID} +
// {Referring Staff} name + {Referring Staff Membership} = "Confirmed". That is
// exactly getReferralsByStaffName, so this reuses it rather than reimplementing
// the formula and letting the two drift. At dialog-open time the row is still
// Confirmed (the admin is about to un-confirm it), so this returns the real
// number that is about to disappear; call it again after and it would be 0.
//
// "Upcoming" reads the LIVE Appointment Date, not the effective/coalesced
// date (Dawson's fileDateOf convention, or lib/referrals/effective-date.ts on
// the agency side). Effective Appointment Date is deliberately built to
// survive cancellation — a cancelled referral still needs to file under the
// month it was booked for — which is exactly wrong here: a cancelled
// referral's effective date can still read as "in the future" with no actual
// booking behind it. A referral only has a live Appointment Date while a slot
// is genuinely held, which is what "does this family still have a Saturday
// booked" actually means. Do not "fix" this toward fileDateOf — the two
// questions are different on purpose.
//
// The row itself shows no count — this is fetched only when the dialog opens.

import { NextRequest, NextResponse } from 'next/server'
import { getReferralsByStaffName } from '@/lib/airtable'
import { requireAgencyAdmin } from '@/lib/auth/agency-admin-access'
import { easternTodayISO } from '@/lib/dates'

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
  const todayISO = easternTodayISO()
  const upcoming = referrals.filter(
    (r: { appointmentDate: string | null }) => !!r.appointmentDate && r.appointmentDate >= todayISO,
  ).length
  return NextResponse.json({ count: referrals.length, upcoming })
}
