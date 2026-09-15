// lib/airtable/referrals.ts
//
// Reads and writes against the Client Referrals table.
//
// June 2026: Referring Agency / Referring Staff / Agency Email / Staff Phone
// are LOOKUPS through Referring Staff Link → Agency Users, and the client
// identity fields are lookups through the Client link. Everything that reads
// them goes through safeLookupString.

import { CATALOG } from '@/lib/catalog/items-disbursed'
import { matchesSearch } from '@/lib/search'
import { easternTodayISO } from '@/lib/dates'
import {
  airtableFetch,
  airtableFetchAll,
  safeLookupString,
  BASE_ID,
  HEADERS,
} from './client'

// 'Appt Slip' and 'Client Receipt' are Airtable ATTACHMENT fields, so they come
// back as an array of attachment objects, not a URL. Reading .url off the first
// one is the whole job; this exists so the three read sites cannot disagree
// about it (the list shapes used to cast the array straight to string, which
// put "[object Object]" in an href).
type AirtableAttachment = { url?: string }
function attachmentUrl(value: unknown): string | null {
  return (value as AirtableAttachment[] | undefined)?.[0]?.url ?? null
}

// Internal helper: shape a Client Referrals record into the list-view object.
// Pulls staff / agency / agency-email / staff-phone from the Referring Staff
// Link lookups (post-migration) rather than the deleted plaintext fields.
function shapeReferralListItem(record: any) {
  const f = record.fields
  // First Name / Last Name / Address / Address 2 / City / State / Zip / Phone
  // are LOOKUPS through the Client link (June 2026) — they arrive as arrays,
  // not strings. safeLookupString unwraps the first value and rejects a
  // rec-ID string from a misconfigured link. Same coercion getReferralById
  // already uses; this shape had been left on bare `as string` casts, which
  // handed the UI an array and blew up the first `.trim()` on it.
  const first = safeLookupString(f['First Name']) ?? ''
  const last = safeLookupString(f['Last Name']) ?? ''
  return {
    id: record.id,
    clientName: `${first} ${last}`.trim(),
    referralDate: f['Referral Date'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (f['Appointment Time'] as string) ?? null,
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentSlipUrl: attachmentUrl(f['Appt Slip']),
    // What the agency asked for on a reschedule, as opposed to what is booked.
    // The agency list reads these to fill the Appointment row on a Reschedule
    // Requested card, which rendered an em dash before — that row was only
    // filled for 'Scheduled'. See lib/referrals/requested-slot.ts.
    preferredDate: (f['Preferred Date'] as string) ?? null,
    preferredTime: (f['Preferred Time'] as string) ?? null,
    schedulingFlexibility: (f['Scheduling Flexibility'] as string) ?? null,
    referredBy: safeLookupString(f['Referring Staff']),
    dataPageUrl: f['Data Page URL'] as string,
    address: safeLookupString(f['Address']),
    address2: safeLookupString(f['Address 2']),
    city: safeLookupString(f['City']),
    state: safeLookupString(f['State']),
    zip: safeLookupString(f['Zip']),
    phone: safeLookupString(f['Phone']),
    // History reads these. clientReceiptUrl gates the "Client Receipt" menu
    // item on a completed referral; the Original Appointment snapshot is the
    // fallback date for a cancelled one, whose live Appointment Date lookup
    // goes empty when the Saturday link is cleared. Same shaping as
    // getReferralById. See lib/referrals/effective-date.ts.
    clientReceiptUrl: attachmentUrl(f['Client Receipt']),
    originalAppointmentDate: Array.isArray(f['Original Appointment Date'])
      ? ((f['Original Appointment Date'] as string[])[0] ?? null)
      : ((f['Original Appointment Date'] as string) ?? null),
    originalAppointmentTime: (f['Original Appointment Time'] as string) ?? null,
  }
}

// Agency-facing referral visibility gates on the referring staff member's
// membership being CONFIRMED by an agency admin. {Referring Staff Membership}
// is a single-select lookup (Referring Staff Link → Agency Users → Membership
// Status). Blank (the default, unconfirmed) is absent from the record payload,
// so `= "Confirmed"` is inherently default-deny: an unconfirmed staffer, or a
// referral with no staff link at all, never matches. Applied in the query
// formula, not post-fetch, because the dashboard computes its counts from the
// same fetch and must not see rows the lists hide.
const MEMBERSHIP_CONFIRMED = `{Referring Staff Membership} = "Confirmed"`

export async function getReferralsByAgencyId(agencyId: string) {
  // Match on the agency RECORD ID, not the name — Agency Name is not unique
  // (two offices of one organisation share it by design), so a name match
  // pooled their referrals. {Referring Agency ID} is a single-value lookup
  // (Referring Staff Link → Agency Users → Agency Record ID), populated on
  // every referral in the base.
  const formula = encodeURIComponent(
    `AND({Referring Agency ID} = "${agencyId}", ${MEMBERSHIP_CONFIRMED})`,
  )
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
  )
  return data.records.map(shapeReferralListItem)
}

