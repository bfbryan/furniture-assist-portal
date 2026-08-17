// lib/clients/do-not-serve.ts
//
// DO-NOT-SERVE: the one definition of what the flag is, what it blocks, and
// what to say when it blocks something.
//
// ============================================================
// The rule
// ============================================================
// The Clients table has a Status single-select: Active, Served, DNS. A client
// whose Status is DNS has been asked to leave, and must not receive a new
// referral. Ben's decision, stated explicitly:
//
//   HARD BLOCK, both portals, NO OVERRIDE — not for agencies, not for Dawson,
//   not for Ben. The decision is made at the moment the client is flagged, so
//   referral time is not when it gets reconsidered.
//
// There is deliberately no bypass parameter, no acknowledgment checkbox and no
// admin escape hatch. Do not add one. The existing "already has an active
// appointment" warning in the duplicate banner IS a soft block with an
// acknowledgment checkbox — this is not that, and the two should not be made
// to look alike.
//
// ============================================================
// Why the test is `=== 'DNS'` and never `!== 'Active'`
// ============================================================
// Tempting, and wrong twice over:
//
//   1. Status is not guaranteed to be set. It is written as 'Active' by the
//      two client-creation helpers in this repo (createClient in
//      lib/referrals/match.ts and the Client branch of
//      lib/referrals/create.ts), but nothing enforces it at the schema level,
//      and a row created any other way — by hand in Airtable, by an import
//      that predates those helpers — can carry a blank. A not-Active test
//      would refuse service to a legitimate new client because of an empty
//      field.
//
//   2. Ben plans to retire 'Served'. The moment he does, every client
//      previously marked Served silently becomes un-referrable under a
//      not-Active test. Under this one, nothing happens, which is correct:
//      'Served' was never a reason to refuse anyone.
//
// Only DNS blocks. Everything else — Active, Served, blank, or an option added
// next year — is allowed through.

import { BASE_ID, HEADERS } from '@/lib/airtable/client'

const CLIENTS_TABLE = 'Clients'

/** The single-select option that means "do not serve". */
export const DO_NOT_SERVE_STATUS = 'DNS'

/**
 * Is this Status value the do-not-serve flag?
 *
 * Trimmed and case-insensitive: the comparison is deliberately liberal about
 * how the option is spelled because being liberal FAILS CLOSED here. Reading
 * 'dns ' as DNS blocks a referral that should have been blocked; reading it as
 * anything else lets one through. Note this widens what counts as DNS, never
 * what counts as Active.
 */
export function isDoNotServeStatus(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toUpperCase() === DO_NOT_SERVE_STATUS
}

/**
 * What Dawson or an agency user sees when the block fires.
 *
 * Because nobody can override it, this has to explain itself: whoever hits it
 * is facing a wall they cannot move, and a vague "submission failed" reads as
 * the portal being broken rather than as a deliberate decision. So it says
 * what the flag is, where it lives, that there is no way past it here, and
 * what would actually change the outcome.
 */
export function doNotServeMessage(clientName?: string | null): string {
  const who = clientName && clientName.trim() ? clientName.trim() : 'This client'
  return (
    `${who} is marked do-not-serve and cannot be referred. ` +
    `That flag is the Status field on their record in the Clients table in Airtable, set to "${DO_NOT_SERVE_STATUS}". ` +
    `It cannot be overridden from the portal by anyone. ` +
    `If the flag is wrong, change it in Airtable first, then submit the referral again.`
  )
}

/** Thrown by the assert helpers. Carries the message meant for the user. */
export class DoNotServeError extends Error {
  readonly clientId: string | null
  constructor(message: string, clientId: string | null = null) {
    super(message)
    this.name = 'DoNotServeError'
    this.clientId = clientId
  }
}

type ClientStatusRow = {
  id: string
  name: string
  status: string | null
}

async function fetchClientRow(clientId: string): Promise<ClientStatusRow> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`
  const res = await fetch(url, { headers: HEADERS, cache: 'no-store' })
  // Every non-OK response throws, including "no such record".
  //
  // This started out with a 404 branch that returned null so an unresolvable
  // id could be treated as "not flagged". Checked against the real base: a
  // well-formed record id that does not exist comes back 403, not 404, so that
  // branch never ran and the comment describing it was wrong. Rather than
  // re-point it at 403 — which is also what a genuine permissions failure
  // returns, and the two are not distinguishable from here — an id that cannot
  // be read is now simply an id whose status is unknown, and unknown fails
  // closed. The caller says "could not verify" and creates nothing.
  if (!res.ok) {
    throw new Error(`Clients lookup failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json()
  const f = data.fields ?? {}
  return {
    id: data.id,
    name: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
    status: (f['Status'] as string) ?? null,
  }
}

