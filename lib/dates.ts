// lib/dates.ts
//
// Every date in this app is a New Jersey date. The charity, its clients and its
// Saturday pickup slots are all Eastern time, but the code runs on Vercel, whose
// runtime clock is UTC. Anything that asked the runtime "what day is it?" via
// new Date() + getHours()/getMonth()/toISOString() therefore rolled over to the
// next day at 8pm Eastern (7pm during standard time).
//
// Two distinct kinds of value live in this codebase; they need opposite
// treatment, which is the trap that produced the original bug:
//
//   1. An INSTANT — "now", or an audit timestamp. To read a calendar field off
//      it (the hour, the date, the year) you must name the zone: Eastern.
//
//   2. A DATE-ONLY value — Airtable's 'YYYY-MM-DD' Date fields (appointment
//      date, referral date, invited date). These carry no time and no zone.
//      Anchoring one at UTC midnight and then formatting it *in Eastern* prints
//      the previous day — the classic off-by-one. They are anchored at UTC
//      midnight and formatted in UTC, so the calendar date survives untouched
//      wherever the code runs.
//
// Use the easternX() helpers for (1) and the ISO/date-only helpers for (2).

export const EASTERN_TIME_ZONE = 'America/New_York'

// ---------- (1) reading calendar fields off an instant, in Eastern ----------

/**
 * Today's Eastern calendar date as 'YYYY-MM-DD'.
 *
 * 'en-CA' is the shortest way to get ISO ordering out of toLocaleDateString;
 * this matches the pattern the two referral submit routes already used.
 */
export function easternTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: EASTERN_TIME_ZONE })
}

/** Current Eastern hour, 0-23 — the input to a "Good morning/afternoon/evening". */
export function easternHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now)
  // hourCycle h23 is the correct request, but some ICU builds still hand back
  // '24' for midnight rather than '00'. The modulo makes that harmless.
  return Number(hour) % 24
}

/** Current Eastern calendar year — e.g. for "the year on an undated form". */
export function easternYear(now: Date = new Date()): number {
  return Number(easternTodayISO(now).slice(0, 4))
}

/**
 * Format a true instant (an ISO timestamp, a Date) in Eastern. For Airtable
 * Date fields use formatDateOnly instead — see the note at the top of the file.
 */
export function formatEasternTimestamp(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { ...options, timeZone: EASTERN_TIME_ZONE })
}

// ---------- (2) date-only 'YYYY-MM-DD' values ----------

/**
 * Anchor a date-only string at UTC midnight. Returns null for anything that
 * isn't a leading 'YYYY-MM-DD', including empty and null.
 *
 * UTC rather than local midnight so the value means the same thing on a laptop
 * in New Jersey and on a Vercel box in UTC. Arithmetic on the result is also
 * DST-proof, because UTC days are all exactly 24 hours.
 */
export function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Format a date-only value for display. Formatted in UTC to match the anchor,
 * which is what keeps the printed day equal to the stored day in every zone.
 */
export function formatDateOnly(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = parseDateOnly(iso)
  if (!date) return '—'
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

/** Shift a 'YYYY-MM-DD' by whole days, returning 'YYYY-MM-DD'. */
export function addDaysISO(iso: string, days: number): string {
  const date = parseDateOnly(iso)
  if (!date) return iso
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Whole days from `fromISO` to `toISO` — negative when `toISO` is earlier.
 * Both sides are UTC-anchored, so no DST transition can round this off by one.
 */
export function differenceInDaysISO(
  fromISO: string | null | undefined,
  toISO: string | null | undefined,
): number | null {
  const from = parseDateOnly(fromISO)
  const to = parseDateOnly(toISO)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