export async function getReferralsByStaffName(agencyId: string, staffName: string) {
  // Agency half matches on {Referring Agency ID} (record id, see
  // getReferralsByAgencyId); staff half stays on the {Referring Staff} name
  // lookup — that is a within-agency identity axis, out of scope here.
  const formula = encodeURIComponent(
    `AND({Referring Agency ID} = "${agencyId}", {Referring Staff} = "${staffName}", ${MEMBERSHIP_CONFIRMED})`,
  )
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
  )
  return data.records.map(shapeReferralListItem)
}

// The dashboard prompt: referrals at this agency whose referring staff member
// is NOT confirmed — the rows the visibility gate above is hiding. Needs its
// own read precisely because getReferralsByAgencyId now excludes them, so the
// dashboard's own fetch can't see them.
//
// NOT({Referring Staff Membership} = "Confirmed") is true for blank
// (unconfirmed, the default — the lookup is absent from the payload) AND for
// 'Not At This Office'. A referral with no staff link has no {Referring
// Agency ID} either, so it can't match the first clause — consistent with
// everywhere else.
//
// Returns the referral count and the DISTINCT staff names behind them, for a
// banner like "2 referrals from unconfirmed staff: Jane Smith, Bob Lee". Name
// only — no client data on the dashboard. Single-page fetch (100 cap): an
// agency with more than 100 pending-confirmation referrals is not a real
// state, and the banner only needs "there are some, from whom".
export async function getUnconfirmedStaffAtAgency(
  agencyId: string,
): Promise<{ referralCount: number; staffNames: string[] }> {
  const formula = encodeURIComponent(
    `AND({Referring Agency ID} = "${agencyId}", NOT(${MEMBERSHIP_CONFIRMED}))`,
  )
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&fields%5B%5D=Referring%20Staff`,
  )
  const records = (data.records ?? []) as { fields: Record<string, unknown> }[]
  const names = new Set<string>()
  for (const r of records) {
    const n = safeLookupString(r.fields['Referring Staff'])
    if (n) names.add(n)
  }
  return { referralCount: records.length, staffNames: [...names].sort() }
}

// membership-followups: counts for /dawson/staff/wrong-agency — a staff
// member flagged 'Not At This Office' has their referrals hidden from the
// flagging agency's view, but nothing else stamps those referrals to any
// other agency, so a client with a Saturday appointment can end up visible
// to nobody. This is the Dawson-side count that surfaces that.
//
// Deliberately NOT getReferralsByStaffName — that query requires
// {Referring Staff Membership} = "Confirmed", which a flagged row can never
// satisfy by definition, so it would always return zero here. Same
// agencyId + staffName match, no membership clause.
//
// "Upcoming" reads the LIVE Appointment Date, same reasoning as
// referral-count/route.ts on the agency side: the effective/coalesced date
// (fileDateOf's convention) is deliberately built to survive cancellation so
// a cancelled referral still files under the right month, which makes it
// exactly wrong for "does this family still have a booking" — a cancelled
// referral's effective date can still read as future-dated with nothing
// behind it. Do not "fix" this toward fileDateOf.
export async function getOrphanedReferralCounts(
  agencyId: string | null,
  staffName: string,
): Promise<{ total: number; upcoming: number }> {
  if (!agencyId || !staffName) return { total: 0, upcoming: 0 }
  const formula = encodeURIComponent(
    `AND({Referring Agency ID} = "${agencyId}", {Referring Staff} = "${staffName}")`,
  )
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&fields%5B%5D=Appointment%20Date`,
  )
  const records = (data.records ?? []) as { fields: Record<string, unknown> }[]
  const todayISO = easternTodayISO()
  let upcoming = 0
  for (const r of records) {
    const raw = r.fields['Appointment Date']
    const d = Array.isArray(raw) ? raw[0] : raw
    if (typeof d === 'string' && d >= todayISO) upcoming++
  }
  return { total: records.length, upcoming }
}

