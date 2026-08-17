// lib/referrals/match.ts
//
// Fuzzy client matching against the Clients table, used by the referral
// intake route (app/api/dawson/referrals/submit/route.ts) to find an
// existing Client before creating a new one, and to surface prior
// appointment history (Completed / No Show / Cancelled) so staff can
// confirm intent before booking instead of silently creating a duplicate
// Client + Client Referrals record.
//
// Distinct from the OCR resolver's normName() in lib/scanning/ocr.ts: that
// function folds lookalike glyphs (1/i/l, 0/o, 5/s, 8/b, 2/z) because it's
// disambiguating a scanned/printed record ID. Here the input is typed by
// hand at intake, so the failure mode is typos, not OCR glyph confusion --
// we normalize case/whitespace/punctuation but do NOT fold digits into
// letters, since that would create false-positive collisions between
// genuinely different names for no benefit.
//
// Last name typo tolerance (Aug 2026): a plain misspelling in the surname
// used to silently defeat the whole check, since candidates were fetched
// with an exact last-name match. Loosened to allow a small Levenshtein
// edit distance (see lastNameCloseEnough) -- still a real gate, and still
// requires at least one corroborating signal (first name, DOB, or phone)
// to actually count as a match, same as before. First/DOB/phone
// themselves are still exact-or-substring, not edit-distance tolerant --
// only the surname gate was loosened, since that was the field a typo
// there completely hid the client rather than just costing a few
// scoring points.

import { differenceInDaysISO, easternTodayISO } from '../dates'
import { isDoNotServeStatus } from '../clients/do-not-serve'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const CLIENTS_TABLE = 'Clients'
const REFERRALS_TABLE = 'Client Referrals'

// ---- windows, per business rule (confirmed with user Aug 2026) ----
// Two separate concepts, both scoped to 12 months for Completed/No
// Show/Cancelled: whether a past appointment is worth SURFACING at all
// (unified across all three -- a no-show from 4 months ago should still
// show up in the modal, just without the reschedule option), and, only
// for No Show, a much narrower window that governs the "reschedule this
// exact record in place" action specifically. Completed and Cancelled
// stay one-way no matter how recent -- there's nothing to reopen for
// either of those, always a new referral record if staff confirm it's
// the same person. No Show within NO_SHOW_RESCHEDULE_WINDOW_DAYS (and
// same referring agency) reschedules the SAME record instead (no new
// record) -- in practice it's almost always the same appointment being
// picked back up within a couple weeks, not a fresh referral. 21 days
// (not 14) to cover a closure/holiday pushing things a week late.
// Reopening the record does mean it stops showing up as a no-show in
// future by-agency reporting once resolved -- accepted knowingly as a
// fair tradeoff given how narrow the window is and how it's mostly
// self-correcting (they DID come back).
//
// 25 days (not 21) -- confirmed Aug 2026: realistically 14 days, but
// sometimes we're closed for a holiday, so padded out further to absorb
// that.
const COMPLETED_WINDOW_DAYS = 365
const NO_SHOW_WINDOW_DAYS = 365
const NO_SHOW_RESCHEDULE_WINDOW_DAYS = 25
const CANCELLED_WINDOW_DAYS = 365

// Real Appointment Status values (confirmed Aug 2026): Unscheduled,
// Pending Schedule, Scheduled, Cancelled, Reschedule, Completed, No Show.
// "Reschedule" is vestigial -- not used anymore, status gets flipped
// directly instead of routed through a view. "Unscheduled" may fall out
// of use going forward but is kept here defensively. "Pending Schedule"
// is what an agency-submitted referral sits in before Dawson reviews it.
// All three represent "not yet resolved" -- the active-appointment guard
// below treats them the same way.
const ACTIVE_STATUSES = ['Scheduled', 'Pending Schedule', 'Unscheduled']

export type ClientRecord = {
  id: string
  firstName: string
  lastName: string
  dob: string
  phone: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
  language: string
  referralIds: string[] // linked Client Referrals record IDs
  // Clients.Status — Active | Served | DNS, and sometimes blank. Carried so
  // the Add Referral banner can show a do-not-serve flag as Dawson types,
  // rather than letting him fill in the whole form and hit a 403 at submit.
  // Only 'DNS' means anything to the UI; see lib/clients/do-not-serve.ts.
  status: string | null
}

