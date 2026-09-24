// app/api/dawson/referrals/[id]/resend-cancellation-notice/route.ts
//
// POST — re-send the Cancellation Notice for ONE already-cancelled referral,
// without cancelling anything.
//
// The twin of resend-reschedule-notice, for the same reason and with the same
// shape. sendCancellationNotice() has exactly one caller — endReferral(), at
// the moment a referral is cancelled or withdrawn — and nothing watches for a
// notice that didn't arrive. An event-fired notice cannot self-heal the way a
// cron can: a cron's record stays in its view and the next run picks it up,
// but the cancel event is gone the moment it has happened. Without this route
// the only way to deliver a missed cancellation notice would be to cancel the
// referral a second time, which is not possible on a record that is already
// cancelled, and would be the wrong thing to do even if it were.
//
// Built before it was needed rather than after. The reschedule twin was
// written in response to three referrals whose notice threw silently
// (Sep 2026); cancellation-notice.ts is the same shape of code with the same
// single caller, so it has the same exposure.
//
// WHAT IT DOES NOT TOUCH
// Appointment Status, Referral Review, Original Appointment Date/Time,
// Saturday Schedule, Appointment Time. It reads the snapshot endReferral()
// already wrote and passes it to the notice; it never writes it. A cancelled
// referral's slot has already been released — nothing here re-books or
// re-releases anything.
//
// WHAT IT DOES WRITE — all inside sendCancellationNotice(), none here:
// one Email Log row, and "Cancellation Email Sent At" on a successful send.
// Unlike the reschedule twin it regenerates no slip: the cancellation notice
// has no attachment, because a slip for an appointment that no longer exists
// is not a record artefact anyone wants.
//
// GUARDS
//   • Dawson-authenticated, same requireDawsonAccess() as every internal route.
//   • One referral per call. No batch: a resend is a decision per referral.
//   • Refuses anything not currently 'Cancelled'. Telling an agency an
//     appointment was cancelled when it is currently booked would be worse
//     than the missing email.
//   • Refuses a referral with no Original Appointment Date. endReferral()
//     writes that snapshot only when a real slot was released, and it is the
//     same condition (`releasedSlot`) that gates the original send — a
//     referral cancelled before it was ever scheduled never had a
//     cancellation notice to miss.
//
// Both 'cancelled' and 'withdrawn' outcomes write Appointment Status =
// 'Cancelled' (withdrawn additionally sets Referral Review), and endReferral
// notifies on both, so this route deliberately does not discriminate between
// them either.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendCancellationNotice } from '@/lib/notifications/cancellation-notice'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

function firstOf(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params

  // Read-only. Nothing on this route writes to the referral.
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  )
  if (!res.ok) {
    return NextResponse.json(
      { error: `Referral ${id} could not be read (${res.status}).` },
      { status: res.status === 404 ? 404 : 502 },
    )
  }
  const record = await res.json()
  const f = record.fields ?? {}

  const status = firstOf(f['Appointment Status'])
  if (status !== 'Cancelled') {
    return NextResponse.json(
      {
        error:
          `This referral is "${status ?? 'blank'}", not Cancelled. A cancellation ` +
          `notice tells an agency their client's appointment is gone — sending one ` +
          `for a referral that is not cancelled would be false.`,
      },
      { status: 409 },
    )
  }

  const previousDate = firstOf(f['Original Appointment Date'])
  const previousTime = firstOf(f['Original Appointment Time'])
  if (!previousDate) {
    return NextResponse.json(
      {
        error:
          'This referral has no Original Appointment Date, so no slot was ever ' +
          'released. It was cancelled before it was scheduled, which is the one case ' +
          'endReferral() does not send a cancellation notice for — there is nothing ' +
          'to re-send.',
      },
      { status: 409 },
    )
  }

  // The whole job. Never throws; it reports its own outcome.
  const result = await sendCancellationNotice(id, previousDate, previousTime)

  return NextResponse.json({
    referralId: id,
    clientName: `${firstOf(f['First Name']) ?? ''} ${firstOf(f['Last Name']) ?? ''}`.trim(),
    sentTo: f['Agency Email'] ?? null,
    cancelledAppointment: { date: previousDate, time: previousTime },
    outcome: firstOf(f['Referral Review']) === 'Withdrawn' ? 'withdrawn' : 'cancelled',
    previouslyNotifiedAt: f['Cancellation Email Sent At'] ?? null,
    result,
  })
}
