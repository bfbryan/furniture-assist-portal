// lib/airtable.ts
//
// Read/write helpers for the Furniture Assist portal.
//
// Schema migration (June 2026) — what changed here:
//
//   Agencies:
//     DELETED: First Name, Last Name, Email, Phone Number,
//              Client Referrals (text), Agency Code, Admin Confirmed
//     ADDED:   Primary Admin (link → Agency Users)
//              Admin First Name, Admin Last Name, Admin Email,
//              Admin Phone (lookups via Primary Admin)
//              Invited Date, Rejected Date
//     RENAMED reference: "Registration Date" was never a real field —
//              the correct field name is "Record Creation Date".
//              All read sites have been corrected.
//
//   Agency Users:
//     NEW primary: Full Name (formula = {First Name} & " " & {Last Name})
//     DELETED: Client Referrals (text), Agency UID, Display Name (superseded
//              by Full Name as primary on 06/30/26)
//     ADDED:   Needs Review (Checkbox), Referrals Submitted (reverse link),
//              Full Name (formula primary)
//
//   Client Referrals:
//     NEW:     Referring Staff Link (link → Agency Users, single)
//     CHANGED (Text/Email/Phone → Lookup via Referring Staff Link):
//              Referring Agency, Referring Staff, Agency Email, Staff Phone
//     DELETED: Assigned By, Emergency
//
// Schema migration (July 2026) — CLIENTS TABLE FORK (COMPLETE):
//
//   Clients (new table):
//     Owns all client identity: First Name, Last Name, DOB, Phone,
//     Address, Address 2, City, State, Zip, County, Preferred Language.
//     Primary formula: {Last Name} & "-" & {First Name} & "-" &
//                      DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
//
//   Client Referrals:
//     NEW:     Client (link → Clients, single)
//     CHANGED (Text/Date/Phone → Lookup via Client):
//              First Name, Last Name, DOB, Phone, Address, Address 2,
//              City, State, Zip, County, Preferred Language
//     Unique ID formula updated to ARRAYJOIN({Last Name}) etc. so it
//     resolves against the new lookup shape.
//
// Every contact-facing field on Agencies now comes through Agency Users
// via the Primary Admin link. Every staff/agency-facing field on a
// Client Referral comes through Agency Users via the Referring Staff Link.
// Every client-identity field on a Client Referral comes through Clients
// via the Client link and must be unwrapped with safeLookupString.


const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}


