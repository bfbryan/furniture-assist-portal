// lib/airtable/agencies.ts
//
// Reads and writes against the Agencies table. Contact-facing fields
// (Admin First/Last Name, Admin Email, Admin Phone) come through the
// Primary Admin link to Agency Users, so they arrive as lookups and go
// through safeLookupString.

import { airtableFetch, airtableFetchAll, safeLookupString, BASE_ID, HEADERS } from './client'

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
    name: f['Agency Name'] as string,
    officeName: (f['Office Name'] as string) ?? null,
    ein: (f['EIN#'] as string) ?? null,
    address: f['Address'] as string,
    address2: (f['Address 2'] as string) ?? null,
    city: f['City'] as string,
    state: f['State'] as string,
    zip: f['Zip'] as string,
    phone: f['Main Phone Number'] as string,
    website: (f['Website'] as string) ?? null,
    contactName: `${adminFirst} ${adminLast}`.trim(),
    adminEmail: safeLookupString(f['Admin Email']) ?? null,
    adminPhone: safeLookupString(f['Admin Phone']) ?? null,
    status: f['Status'] as string,
    clerkOrgId: (f['Clerk Org ID'] as string) ?? null,
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
      name: f['Agency Name'] as string,
      ein: f['EIN#'] as string,
      address: f['Address'] as string,
      address2: (f['Address 2'] as string) ?? null,
      city: f['City'] as string,
      state: f['State'] as string,
      zip: f['Zip'] as string,
      phone: f['Main Phone Number'] as string,
      // Admin email is now a lookup via Primary Admin.
      email: safeLookupString(f['Admin Email']),
      contactName: `${adminFirst} ${adminLast}`.trim(),
      status: f['Status'] as string,
      // FIXED: was reading "Registration Date" (a field that doesn't exist).
      // The real field is "Record Creation Date".
      registrationDate: (f['Record Creation Date'] as string) ?? null,
      approvalDate: (f['Approval Date'] as string) ?? null,
      invitedDate: (f['Invited Date'] as string) ?? null,
      rejectedDate: (f['Rejected Date'] as string) ?? null,
      website: (f['Website'] as string) ?? null,
      officeName: (f['Office Name'] as string) ?? null,
      possibleDuplicate: (f['Possible Duplicate'] as boolean) ?? false,
      source: (f['Source'] as string) ?? null,
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
  // Referrals filter uses {Referring Agency} which is now a lookup through
  // Referring Staff Link, but single-value lookup formulas still compare as
  // strings, so the existing filter still works for the linked-staff case.
  // Referrals with NO staff link (Branch c in createReferralWithAgency) will
  // not appear in this list — they have no Referring Agency lookup value.
  // Those should be reconciled at agency-claim time.
  const [users, referrals] = await Promise.all([
    airtableFetch(
      'Agency Users',
      `?filterByFormula=${encodeURIComponent(`FIND("${agencyId}", ARRAYJOIN({Agency}, ","))`)}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
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
    name: af['Agency Name'] as string,
    ein: af['EIN#'] as string,
    address: af['Address'] as string,
    address2: (af['Address 2'] as string) ?? null,
    city: af['City'] as string,
    state: af['State'] as string,
    zip: af['Zip'] as string,
    county: (af['County'] as string) ?? null,
    officeName: (af['Office Name'] as string) ?? null,
    phone: af['Main Phone Number'] as string,
    website: (af['Website'] as string) ?? null,
    // Admin-derived (lookup chain via Primary Admin → Agency Users)
    email: adminEmail,
    contactFirstName: adminFirst || null,
    contactLastName: adminLast || null,
    contactPhone: adminPhone,
    primaryAdminId,                                  // for the admin-confirm UI
    status: af['Status'] as string,
    // FIXED: "Registration Date" → "Record Creation Date"
    registrationDate: (af['Record Creation Date'] as string) ?? null,
    approvalDate: (af['Approval Date'] as string) ?? null,
    invitedDate: (af['Invited Date'] as string) ?? null,
    rejectedDate: (af['Rejected Date'] as string) ?? null,
    agencyNumber: (af['Agency #'] as string) ?? null,
    possibleDuplicate: (af['Possible Duplicate'] as boolean) ?? false,
    notes: (af['Notes'] as string) ?? null,
    source: (af['Source'] as string) ?? null,
    users: users.records.map((r: any) => ({
      id: r.id,
      name: `${r.fields['First Name'] ?? ''} ${r.fields['Last Name'] ?? ''}`.trim(),
      firstName: (r.fields['First Name'] as string) ?? '',
      lastName: (r.fields['Last Name'] as string) ?? '',
      email: r.fields['Email'] as string,
      phone: (r.fields['Phone Number'] as string) ?? null,
      role: r.fields['Role'] as string,
      status: r.fields['Status'] as string,
      // FIXED: was falling back to "Registration Date" (doesn't exist).
      // Real field is "Record Creation Date" on Agency Users.
      invitedDate:
        (r.fields['Invited Date'] as string) ??
        (r.fields['Record Creation Date'] as string) ??
        null,
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
