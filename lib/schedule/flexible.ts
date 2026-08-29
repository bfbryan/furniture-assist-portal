// lib/schedule/flexible.ts
//
// FLEXIBLE SCHEDULING — "I don't mind which Saturday, you pick."
//
// ============================================================
// What this replaces
// ============================================================
// This ran in Airtable as `at-auto-schedule-script.js`, an automation on
// record creation. Ben has switched those automations off in favour of code,
// so as of that moment NOTHING assigned a date to a referral submitted without
// a specific one — it was created with no slot and stayed there silently.
//
// It does not bite today only because Dawson picks every date by hand. It bites
// the moment a flexible referral is created from anywhere, which is why this is
// code now rather than a note in a comment.
//
// ============================================================
// The rule, as Ben stated it
// ============================================================
// A flexible referral gets:
//
//   1. the NEXT AVAILABLE SATURDAY,
//   2. respecting the 50-appointment day cap that applies to agencies,
//   3. no earlier than 14 DAYS out,
//   4. in a TIME SLOT under that slot's own per-hour cap.
//
// 14 is confirmed. The old automation used 21, and a comment in
// app/api/dawson/schedule/available/route.ts still documented that number long
// after it stopped being true — corrected in the same change as this file.
//
// ============================================================
// This joins two things that already worked
// ============================================================
// Neither half is new, and that is deliberate — the point of this module is
// that the two existing behaviours meet in one place instead of a third
// implementation appearing:
//
//   • WHICH SATURDAY is the query from /api/agency/schedule/available: Status
//     'Open', `{Slots Remaining} > 0` (Airtable computes that field, so it
//     stays the authority on the 50 cap), on or after today + leadDays,
//     ascending. Same formula, same fields, same lead-day meaning.
//
//   • WHICH HOUR is pickFirstOpenSlot from the referral submit routes: walk
//     TIME_ORDER and take the first slot whose booked count is under its
//     TIME_CAPS entry. That function has moved into lib/schedule/capacity.ts so
//     this module and those routes share one copy rather than two.
//
// The only genuinely new logic is the join: a Saturday that passes the 50 cap
// can still have all five of its hours at cap, so this walks the candidate days
// in order and returns the first one that has BOTH room in the day and room in
// an hour. The old automation did the same thing.

import { addDaysISO, easternTodayISO } from '@/lib/dates'
import { pickFirstOpenSlot, type TimeSlot } from '@/lib/schedule/capacity'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

const SCHEDULE_TABLE = 'Saturday Schedule'

/**
 * Minimum lead time for an automatically assigned date, in days.
 *
 * Ben confirmed 14 explicitly. The old Airtable automation used 21; that number
 * is dead and should not be reintroduced.
 *
 * Note this is NOT the same as the agency availability endpoint's default,
 * which is also 14 but is a picker floor a caller may override per request.
 * This one is the policy for a date nobody chose.
 */
export const FLEXIBLE_LEAD_DAYS = 14

/** How many Saturdays ahead to look before giving up. */
const SEARCH_WEEKS = 26

export type FlexibleAssignment = {
  /** Saturday Schedule record id, for the link field on Client Referrals. */
  scheduleId: string
  /** The chosen Saturday as 'YYYY-MM-DD'. */
  date: string
  /** The chosen hour, guaranteed under its own cap at read time. */
  time: TimeSlot
}

type ScheduleRecord = { id: string; fields: Record<string, unknown> }

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Per-hour booked counts off a Saturday Schedule row.
 *
 * The `??` fallbacks mirror the availability endpoints exactly: the base has
 * carried both bare ('10am') and suffixed ('10am Booked') field names, and
 * every reader in this repo tolerates either rather than assuming one.
 */
function bookedByTime(fields: Record<string, unknown>): Record<TimeSlot, number> {
  return {
    '9am': toInt(fields['9am'] ?? fields['9am Booked']),
    '10am': toInt(fields['10am'] ?? fields['10am Booked']),
    '11am': toInt(fields['11am'] ?? fields['11am Booked']),
    '12pm': toInt(fields['12pm'] ?? fields['12pm Booked']),
    '1pm': toInt(fields['1pm'] ?? fields['1pm Booked']),
  }
}

/**
 * The next Saturday a flexible referral can be booked onto, and the hour on it.
 *
 * Returns null when nothing in the next `SEARCH_WEEKS` weeks qualifies — every
 * Saturday either full to 50, closed, or with all five hours at cap. Callers
 * must handle that rather than assuming a date: silently leaving the referral
 * unscheduled is the exact failure this module exists to end, so the caller
 * should surface it.
 *
 * @param leadDays override for the 14-day floor. Present for tests and for a
 *                caller with a genuinely different policy; do not pass 21.
 */
export async function findNextFlexibleSlot(
  leadDays: number = FLEXIBLE_LEAD_DAYS,
): Promise<FlexibleAssignment | null> {
  const today = easternTodayISO()
  const minDate = addDaysISO(today, leadDays)
  const endDate = addDaysISO(today, SEARCH_WEEKS * 7)

  // Identical to the agency availability endpoint's filter — including
  // `{Slots Remaining} > 0`, which IS the 50 cap. Airtable computes that field,
  // so the day cap is enforced by the base rather than recomputed here and
  // allowed to drift.
  //
  // NOT(IS_BEFORE(...)) rather than IS_AFTER so a Saturday exactly on the
  // 14-day boundary still counts as "no earlier than 14 days out".
  const formula = `AND(
    NOT(IS_BEFORE({Date}, '${minDate}')),
    IS_BEFORE({Date}, '${endDate}'),
    {Status} = 'Open',
    {Slots Remaining} > 0
  )`.replace(/\s+/g, ' ')

  const url =
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE)}?` +
    `filterByFormula=${encodeURIComponent(formula)}&` +
    `sort[0][field]=Date&sort[0][direction]=asc&` +
    `maxRecords=100`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Saturday Schedule lookup failed: ${await res.text()}`)
  }

  const data = await res.json()
  const records: ScheduleRecord[] = data.records ?? []

  // Ascending by Date, so the first record that also has an open hour is by
  // definition the NEXT available Saturday. A day can pass the 50 cap and still
  // have every hour full — 9am and 1pm are small (5 and 3) — so the per-hour
  // check has to happen per candidate rather than only on the first one.
  for (const record of records) {
    const date = record.fields['Date']
    if (typeof date !== 'string' || !date) continue

    const time = pickFirstOpenSlot(bookedByTime(record.fields))
    if (!time) continue

    return { scheduleId: record.id, date: date.slice(0, 10), time }
  }

  return null
}