async function airtableFetch(table: string, params: string = '') {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable error: ${err}`)
  }
  return res.json()
}


// Lookups return arrays even when the underlying field is a single value.
// This unwraps `["foo"]` -> `"foo"` and `[]` / undefined -> null. Used for
// all admin-* lookups on Agencies, all staff/agency lookups on Client
// Referrals (June 2026 migration), and all client-identity lookups on
// Client Referrals (July 2026 migration).
function unwrapLookup<T = string>(value: unknown): T | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value[0] as T
  }
  return value as T
}


// DEFENSIVE GUARD (June 2026):
//   If a "Referring Agency" / "Referring Staff" / "Agency Email" /
//   "Staff Phone" field is configured as a Link to another record
//   instead of a Lookup, Airtable will return an array of record IDs
//   (e.g. ["recAbCd1234..."]) and unwrapLookup will hand us a string
//   like "recAbCd1234EFGHIJ" — which then renders verbatim in the UI.
//
//   This guard catches that case and returns null so the page shows
//   a clean em-dash instead of a record ID. If you see lots of nulls
//   where you expect names, the underlying Airtable field is still a
//   link and needs to be converted to a lookup (or the lookup needs
//   its "Field to look up" pointed at a text column, not a record id).
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/
function safeLookupString(value: unknown): string | null {
  const v = unwrapLookup<string>(value)
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  if (REC_ID_RE.test(v)) return null
  return v
}


// Numeric lookup unwrap. Some client-identity lookups on Client Referrals
// (e.g. Zip when stored as a number on Clients) come back as [12345].
// Coerces to string for consistent display, or null when empty.
function safeLookupNumberAsString(value: unknown): string | null {
  const v = unwrapLookup<unknown>(value)
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  return null
}


export async function getAgencyUserByClerkId(clerkUserId: string) {
  const formula = encodeURIComponent(`{Clerk User ID} = "${clerkUserId}"`)
  const data = await airtableFetch('Agency Users', `?filterByFormula=${formula}&maxRecords=1`)


  if (!data.records || data.records.length === 0) return null


  const record = data.records[0]
  return {
    id: record.id,
    name: `${record.fields['First Name'] ?? ''} ${record.fields['Last Name'] ?? ''}`.trim(),
    email: record.fields['Email'] as string,
    role: record.fields['Role'] as string,
    agencyId: (record.fields['Agency'] as string[])?.[0] ?? null,
    phone: (record.fields['Phone Number'] as string) ?? null,
    status: record.fields['Status'] as string,
  }
}


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
    address: f['Address'] as string,
    address2: (f['Address 2'] as string) ?? null,
    city: f['City'] as string,
    state: f['State'] as string,
    zip: f['Zip'] as string,
    phone: f['Main Phone Number'] as string,
    contactName: `${adminFirst} ${adminLast}`.trim(),
    status: f['Status'] as string,
    clerkOrgId: (f['Clerk Org ID'] as string) ?? null,
  }
}


// Internal helper: shape a Client Referrals record into the list-view object.
// Pulls staff / agency / agency-email / staff-phone from the Referring Staff
// Link lookups (June 2026) and all client identity from the Client link
// lookups (July 2026) — all unwrapped via safeLookupString.
function shapeReferralListItem(record: any) {
  const f = record.fields
  const firstName = safeLookupString(f['First Name']) ?? ''
  const lastName = safeLookupString(f['Last Name']) ?? ''
  return {
    id: record.id,
    clientName: `${firstName} ${lastName}`.trim(),
    referralDate: f['Referral Date'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (f['Appointment Time'] as string) ?? null,
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentSlipUrl: f['Appt Slip'] as string,
    referredBy: safeLookupString(f['Referring Staff']),
    dataPageUrl: f['Data Page URL'] as string,
    address: safeLookupString(f['Address']),
    address2: safeLookupString(f['Address 2']),
    city: safeLookupString(f['City']),
    state: safeLookupString(f['State']),
    zip: safeLookupNumberAsString(f['Zip']),
    phone: safeLookupString(f['Phone']),
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


// ─── DAWSON PORTAL FUNCTIONS ───────────────────────────────────────────────


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
  const data = await airtableFetch('Agencies', params)


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
    }
  })
}


export async function getAllReferrals(filters?: {
  review?: string
  statuses?: string[]
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


  if (filters?.dateFrom) {
    conditions.push(`{Referral Date} >= "${filters.dateFrom}"`)
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
    airtableFetch('Client Referrals', params),
    airtableFetch('Agencies', '?fields%5B%5D=Agency%20Name'),
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
    // Client identity fields are LOOKUPS post-July-2026 migration —
    // safeLookupString unwraps the [value] array shape and guards
    // against rec-ID fallback (though clients don't chain via link,
    // the guard is harmless).
    const firstName = safeLookupString(f['First Name']) ?? ''
    const lastName = safeLookupString(f['Last Name']) ?? ''


    // Referring Agency / Staff / Phone are LOOKUPS post-June-2026 migration.
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
      // Client identity — all lookups via {Client} link
      address: safeLookupString(f['Address']),
      city: safeLookupString(f['City']),
      state: safeLookupString(f['State']),
      zip: safeLookupNumberAsString(f['Zip']),
      phone: safeLookupString(f['Phone']),
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


export async function getDashboardStats() {
  const [agencies, referrals] = await Promise.all([
    airtableFetch('Agencies', ''),
    airtableFetch('Client Referrals', '?sort[0][field]=Referral%20Date&sort[0][direction]=desc'),
  ])


  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]


  const agencyRecords = agencies.records
  const referralRecords = referrals.records


  return {
    totalAgencies: agencyRecords.length,
    pendingAgencies: agencyRecords.filter((r: any) => r.fields['Status'] === 'Pending').length,
    approvedAgencies: agencyRecords.filter((r: any) => r.fields['Status'] === 'Approved').length,
    totalReferrals: referralRecords.length,
    pendingReferrals: referralRecords.filter((r: any) => r.fields['Referral Review'] === 'Pending').length,
    scheduledReferrals: referralRecords.filter(
      (r: any) =>
        r.fields['Appointment Status']?.name === 'Scheduled' ||
        r.fields['Appointment Status'] === 'Scheduled',
    ).length,
    thisMonthReferrals: referralRecords.filter((r: any) => r.fields['Referral Date'] >= startOfMonth).length,
    recentReferrals: referralRecords.slice(0, 5).map((record: any) => {
      const f = record.fields
      // Identity fields are lookups post-July-2026.
      const firstName = safeLookupString(f['First Name']) ?? ''
      const lastName = safeLookupString(f['Last Name']) ?? ''
      return {
        id: record.id,
        clientName: `${firstName} ${lastName}`.trim(),
        referralDate: f['Referral Date'] as string,
        referralReview: f['Referral Review'] as string,
        appointmentStatus: f['Appointment Status'] as string,
        // Guarded lookups — return null instead of rec IDs.
        referringAgency: safeLookupString(f['Referring Agency']),
        referredBy: safeLookupString(f['Referring Staff']),
      }
    }),
    pendingAgencyList: agencyRecords
      .filter((r: any) => r.fields['Status'] === 'Pending')
      .slice(0, 5)
      .map((record: any) => {
        const f = record.fields
        const adminFirst = safeLookupString(f['Admin First Name']) ?? ''
        const adminLast = safeLookupString(f['Admin Last Name']) ?? ''
        return {
          id: record.id,
          name: f['Agency Name'] as string,
          city: f['City'] as string,
          // FIXED: "Registration Date" → "Record Creation Date"
          registrationDate: (f['Record Creation Date'] as string) ?? null,
          contactName: `${adminFirst} ${adminLast}`.trim(),
        }
      }),
  }
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
    referrals: referrals.records.map((r: any) => {
      // Client identity fields are lookups post-July-2026 migration.
      const firstName = safeLookupString(r.fields['First Name']) ?? ''
      const lastName = safeLookupString(r.fields['Last Name']) ?? ''
      return {
        id: r.id,
        clientName: `${firstName} ${lastName}`.trim(),
        referralDate: r.fields['Referral Date'] as string,
        referralReview: r.fields['Referral Review'] as string,
        appointmentStatus: r.fields['Appointment Status'] as string,
        referredBy: safeLookupString(r.fields['Referring Staff']),
      }
    }),
  }
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


  const itemsDisbursed = {
    livingRoom: compact([
      item('Bookcase / Storage',    'LR Bookcase/Storage'),
      item('Chair',                  'LR Chair'),
      item('Coffee Table',           'LR Coffee Table'),
      item('Couch / Loveseat / Futon', 'LR Couch/Loveseat/Futon'),
      item('End Table / TV Stand',   'LR End Table/TV Stand'),
      item('Lamp',                   'LR Lamp'),
      item('Picture / Decor',        'LR Picture/Other Decor'),
      item('Rug',                    'LR Rug'),
      item('Student Desk',           'LR Student Desk'),
      item('TV / Electronics',       'LR TV/Electronics'),
    ]),
    bedroom: compact([
      item('Bedframe',               'BR Bedframe'),
      item('Dresser',                'BR Dresser'),
      item('Mattress / Boxspring',   'BR Mattress/Boxspring'),
      item('Nightstand',             'BR Nightstand'),
    ]),
    diningRoom: compact([
      item('Dining Table',           'DR Dining Table'),
      item('Chair',                  'DR Chair'),
    ]),
    kitchen: compact([
      item('Dishes',                 'KH Dishes'),
      item('Pots / Pans / Utensils', 'KH Pots/Pans/Utensils'),
      item('Small Appliance',        'KH Small Appliance'),
      item('Linen',                  'KH Linen'),
      item('Bathroom',               'KH Bathroom'),
      item('General Household',      'KH General Household'),
      item('Home Office',            'KH Home Office'),
      item('Cookbook',               'KH Cookbook'),
    ]),
    linens: compact([
      item('Clothes',                'CL Clothes'),
      item('Shoes',                  'CL Shoes'),
    ]),
    misc: compact([
      item('Crib / Bassinet',        'BK Crib/Bassinet'),
      item('Baby Clothes',           'BK Baby Clothes'),
      item('General Baby',           'BK General Baby'),
      item('Toys / Books / School',  'BK Toys/Books/School'),
    ]),
    volunteerInitials: (f['Volunteer Initials'] as string) ?? null,
    checkoutTime: (f['Check-out Time'] as string) ?? null,
    distributionNotes: (f['Distribution Notes'] as string) ?? null,
  }


  // Referring Staff Link is a single link to Agency Users. The plaintext
  // counterparts (Referring Agency / Referring Staff / Agency Email /
  // Staff Phone) are LOOKUPS through that link as of June 2026.
  // Client identity fields (First Name, Last Name, DOB, Phone, Address,
  // Address 2, City, State, Zip, County, Preferred Language) are LOOKUPS
  // through the {Client} link as of July 2026. All come back wrapped in
  // arrays — unwrap them here via safeLookupString.
  const referringStaffLinkId = (f['Referring Staff Link'] as string[])?.[0] ?? null
  const clientLinkId = (f['Client'] as string[])?.[0] ?? null


  const firstName = safeLookupString(f['First Name']) ?? ''
  const lastName = safeLookupString(f['Last Name']) ?? ''


  return {
    id: data.id,
    clientName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    // DOB lookup — Airtable returns dates through lookups as ISO strings.
    dob: safeLookupString(f['DOB']),
    phone: safeLookupString(f['Phone']),
    language: safeLookupString(f['Preferred Language']),
    address: safeLookupString(f['Address']),
    address2: safeLookupString(f['Address 2']),
    city: safeLookupString(f['City']),
    state: safeLookupString(f['State']),
    zip: safeLookupNumberAsString(f['Zip']),
    county: safeLookupString(f['County']),
    hhSize: (f['# in HH'] as string) ?? null,
    children: (f['# Children'] as string) ?? null,
    items: (f['Items Requested'] as string) ?? null,
    externalNotes: (f['External Notes'] as string) ?? null,
    internalNotes: (f['Internal Notes'] as string) ?? null,
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
    clientId: clientLinkId,                           // for deep-link to Client detail (future)
    possibleDuplicate: (f['Possible Duplicate'] as boolean) ?? false,
    itemsDisbursed,
  }
}


export async function getSaturdaySchedule() {
  const data = await airtableFetch('Saturday Schedule', '?sort[0][field]=Date&sort[0][direction]=asc')


  return data.records.map((record: any) => ({
    id: record.id,
    date: record.fields['Date'] as string,
    status: (record.fields['Status'] as string) ?? 'Open',
    slots9am: (record.fields['9am'] as number) ?? 0,
    slots10am: (record.fields['10am'] as number) ?? 0,
    slots11am: (record.fields['11am'] as number) ?? 0,
    slots12pm: (record.fields['12pm'] as number) ?? 0,
    slots1pm: (record.fields['1pm'] as number) ?? 0,
    totalFilled: (record.fields['Total Slots Filled'] as number) ?? 0,
    totalCapacity: (record.fields['Total Capacity'] as number) ?? 50,
    slotsRemaining: (record.fields['Slots Remaining'] as number) ?? 0,
    mailMergeComplete: (record.fields['Mail Merge Complete'] as boolean) ?? false,
  }))
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


export async function getAgencyUsersByAgencyId(agencyId: string) {
  const formula = encodeURIComponent(`{Agency} = "${agencyId}"`)
  const data = await airtableFetch(
    'Agency Users',
    `?filterByFormula=${formula}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
  )


  return data.records.map((r: any) => ({
    id: r.id,
    name: `${r.fields['First Name'] ?? ''} ${r.fields['Last Name'] ?? ''}`.trim(),
    firstName: (r.fields['First Name'] as string) ?? '',
    lastName: (r.fields['Last Name'] as string) ?? '',
    email: r.fields['Email'] as string,
    phone: (r.fields['Phone Number'] as string) ?? null,
    role: r.fields['Role'] as string,
    status: r.fields['Status'] as string,
    clerkUserId: (r.fields['Clerk User ID'] as string) ?? null,
    invitedDate: (r.fields['Invited Date'] as string) ?? null,
    // Surfaces June 2026 Needs Review flag so the AgencyDetail page can
    // badge users that came from name-only Excel imports (Option B).
    needsReview: (r.fields['Needs Review'] as boolean) ?? false,
    recordCreationDate: (r.fields['Record Creation Date'] as string) ?? null,
  }))
}


// Note: Agency Users Status options changed in June 2026 — added 'Invited'
// and 'Unclaimed' (the latter was already used by importers; the type
// signature here is enforced at the API boundary).
export async function updateAgencyUserStatus(
  recordId: string,
  status: 'Unclaimed' | 'Invited' | 'Pending' | 'Active' | 'Inactive',
) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { Status: status } }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
