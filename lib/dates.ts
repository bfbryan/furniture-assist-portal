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

// ---------- (3) typed mm/dd/yyyy entry ----------
//
// For date fields a human TYPES rather than picks. The internal Add Referral
// screen's Date of Birth is the first: Ben asked for a plain typed field
// because tabbing through a native picker is slower for Dawson, and a native
// date input has a second problem he did not raise — on iPadOS Safari an EMPTY
// one renders today's date in the control, so a required field that is really
// blank looks filled in. (This form's own submit handler already carried a
// comment about "a date input that looks filled but holds an empty value".)
//
// These two are pure string functions, deliberately: the mask is what the
// field shows as you type, and the parse is the only thing allowed to produce
// the ISO value the rest of the app stores. Nothing downstream changes — the
// stored value is still 'YYYY-MM-DD', which is what the duplicate-client check,
// findClientMatches() and the submit route's formatDOB() all already expect.

/**
 * Format what someone is typing into mm/dd/yyyy, as they type it.
 *
 * Handles both habits: eight straight digits ("12251990") get their slashes
 * inserted for them, and slashes typed by hand are respected as segment
 * boundaries, so "1/2/1990" becomes "01/02/1990" and not "12/19/90".
 *
 * Purely cosmetic — it never decides whether a date is real. That is
 * parseMdyToISO()'s job, and it is the one whose answer gets stored.
 */
export function maskMdyInput(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^\d/]/g, '')
  if (!cleaned) return ''

  // A '/' the user typed means "this segment is finished", so a single digit
  // before one is a zero-padded month or day rather than the first half of a
  // two-digit one. Anything not closed by a separator just flows into the
  // fixed widths below.
  const parts = cleaned.split('/')
  let digits = ''
  for (let i = 0; i < parts.length; i++) {
    const closed = i < parts.length - 1
    digits += closed && i < 2 ? parts[i].padStart(2, '0').slice(0, 2) : parts[i]
  }

  digits = digits.slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * 'mm/dd/yyyy' -> 'YYYY-MM-DD', or null if it is not a real past date.
 *
 * Null covers every way this can fail, and they are all the same to the
 * caller: half-typed, out of range, or a day that does not exist. Rejecting
 * 02/30/1990 needs the round-trip below — Date happily rolls that over to
 * 03/02 and would otherwise store a birthday nobody has.
 *
 * A date of birth in the future is refused too. `todayISO` is injected so a
 * caller can pass one value for a whole render rather than re-reading the
 * clock, and so this stays testable.
 */
export function parseMdyToISO(
  text: string | null | undefined,
  todayISO: string = easternTodayISO(),
): string | null {
  const match = String(text ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])

  // 1900 is a floor for mistyped years ("0199", "2O26" once the letter is
  // stripped). Nobody being referred for furniture was born before it.
  if (year < 1900) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const dt = new Date(Date.UTC(year, month - 1, day))
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null
  }

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // ISO date strings compare correctly as plain strings.
  if (iso > todayISO) return null
  return iso
}