export type ReferralHistoryItem = {
  id: string
  appointmentStatus: string
  appointmentDate: string // as stored on the record; expected ISO-ish
  preferredDate: string // fallback display for Unscheduled records, which usually have no Appointment Date yet
  referringAgency: string // lookup off Referring Staff Link -- also used to gate the no-show "reschedule" option to same-agency only
  referringStaff: string // lookup off Referring Staff Link
  // Carried along so the Add Referral form can prefill these onto a new
  // referral when staff choose "book new appointment" for a match, instead
  // of Dawson re-typing the same household/items info from scratch.
  itemsRequested: string[]
  hhSize: string
  children: string
  internalNotes: string
}

export type MatchScenario = {
  // 'active' = a currently Scheduled or Unscheduled referral -- the guard
  // against booking a second appointment on top of one that's already
  // pending. No date window applies to this one; it's just true or false
  // right now.
  type: 'completed' | 'no-show' | 'cancelled' | 'active'
  referral: ReferralHistoryItem
  // Only meaningful when type === 'no-show'. True when this specific
  // no-show falls inside NO_SHOW_RESCHEDULE_WINDOW_DAYS -- the modal only
  // offers "reschedule in place" when this is true (and the agency
  // matches); otherwise it's surfaced the same as Completed/Cancelled.
  eligibleForReschedule?: boolean
}

export type ClientMatch = {
  client: ClientRecord
  // Every past referral for this Client, most recent first -- the modal
  // shows this in full (not just the windowed scenarios below) so staff
  // get the whole picture, not just whatever happened to trip a window.
  history: ReferralHistoryItem[]
  // The subset of `history` that's actually worth surfacing (Completed/No
  // Show/Cancelled within 12mo, plus any currently active appointment
  // regardless of date) -- this is what drives whether the modal shows at
  // all, and which action buttons are available.
  scenarios: MatchScenario[]
}

function normalize(s: string | undefined | null): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '')
}

function normalizePhone(s: string | undefined | null): string {
  return String(s || '').replace(/\D/g, '')
}

// Clients.DOB is a true Airtable Date field, so the API returns it as ISO
// (YYYY-MM-DD) on read regardless of what format was used to write it --
// but the rest of this codebase's convention (formatDOB() in the submit
// route) writes DOB as M/D/YYYY. Rather than assume which format shows up
// on either side of the comparison, normalize both to ISO before comparing.
function normalizeDob(s: string | undefined | null): string {
  const str = String(s || '').trim()
  if (!str) return ''

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return ''
}

// Measured against the Eastern calendar day. Against the runtime clock the
// count ticked over at 8pm Eastern, so on Vercel a No Show could age out of
// the reschedule window an evening early.
function daysAgo(dateStr: string): number | null {
  return differenceInDaysISO(dateStr, easternTodayISO())
}

// Damerau-Levenshtein (optimal string alignment variant) -- edit distance
// counting single-character insertions/deletions/substitutions AND
// adjacent transpositions as one edit each. The transposition part
// matters a lot here: swapped-adjacent-letters ("Jonhson" for "Johnson")
// is one of the single most common typing mistakes, and plain Levenshtein
// counts a transposition as 2 edits, not 1 -- verified that gap directly
// against real examples before shipping this. O(n*m), fine for names.
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

// Confirmed Aug 2026: a plain typo in the last name (dropped/swapped/wrong
// letter) previously defeated the whole duplicate check, since the old
// candidate fetch required an exact last-name match. Loosened to tolerate
// a small edit distance instead -- still a real gate (a last name that's
// too different disqualifies the candidate outright, same as before), just
// no longer exact-only. Threshold scales gently with name length: capped
// at 2 edits so long surnames don't get too loose, and names of 3
// characters or fewer require an exact match -- a single edit on
// something that short changes the name too much to safely tolerate (Li
// vs. Lu, tested directly, is not the same person).
function lastNameCloseEnough(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const maxLen = Math.max(a.length, b.length)
  if (maxLen <= 3) return false
  const threshold = Math.min(2, Math.max(1, Math.floor(maxLen / 4)))
  return damerauLevenshtein(a, b) <= threshold
}

