// lib/airtable/referrals.ts
//
// Reads and writes against the Client Referrals table.
//
// June 2026: Referring Agency / Referring Staff / Agency Email / Staff Phone
// are LOOKUPS through Referring Staff Link → Agency Users, and the client
// identity fields are lookups through the Client link. Everything that reads
// them goes through safeLookupString.

import { CATALOG } from '@/lib/catalog/items-disbursed'
import {
  airtableFetch,
  airtableFetchAll,
  safeLookupString,
  unwrapLookup,
  REC_ID_RE,
  BASE_ID,
  HEADERS,
} from './client'

// Internal helper: shape a Client Referrals record into the list-view object.
// Pulls staff / agency / agency-email / staff-phone from the Referring Staff
// Link lookups (post-migration) rather than the deleted plaintext fields.
function shapeReferralListItem(record: any) {
  const f = record.fields
  return {
    id: record.id,
    clientName: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
    referralDate: f['Referral Date'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (f['Appointment Time'] as string) ?? null,
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentSlipUrl: f['Appt Slip'] as string,
    referredBy: safeLookupString(f['Referring Staff']),
    dataPageUrl: f['Data Page URL'] as string,
    address: (f['Address'] as string) ?? null,
    address2: (f['Address 2'] as string) ?? null,
    city: (f['City'] as string) ?? null,
    state: (f['State'] as string) ?? null,
    zip: (f['Zip'] as string) ?? null,
    phone: (f['Phone'] as string) ?? null,
  }
}

export async function getReferralsByAgencyId(agencyName: string) {
  // {Referring Agency} is now a lookup, but Airtable formulas can still
  // compare against lookup values as strings (single-value lookup → string).
  const formula = encodeURIComponent(`{Referring Agency} = "${agencyName}"`)
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
  )
  return data.records.map(shapeReferralListItem)
}

