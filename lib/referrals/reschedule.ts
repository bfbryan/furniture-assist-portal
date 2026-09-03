// lib/referrals/reschedule.ts
//
// THE reschedule. Every path that moves a referral to a new Saturday goes
// through rescheduleReferral() — Dawson doing it by hand in the portal
// (app/api/dawson/referrals/[id]/reschedule/route.ts) and the OCR scan
// pipeline reading a RESCH/DATE box (lib/scanning/ocr.ts).
//
// This logic was lifted verbatim out of the manual route, which had been
// running it correctly in production; the route is now a thin HTTP wrapper
// over it. It is deliberately NOT reimplemented per caller: a reschedule is
// five coupled writes plus an email, and two copies would drift.
//
// DEPENDENCY (recorded, not fixed here): app/api/dawson/referrals/submit/route.ts
// still carries two more copies of this booking logic — an inline
// specific-date block and rescheduleExistingReferral() — which have already
// drifted once (a reminder re-arm was added here and missed there). That route
// is separately broken (it writes plaintext to lookup fields) and Ben is
// rewriting it as part of the agency New Referral work; the consolidation onto
// this function happens there.
//
// Sep 2026: `review` param added so a first-time booking (Needs Action "Approve"
// on a pending referral) can flip Referral Review to 'Approved' in the SAME
// PATCH as the slot write — no second call, no window where a failed follow-up
// leaves a referral approved but booked nowhere. Reschedule callers (the OCR
// pipeline, the Dawson reschedule route) pass nothing and are unaffected.
//
// What one call does:
//   1. Snapshots the referral's current appointment into 'Original
//      Appointment Date' / 'Original Appointment Time' (overwrite-every-time),
//      but only when there IS a current appointment to snapshot.
//   2. Resolves the time slot — explicit if given, otherwise the first slot
//      under cap in fill order.
//   3. Links the new Saturday Schedule row, writes the time, and sets
//      Appointment Status = 'Scheduled'.
//   4. Re-arms the Monday reminder by clearing 'Reminder Email Sent'.
//   5. Fires the Reschedule Notice — regenerates the slip PDF for the new
//      date and emails the referring agency — but only when step 1 actually
//      snapshotted something, i.e. this is a genuine move rather than a
//      first-time scheduling.
//
// Callers get a discriminated result rather than an exception, because the
// two callers need opposite handling: the route turns a failure into an HTTP
// status for a human staring at a modal, while the scan pipeline turns it
// into an Airtable flag for a human who is not there.

import { sendRescheduleNotice, type RescheduleNoticeResult } from '@/lib/notifications/reschedule-notice'
import { parseDateOnly } from '@/lib/dates'
import {
  assertReferralClientMayBeRescheduled,
  doNotServeUnverifiedMessage,
  DoNotServeError,
} from '@/lib/clients/do-not-serve'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// Capacities, slot names and fill order all come from lib/schedule/capacity.ts.
// Re-exported here so the modules that already import them from this file keep
// working -- there is still exactly one definition.
import { TIME_CAPS, TIME_ORDER, VALID_TIMES, type TimeSlot } from '@/lib/schedule/capacity'
export { TIME_CAPS, TIME_ORDER, VALID_TIMES, type TimeSlot }