/**
 * Fetches Clients whose Last Name starts with the same first letter as
 * what was typed. Broadened (Aug 2026) from an exact last-name match --
 * that was silently missing anyone whose surname got typo'd on intake.
 * scoreMatch() below applies the real precision via lastNameCloseEnough()
 * (edit-distance), so this just needs to be a superset that stays
 * reasonably bounded rather than fetching the entire Clients table.
 * Paginated a few pages deep in case a lot of clients share a first
 * letter.
 */
async function fetchCandidateClients(lastName: string): Promise<any[]> {
  const firstLetter = normalize(lastName).charAt(0)
  if (!firstLetter) return []
  const safeLetter = firstLetter.replace(/"/g, '\\"')
  const formula = `LOWER(LEFT({Last Name}, 1)) = "${safeLetter}"`

  const records: any[] = []
  let offset: string | undefined
  let pages = 0
  const MAX_PAGES = 3

  do {
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENTS_TABLE)}` +
      `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100` +
      (offset ? `&offset=${offset}` : '')

    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      console.error(`fetchCandidateClients failed: ${res.status} ${await res.text()}`)
      break
    }
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset
    pages += 1
  } while (offset && pages < MAX_PAGES)

  return records
}

/**
 * Scores how likely `candidate` is the same person as the typed-in intake
 * data. Returns null if it's not a plausible match. A close-enough last
 * name is required (typo-tolerant via lastNameCloseEnough, but still a
 * real gate) -- on its own that's NOT enough to count as a match (common
 * surnames, family members), so also requires at least one corroborating
 * signal (first name, DOB, or phone) to clear the score threshold.
 */
function scoreMatch(
  candidate: any,
  input: { firstName: string; lastName: string; dob: string; phone: string }
): number | null {
  const cFirst = normalize(candidate.fields['First Name'])
  const cLast = normalize(candidate.fields['Last Name'])
  const cDob = normalizeDob(candidate.fields['DOB'])
  const cPhone = normalizePhone(candidate.fields['Phone'])

  const iFirst = normalize(input.firstName)
  const iLast = normalize(input.lastName)
  const iDob = normalizeDob(input.dob)
  const iPhone = normalizePhone(input.phone)

  if (!lastNameCloseEnough(cLast, iLast)) return null

  let score = 0
  if (cFirst === iFirst) score += 2
  else if (cFirst && iFirst && (cFirst.includes(iFirst) || iFirst.includes(cFirst))) score += 1

  if (cDob && iDob && cDob === iDob) score += 3
  if (cPhone && iPhone && cPhone === iPhone) score += 3

  return score >= 2 ? score : null
}

async function fetchReferralHistory(referralIds: string[]): Promise<ReferralHistoryItem[]> {
  if (referralIds.length === 0) return []

  // No batch-get-by-id endpoint on the standard Airtable API -- use
  // filterByFormula OR(RECORD_ID()='...', ...), chunked to stay well under
  // the formula length limit.
  const CHUNK = 40
  const items: ReferralHistoryItem[] = []

  for (let i = 0; i < referralIds.length; i += CHUNK) {
    const chunk = referralIds.slice(i, i + CHUNK)
    const formula = `OR(${chunk.map((id) => `RECORD_ID()="${id}"`).join(',')})`
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REFERRALS_TABLE)}` +
      `?filterByFormula=${encodeURIComponent(formula)}&` +
      `fields%5B%5D=${encodeURIComponent('Appointment Status')}&` +
      `fields%5B%5D=${encodeURIComponent('Appointment Date')}&` +
      `fields%5B%5D=${encodeURIComponent('Preferred Date')}&` +
      `fields%5B%5D=${encodeURIComponent('Referring Agency')}&` +
      `fields%5B%5D=${encodeURIComponent('Referring Staff')}&` +
      `fields%5B%5D=${encodeURIComponent('Items Requested')}&` +
      `fields%5B%5D=${encodeURIComponent('# in HH')}&` +
      `fields%5B%5D=${encodeURIComponent('# Children')}&` +
      `fields%5B%5D=${encodeURIComponent('Internal Notes')}&` +
      `pageSize=100`

    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      console.error(`fetchReferralHistory failed: ${res.status} ${await res.text()}`)
      continue
    }
    const data = await res.json()
    for (const r of data.records || []) {
      const rawDate = r.fields['Appointment Date']
      const rawPreferredDate = r.fields['Preferred Date']
      const rawAgency = r.fields['Referring Agency']
      const rawStaff = r.fields['Referring Staff']
      const rawItems = r.fields['Items Requested']
      items.push({
        id: r.id,
        appointmentStatus: r.fields['Appointment Status'] || '',
        appointmentDate: Array.isArray(rawDate) ? rawDate[0] || '' : rawDate || '',
        preferredDate: Array.isArray(rawPreferredDate) ? rawPreferredDate[0] || '' : rawPreferredDate || '',
        referringAgency: Array.isArray(rawAgency) ? rawAgency[0] || '' : rawAgency || '',
        referringStaff: Array.isArray(rawStaff) ? rawStaff[0] || '' : rawStaff || '',
        itemsRequested: Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [],
        hhSize: r.fields['# in HH'] != null ? String(r.fields['# in HH']) : '',
        children: r.fields['# Children'] != null ? String(r.fields['# Children']) : '',
        internalNotes: r.fields['Internal Notes'] || '',
      })
    }
  }

  // Most recent first -- both for display and so callers who just want
  // "the latest referring agency/staff" can take history[0].
  items.sort((a, b) => (b.appointmentDate || '').localeCompare(a.appointmentDate || ''))

  return items
}

