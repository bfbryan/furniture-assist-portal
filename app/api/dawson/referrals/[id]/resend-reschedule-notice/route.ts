// app/api/dawson/referrals/[id]/resend-reschedule-notice/route.ts
//
// POST — re-send the Reschedule Notice for ONE referral that is already booked,
// without rebooking it.
//
// WHY THIS EXISTS
// sendRescheduleNotice() has exactly one caller — rescheduleReferral(), on a
// booking. Nothing else in the codebase can invoke it, and no cron or Airtable
// view looks for a referral that was moved without its agency being told. So
// when the notice failed for three referrals in Sep 2026 (a TypeError thrown
// before any write — see lib/notifications/agency-mailto-fallback.ts), the only
// way to deliver the email would have been to reschedule the referral a second
// time onto the date it already held. That would rewrite Original Appointment
// Date to the CURRENT date, destroying the record of where the client actually
// moved from, and re-arm the reminder — corrupting the record to fix an email.
//
// This route is the narrow alternative: same notice, same recipient, no booking.
//
// WHAT IT DOES NOT TOUCH
// Appointment Date, Original Appointment Date, Original Appointment Time,
// Appointment Time, Appointment Status, Saturday Schedule, Preferred Date,
// Preferred Time, Reminder Email Sent. It reads the snapshot the original
// booking already wrote and passes it to the notice; it never writes it.
//
// WHAT IT DOES WRITE — all of it inside sendRescheduleNotice(), none of it here:
//   • regenerates the Appt Slip attachment for the CURRENT date (overwrites in
//     place — the slip is a record artefact and should already say Oct 10)
//   • one Email Log row (Sent / Failed / Skipped / Withheld)
//   • Reschedule Email Sent At, on a successful send only
//
// GUARDS
//   • Dawson-authenticated, same requireDawsonAccess() as every other internal
//     route.
//   • One referral per call, by record id in the path. No batch, no "all
//     missing" sweep — a resend is a decision per referral, and a loop over a
//     view is how you mail fifty agencies about appointments they already know
//     about.
//   • Refuses a referral with no Original Appointment Date. That snapshot is
//     what makes this a RESCHEDULE notice rather than a confirmation: without
//     it the email cannot say what the appointment moved from, and the referral
//     was probably never rescheduled in the first place.
//   • Refuses a referral that is not currently Scheduled. Re-announcing a
//     cancelled or completed appointment is worse than silence.
//
// The response is sendRescheduleNotice()'s own result, unmodified, so the
// caller sees exactly which branch it took rather than a bare status.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendRescheduleNotice } from '@/lib/notifications/reschedule-notice'

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
  if (status !== 'Scheduled') {
    return NextResponse.json(
      {
        error:
          `This referral is "${status ?? 'blank'}", not Scheduled. A reschedule notice ` +
          `tells an agency their client's appointment moved — sending one for a ` +
          `referral that is not currently booked would be wrong.`,
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
          'This referral has no Original Appointment Date, so there is no previous ' +
          'appointment to report. It was most likely booked for the first time rather ' +
          'than rescheduled — a first booking is the Wednesday confirmation cron’s job.',
      },
      { status: 409 },
    )
  }

  // The whole job. Never throws — it reports its own outcome, and since Sep 2026
  // it writes an Email Log row for every one of them.
  const result = await sendRescheduleNotice(id, previousDate, previousTime)

  return NextResponse.json({
    referralId: id,
    clientName: `${firstOf(f['First Name']) ?? ''} ${firstOf(f['Last Name']) ?? ''}`.trim(),
    sentTo: f['Agency Email'] ?? null,
    previousAppointment: { date: previousDate, time: previousTime },
    currentAppointment: {
      date: firstOf(f['Appointment Date']),
      time: firstOf(f['Appointment Time']),
    },
    result,
  })
}