// detail-pages-rebuild: the Dawson-side referral shape, extracted verbatim
// from getAllReferrals's own inline mapper (previously the only consumer)
// so a second Dawson reader — getStaffWithDetails, for the staff detail
// page — can share it rather than carrying its own thinner copy. Pure
// extraction: every field name below, including the redundant aliases
// (saturdayDate/staffName/agencyName duplicate appointmentDate/referredBy/
// referringAgency), is unchanged from what getAllReferrals always returned,
// so its existing callers (Needs Action, the referrals list) see no
// behavior change. The aliases are kept only because those callers may
// still read them under the old names — not proof they're needed, just
// not this branch's job to chase down and rename.
//
// Distinct from shapeReferralListItem (agency-portal side, out of scope
// here): that shaper's callers gate visibility on {Referring Staff
// Membership} = "Confirmed" in their query formula, a concern this
// function has nothing to do with. This is a superset of what that shaper
// returns; whether it could replace it is a separate question for whenever
// the agency-portal reads are next touched.
export function shapeDawsonReferral(record: any) {
  const f = record.fields
  // First/Last Name and the address fields below are LOOKUPS through the
  // Client link — arrays at runtime, not strings. safeLookupString unwraps
  // them the same way shapeReferralListItem and getReferralById do.
  const firstName = safeLookupString(f['First Name']) ?? ''
  const lastName = safeLookupString(f['Last Name']) ?? ''

  // Referring Agency / Staff / Phone are LOOKUPS post-migration.
  const agencyName = safeLookupString(f['Referring Agency'])
  const staffName = safeLookupString(f['Referring Staff'])
  const staffPhone = safeLookupString(f['Staff Phone'])

  // Agency record id, straight off the lookup — Referring Staff Link →
  // Agency Users → Agency Record ID. Populated on every row that has a
  // staff link (all 471 today); blank for the rare link-less import rows,
  // exactly as the old name→id map also failed to resolve those.
  const referringAgencyId = (f['Referring Agency ID'] as string[])?.[0] ?? null

  // Referring Staff Link is a single link field; grab the linked user id
  // so a list view can deep-link to a Staff ID page.
  const referringStaffId = (f['Referring Staff Link'] as string[])?.[0] ?? null

  return {
    id: record.id,
    firstName,
    lastName,
    clientName: `${firstName} ${lastName}`.trim(),
    referralDate: f['Referral Date'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    saturdayDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (f['Appointment Time'] as string) ?? null,
    // The live Appointment Date coalesced with the Original snapshot — the
    // date a terminal (cancelled/withdrawn) referral should be filed under.
    // Read from the same {Effective Appointment Date} formula the date
    // filter in getAllReferrals uses, so the two can't disagree. See
    // lib/referrals/effective-date.ts for the pre-field JS equivalent.
    effectiveAppointmentDate:
      (Array.isArray(f['Effective Appointment Date'])
        ? (f['Effective Appointment Date'] as string[])[0]
        : (f['Effective Appointment Date'] as string)) ?? null,
    // What the agency ASKED for, as opposed to what is currently booked.
    // Only meaningful while Appointment Status is 'Reschedule'; a reader can
    // offer Dawson "accept as requested" off these.
    // Preferred Time's select options are identical to Appointment Time's,
    // so this value needs no translation on the way back out.
    preferredDate: (f['Preferred Date'] as string) ?? null,
    preferredTime: (f['Preferred Time'] as string) ?? null,
    schedulingFlexibility: (f['Scheduling Flexibility'] as string) ?? null,
    // UTC timestamp stamped when Appointment Status is set to 'Reschedule',
    // by both writers of that status (agency reschedule request, and the OCR
    // no-usable-date branch). Needs Action reads it for the "requested N
    // days ago" age on a reschedule card; null on rows that pre-date the
    // field, rendered there as "request date unknown".
    rescheduleRequestedAt: (f['Reschedule Requested At'] as string) ?? null,
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentSlipUrl: attachmentUrl(f['Appt Slip']),
    // Same attachment field the detail shape already reads. In the list
    // shape too so History can link straight to a completed client's
    // receipt without opening the record.
    clientReceiptUrl: attachmentUrl(f['Client Receipt']),
    // The slot a terminal referral last held, snapshotted by
    // end-referral.ts. The fallback for the Appointment column / month
    // grouping once a reader falls back to it. Same defensive array unwrap
    // shapeReferralListItem uses.
    originalAppointmentDate: Array.isArray(f['Original Appointment Date'])
      ? ((f['Original Appointment Date'] as string[])[0] ?? null)
      : ((f['Original Appointment Date'] as string) ?? null),
    originalAppointmentTime: (f['Original Appointment Time'] as string) ?? null,
    referredBy: staffName,
    staffName,
    staffPhone,
    referringAgency: agencyName,
    referringAgencyId,                   // drives the teal-bold link in list view
    referringStaffId,                    // resolved from Referring Staff Link
    agencyName,
    dataPageUrl: (f['Data Page URL'] as string) ?? null,
    address: safeLookupString(f['Address']),
    city: safeLookupString(f['City']),
    state: safeLookupString(f['State']),
    zip: safeLookupString(f['Zip']),
    phone: safeLookupString(f['Phone']),
  }
}

export async function getAllReferrals(filters?: {
  review?: string
  statuses?: string[]
  // July 2026: renamed from `dateFrom` (Referral Date) to `appointmentDateFrom`
  // so history-style views filter on when the appointment actually happened,
  // not when the referral was submitted. Legacy `dateFrom` is still accepted
  // and treated as appointmentDateFrom.
  //
  // Sep 2026: both bounds now filter on {Effective Appointment Date} — an
  // Airtable formula field, IF({Appointment Date}, {Appointment Date},
  // {Original Appointment Date}). {Appointment Date} is a lookup through the
  // Saturday Schedule link and empties when that link is cleared on cancel /
  // withdraw, so filtering on it alone dropped every cancelled and withdrawn
  // referral out of every date-bounded range. {Original Appointment Date} is
  // the snapshot end-referral.ts writes when a slot is released, so the
  // coalesce puts them back. See lib/referrals/effective-date.ts.
  appointmentDateFrom?: string   // inclusive lower bound, ISO date
  appointmentDateTo?: string     // inclusive upper bound, ISO date
  dateFrom?: string              // legacy alias for appointmentDateFrom
  // Sep 2026: inclusive lower bound on {Cancellation Email Sent At} — the
  // timestamp the portal cancel path stamps when it emails the agency. Lets a
  // caller ask "cancelled through the portal since <date>" without an
  // appointment-date bound, which would miss a cancel of a far-future slot.
  // The dashboard's "Cancelled, last 7 days" card uses this. Rows cancelled
  // before the field was un-misspelled (2026-08-14) never match — correct, not
  // a lookup failure.
  cancellationFrom?: string      // inclusive lower bound, ISO date
  // Sep 2026, undated-terminal-referrals: a referral cancelled or withdrawn
  // before it was ever scheduled has nothing for {Effective Appointment
  // Date} to coalesce — no {Appointment Date} (no slot booked) and no
  // {Original Appointment Date} (that snapshot is written only when a slot
  // is released, and there was none). Filtering DATED_STATUSES on that
  // field, as appointmentDateFrom/To above does, silently drops those rows
  // out of every bounded range. This is how Dawson's referrals list fetches
  // them instead — unbounded, alongside the request-status fetch it already
  // runs the same way — so they can be windowed by Preferred Date in code
  // rather than lost at the query.
  effectiveDateBlank?: boolean
  agency?: string                // Agencies record id — matched against {Referring Agency ID}
  limit?: number                 // cap total rows (server-side maxRecords, applied after sort)
  // Substring match on client name / agency / staff, applied in JS AFTER the
  // server filter + limit — i.e. over the already-narrowed slice, never over
  // the whole table. Client/agency/staff are all lookup fields; matching them
  // in filterByFormula needs ARRAYJOIN gymnastics that have been a bug source
  // here before, so this stays in code. No current caller passes it (the list
  // pages run their own search over their own fetch); kept for the merged page.
  search?: string
}) {
  const conditions: string[] = []

  if (filters?.review) {
    conditions.push(`{Referral Review} = "${filters.review}"`)
  }

  if (filters?.statuses && filters.statuses.length > 0) {
    const statusOr = filters.statuses
      .map(s => `{Appointment Status} = "${s}"`)
      .join(', ')
    conditions.push(`OR(${statusOr})`)
  }

  if (filters?.agency) {
    // {Referring Agency ID} is a lookup: Referring Staff Link → Agency Users →
    // Agency Record ID. Single-value, so string equality works — same as the
    // {Referring Agency} name equality the older code relied on.
    conditions.push(`{Referring Agency ID} = "${filters.agency}"`)
  }

  const apptDateFrom = filters?.appointmentDateFrom ?? filters?.dateFrom
  if (apptDateFrom) {
    conditions.push(
      `OR(IS_AFTER({Effective Appointment Date}, "${apptDateFrom}"), IS_SAME({Effective Appointment Date}, "${apptDateFrom}", 'day'))`
    )
  }
  if (filters?.appointmentDateTo) {
    conditions.push(
      `OR(IS_BEFORE({Effective Appointment Date}, "${filters.appointmentDateTo}"), IS_SAME({Effective Appointment Date}, "${filters.appointmentDateTo}", 'day'))`
    )
  }

  if (filters?.effectiveDateBlank) {
    conditions.push(`{Effective Appointment Date} = ""`)
  }

  if (filters?.cancellationFrom) {
    // {Cancellation Email Sent At} is a datetime; the blank-guard keeps rows
    // that never had it written (pre-2026-08-14) from matching via a null date
    // comparison.
    conditions.push(
      `AND({Cancellation Email Sent At} != "", ` +
      `OR(IS_AFTER({Cancellation Email Sent At}, "${filters.cancellationFrom}"), ` +
      `IS_SAME({Cancellation Email Sent At}, "${filters.cancellationFrom}", 'day')))`
    )
  }

  const formula = conditions.length > 0
    ? encodeURIComponent(`AND(${conditions.join(', ')})`)
    : ''

  // Primary sort: Effective Appointment Date desc — what a merged Referrals
  // page groups by. Secondary: Referral Date desc — the tiebreaker for rows
  // with no effective date (a Pending review queue, or a cancel that released
  // no slot). That secondary keeps the Awaiting Review page's
  // newest-submitted-first order unchanged, since all its rows tie on a blank
  // effective date and fall through to it.
  const sort =
    'sort[0][field]=Effective%20Appointment%20Date&sort[0][direction]=desc' +
    '&sort[1][field]=Referral%20Date&sort[1][direction]=desc'
  const maxParam = filters?.limit ? `&maxRecords=${filters.limit}` : ''
  const params = `?${formula ? `filterByFormula=${formula}&` : ''}${sort}${maxParam}`

  // One fetch. The agency record id per referral now comes from the
  // {Referring Agency ID} lookup (added Sep 2026), so this no longer pulls
  // the entire Agencies table to build a name→id map on every call.
  const data = await airtableFetchAll('Client Referrals', params)

  const records = data.records.map(shapeDawsonReferral)

  // Substring search — over the narrowed slice above, not the whole table.
  if (filters?.search) {
    const q = filters.search
    return records.filter((r: any) =>
      matchesSearch(q, r.clientName, r.referringAgency, r.referredBy)
    )
  }

  return records
}

export async function updateReferralReview(referralId: string, review: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${referralId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { 'Referral Review': review } }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// detail-pages-rebuild: getReferralById is not Dawson-only — it also backs
// the AGENCY portal's own referral detail page (app/(agency)/referrals/[id]
// /page.tsx) and the access guard (lib/auth/agency-referral-access.ts), so
// it can't move wholly onto shapeDawsonReferral the way getStaffWithDetails
// did. Forcing a list shaper to carry full client identity and disbursement
// detail for every row would be the wrong shape for that shaper's other
// callers (Needs Action, the referrals list). Instead: call the shaper for
// the genuinely shared subset (dates, statuses, agency/staff identity,
// document URLs — everything the agency page's own Referral type already
// expects, under the same names), then extend with this function's own
// detail-only fields, unchanged from before.
//
// Two fields ARE renamed here — referredByPhone -> staffPhone,
// referringStaffLinkId -> referringStaffId, adopting shapeDawsonReferral's
// names. Checked before renaming, not assumed: neither old name is read
// anywhere outside this file and the Dawson referral page, INCLUDING
// app/(agency)/referrals/[id]/page.tsx, which runs on this same function
// and uses neither.
//
// Net effect: this function gains effectiveAppointmentDate and
// rescheduleRequestedAt for free (the shaper already computes both), and
// loses the extra API call it used to make chasing Referring Staff Link ->
// Agency Users -> Agency for referringAgencyId — the shaper already reads
// {Referring Agency ID} by direct lookup on the referral row itself.
export async function getReferralById(referralId: string) {
  const data = await airtableFetch('Client Referrals', `/${referralId}`)
  const f = data.fields
  const shared = shapeDawsonReferral(data)

  const item = (label: string, fieldName: string) => {
    const raw = f[fieldName]
    if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') return null
    return { name: label, qty: raw }
  }
  const compact = <T,>(arr: (T | null)[]) => arr.filter((x): x is T => x !== null)

  // Built from the shared catalog in lib/catalog/items-disbursed.ts so the read shape,
  // the PATCH allowlist, and the edit UI can never drift apart. Adding an item
  // to the pickup sheet is now a one-line change there.
  const itemsDisbursed = {
    ...Object.fromEntries(
      CATALOG.map(g => [g.key, compact(g.items.map(i => item(i.label, i.field)))]),
    ),
    volunteerInitials: (f['Volunteer Initials'] as string) ?? null,
    checkInTime: (f['Check-in Time'] as string) ?? null,
    checkoutTime: (f['Check-out Time'] as string) ?? null,
    otherItems: (f['Other Items'] as string) ?? null,
    distributionNotes: (f['Distribution Notes'] as string) ?? null,
  }

  // Client link — single rec ID pointing at Clients. Needed so the Client
  // Detail page can PATCH identity fields (First Name / DOB / Address /
  // etc.) which live on Clients, not on Client Referrals. Detail-only —
  // no list view needs it, so it's not on the shared shaper.
  const clientId = (f['Client'] as string[])?.[0] ?? null

  return {
    id: shared.id,
    clientId,                                         // for PATCH /api/dawson/clients/[id]
    clientName: shared.clientName,
    firstName: shared.firstName,
    lastName: shared.lastName,
    // Detail-only client-identity fields below — First Name / Last Name /
    // DOB / Phone / Address / etc. are LOOKUPS through the Client link
    // (June 2026), arriving as arrays; safeLookupString unwraps them and
    // guards against a misconfigured link returning a rec ID string.
    dob:       safeLookupString(f['DOB']),
    phone:     shared.phone,
    language:  safeLookupString(f['Preferred Language']),
    address:   shared.address,
    address2:  safeLookupString(f['Address 2']),
    city:      shared.city,
    state:     shared.state,
    zip:       shared.zip,
    county:    safeLookupString(f['County']),
    // # in HH / # Children are per-VISIT on Client Referrals (not on Clients)
    // — they're plain text on the referral row, not lookups. Coerce numbers
    // to strings so the UI can render them uniformly.
    hhSize:   f['# in HH']    != null ? String(f['# in HH'])    : null,
    children: f['# Children'] != null ? String(f['# Children']) : null,
    // Items Requested is a multi-select on Client Referrals — comes back
    // as string[]. Join with ", " for display; the page splits it again to
    // build the checkbox state.
    items: Array.isArray(f['Items Requested'])
      ? (f['Items Requested'] as string[]).join(', ')
      : (typeof f['Items Requested'] === 'string' ? (f['Items Requested'] as string) : null),
    externalNotes: safeLookupString(f['External Notes']),
    internalNotes: safeLookupString(f['Internal Notes']),
    referralDate: shared.referralDate,
    staffPhone: shared.staffPhone,
    referralReview: shared.referralReview,
    appointmentStatus: shared.appointmentStatus,
    // Raw, live Appointment Date/Time — answers "is there a live booking
    // right now." Empties on cancel/withdraw. Kept separate from
    // effectiveAppointmentDate below on purpose: apptDatePassed and
    // daysSinceNoShow on the detail page both need the live-booking
    // question, not the display one, and must keep reading this field.
    appointmentDate: shared.appointmentDate,
    appointmentTime: shared.appointmentTime,
    // The live Appointment Date coalesced with the Original snapshot —
    // answers "what slot is or was this referral for," which is the
    // display question. Reads the same {Effective Appointment Date}
    // formula field the agency page and referrals list use, via the
    // shared shaper, so this page can't disagree with them about it.
    effectiveAppointmentDate: shared.effectiveAppointmentDate,
    // What the referral last held before a cancel/reschedule released the
    // slot — written by lib/referrals/end-referral.ts (on cancel) and
    // lib/referrals/reschedule.ts (on every reschedule, even one that
    // lands on a new live slot). Single-value, overwritten each time — see
    // the "Previously" sub-line on the Appointment cell for how this page
    // uses it honestly.
    originalAppointmentDate: shared.originalAppointmentDate,
    originalAppointmentTime: shared.originalAppointmentTime,
    // What the agency ASKED for, as opposed to what is currently booked.
    // Only meaningful while Appointment Status is 'Reschedule'.
    preferredDate: shared.preferredDate,
    preferredTime: shared.preferredTime,
    schedulingFlexibility: shared.schedulingFlexibility,
    // UTC timestamp stamped when Appointment Status is set to 'Reschedule'.
    // Single-value, overwritten on every new request — there is no history
    // of past requests, only the current one if there is one.
    rescheduleRequestedAt: shared.rescheduleRequestedAt,
    appointmentSlipUrl: shared.appointmentSlipUrl,
    // Written by the client-receipt cron (lib/notifications/client-receipt.ts)
    // into the "Client Receipt" attachment field once the visit is done. Read
    // only — the portal surfaces the PDF, it never generates it.
    clientReceiptUrl: shared.clientReceiptUrl,
    dataPageUrl: shared.dataPageUrl,
    referredBy: shared.referredBy,
    referringAgency: shared.referringAgency,
    agencyEmail: safeLookupString(f['Agency Email']),
    referringStaffId: shared.referringStaffId,        // for deep-link to Staff ID page
    referringAgencyId: shared.referringAgencyId,       // for deep-link to Agency detail page
    // Membership Status of the referring staff member, looked up through
    // Referring Staff Link → Agency Users. Single-select lookup: wrapped in an
    // array, absent entirely when unconfirmed (blank) — safeLookupString
    // unwraps both, same as the other lookups on this record. The agency
    // referral-access guard denies anything that isn't 'Confirmed', mirroring
    // the query-formula gate on the list reads above. Zero extra API calls —
    // it rides on the record already fetched here. Detail-only: no list view
    // needs it, so it's not on the shared shaper.
    referringStaffMembership: safeLookupString(f['Referring Staff Membership']),
    possibleDuplicate: (f['Possible Duplicate'] as boolean) ?? false,
    // Aug 2026: two plain Airtable checkboxes on Client Referrals.
    // Unchecked checkboxes come back as `undefined` from the API (not
    // `false`), so both need the `?? false` coercion — otherwise the
    // Referral Detail page's lock logic (recordLocked / completedLocked)
    // would see `undefined`, which is falsy in the same way but breaks the
    // `boolean` type the page expects.
    readyForPostApptEmail: (f['Ready for Post-Appt Email'] as boolean) ?? false,
    postApptEmailSent: (f['Post Appt Email Sent'] as boolean) ?? false,
    // Aug 2026: the five "when did this email go out" stamps, written by the
    // notification modules as each one fires. Surfaced on the internal detail
    // page's Email History card.
    //
    // 'Cancellation Email Sent At' was misspelled in Airtable until 2026-08-14,
    // so nothing was ever written to it. Every referral cancelled before that
    // date reads null here and that is correct, not a lookup failure — do not
    // add a fallback for it.
    emailSentAt: {
      confirmation: (f['Confirm Email Sent At'] as string) ?? null,
      reschedule:   (f['Reschedule Email Sent At'] as string) ?? null,
      reminder:     (f['Reminder Sent At'] as string) ?? null,
      completed:    (f['Post Appt Email Sent At'] as string) ?? null,
      cancellation: (f['Cancellation Email Sent At'] as string) ?? null,
    },
    itemsDisbursed,
  }
}