function bucketHistory(history: ReferralHistoryItem[]): MatchScenario[] {
  const scenarios: MatchScenario[] = []

  for (const item of history) {
    // Active guard first, and deliberately before the date check below --
    // an Unscheduled/Pending Schedule referral usually has no Appointment
    // Date at all yet, so gating on daysAgo() would silently skip it
    // entirely otherwise.
    if (ACTIVE_STATUSES.includes(item.appointmentStatus)) {
      scenarios.push({ type: 'active', referral: item })
      continue
    }

    const age = daysAgo(item.appointmentDate)
    if (age === null) continue

    if (item.appointmentStatus === 'Completed' && age <= COMPLETED_WINDOW_DAYS) {
      scenarios.push({ type: 'completed', referral: item })
    } else if (item.appointmentStatus === 'No Show' && age <= NO_SHOW_WINDOW_DAYS) {
      scenarios.push({
        type: 'no-show',
        referral: item,
        eligibleForReschedule: age <= NO_SHOW_RESCHEDULE_WINDOW_DAYS,
      })
    } else if (item.appointmentStatus === 'Cancelled' && age <= CANCELLED_WINDOW_DAYS) {
      scenarios.push({ type: 'cancelled', referral: item })
    }
  }

  return scenarios
}

/**
 * Main entry point: given what was just typed into the Add Referral form,
 * find any existing Clients that are plausibly the same person, along with
 * whatever recent appointment history should be surfaced to staff before
 * they book. Called both by the check-duplicate route (pre-submit modal)
 * and defensively inside submit itself in case the modal step is skipped.
 *
 * `dob` may be passed as ISO (YYYY-MM-DD, straight off an HTML date input)
 * or M/D/YYYY (the submit route's formatDOB() convention) -- normalizeDob()
 * reconciles both against whatever Airtable returns for the Date field.
 */
