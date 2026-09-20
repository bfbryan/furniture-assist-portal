// lib/donors/in-kind-donations.ts
//
// Domain functions for the In Kind Donations table — donor-checkin's one
// table, in the separate donor base (see lib/donors/client.ts).
//
// Schema facts this file leans on, checked live against the donor base
// before writing anything (2026-09):
//   - One record per donation, not per item (30 numeric item-category
//     columns on a single row).
//   - Status: 'Pending' | 'Received' | 'No Show' (+ a stray 'Status' option
//     in the live choice list — never written here).
//   - Donation Date is stamped by an EXISTING Airtable automation the
//     moment Status flips — confirmed with Ben. Never written here; writing
//     it from this route would duplicate that automation and could diverge
//     from it.
//   - Last Updated (lastModifiedTime) is not a dedicated "checked in at"
//     field — it reflects the last change to the row for ANY reason. Good
//     enough for a same-day "already received at 11:42" read on the desk
//     view (nothing else touches a Pending/just-Received row same-day), not
//     something to treat as an authoritative check-in timestamp longer-term.
//   - Manual or Automatic = 'Automatic' AND Status = 'Pending' is the
//     ~108-record subset (checked live) the desk's primary search is scoped
//     to, matching how these donations actually arrived (versus a
//     hand-entered 'Manual' row, which is never Pending — it's created
//     already-resolved).

import { donorFetch } from './client'

export type Donation = {
  id: string
  firstName: string
  lastName: string
  status: string | null
  formDate: string | null // date-only 'YYYY-MM-DD'
  lastUpdated: string | null // instant
}

function shapeDonation(record: { id: string; fields: Record<string, unknown> }): Donation {
  const f = record.fields
  return {
    id: record.id,
    firstName: (f['First Name'] as string) ?? '',
    lastName: (f['Last Name'] as string) ?? '',
    status: (f['Status'] as string) ?? null,
    formDate: (f['Form Date'] as string) ?? null,
    lastUpdated: (f['Last Updated'] as string) ?? null,
  }
}

/** Null on a genuinely missing record (bad scan, wrong code) — not a throw,
 *  since "not found" is an expected, routine outcome here, not a fault. */
export async function getDonationById(id: string): Promise<Donation | null> {
  try {
    const record = await donorFetch(`/${id}`)
    return shapeDonation(record)
  } catch {
    // donorFetch throws on any non-ok response, including Airtable's 404
    // for an id that doesn't exist or isn't shaped like a real record id.
    // Indistinguishable from a real network error at this layer, but the
    // caller (the check-in route) already validated the id's shape via
    // parseScanInput before calling this, so a throw here reads as "not
    // found" either way — a transient Airtable outage would look the same
    // to a volunteer as a bad code, which is an acceptable ambiguity for a
    // "try again" retry either way.
    return null
  }
}

/** The one write this whole feature makes. Status only — see the header note
 *  on Donation Date. */
export async function markReceived(id: string): Promise<void> {
  await donorFetch(`/${id}`, {
    method: 'PATCH',
    body: { fields: { Status: 'Received' } },
  })
}

function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '\\"')
}

export type DonationSearchResult = {
  id: string
  firstName: string
  lastName: string
  status: string | null
  formDate: string | null
  lastUpdated: string | null
  /** last 4 digits of Cell Number, for disambiguating two same-named
   *  results — never the full number. See the desk-exposure note below. */
  phoneLast4: string | null
}

// Desk-view exposure: the Chromebook's search reaches names across ~108
// pending records and sits on a desk in a warehouse — more exposure than
// the phone, which only ever shows the one donor just scanned. Search
// results carry name, the scheduled Form Date, and the last 4 digits of the
// phone on file — enough to tell two same-surname donors apart — and
// nothing else. No street address, no full phone, no email, at any point in
// this flow, including after a result is selected; the confirm step stays
// as minimal as the phone's own.
function shapeSearchResult(record: { id: string; fields: Record<string, unknown> }): DonationSearchResult {
  const f = record.fields
  const cell = (f['Cell Number'] as string) ?? ''
  const digits = cell.replace(/\D/g, '')
  return {
    id: record.id,
    firstName: (f['First Name'] as string) ?? '',
    lastName: (f['Last Name'] as string) ?? '',
    status: (f['Status'] as string) ?? null,
    formDate: (f['Form Date'] as string) ?? null,
    lastUpdated: (f['Last Updated'] as string) ?? null,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
  }
}

