// app/api/referrals/[id]/cancel/route.ts
//
// Agency-facing cancel.
//
// Ownership is checked with the shared guard — this previously only verified
// that a user was signed in, which let any authenticated agency user cancel
// any referral in the base.
//
// Aug 2026: this used to write 'Appointment Status' = 'Cancelled' and nothing
// else, which left the referral holding its Saturday Schedule link and its
// Appointment Time. The Saturday capacity rollups count Appointment Time and
// never look at Appointment Status, so a client cancelled from the agency side
// kept consuming their hour against both the per-hour cap and the day's — and
// kept appearing on the printed roster. The record now ends the same way
// Dawson's cancel ends it, through the one shared helper. See
// lib/referrals/end-referral.ts for what "ending a referral" actually means.
//
// The cancellation email now fires on this path too, where before only
// Dawson's cancel sent one. Both cancels are the same event to the person
// reading the agency mailbox, and the agency's own shared inbox is where the
// rest of that agency's staff find out an appointment is off — the caseworker
// who clicked the button already knows; their colleagues do not.

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

  const result = await endReferral({ referralId: id, outcome: 'cancelled', notify: true })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    releasedSlot: result.releasedSlot,
    cancellationNotice: result.cancellationNotice,
  })
}