export async function getReferralsByStaffName(agencyName: string, staffName: string) {
  // Both {Referring Agency} and {Referring Staff} are now lookups through
  // Referring Staff Link → Agency Users. The single-value formula equality
  // still works for matching exact strings.
  const formula = encodeURIComponent(
    `AND({Referring Agency} = "${agencyName}", {Referring Staff} = "${staffName}")`,
  )
  const data = await airtableFetch(
    'Client Referrals',
    `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
  )
  return data.records.map(shapeReferralListItem)
}

export async function getAllReferrals(filters?: {
  review?: string
  statuses?: string[]
  // July 2026: renamed from `dateFrom` (Referral Date) to `appointmentDateFrom`
  // so history-style views filter on when the appointment actually happened,
  // not when the referral was submitted. Legacy `dateFrom` is still accepted
  // for backwards compat and treated as appointmentDateFrom.
  appointmentDateFrom?: string
  dateFrom?: string
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

  const apptDateFrom = filters?.appointmentDateFrom ?? filters?.dateFrom
  if (apptDateFrom) {
    // Filter by Appointment Date, not Referral Date. Inclusive of boundary:
    // returns appointments ON or AFTER apptDateFrom.
    conditions.push(
      `OR(IS_AFTER({Appointment Date}, "${apptDateFrom}"), IS_SAME({Appointment Date}, "${apptDateFrom}", 'day'))`
    )
  }

  const formula = conditions.length > 0
    ? encodeURIComponent(`AND(${conditions.join(', ')})`)
    : ''

  const params = formula
    ? `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`
    : `?sort[0][field]=Referral%20Date&sort[0][direction]=desc`

  // Fetch referrals + agency name→id map in parallel.
  // The map enables a clickable Agency cell on the Scheduled page (and any
  // other list view) without requiring a linked-record migration on Client
  // Referrals. Stays in sync because we rebuild on every list fetch.
  const [data, agencyIndex] = await Promise.all([
    airtableFetchAll('Client Referrals', params),
    // Paginated — without this, agencies past record 100 don't appear in
    // the name→id map and their referrals render as plain text instead of
    // teal-linked. Table currently has 131 agencies and grows over time.
    airtableFetchAll('Agencies', '?fields%5B%5D=Agency%20Name'),
  ])

  // Build TWO indexes: one by name (when Referring Agency lookup returns
  // a clean name string) and one by rec ID (defensive fallback for the
  // case where Referring Agency is still a link field returning rec IDs).
  //
  // Aggressive normalization for the name key so punctuation drift between
  // "St. Joseph" (Agencies table) and "St Joseph" (Referring Agency lookup)
  // doesn't miss the map — strip all non-alphanumerics, lowercase, collapse.
  const normalizeAgencyKey = (raw: string) =>
    raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')

  const agencyIdByName = new Map<string, string>()
  const agencyNameById = new Map<string, string>()
  for (const a of agencyIndex.records) {
    const raw = (a.fields['Agency Name'] as string) || ''
    const key = normalizeAgencyKey(raw)
    if (key) agencyIdByName.set(key, a.id)
    if (raw) agencyNameById.set(a.id, raw)
  }

  const records = data.records.map((record: any) => {
    const f = record.fields
    const firstName = (f['First Name'] as string) ?? ''
    const lastName = (f['Last Name'] as string) ?? ''

    // Referring Agency / Staff / Phone are LOOKUPS post-migration.
    // safeLookupString returns null for rec-ID strings (caught by guard)
    // so the UI never accidentally renders a "recAbCd..." instead of a name.
    let agencyName = safeLookupString(f['Referring Agency'])
    const staffName = safeLookupString(f['Referring Staff'])
    const staffPhone = safeLookupString(f['Staff Phone'])

    // FALLBACK: if Referring Agency got filtered to null because it's
    // still misconfigured as a link field, try to recover the name via
    // the raw rec ID through our agencyNameById index.
    const rawAgencyValue = unwrapLookup<string>(f['Referring Agency'])
    if (!agencyName && typeof rawAgencyValue === 'string' && REC_ID_RE.test(rawAgencyValue)) {
      agencyName = agencyNameById.get(rawAgencyValue) ?? null
    }

    const agencyKey = agencyName ? normalizeAgencyKey(agencyName) : ''
    let referringAgencyId = agencyKey
      ? (agencyIdByName.get(agencyKey) ?? null)
      : null

    // Second fallback for the ID: if the raw value already IS a rec ID
    // (link-field case), use it directly so the link still works.
    if (
      !referringAgencyId &&
      typeof rawAgencyValue === 'string' &&
      REC_ID_RE.test(rawAgencyValue)
    ) {
      referringAgencyId = rawAgencyValue
    }

    // Referring Staff Link is a single link field; grab the linked user id
    // so the list view can deep-link to a Staff ID page when we build it.
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
      referralReview: f['Referral Review'] as string,
      appointmentStatus: f['Appointment Status'] as string,
      appointmentSlipUrl: (f['Appt Slip'] as string) ?? null,
      referredBy: staffName,
      staffName,
      staffPhone,
      referringAgency: agencyName,
      referringAgencyId,                   // drives the teal-bold link in list view
      referringStaffId,                    // resolved from Referring Staff Link
      agencyName,
      dataPageUrl: (f['Data Page URL'] as string) ?? null,
      address: (f['Address'] as string) ?? null,
      city: (f['City'] as string) ?? null,
      state: (f['State'] as string) ?? null,
      zip: (f['Zip'] as string) ?? null,
      phone: (f['Phone'] as string) ?? null,
    }
  })

  // Client-side search filter
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    return records.filter((r: any) =>
      r.clientName.toLowerCase().includes(q) ||
      (r.referringAgency ?? '').toLowerCase().includes(q) ||
      (r.referredBy ?? '').toLowerCase().includes(q)
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

export async function getReferralById(referralId: string) {
  const data = await airtableFetch('Client Referrals', `/${referralId}`)
  const f = data.fields

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

  // Referring Staff Link is a single link to Agency Users. The plaintext
  // counterparts (Referring Agency / Referring Staff / Agency Email /
  // Staff Phone) are LOOKUPS through that link as of June 2026 and come
  // back wrapped in arrays — unwrap them here. safeLookupString also
  // guards against the field still being misconfigured as a link.
  const referringStaffLinkId = (f['Referring Staff Link'] as string[])?.[0] ?? null

  // Client link — single rec ID pointing at Clients. Needed so the Client
  // Detail page can PATCH identity fields (First Name / DOB / Address /
  // etc.) which live on Clients, not on Client Referrals.
  const clientId = (f['Client'] as string[])?.[0] ?? null

  // Referring Agency ID — derived from Referring Staff Link → Agency Users
  // → Agency. Client Referrals doesn't have a direct link to Agencies,
  // so we chase the chain through the linked Agency User. Cost: one extra
  // API fetch per detail view, only when a staff link exists.
  let referringAgencyId: string | null = null
  if (referringStaffLinkId) {
    try {
      const user = await airtableFetch('Agency Users', `/${referringStaffLinkId}`)
      referringAgencyId = (user.fields?.['Agency'] as string[])?.[0] ?? null
    } catch {
      // Non-fatal — the link will render as plain text if this fails.
      referringAgencyId = null
    }
  }

  // First Name / Last Name / DOB / Phone / Address / etc. became LOOKUPS
  // through the Client link in June 2026, so they come back wrapped in
  // arrays. safeLookupString handles the unwrap AND guards against a
  // misconfigured link returning a rec ID string.
  const firstName = safeLookupString(f['First Name']) ?? ''
  const lastName  = safeLookupString(f['Last Name'])  ?? ''

  return {
    id: data.id,
    clientId,                                         // for PATCH /api/dawson/clients/[id]
    clientName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    dob:       safeLookupString(f['DOB']),
    phone:     safeLookupString(f['Phone']),
    language:  safeLookupString(f['Preferred Language']),
    address:   safeLookupString(f['Address']),
    address2:  safeLookupString(f['Address 2']),
    city:      safeLookupString(f['City']),
    state:     safeLookupString(f['State']),
    zip:       safeLookupString(f['Zip']),
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
    referralDate: f['Referral Date'] as string,
    referredByPhone: safeLookupString(f['Staff Phone']),
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (f['Appointment Time'] as string) ?? null,
    appointmentSlipUrl: (f['Appt Slip'] as any[])?.[0]?.url ?? null,
    dataPageUrl: (f['Data Page URL'] as string) ?? null,
    referredBy: safeLookupString(f['Referring Staff']),
    referringAgency: safeLookupString(f['Referring Agency']),
    agencyEmail: safeLookupString(f['Agency Email']),
    referringStaffLinkId,                             // for deep-link to Staff ID page
    referringAgencyId,                                // for deep-link to Agency detail page
    possibleDuplicate: (f['Possible Duplicate'] as boolean) ?? false,
    // Aug 2026: two plain Airtable checkboxes on Client Referrals.
    // Unchecked checkboxes come back as `undefined` from the API (not
    // `false`), so both need the `?? false` coercion — otherwise the
    // Referral Detail page's lock logic (recordLocked / completedLocked)
    // would see `undefined`, which is falsy in the same way but breaks the
    // `boolean` type the page expects.
    readyForPostApptEmail: (f['Ready for Post-Appt Email'] as boolean) ?? false,
    postApptEmailSent: (f['Post Appt Email Sent'] as boolean) ?? false,
    itemsDisbursed,
  }
}