const SEARCH_FIELDS = ['First Name', 'Last Name', 'Status', 'Form Date', 'Last Updated', 'Cell Number', 'Manual or Automatic']

function fieldsParam(): string {
  return SEARCH_FIELDS.map(f => `&fields[]=${encodeURIComponent(f)}`).join('')
}

/**
 * Tier 1 — the primary search. Scoped to Manual or Automatic = 'Automatic'
 * AND Status = 'Pending', matching how a donation that's actually still
 * awaiting check-in looks (a hand-entered 'Manual' row is never Pending).
 * ~108 records rather than 1,056, so a search returns one or two results.
 */
export async function searchPendingByLastName(query: string): Promise<DonationSearchResult[]> {
  const safe = escapeFormulaString(query.trim())
  if (!safe) return []
  const formula = encodeURIComponent(
    `AND(SEARCH("${safe.toLowerCase()}", LOWER({Last Name})), {Status} = "Pending", {Manual or Automatic} = "Automatic")`
  )
  const data = await donorFetch(`?filterByFormula=${formula}&maxRecords=10${fieldsParam()}`)
  return (data.records ?? []).map(shapeSearchResult)
}

/**
 * Tier 2 — only called when tier 1 comes back empty. No Status/Manual
 * filter, so it can find an already-Received (or No Show) row and let the
 * desk say "already received at 11:42" instead of a bare "no results" —
 * which reads as "not in the system at all," the wrong and alarming
 * message for someone who's actually already been checked in.
 */
export async function searchAnyByLastName(query: string): Promise<DonationSearchResult[]> {
  const safe = escapeFormulaString(query.trim())
  if (!safe) return []
  const formula = encodeURIComponent(`SEARCH("${safe.toLowerCase()}", LOWER({Last Name}))`)
  const data = await donorFetch(`?filterByFormula=${formula}&maxRecords=10${fieldsParam()}`)
  return (data.records ?? []).map(shapeSearchResult)
}

export type CheckinListEntry = {
  id: string
  firstName: string
  lastName: string
  checkedInAt: string | null
}

/**
 * Today's live list for the desk view — Status = Received AND Donation Date
 * = today. Donation Date, not Last Updated, because it's the field the
 * existing automation stamps specifically on the receive transition (Last
 * Updated would also catch an unrelated same-day edit to an older record).
 *
 * IS_SAME(), not a plain `{Donation Date} = "..."` string comparison —
 * checked live against the donor base before writing this: a bare `=`
 * against this field (type 'date') returned zero rows for a date with 37
 * real Received records, while IS_SAME() returned them correctly. Would
 * have shipped a live list that always reads empty.
 */
export async function getTodaysCheckins(todayISO: string): Promise<CheckinListEntry[]> {
  const formula = encodeURIComponent(`AND({Status} = "Received", IS_SAME({Donation Date}, "${todayISO}"))`)
  const data = await donorFetch(
    `?filterByFormula=${formula}&sort[0][field]=Last%20Updated&sort[0][direction]=desc&maxRecords=100&fields[]=First%20Name&fields[]=Last%20Name&fields[]=Last%20Updated`
  )
  return (data.records ?? []).map((r: { id: string; fields: Record<string, unknown> }) => ({
    id: r.id,
    firstName: (r.fields['First Name'] as string) ?? '',
    lastName: (r.fields['Last Name'] as string) ?? '',
    checkedInAt: (r.fields['Last Updated'] as string) ?? null,
  }))
}
