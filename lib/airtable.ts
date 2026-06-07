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

export async function getAgencyUserByClerkId(clerkUserId: string) {
  const formula = encodeURIComponent(`{Clerk User ID} = "${clerkUserId}"`)
  const data = await airtableFetch('Agency Users', `?filterByFormula=${formula}&maxRecords=1`)
  
  if (!data.records || data.records.length === 0) return null
  
  const record = data.records[0]
  return {
    id: record.id,
    name: `${record.fields['First Name']} ${record.fields['Last Name']}`,
    email: record.fields['Email'] as string,
    role: record.fields['Role'] as string,
    agencyId: (record.fields['Agency'] as string[])?.[0] ?? null,
    phone: record.fields['Phone Number'] as string ?? null,
    status: record.fields['Status'] as string,
  }
}

export async function getAgencyById(agencyId: string) {
  const data = await airtableFetch('Agencies', `/${agencyId}`)
  return {
    id: data.id,
    name: data.fields['Agency Name'] as string,
    address: data.fields['Address'] as string,
    address2: data.fields['Address 2'] as string ?? null,
    city: data.fields['City'] as string,
    state: data.fields['State'] as string,
    zip: data.fields['Zip'] as string,
    phone: data.fields['Main Phone Number'] as string,
    contactName: `${data.fields['First Name']} ${data.fields['Last Name']}`,
    status: data.fields['Status'] as string,
    clerkOrgId: data.fields['Clerk Org ID'] as string ?? null,
  }
}