/**
 * Refuse to go further if this Client is flagged do-not-serve.
 *
 * Call this on the CREATION PATH — the server route that is about to write a
 * referral — not on a screen. Screens come and go and each new one is a chance
 * to forget; there is exactly one moment a referral comes into existence, and
 * this belongs at it. Same reasoning that put the reschedule-notice
 * confirmation guard inside the shared send function rather than into each of
 * its four callers.
 *
 * FAILS CLOSED. If the Clients row cannot be read — timeout, permissions, or
 * an id that does not resolve — this throws rather than assuming the client is
 * fine. A flag whose whole purpose is to stop something must not be defeated
 * by a bad round-trip. This adds no new outage class in practice: every caller
 * is already several Airtable round-trips deep by the time it gets here, so an
 * Airtable outage fails the request regardless — the difference is only that
 * this one says why.
 *
 * Note the two failures are distinguishable by the CALLER, and should be kept
 * that way: a DoNotServeError is the flag and means "this will never work",
 * while anything else means "try again". They get different status codes and
 * different wording for that reason.
 */
export async function assertClientMayBeReferred(clientId: string): Promise<void> {
  const row = await fetchClientRow(clientId)
  if (isDoNotServeStatus(row.status)) {
    throw new DoNotServeError(doNotServeMessage(row.name), row.id)
  }
}

// ---------------------------------------------------------------------------
// Identity lookup, for creation paths that have a name but no Client record id
// ---------------------------------------------------------------------------

function normalizeName(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 'YYYY-MM-DD', 'M/D/YYYY' and 'MM/DD/YYYY' all reduce to the same key. */
function normalizeDob(s: unknown): string {
  const raw = String(s ?? '').trim()
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${Number(iso[2])}-${Number(iso[3])}`
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdy) return `${mdy[3]}-${Number(mdy[1])}-${Number(mdy[2])}`
  return raw.toLowerCase()
}

/**
 * The do-not-serve Client matching this identity, or null.
 *
 * For a creation path that has not resolved a Client record yet — the agency
 * submit route, which builds a referral straight from form fields.
 *
 * Deliberately NARROW: it queries only rows already flagged DNS, then requires
 * first name, last name AND date of birth to agree. That is the Clients
 * table's own identity key (its Unique ID formula is Last-First-DOB), so a
 * match here means the same person by the base's own definition.
 *
 * It is intentionally stricter than findClientMatches() in
 * lib/referrals/match.ts, which scores fuzzily and is allowed to be
 * approximate because a false positive there only shows a banner. A false
 * positive here refuses service to someone with an unlucky surname, so it does
 * not guess. The cost is that a DNS client submitted with a mistyped DOB gets
 * through this particular door — which is why this is the backstop for a path
 * with no Client link, and assertClientMayBeReferred() is the real guard
 * everywhere a Client record is actually resolved.
 */
export async function findDoNotServeClientByIdentity(input: {
  firstName: string
  lastName: string
  dob: string
}): Promise<{ id: string; name: string } | null> {
  if (!String(input.lastName ?? '').trim()) return null

  // The formula narrows on Status ONLY; every name and date comparison happens
  // in JS below.
  //
  // The surname used to be in the formula too, as
  // `LOWER({Last Name}) = LOWER('...')`. That looked equivalent and was not:
  // Airtable's LOWER lowercases but does not collapse whitespace, so a surname
  // typed with a stray double space missed a client whose record spells it with
  // one — and the base really does hold multi-word surnames ("Castillo Rosa"),
  // which is exactly where that goes wrong. Caught by running this against the
  // real base rather than by reading it.
  //
  // Matching in one language instead of two removes the whole class of
  // formula-vs-JS disagreement, and it takes the caller's surname out of the
  // formula string, so there is nothing left to quote-escape either. Safe to do
  // because the flagged set is tiny by nature — being asked to leave is rare,
  // and today it is one client.
  const formula = `{Status} = '${DO_NOT_SERVE_STATUS}'`

  const wantFirst = normalizeName(input.firstName)
  const wantLast = normalizeName(input.lastName)
  const wantDob = normalizeDob(input.dob)

  let offset: string | undefined
  let pages = 0
  const MAX_PAGES = 5 // 500 flagged clients; a ceiling, not an expectation

  do {
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENTS_TABLE)}?` +
      `filterByFormula=${encodeURIComponent(formula)}&pageSize=100` +
      (offset ? `&offset=${encodeURIComponent(offset)}` : '')

    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' })
    if (!res.ok) {
      // Fails closed, same as assertClientMayBeReferred: the caller turns this
      // into "could not verify" rather than quietly continuing.
      throw new Error(`Do-not-serve lookup failed (${res.status}): ${await res.text()}`)
    }

    const data = await res.json()
    for (const rec of data.records ?? []) {
      const f = rec.fields ?? {}
      if (normalizeName(f['Last Name']) !== wantLast) continue
      if (normalizeName(f['First Name']) !== wantFirst) continue
      // Both sides must carry a DOB and agree. A blank on either side is not a
      // match — see the note above on why this does not guess.
      const recDob = normalizeDob(f['DOB'])
      if (!recDob || !wantDob || recDob !== wantDob) continue
      return {
        id: rec.id,
        name: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
      }
    }

    offset = data.offset
    pages += 1
  } while (offset && pages < MAX_PAGES)

  return null
}
