// app/api/referrals/[id]/withdraw/route.ts
//
// Agency-facing withdraw. Same ownership gap as cancel — it only checked that
// someone was signed in — closed with the shared check.
//
// Aug 2026: this wrote 'Referral Review' = 'Withdrawn' and nothing else, so a
// withdrawn referral kept its Saturday Schedule link and its Appointment Time
// and went on consuming that hour forever. Worse than the cancel case, in
// fact, because the Appointment Status still read 'Scheduled', so the client
// also stayed on the printed Saturday roster.
//
// Withdrawing is ending the referral, so it now goes through the same helper
// the two cancel paths use and releases the slot. It writes the Cancelled
// appointment status alongside 'Withdrawn' — see the note on
// EndReferralOutcome in lib/referrals/end-referral.ts for why, and note that
// what the AGENCY sees is unchanged: getPortalStatus() reads Referral Review
// before Appointment Status, so this still displays as "Withdrawn".

import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'
import { endReferral } from '@/lib/referrals/end-referral'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await requireAgencyReferralAccess(id)
  if (access.denied) return access.denied

  const result = await endReferral({ referralId: id, outcome: 'withdrawn', notify: true })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    releasedSlot: result.releasedSlot,
    cancellationNotice: result.cancellationNotice,
  })
}
