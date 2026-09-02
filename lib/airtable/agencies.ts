// lib/airtable/agencies.ts
//
// Reads and writes against the Agencies table. Contact-facing fields
// (Admin First/Last Name, Admin Email, Admin Phone) come through the
// Primary Admin link to Agency Users, so they arrive as lookups and go
// through safeLookupString.

import {
  airtableFetch,
  airtableFetchAll,
  optionalString,
  safeLookupString,
  BASE_ID,
  HEADERS,
} from './client'

// Airtable omits empty fields from the API response entirely, so every
// optional column reads back `undefined` when blank — including ones the
// UI treats as always-there, like City (75 of 129 unclaimed agencies have
// none). These mappers used to paper over that with `as string`, which let
// `undefined` masquerade as `string` all the way into `.toLowerCase()`
// calls in search boxes. Optional text fields are now typed `string | null`
// honestly; only the primary display field (Agency Name) falls back to ''
// because everything renders and sorts on it.

export async function getAgencyById(agencyId: string) {
  const data = await airtableFetch('Agencies', `/${agencyId}`)
  const f = data.fields
  // Admin contact info now comes from the Primary Admin lookup chain.
  // When no Primary Admin is set yet (Unclaimed agencies), these lookups
  // return undefined and contactName collapses to ''.
  const adminFirst = safeLookupString(f['Admin First Name']) ?? ''
  const adminLast = safeLookupString(f['Admin Last Name']) ?? ''
  return {
    id: data.id,
    name: optionalString(f['Agency Name']) ?? '',
    officeName: optionalString(f['Office Name']),
    ein: optionalString(f['EIN#']),
    address: optionalString(f['Address']),
    address2: optionalString(f['Address 2']),
    city: optionalString(f['City']),
    state: optionalString(f['State']),
    zip: optionalString(f['Zip']),
    phone: optionalString(f['Main Phone Number']),
    website: optionalString(f['Website']),
    contactName: `${adminFirst} ${adminLast}`.trim(),
    adminEmail: safeLookupString(f['Admin Email']) ?? null,
    adminPhone: safeLookupString(f['Admin Phone']) ?? null,
    status: optionalString(f['Status']) ?? '',
    clerkOrgId: optionalString(f['Clerk Org ID']),
  }
}

export async function getAllAgencies(status?: string) {
  // Accept either single status ("Approved") or comma-separated ("Approved,Unclaimed")
  let formula = ''
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      formula = encodeURIComponent(`{Status} = "${statuses[0]}"`)
    } else if (statuses.length > 1) {
      const orClauses = statuses.map(s => `{Status} = "${s}"`).join(', ')
      formula = encodeURIComponent(`OR(${orClauses})`)
    }
  }

  const params = formula
    ? `?filterByFormula=${formula}&sort[0][field]=Agency%20Name&sort[0][direction]=asc`
    : `?sort[0][field]=Agency%20Name&sort[0][direction]=asc`
  // Paginated — the Agencies table already exceeds 100 rows (July 2026).
  const data = await airtableFetchAll('Agencies', params)

  return data.records.map((record: any) => {
    const f = record.fields
    const adminFirst = safeLookupString(f['Admin First Name']) ?? ''
    const adminLast = safeLookupString(f['Admin Last Name']) ?? ''
    return {
      id: record.id,
      name: optionalString(f['Agency Name']) ?? '',
      ein: optionalString(f['EIN#']),
      address: optionalString(f['Address']),
      address2: optionalString(f['Address 2']),
      city: optionalString(f['City']),
      state: optionalString(f['State']),
      zip: optionalString(f['Zip']),
      phone: optionalString(f['Main Phone Number']),
      // Admin email is now a lookup via Primary Admin.
      email: safeLookupString(f['Admin Email']),
      contactName: `${adminFirst} ${adminLast}`.trim(),
      status: optionalString(f['Status']) ?? '',
      // FIXED: was reading "Registration Date" (a field that doesn't exist).
      // The real field is "Record Creation Date".
      registrationDate: optionalString(f['Record Creation Date']),
      approvalDate: optionalString(f['Approval Date']),
      invitedDate: optionalString(f['Invited Date']),
      rejectedDate: optionalString(f['Rejected Date']),
      website: optionalString(f['Website']),
      officeName: optionalString(f['Office Name']),
      possibleDuplicate: (f['Possible Duplicate'] as boolean) ?? false,
      source: optionalString(f['Source']),
      // Ben ticks Reconciled in Airtable once he has verified the imported
      // agency. Together with an Admin Email on file (via Primary Admin) it
      // gates the Invite button on the Unclaimed list.
      reconciled: (f['Reconciled'] as boolean) ?? false,
    }
  })
}