// An appointment date is a date-only value, so it is anchored at UTC midnight
// via the shared parser and read back with getUTCDay(). The pair has to stay
// together: getDay() on a UTC-anchored date would report the previous day
// anywhere west of Greenwich, and every Saturday would look like a Friday.
//
// This previously built the Date from local components at noon, which also
// worked, but only by relying on local-noon never crossing a day boundary.
// Going through parseDateOnly makes it independent of the runtime zone by
// construction rather than by argument.
export function isSaturday(isoDate: string): boolean {
  const dt = parseDateOnly(isoDate)
  return dt !== null && dt.getUTCDay() === 6
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

// Look up a Saturday Schedule record by ISO date. Returns the full record
// (id + status + per-slot booked counts) or null. Uses DATETIME_FORMAT to
// compare on YYYY-MM-DD regardless of AT's stored datetime precision.
//
// Status is read but NOT filtered on in the formula, so a Blackout day comes
// back and can be reported as a Blackout day rather than as a missing row.
// Telling the caller "create that Saturday" when the Saturday exists and is
// deliberately closed would invite a duplicate schedule row.
async function findScheduleRecordByDate(isoDate: string): Promise<{
  id: string
  status: string | null
  bookedByTime: Record<TimeSlot, number>
} | null> {
  const formula = `DATETIME_FORMAT({Date}, 'YYYY-MM-DD') = '${isoDate}'`
  const url =
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Saturday Schedule')}?` +
    `filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) throw new Error(`Saturday Schedule lookup failed: ${await res.text()}`)
  const data = await res.json()
  if (!data.records || data.records.length === 0) return null
  const rec = data.records[0]
  return {
    id: rec.id as string,
    status: typeof rec.fields['Status'] === 'string' ? rec.fields['Status'] : null,
    bookedByTime: {
      '9am':  toInt(rec.fields['9am']  ?? rec.fields['9am Booked']),
      '10am': toInt(rec.fields['10am'] ?? rec.fields['10am Booked']),
      '11am': toInt(rec.fields['11am'] ?? rec.fields['11am Booked']),
      '12pm': toInt(rec.fields['12pm'] ?? rec.fields['12pm Booked']),
      '1pm':  toInt(rec.fields['1pm']  ?? rec.fields['1pm Booked']),
    },
  }
}

// First slot under cap using TIME_ORDER. Null if all 5 are at cap.
function pickFirstOpenSlot(bookedByTime: Record<TimeSlot, number>): TimeSlot | null {
  for (const slot of TIME_ORDER) {
    if (bookedByTime[slot] < TIME_CAPS[slot]) return slot
  }
  return null
}

// Read the current referral so we can snapshot its pre-reschedule
// Saturday Schedule + Appointment Time into the Original fields.
async function getReferral(id: string): Promise<any | null> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) return null
  return await res.json()
}

/** Why a reschedule could not be applied. The caller decides how loudly to say so. */
export type RescheduleFailureReason =
  | 'missing-date'
  | 'invalid-time'
  | 'not-saturday'
  | 'no-schedule-row'
  | 'blackout-date'
  | 'all-slots-full'
  | 'lookup-failed'
  | 'write-failed'
  /** The client is flagged do-not-serve. Permanent: retrying will not help. */
  | 'do-not-serve'
  /** The do-not-serve status could not be read, so this failed closed. Retryable. */
  | 'do-not-serve-unverified'

/** Set only when an explicitly requested slot was already at or over its cap. */
export interface CapacityOverride {
  slot: TimeSlot
  booked: number
  cap: number
}

export type RescheduleResult =
  | {
      ok: true
      appointmentTime: TimeSlot
      /** True when there was a real previous appointment, so the notice fired. */
      snapshotTaken: boolean
      previousDate: string | null
      previousTime: string | null
      /** Non-null when the requested slot was full and we booked into it anyway. */
      capacityOverride: CapacityOverride | null
      rescheduleNotice: RescheduleNoticeResult | null
    }
  | { ok: false; reason: RescheduleFailureReason; message: string }

export async function rescheduleReferral({
  referralId,
  preferredDate,
  appointmentTime,
  review,
}: {
  referralId: string
  preferredDate: string | null | undefined
  /** A valid slot, or null/undefined/'' to let the allocator choose. */
  appointmentTime?: string | null
  /**
   * Optional. When set (the Needs Action "Approve" path passes 'Approved'),
   * Referral Review is written in the same PATCH as the slot. Omit for a
   * reschedule — the referral is already Approved and this must not touch it.
   */
  review?: string
}): Promise<RescheduleResult> {
  if (!preferredDate) {
    return { ok: false, reason: 'missing-date', message: 'Preferred date is required.' }
  }
  if (!isSaturday(preferredDate)) {
    return { ok: false, reason: 'not-saturday', message: 'Preferred date must be a Saturday.' }
  }

  const hasTime =
    typeof appointmentTime === 'string' && VALID_TIMES.has(appointmentTime)

  if (
    appointmentTime !== undefined &&
    appointmentTime !== null &&
    appointmentTime !== '' &&
    !hasTime
  ) {
    return {
      ok: false,
      reason: 'invalid-time',
      message: `Invalid appointment time: ${appointmentTime}`,
    }
  }

  // ---- Snapshot current values for the Original Appointment fields.
  //   Policy: overwrite every time. Only writes when the referral is
  //   currently scheduled (has a Saturday Schedule link + Time). If it's
  //   currently Pending Schedule/Reschedule, there's nothing to snapshot.
  const current = await getReferral(referralId)
  const currentScheduleLinks: string[] = current?.fields?.['Saturday Schedule'] ?? []
  const currentApptDateLookup: string[] | string | undefined =
    current?.fields?.['Appointment Date']
  const currentApptTime: string | undefined = current?.fields?.['Appointment Time']

  // Appointment Date is a lookup (array of strings from Saturday Schedule).
  // Normalize to a single ISO date string for the Original field.
  const currentApptDate: string | null = Array.isArray(currentApptDateLookup)
    ? (currentApptDateLookup[0] as string) ?? null
    : (currentApptDateLookup as string) ?? null

  const shouldSnapshot =
    currentScheduleLinks.length > 0 && !!currentApptTime && !!currentApptDate

  // ---- Do-not-serve. A flagged client must not be moved onto a new Saturday.
  //   Ben widened the flag from "cannot be referred" to "cannot be put in
  //   front of the warehouse", which a reschedule does just as surely as a new
  //   referral does. It sits here, in the shared function, rather than in the
  //   two callers, so Dawson's reschedule button and the OCR scan pipeline are
  //   covered by construction and a third caller cannot forget it.
  //
  //   Before any write, and after the referral read above so it costs no extra
  //   round trip. First Name / Last Name / DOB on Client Referrals are lookups
  //   through the Client link, so they arrive wrapped in arrays; the fallback
  //   only runs for a row with no link at all.
  //   Fails closed on a referral that could not be read at all. getReferral()
  //   returns null for any non-OK response, and the code below tolerates that
  //   by skipping the snapshot and writing anyway — which is survivable for a
  //   snapshot and not survivable for this. A record whose Client link cannot
  //   be seen is a record whose flag cannot be seen.
  if (!current) {
    return {
      ok: false,
      reason: 'do-not-serve-unverified',
      message: doNotServeUnverifiedMessage(
        'the appointment was not moved',
        `referral ${referralId} could not be read`,
      ),
    }
  }

  try {
    const clientLinks: string[] = current?.fields?.['Client'] ?? []
    const lookup = (v: unknown): string =>
      Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : ''
    await assertReferralClientMayBeRescheduled({
      clientId: clientLinks[0] ?? null,
      firstName: lookup(current?.fields?.['First Name']),
      lastName: lookup(current?.fields?.['Last Name']),
      dob: lookup(current?.fields?.['DOB']),
    })
  } catch (e) {
    if (e instanceof DoNotServeError) {
      return { ok: false, reason: 'do-not-serve', message: e.message }
    }
    return {
      ok: false,
      reason: 'do-not-serve-unverified',
      message: doNotServeUnverifiedMessage(
        'the appointment was not moved',
        e instanceof Error ? e.message : String(e),
      ),
    }
  }

  // ---- Look up the Saturday Schedule row for the requested date.
  let scheduleRow: Awaited<ReturnType<typeof findScheduleRecordByDate>>
  try {
    scheduleRow = await findScheduleRecordByDate(preferredDate)
  } catch (e) {
    return {
      ok: false,
      reason: 'lookup-failed',
      message: e instanceof Error ? e.message : String(e),
    }
  }
  if (!scheduleRow) {
    return {
      ok: false,
      reason: 'no-schedule-row',
      message: `No Saturday Schedule row found for ${preferredDate}.`,
    }
  }

  // A Blackout Saturday is a closure, not a full day. Its per-hour rollups are
  // all 0 and Slots Remaining is forced to 0, so every capacity check below
  // reads it as completely empty and would happily book into it.
  //
  // Dawson cannot reach this by clicking — his date picker and the agency one
  // both filter on Status = 'Open'. The OCR scan pipeline can: it takes the
  // date a volunteer wrote in the RESCH/DATE box, and the Saturday after a
  // scanned one is often a Blackout (2026-09-05 follows 2026-08-29). Booking
  // there would move the client onto a day the warehouse is shut, flip the
  // record to Scheduled, re-arm the reminder, and — because the Reschedule
  // Notice automation is enabled — email the agency to confirm it.
  //
  // This is deliberately NOT a capacity check. Dawson's authority to book past
  // a cap is untouched; a closed day is not a full day.
  if (scheduleRow.status === 'Blackout') {
    return {
      ok: false,
      reason: 'blackout-date',
      message: `${preferredDate} is a Blackout Saturday — the warehouse is closed that day. Pick a different Saturday.`,
    }
  }

  // ---- Decide the time slot.
  //   - Explicit time -> use it. Caps are NOT enforced: an explicit time is
  //     an override by definition (Dawson has AT-level override authority,
  //     and on a scanned sheet the handwriting is the same instruction).
  //     We report the override so the caller can make it visible.
  //   - No time -> pick first open slot under cap.
  let resolvedTime: TimeSlot
  let capacityOverride: CapacityOverride | null = null
  if (hasTime) {
    resolvedTime = appointmentTime as TimeSlot
    const booked = scheduleRow.bookedByTime[resolvedTime]
    const cap = TIME_CAPS[resolvedTime]
    if (booked >= cap) capacityOverride = { slot: resolvedTime, booked, cap }
  } else {
    const picked = pickFirstOpenSlot(scheduleRow.bookedByTime)
    if (!picked) {
      return {
        ok: false,
        reason: 'all-slots-full',
        message: `All 5 time slots on ${preferredDate} are at capacity. Pick a specific time to override, or choose a different Saturday.`,
      }
    }
    resolvedTime = picked
  }

  const fields: Record<string, any> = {
    'Scheduling Flexibility': 'Specific Date',
    'Preferred Date': preferredDate,
    'Saturday Schedule': [scheduleRow.id],
    'Appointment Time': resolvedTime,
    'Appointment Status': 'Scheduled',
    // Re-arm the Monday reminder for the NEW date: the "Reminder Email Pending"
    // view only matches rows where 'Reminder Email Sent' is blank, so without
    // this a referral that was already reminded never re-enters the view.
    'Reminder Email Sent': false,
    'Reminder Sent At': null,
  }

  if (shouldSnapshot) {
    fields['Original Appointment Date'] = currentApptDate
    fields['Original Appointment Time'] = currentApptTime
  }

  // First-booking Approve only — see the `review` param. Never set on a
  // reschedule (shouldSnapshot true), which leaves an already-Approved
  // referral's review untouched.
  if (review && !shouldSnapshot) {
    fields['Referral Review'] = review
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${referralId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields, typecast: true }),
    }
  )

  if (!res.ok) {
    return { ok: false, reason: 'write-failed', message: await res.text() }
  }

  // ---- Fire the Reschedule Notice.
  //   Only when this referral was already Scheduled (shouldSnapshot true) --
  //   i.e. there's a genuine previous appointment to report. A first-time
  //   Pending Schedule -> Scheduled transition is handled by the Wednesday
  //   Appointment Confirmation cron instead, not here.
  //   sendRescheduleNotice never throws; it reports its own failure, and a
  //   failed email must not undo a committed Airtable write.
  let rescheduleNotice: RescheduleNoticeResult | null = null
  if (shouldSnapshot) {
    rescheduleNotice = await sendRescheduleNotice(
      referralId,
      currentApptDate,
      currentApptTime ?? null
    )
  }

  return {
    ok: true,
    appointmentTime: resolvedTime,
    snapshotTaken: shouldSnapshot,
    previousDate: currentApptDate,
    previousTime: currentApptTime ?? null,
    capacityOverride,
    rescheduleNotice,
  }
}
