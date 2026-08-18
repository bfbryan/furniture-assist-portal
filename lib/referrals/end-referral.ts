// lib/referrals/end-referral.ts
//
// THE way a referral stops being a live appointment. Every route that ends
// one goes through endReferral() — the agency cancel and withdraw buttons,
// Dawson's cancel button, and the OCR pickup endpoint when a sheet comes back
// marked Cancelled.
//
// ============================================================
// Why this exists: ending a referral is not a status write
// ============================================================
// A Saturday's per-slot counts are Airtable rollups over a per-slot helper
// formula, and that formula tests 'Appointment Time' ONLY. It never looks at
// 'Appointment Status'. So a referral that is marked Cancelled but still holds
// a Saturday Schedule link and an Appointment Time is, as far as capacity is
// concerned, still keeping its 9am on the 22nd. It counts against that hour's
// cap and against the day's, forever, and no amount of cancelling it again
// will shift it. The client also stays on the printed Saturday roster, which
// queries Appointment Status = 'Scheduled' AND Appointment Date — the date
// being a lookup THROUGH the Saturday Schedule link.
//
// So "end this referral" is four writes that have to happen together:
//
//   1. the terminal status the caller wants (Cancelled / Withdrawn)
//   2. Saturday Schedule -> []      release the day
//   3. Appointment Time   -> null   release the hour  <-- the one that counts
//   4. Original Appointment Date/Time <- the values from 2 and 3, so the
//      record still says what the appointment WAS, and so the cancellation
//      email has something to quote back.
//
// Dawson's cancel route had all four inline and correct. The agency-facing
// cancel wrote only (1), and the agency-facing withdraw wrote only its own
// review value — so every referral an agency ever ended is still holding its
// slot. That is the bug this module exists to make un-repeatable: there is now
// one implementation, and a new ending route gets all four writes by calling
// it rather than by remembering them.
//
// ============================================================
// The Airtable automation that is supposed to do this
// ============================================================
// The old cancel route carried a comment saying the "Cancellation" Airtable
// automation would handle the agency path as a safety net until that path was
// ported. It will not. Ben's automations are all switched OFF while he
// migrates this work into code, so nothing has been picking up the slack.
// Treat every comment in this repo that defers work to an Airtable automation
// the same way: as a description of something that no longer runs.

import {
  sendCancellationNotice,
  type CancellationNoticeResult,
} from '@/lib/notifications/cancellation-notice'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

/**
 * How this referral ended.
 *
 * 'cancelled' — the appointment is off. Written by both cancel buttons and by
 *   a pickup sheet that comes back marked Cancelled.
 *
 * 'withdrawn' — the referring agency is taking the referral back. Sets the
 *   Referral Review side as well, because that is the axis that records WHO
 *   ended it; getPortalStatus() in lib/referrals/edit-window.ts reads review
 *   before status, so the agency still sees "Withdrawn" and not "Cancelled".
 *   Appointment Status goes to Cancelled too — 'Withdrawn' is not one of the
 *   Appointment Status options on this base, and leaving a withdrawn referral
 *   sitting at 'Scheduled' with its date cleared would park it in Dawson's
 *   Scheduled queue with a blank appointment date, which is a worse artefact
 *   than the one being fixed.
 */
export type EndReferralOutcome = 'cancelled' | 'withdrawn'

const TERMINAL_FIELDS: Record<EndReferralOutcome, Record<string, unknown>> = {
  cancelled: { 'Appointment Status': 'Cancelled' },
  withdrawn: { 'Appointment Status': 'Cancelled', 'Referral Review': 'Withdrawn' },
}

export type EndReferralResult =
  | {
      ok: true
      /**
       * True when the referral really was holding a Saturday and an hour, so
       * a slot was actually released and the Original fields were written.
       * False for a referral that was cancelled before it was ever scheduled.
       */
      releasedSlot: boolean
      previousDate: string | null
      previousTime: string | null
      /** Null when nothing was released, or when the caller asked not to notify. */
      cancellationNotice: CancellationNoticeResult | null
    }
  | { ok: false; status: 404 | 500; message: string }

/**
 * End a referral and give its Saturday slot back.
 *
 * `notify` fires the Cancellation Notice to the referring agency, and only
 * ever when a real appointment was released — an Unscheduled referral being
 * cancelled never had an appointment to tell anyone about.
 *
 * Note there is deliberately NO "were they ever told about this appointment
 * in the first place" guard here, of the kind sendRescheduleNotice() carries.
 * That is an open question and not one to answer by quietly adding a
 * condition.
 */
export async function endReferral({
  referralId,
  outcome,
  notify,
  alsoWrite,
}: {
  referralId: string
  outcome: EndReferralOutcome
  notify: boolean
  /**
   * Extra fields to write in the SAME PATCH. For a caller that has its own
   * unrelated columns to set on the record it is ending — the OCR pickup
   * endpoint, which carries item quantities off the scanned sheet. Merged
   * first, so the terminal status and the slot release always win.
   */
  alsoWrite?: Record<string, unknown>
}): Promise<EndReferralResult> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${referralId}`

  const readRes = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: 'no-store',
  })
  if (!readRes.ok) {
    return { ok: false, status: 404, message: 'Referral not found' }
  }
  const ref = await readRes.json()

  const scheduleLinks: string[] = ref?.fields?.['Saturday Schedule'] ?? []
  const previousTime: string | null = ref?.fields?.['Appointment Time'] ?? null

  // Appointment Date is a lookup through the Saturday Schedule link, so it
  // arrives as an array of ISO date strings. Take the first.
  const dateLookup = ref?.fields?.['Appointment Date']
  const previousDate: string | null = Array.isArray(dateLookup)
    ? (dateLookup[0] as string) ?? null
    : (dateLookup as string) ?? null

  // Only a referral holding all three is actually consuming a slot.
  const releasedSlot = scheduleLinks.length > 0 && !!previousTime && !!previousDate

  const fields: Record<string, unknown> = {
    ...alsoWrite,
    ...TERMINAL_FIELDS[outcome],
    'Saturday Schedule': [],
    'Appointment Time': null,
  }
  if (releasedSlot) {
    fields['Original Appointment Date'] = previousDate
    fields['Original Appointment Time'] = previousTime
  }

  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!patchRes.ok) {
    return { ok: false, status: 500, message: await patchRes.text() }
  }

  // The email is best-effort and must never undo the write above, which is
  // the part that matters operationally. sendCancellationNotice() reports its
  // own failures rather than throwing.
  let cancellationNotice: CancellationNoticeResult | null = null
  if (notify && releasedSlot) {
    cancellationNotice = await sendCancellationNotice(referralId, previousDate, previousTime)
  }

  return { ok: true, releasedSlot, previousDate, previousTime, cancellationNotice }
}