export async function getAgencyWithDetails(agencyId: string) {
  // Fetch agency first to get the name
  const agency = await airtableFetch('Agencies', `/${agencyId}`)
  const agencyName = agency.fields['Agency Name'] as string

  // Then fetch users and referrals in parallel.
  //
  // USERS. The filter matches on {Agency Record ID}, NOT on {Agency}.
  //
  // {Agency} is the linked-record field, and a linked-record field referenced
  // from an Airtable formula resolves to the linked rows' PRIMARY FIELD - for
  // Agencies that is the agency's name. So the previous filter,
  // FIND("recXXXX", ARRAYJOIN({Agency}, ",")), was looking for a record id
  // inside a string of agency names and matched nothing, ever. Verified against
  // the live base: it returned 0 rows for an agency with three Active users.
  // That is why this page said "No portal users yet" for every agency and why
  // its Active Staff tile always read 0 - not just for active staff, for all of
  // them.
  //
  // {Agency Record ID} is an existing lookup on Agency Users that pulls the
  // linked agency's RECORD_ID() formula, so it genuinely contains ids. Matching
  // on it keeps this id-based rather than name-based, which also means a
  // renamed agency and two agencies with similar names can't confuse it.
  //
  // Referrals filter uses {Referring Agency} which is now a lookup through
  // Referring Staff Link, but single-value lookup formulas still compare as
  // strings, so the existing filter still works for the linked-staff case.
  // Referrals with NO staff link (Branch c in createReferralWithAgency) will
  // not appear in this list — they have no Referring Agency lookup value.
  // Those should be reconciled at agency-claim time.
  const [users, referrals] = await Promise.all([
    airtableFetch(
      'Agency Users',
      `?filterByFormula=${encodeURIComponent(`FIND("${agencyId}", ARRAYJOIN({Agency Record ID}, ","))`)}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
    ),
    airtableFetch(
      'Client Referrals',
      `?filterByFormula=${encodeURIComponent(`{Referring Agency} = "${agencyName}"`)}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
    ),
  ])

  const af = agency.fields
  const adminFirst = safeLookupString(af['Admin First Name']) ?? ''
  const adminLast = safeLookupString(af['Admin Last Name']) ?? ''
  const adminEmail = safeLookupString(af['Admin Email'])
  const adminPhone = safeLookupString(af['Admin Phone'])
  // Primary Admin is a link field on Agencies — single linked Agency User id.
  const primaryAdminId = (af['Primary Admin'] as string[])?.[0] ?? null

  return {
    id: agency.id,
    name: optionalString(af['Agency Name']) ?? '',
    ein: optionalString(af['EIN#']),
    address: optionalString(af['Address']),
    address2: optionalString(af['Address 2']),
    city: optionalString(af['City']),
    state: optionalString(af['State']),
    zip: optionalString(af['Zip']),
    county: optionalString(af['County']),
    officeName: optionalString(af['Office Name']),
    phone: optionalString(af['Main Phone Number']),
    website: optionalString(af['Website']),
    // Admin-derived (lookup chain via Primary Admin → Agency Users)
    email: adminEmail,
    contactFirstName: adminFirst || null,
    contactLastName: adminLast || null,
    contactPhone: adminPhone,
    primaryAdminId,                                  // for the admin-confirm UI
    // Gates the Invite button on the detail page, same as it gates the invite
    // route: only a reconciled agency with a primary admin + email can be
    // invited.
    reconciled: (af['Reconciled'] as boolean) ?? false,
    status: optionalString(af['Status']) ?? '',
    // FIXED: "Registration Date" → "Record Creation Date"
    registrationDate: optionalString(af['Record Creation Date']),
    approvalDate: optionalString(af['Approval Date']),
    invitedDate: optionalString(af['Invited Date']),
    rejectedDate: optionalString(af['Rejected Date']),
    agencyNumber: optionalString(af['Agency #']),
    possibleDuplicate: (af['Possible Duplicate'] as boolean) ?? false,
    notes: optionalString(af['Notes']),
    source: optionalString(af['Source']),
    users: users.records.map((r: any) => ({
      id: r.id,
      name: `${r.fields['First Name'] ?? ''} ${r.fields['Last Name'] ?? ''}`.trim(),
      firstName: optionalString(r.fields['First Name']) ?? '',
      lastName: optionalString(r.fields['Last Name']) ?? '',
      // Genuinely absent on Excel-import placeholder rows — the detail page
      // shows a "no email on file" badge for exactly this case.
      email: optionalString(r.fields['Email']),
      phone: optionalString(r.fields['Phone Number']),
      role: optionalString(r.fields['Role']) ?? '',
      status: optionalString(r.fields['Status']) ?? '',
      // FIXED: was falling back to "Registration Date" (doesn't exist).
      // Real field is "Record Creation Date" on Agency Users.
      invitedDate:
        optionalString(r.fields['Invited Date']) ??
        optionalString(r.fields['Record Creation Date']),
      needsReview: (r.fields['Needs Review'] as boolean) ?? false,
      isPrimaryAdmin: primaryAdminId === r.id,
    })),
    referralCount: referrals.records.length,
    referrals: referrals.records.map((r: any) => ({
      id: r.id,
      clientName: `${r.fields['First Name'] ?? ''} ${r.fields['Last Name'] ?? ''}`.trim(),
      referralDate: r.fields['Referral Date'] as string,
      // July 2026: include appointment date so the agency detail panel can
      // show "Appt Date" for Scheduled/Completed/No Show rows instead of
      // the (less useful) submission date.
      appointmentDate: (r.fields['Appointment Date'] as string[])?.[0] ?? null,
      referralReview: r.fields['Referral Review'] as string,
      appointmentStatus: r.fields['Appointment Status'] as string,
      referredBy: safeLookupString(r.fields['Referring Staff']),
    })),
  }
}

export async function updateAgencyNotes(id: string, notes: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { Notes: notes } }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateAgencyProfile(
  recordId: string,
  update: {
    agencyName?: string
    officeName?: string | null
    ein?: string | null
    address?: string
    address2?: string | null
    city?: string
    state?: string
    zip?: string
    phone?: string
    website?: string | null
  }
) {
  const fields: Record<string, unknown> = {}
  if (update.agencyName !== undefined) fields['Agency Name']       = update.agencyName
  if (update.officeName !== undefined) fields['Office Name']       = update.officeName
  if (update.ein !== undefined)        fields['EIN#']              = update.ein
  if (update.address !== undefined)    fields['Address']           = update.address
  if (update.address2 !== undefined)   fields['Address 2']         = update.address2
  if (update.city !== undefined)       fields['City']              = update.city
  if (update.state !== undefined)      fields['State']             = update.state
  if (update.zip !== undefined)        fields['Zip']               = update.zip
  if (update.phone !== undefined)      fields['Main Phone Number'] = update.phone
  if (update.website !== undefined)    fields['Website']           = update.website

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