export async function findClientMatches(input: {
  firstName: string
  lastName: string
  dob: string
  phone: string
}): Promise<ClientMatch[]> {
  if (!input.lastName) return []

  const candidates = await fetchCandidateClients(input.lastName)
  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreMatch(c, input) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number))

  const matches: ClientMatch[] = []

  for (const { candidate } of scored) {
    const referralLinks: string[] = candidate.fields['Client Referrals'] || []
    const history = await fetchReferralHistory(referralLinks)
    const scenarios = bucketHistory(history)

    // A do-not-serve client is ALWAYS worth surfacing, history or not. The
    // rule below exists to suppress meaningless name coincidences, but a
    // flagged client with no appointments on file is exactly the case Dawson
    // most needs to see early: nothing else on the Add Referral page would
    // mention it, and he would otherwise fill in the entire form before the
    // submit route refused him. The flag is the reason to show the card, not
    // the history.
    const isFlagged = isDoNotServeStatus(candidate.fields['Status'])

    // Only surface candidates that actually have something worth showing
    // -- a name/DOB coincidence with zero relevant history isn't a
    // meaningful duplicate concern, and shouldn't pop the modal or count
    // toward 'Possible Duplicate'.
    if (scenarios.length === 0 && !isFlagged) continue

    matches.push({
      client: {
        id: candidate.id,
        firstName: candidate.fields['First Name'] || '',
        lastName: candidate.fields['Last Name'] || '',
        dob: candidate.fields['DOB'] || '',
        phone: candidate.fields['Phone'] || '',
        address: candidate.fields['Address'] || '',
        address2: candidate.fields['Address 2'] || '',
        city: candidate.fields['City'] || '',
        state: candidate.fields['State'] || '',
        zip: candidate.fields['Zip'] || '',
        language: candidate.fields['Preferred Language'] || '',
        referralIds: referralLinks,
        status: candidate.fields['Status'] ?? null,
      },
      history,
      scenarios,
    })
  }

  return matches
}

/**
 * Creates a brand-new Client record from intake demographic fields. Used
 * when no match was found, or staff explicitly chose "not the same
 * person" in the modal. `dob` is expected already formatted M/D/YYYY,
 * matching the existing formatDOB() convention in the submit route.
 */
export async function createClient(fields: {
  firstName: string
  lastName: string
  dob: string
  address: string
  address2?: string
  city: string
  state: string
  zip: string
  county?: string
  phone: string
  language: string
}): Promise<string> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENTS_TABLE)}`
  const body: Record<string, any> = {
    'First Name': fields.firstName,
    'Last Name': fields.lastName,
    'DOB': fields.dob,
    'Address': fields.address,
    'City': fields.city,
    'State': fields.state,
    'Zip': fields.zip,
    'Phone': fields.phone,
    'Preferred Language': fields.language,
    'Status': 'Active',
  }
  if (fields.address2) body['Address 2'] = fields.address2
  if (fields.county) body['County'] = fields.county

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: body, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to create client: ${await res.text()}`)
  const data = await res.json()
  return data.id
}

/**
 * Used at submit time when staff picked "book new appointment" against a
 * matched Client (see check-duplicate + DuplicateClientModal), then edited
 * one of the prefilled identifying fields before submitting. If DOB,
 * phone, or address/city/state/zip no longer agree with what's on file for
 * that Client, the edit wasn't just a typo fix -- staff are telling us
 * (implicitly, by changing it) that this isn't confidently the same
 * record. Rather than silently link a new referral to a Client whose data
 * now disagrees with what was just typed, the submit route creates a
 * fresh Client from the edited values instead.
 *
 * Only compares a field when BOTH sides have a value -- a blank on either
 * side isn't a meaningful disagreement, just missing data.
 */
export async function clientDataDiverges(
  clientId: string,
  input: { dob: string; phone: string; address: string; city: string; state: string; zip: string }
): Promise<boolean> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    console.error(`clientDataDiverges lookup failed: ${res.status} ${await res.text()}`)
    return false // fail safe -- don't fork off a duplicate Client on a lookup hiccup
  }
  const data = await res.json()

  const onFileDob = normalizeDob(data.fields['DOB'])
  const typedDob = normalizeDob(input.dob)
  if (onFileDob && typedDob && onFileDob !== typedDob) return true

  const onFilePhone = normalizePhone(data.fields['Phone'])
  const typedPhone = normalizePhone(input.phone)
  if (onFilePhone && typedPhone && onFilePhone !== typedPhone) return true

  const onFileAddr = normalize(
    `${data.fields['Address'] || ''} ${data.fields['City'] || ''} ${data.fields['State'] || ''} ${data.fields['Zip'] || ''}`
  )
  const typedAddr = normalize(`${input.address || ''} ${input.city || ''} ${input.state || ''} ${input.zip || ''}`)
  if (onFileAddr && typedAddr && onFileAddr !== typedAddr) return true

  return false
}
