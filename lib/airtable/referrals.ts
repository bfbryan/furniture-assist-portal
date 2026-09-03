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

  const records = data.records.map((record: any) => {
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
    // staff link (all 452 today); blank for the rare link-less import rows,
    // exactly as the old name→id map also failed to resolve those.
    const referringAgencyId = (f['Referring Agency ID'] as string[])?.[0] ?? null

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
      // The live Appointment Date coalesced with the Original snapshot — the
      // date a terminal (cancelled/withdrawn) referral should be filed under.
      // Read from the same {Effective Appointment Date} formula the date
      // filter above uses, so the two can't disagree. Additive; see
      // lib/referrals/effective-date.ts for the pre-field JS equivalent.
      effectiveAppointmentDate:
        (Array.isArray(f['Effective Appointment Date'])
          ? (f['Effective Appointment Date'] as string[])[0]
          : (f['Effective Appointment Date'] as string)) ?? null,
      // What the agency ASKED for, as opposed to what is currently booked.
      // Only meaningful while Appointment Status is 'Reschedule'; the Awaiting
      // Review page reads these to offer Dawson "accept as requested".
      // Preferred Time's select options are identical to Appointment Time's,
      // so this value needs no translation on the way back out.
      preferredDate: (f['Preferred Date'] as string) ?? null,
      preferredTime: (f['Preferred Time'] as string) ?? null,
      schedulingFlexibility: (f['Scheduling Flexibility'] as string) ?? null,
      // UTC timestamp stamped when Appointment Status is set to 'Reschedule',
      // by both writers of that status (agency reschedule request, and the OCR
      // no-usable-date branch). The Needs Action page reads it for the
      // "requested N days ago" age on a reschedule card; null on rows that
      // pre-date the field, rendered there as "request date unknown".
      rescheduleRequestedAt: (f['Reschedule Requested At'] as string) ?? null,
      referralReview: f['Referral Review'] as string,
      appointmentStatus: f['Appointment Status'] as string,
      appointmentSlipUrl: attachmentUrl(f['Appt Slip']),
      // Same attachment field the detail shape already reads. Added to the
      // list shape so History can link straight to a completed client's
      // receipt without opening the record.
      clientReceiptUrl: attachmentUrl(f['Client Receipt']),
      // The slot a terminal referral last held, snapshotted by
      // end-referral.ts. History's fallback for the Appointment column /
      // month grouping once it reads from here. Same defensive array unwrap
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
  })

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
    // What the referral last held before a cancel/withdraw released the slot —
    // written by lib/referrals/end-referral.ts. The live Appointment Date
    // lookup goes empty once the Saturday Schedule link is cleared, so the
    // agency Appointment card falls back to these to show the cancelled slot.
    originalAppointmentDate: Array.isArray(f['Original Appointment Date'])
      ? ((f['Original Appointment Date'] as string[])[0] ?? null)
      : ((f['Original Appointment Date'] as string) ?? null),
    originalAppointmentTime: (f['Original Appointment Time'] as string) ?? null,
    // Same three fields the list shape carries, for the same reason: the
    // agency detail page's Appointment card left Date and Time blank on a
    // referral awaiting a reschedule. See lib/referrals/requested-slot.ts.
    preferredDate: (f['Preferred Date'] as string) ?? null,
    preferredTime: (f['Preferred Time'] as string) ?? null,
    schedulingFlexibility: (f['Scheduling Flexibility'] as string) ?? null,
    appointmentSlipUrl: attachmentUrl(f['Appt Slip']),
    // Written by the client-receipt cron (lib/notifications/client-receipt.ts)
    // into the "Client Receipt" attachment field once the visit is done. Read
    // only — the portal surfaces the PDF, it never generates it.
    clientReceiptUrl: attachmentUrl(f['Client Receipt']),
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