export async function getReferralsByAgencyId(agencyName: string) {
  const formula = encodeURIComponent(`{Referring Agency} = "${agencyName}"`)
  const data = await airtableFetch('Client Referrals', `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`)

  return data.records.map((record: any) => ({
    id: record.id,
    clientName: `${record.fields['First Name']} ${record.fields['Last Name']}`,
    referralDate: record.fields['Referral Date'] as string,
    appointmentDate: (record.fields['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: record.fields['Appointment Time'] as string ?? null,
    referralReview: record.fields['Referral Review'] as string,
    appointmentStatus: record.fields['Appointment Status'] as string,
    appointmentSlipUrl: record.fields['Appt Slip'] as string,
    referredBy: record.fields['Referring Staff'] as string ?? null,
    dataPageUrl: record.fields['Data Page URL'] as string,
    address: record.fields['Address'] as string ?? null,
    address2: record.fields['Address 2'] as string ?? null,
    city: record.fields['City'] as string ?? null,
    state: record.fields['State'] as string ?? null,
    zip: record.fields['Zip'] as string ?? null,
    phone: record.fields['Phone'] as string ?? null,
  }))
}

export async function getReferralsByStaffName(agencyName: string, staffName: string) {
  const formula = encodeURIComponent(`AND({Referring Agency} = "${agencyName}", {Referring Staff} = "${staffName}")`)
  const data = await airtableFetch('Client Referrals', `?filterByFormula=${formula}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`)

  return data.records.map((record: any) => ({
    id: record.id,
    clientName: `${record.fields['First Name']} ${record.fields['Last Name']}`,
    referralDate: record.fields['Referral Date'] as string,
    appointmentDate: (record.fields['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: record.fields['Appointment Time'] as string ?? null,
    referralReview: record.fields['Referral Review'] as string,
    appointmentStatus: record.fields['Appointment Status'] as string,
    appointmentSlipUrl: record.fields['Appt Slip'] as string,
    referredBy: record.fields['Referring Staff'] as string ?? null,
    dataPageUrl: record.fields['Data Page URL'] as string,
    address: record.fields['Address'] as string ?? null,
    address2: record.fields['Address 2'] as string ?? null,
    city: record.fields['City'] as string ?? null,
    state: record.fields['State'] as string ?? null,
    zip: record.fields['Zip'] as string ?? null,
    phone: record.fields['Phone'] as string ?? null,
  }))
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

  return data.records.map((record: any) => ({
    id: record.id,
    name: record.fields['Agency Name'] as string,
    ein: record.fields['EIN#'] as string,
    address: record.fields['Address'] as string,
    address2: (record.fields['Address 2'] as string) ?? null,
    city: record.fields['City'] as string,
    state: record.fields['State'] as string,
    zip: record.fields['Zip'] as string,
    phone: record.fields['Main Phone Number'] as string,
    email: record.fields['Email'] as string,
    contactName: `${record.fields['First Name'] ?? ''} ${record.fields['Last Name'] ?? ''}`.trim(),
    status: record.fields['Status'] as string,
    registrationDate: record.fields['Registration Date'] as string,
    approvalDate: record.fields['Approval Date'] as string ?? null,
    website: record.fields['Website'] as string ?? null,
    officeName: record.fields['Office Name'] as string ?? null,
    possibleDuplicate: record.fields['Possible Duplicate'] as boolean ?? false,
  }))
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

  const data = await airtableFetch('Client Referrals', params)

  const records = data.records.map((record: any) => {
  const firstName = (record.fields['First Name'] as string) ?? ''
  const lastName = (record.fields['Last Name'] as string) ?? ''
  return {
    id: record.id,
    firstName,
    lastName,
    clientName: `${firstName} ${lastName}`.trim(),
    referralDate: record.fields['Referral Date'] as string,
    appointmentDate: (record.fields['Appointment Date'] as string[])?.[0] ?? null,
    saturdayDate: (record.fields['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: (record.fields['Appointment Time'] as string) ?? null,
    referralReview: record.fields['Referral Review'] as string,
    appointmentStatus: record.fields['Appointment Status'] as string,
    appointmentSlipUrl: (record.fields['Appt Slip'] as string) ?? null,
    referredBy: (record.fields['Referring Staff'] as string) ?? null,
    staffName: (record.fields['Referring Staff'] as string) ?? null,
    staffPhone: (record.fields['Staff Phone'] as string) ?? null,
    referringAgency: (record.fields['Referring Agency'] as string) ?? null,
    agencyName: (record.fields['Referring Agency'] as string) ?? null,
    dataPageUrl: (record.fields['Data Page URL'] as string) ?? null,
    address: (record.fields['Address'] as string) ?? null,
    city: (record.fields['City'] as string) ?? null,
    state: (record.fields['State'] as string) ?? null,
    zip: (record.fields['Zip'] as string) ?? null,
    phone: (record.fields['Phone'] as string) ?? null,
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
    scheduledReferrals: referralRecords.filter((r: any) => r.fields['Appointment Status']?.name === 'Scheduled' || r.fields['Appointment Status'] === 'Scheduled').length,
    thisMonthReferrals: referralRecords.filter((r: any) => r.fields['Referral Date'] >= startOfMonth).length,
    recentReferrals: referralRecords.slice(0, 5).map((record: any) => ({
      id: record.id,
      clientName: `${record.fields['First Name']} ${record.fields['Last Name']}`,
      referralDate: record.fields['Referral Date'] as string,
      referralReview: record.fields['Referral Review'] as string,
      appointmentStatus: record.fields['Appointment Status'] as string,
      referringAgency: record.fields['Referring Agency'] as string ?? null,
      referredBy: record.fields['Referring Staff'] as string ?? null,
    })),
    pendingAgencyList: agencyRecords
      .filter((r: any) => r.fields['Status'] === 'Pending')
      .slice(0, 5)
      .map((record: any) => ({
        id: record.id,
        name: record.fields['Agency Name'] as string,
        city: record.fields['City'] as string,
        registrationDate: record.fields['Registration Date'] as string,
        contactName: `${record.fields['First Name'] ?? ''} ${record.fields['Last Name'] ?? ''}`.trim(),
      })),
  }
}
export async function getAgencyWithDetails(agencyId: string) {
 // Fetch agency first to get the name
const agency = await airtableFetch('Agencies', `/${agencyId}`)
const agencyName = agency.fields['Agency Name'] as string

// Then fetch users and referrals in parallel
const [users, referrals] = await Promise.all([
  airtableFetch('Agency Users', `?filterByFormula=${encodeURIComponent(`FIND("${agencyId}", ARRAYJOIN({Agency}, ","))`)}`),
  airtableFetch('Client Referrals', `?filterByFormula=${encodeURIComponent(`{Referring Agency} = "${agencyName}"`)}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`),
])
  

  return {
    id: agency.id,
    name: agency.fields['Agency Name'] as string,
    ein: agency.fields['EIN#'] as string,
    address: agency.fields['Address'] as string,
    address2: agency.fields['Address 2'] as string ?? null,
    city: agency.fields['City'] as string,
    state: agency.fields['State'] as string,
    zip: agency.fields['Zip'] as string,
    county: agency.fields['County'] as string ?? null,
    officeName: agency.fields['Office Name'] as string ?? null,
    phone: agency.fields['Main Phone Number'] as string,
    website: agency.fields['Website'] as string ?? null,
    email: agency.fields['Email'] as string,
    contactFirstName: agency.fields['First Name'] as string,
    contactLastName: agency.fields['Last Name'] as string,
    contactPhone: agency.fields['Phone Number'] as string ?? null,
    status: agency.fields['Status'] as string,
    registrationDate: agency.fields['Registration Date'] as string,
    approvalDate: agency.fields['Approval Date'] as string ?? null,
    agencyNumber: agency.fields['Agency #'] as string ?? null,
    possibleDuplicate: agency.fields['Possible Duplicate'] as boolean ?? false,
    notes: agency.fields['Notes'] as string ?? null,
    users: users.records.map((r: any) => ({
      id: r.id,
      name: `${r.fields['First Name']} ${r.fields['Last Name']}`,
      email: r.fields['Email'] as string,
      phone: r.fields['Phone Number'] as string ?? null,
      role: r.fields['Role'] as string,
      status: r.fields['Status'] as string,
      invitedDate: r.fields['Invited Date'] as string ?? r.fields['Registration Date'] as string ?? null,
    })),
    referralCount: referrals.records.length,
    referrals: referrals.records.map((r: any) => ({
      id: r.id,
      clientName: `${r.fields['First Name']} ${r.fields['Last Name']}`,
      referralDate: r.fields['Referral Date'] as string,
      referralReview: r.fields['Referral Review'] as string,
      appointmentStatus: r.fields['Appointment Status'] as string,
      referredBy: r.fields['Referring Staff'] as string ?? null,
    })),
  }
}

export async function updateReferralReview(referralId: string, review: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${referralId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { 'Referral Review': review } }),
    }
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

  return {
    id: data.id,
    clientName: `${f['First Name']} ${f['Last Name']}`,
    firstName: f['First Name'] as string,
    lastName: f['Last Name'] as string,
    dob: f['DOB'] as string ?? null,
    phone: f['Phone'] as string ?? null,
    language: f['Preferred Language'] as string ?? null,
    address: f['Address'] as string ?? null,
    address2: f['Address 2'] as string ?? null,
    city: f['City'] as string ?? null,
    state: f['State'] as string ?? null,
    zip: f['Zip'] as string ?? null,
    county: f['County'] as string ?? null,
    hhSize: f['# in HH'] as string ?? null,
    children: f['# Children'] as string ?? null,
    items: f['Items Requested'] as string ?? null,
    externalNotes: f['External Notes'] as string ?? null,
    internalNotes: f['Internal Notes'] as string ?? null,
    referralDate: f['Referral Date'] as string,
    referredByPhone: f['Staff Phone'] as string ?? null,
    referralReview: f['Referral Review'] as string,
    appointmentStatus: f['Appointment Status'] as string,
    appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
    appointmentTime: f['Appointment Time'] as string ?? null,
    appointmentSlipUrl: (f['Appt Slip'] as any[])?.[0]?.url ?? null,
    dataPageUrl: f['Data Page URL'] as string ?? null,
    referredBy: f['Referring Staff'] as string ?? null,
    referringAgency: f['Referring Agency'] as string ?? null,
    agencyEmail: f['Agency Email'] as string ?? null,
    possibleDuplicate: f['Possible Duplicate'] as boolean ?? false,
    itemsDisbursed,
  }
}
export async function getSaturdaySchedule() {
  const data = await airtableFetch('Saturday Schedule', '?sort[0][field]=Date&sort[0][direction]=asc')
  
  return data.records.map((record: any) => ({
    id: record.id,
    date: record.fields['Date'] as string,
    status: record.fields['Status'] as string ?? 'Open',
    slots9am: record.fields['9am'] as number ?? 0,
    slots10am: record.fields['10am'] as number ?? 0,
    slots11am: record.fields['11am'] as number ?? 0,
    slots12pm: record.fields['12pm'] as number ?? 0,
    slots1pm: record.fields['1pm'] as number ?? 0,
    totalFilled: record.fields['Total Slots Filled'] as number ?? 0,
    totalCapacity: record.fields['Total Capacity'] as number ?? 50,
    slotsRemaining: record.fields['Slots Remaining'] as number ?? 0,
     mailMergeComplete: record.fields['Mail Merge Complete'] as boolean ?? false,
  }))
}
export async function updateAgencyNotes(id: string, notes: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { Notes: notes } }),
    }
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAgencyUsersByAgencyId(agencyId: string) {
  const formula = encodeURIComponent(`{Agency} = "${agencyId}"`)
  const data = await airtableFetch('Agency Users', `?filterByFormula=${formula}&sort[0][field]=Last%20Name&sort[0][direction]=asc`)
  
  return data.records.map((r: any) => ({
    id: r.id,
    name: `${r.fields['First Name']} ${r.fields['Last Name']}`,
    firstName: r.fields['First Name'] as string,
    lastName: r.fields['Last Name'] as string,
    email: r.fields['Email'] as string,
    phone: r.fields['Phone Number'] as string ?? null,
    role: r.fields['Role'] as string,
    status: r.fields['Status'] as string,
    clerkUserId: r.fields['Clerk User ID'] as string ?? null,
    invitedDate: r.fields['Invited Date'] as string ?? null,
  }))
}

export async function updateAgencyUserStatus(recordId: string, status: 'Active' | 'Inactive' | 'Pending') {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { Status: status } }),
    }
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

