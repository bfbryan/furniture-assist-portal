// app/api/dawson/referrals/submit/route.ts
//
// POST /api/dawson/referrals/submit
//
// Used by:
//   - app/dawson/referrals/new/page.tsx (Dawson's internal "Add Referral" form)
//
// Scheduling behavior (June 30, 2026):
//   Creates the referral with Appointment Status = 'Unscheduled'. The
//   Airtable auto-schedule automation handles both Specific Date and
//   Flexible branches; see prior notes.
//
// July 2026 schema migration — CLIENTS TABLE FORK:
//   Client identity (name, DOB, phone, address) now also lives on a
//   Clients table. Every referral submitted here now:
//     1. Finds or creates a Client by Unique ID (Last-First-DOB)
//     2. Populates the Client link on the referral
//   Client identity fields continue to be DUAL-WRITTEN to Client Referrals
//   during the transition so the existing Unique ID formula and read
//   paths keep working. Post-Saturday cleanup step converts those to
//   lookups and this route stops writing them.
//
// Duplicate detection:
//   - Old logic: {Last Name} + IS_SAME({DOB}) on Client Referrals → always
//     true for repeat clients (bad post-fork).
//   - New logic: {Last Name} + IS_SAME({DOB}) + IS_SAME({Preferred Date})
//     — flags only when the same person is being scheduled for the same
//     target Saturday. Flexible submissions skip the check (no target date).




import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'




const ALLOWED_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', // Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM', // Ray
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg', // Dawson
  'user_3DE1gUnIeNmWZpQyd7LjdZb9vnN', // Chase
]




const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}




function formatDOB(dob: string) {
  const [y, m, d] = dob.split('-')
  return `${m}/${d}/${y}`
}




function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return !isNaN(dt.getTime()) && dt.getDay() === 6
}




/**
 * Client dedupe key — matches the Clients table primary formula:
 *   {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 */
function buildClientUniqueId(firstName: string, lastName: string, dobFormatted: string): string {
  return `${lastName.trim()}-${firstName.trim()}-${dobFormatted}`
}




// Duplicate detection (updated for Clients fork):
//   Flags only when the same person is being scheduled for the same
//   Preferred Date. Repeat clients on different Saturdays are NOT flagged.
//   Flexible submissions have no target date → skip the check.
async function checkDuplicate(
  lastName: string,
  dobFormatted: string,
  preferredDate: string | null | undefined,
): Promise<boolean> {
  if (!preferredDate) return false
  const safeLast = lastName.replace(/"/g, '\\"')
  const formula = encodeURIComponent(
    `AND({Last Name} = "${safeLast}", IS_SAME({DOB}, "${dobFormatted}", 'day'), IS_SAME({Preferred Date}, "${preferredDate}", 'day'))`
  )
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  const data = await res.json()
  return data.records && data.records.length > 0
}




// Look up Client by Unique ID (Last-First-DOB). Returns record ID or null.
async function findClientByUniqueId(clientUniqueId: string): Promise<string | null> {
  const safe = clientUniqueId.replace(/"/g, '\\"')
  const formula = encodeURIComponent(`{Unique ID} = "${safe}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Clients?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Client lookup failed: ${await res.text()}`)
  const data = await res.json()
  if (!data.records || data.records.length === 0) return null
  return data.records[0].id as string
}




// Create a Client record. Called only when findClientByUniqueId returned null.
// Note: on returning-client visits we do NOT update Client contact/address —
// that lives on the profile-claim flow. This prevents accidental overwrites.
async function createClient(params: {
  firstName: string
  lastName: string
  dobFormatted: string
  phone?: string
  address?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  preferredLanguage?: string
}): Promise<string> {
  const fields: Record<string, any> = {
    'First Name': params.firstName,
    'Last Name': params.lastName,
    'DOB': params.dobFormatted,
    'Status': 'Active',
  }
  if (params.phone) fields['Phone'] = params.phone
  if (params.address) fields['Address'] = params.address
  if (params.address2) fields['Address 2'] = params.address2
  if (params.city) fields['City'] = params.city
  if (params.state) fields['State'] = params.state
  if (params.zip) fields['Zip'] = params.zip
  if (params.county) fields['County'] = params.county
  if (params.preferredLanguage) fields['Preferred Language'] = params.preferredLanguage




  const url = `https://api.airtable.com/v0/${BASE_ID}/Clients`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to create client: ${await res.text()}`)
  const data = await res.json()
  return data.id
}




async function createUnclaimedAgency(name: string): Promise<{ id: string; name: string }> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agencies`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      fields: {
        'Agency Name': name,
        'Status': 'Unclaimed',
        'Source': 'Created via Referral',
      },
      typecast: true,
    }),
  })
  if (!res.ok) throw new Error(`Failed to create agency: ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, name: data.fields['Agency Name'] }
}




async function createUnclaimedAgencyUser(params: {
  agencyId: string
  firstName: string
  lastName: string
  email: string
  phone: string
}): Promise<string> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agency%20Users`
  const fields: Record<string, any> = {
    'First Name': params.firstName,
    'Last Name': params.lastName,
    'Email': params.email,
    'Status': 'Unclaimed',
    'Role': 'Staff',
    'Agency': [params.agencyId],
  }
  if (params.phone) fields['Phone Number'] = params.phone




  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to create agency user: ${await res.text()}`)
  const data = await res.json()
  return data.id
}




export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }




  const body = await req.json()




  const {
    // client info
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
    // scheduling
    preferredDate, flexible,
    // case 1 (both exist)
    agencyId, staffId,
    // case 2 + 3
    newStaff,
    // case 3 only
    newAgency,
  } = body




  // ---- Scheduling validation ----
  const isFlexible = flexible === true
  if (!isFlexible) {
    if (!preferredDate) {
      return NextResponse.json({ error: 'Preferred date is required when not flexible.' }, { status: 400 })
    }
    if (!isSaturday(preferredDate)) {
      return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
    }
  }




  // ---- Resolve agency (existing or new) ----
  let resolvedAgencyId: string
  let wasNewAgency = false




  try {
    if (newAgency) {
      if (!newAgency.name) {
        return NextResponse.json({ error: 'New agency requires a name.' }, { status: 400 })
      }
      const created = await createUnclaimedAgency(newAgency.name)
      resolvedAgencyId = created.id
      wasNewAgency = true
    } else {
      if (!agencyId) {
        return NextResponse.json({ error: 'Agency is required.' }, { status: 400 })
      }
      resolvedAgencyId = agencyId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Agency creation failed: ${e.message}` }, { status: 500 })
  }




  // ---- Resolve staff (existing or new) ----
  let resolvedStaffId: string




  try {
    if (newStaff) {
      if (!newStaff.firstName || !newStaff.lastName || !newStaff.email) {
        return NextResponse.json({ error: 'New staff requires first name, last name, and email.' }, { status: 400 })
      }
      resolvedStaffId = await createUnclaimedAgencyUser({
        agencyId: resolvedAgencyId,
        firstName: newStaff.firstName,
        lastName: newStaff.lastName,
        email: newStaff.email,
        phone: newStaff.phone || '',
      })
    } else {
      if (!staffId) {
        return NextResponse.json({ error: 'Staff member is required.' }, { status: 400 })
      }
      resolvedStaffId = staffId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Staff creation failed: ${e.message}` }, { status: 500 })
  }




  // ---- Resolve client (existing or new) ----
  // NEW step (July 2026 fork). Client identity is looked up by Unique ID
  // (Last-First-DOB). If a returning client already exists, we link to
  // that record and do NOT overwrite their contact/address info.
  const dobFormatted = formatDOB(dob)
  const clientUniqueId = buildClientUniqueId(firstName, lastName, dobFormatted)
  let resolvedClientId: string
  let clientCreated = false




  try {
    const existingClientId = await findClientByUniqueId(clientUniqueId)
    if (existingClientId) {
      resolvedClientId = existingClientId
    } else {
      resolvedClientId = await createClient({
        firstName,
        lastName,
        dobFormatted,
        phone,
        address,
        address2,
        city,
        state,
        zip,
        county,
        preferredLanguage: language,
      })
      clientCreated = true
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Client resolution failed: ${e.message}` }, { status: 500 })
  }




  // ---- Duplicate flag ----
  const isDuplicate = await checkDuplicate(lastName, dobFormatted, isFlexible ? null : preferredDate)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })




  // ---- Build referral fields ----
  // TRANSITION-WINDOW NOTE: Client identity fields (First Name, Last Name,
  // DOB, Phone, Address, City, State, Zip, County, Preferred Language)
  // are dual-written to Client Referrals during the July 2026 migration
  // so the existing Unique ID formula and read paths keep working. After
  // the schema trim step, those fields become lookups from {Client} and
  // this block collapses to just per-visit + link fields.
  const fields: Record<string, any> = {
    'First Name': firstName,
    'Last Name': lastName,
    'Address': address,
    'City': city,
    'State': state,
    'Zip': zip,
    'Phone': phone,
    '# in HH': parseInt(hhSize),
    '# Children': parseInt(children),
    'DOB': dobFormatted,
    'Preferred Language': language,
    'Items Requested': items,
    'Referral Date': today,
    'Referring Staff Link': [resolvedStaffId],
    'Client': [resolvedClientId],                // NEW link
    'Referral Review': 'Approved',
    'Appointment Status': 'Unscheduled',
    'Possible Duplicate': isDuplicate,
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    'Was New Agency': wasNewAgency,
  }




  if (address2) fields['Address 2'] = address2
  if (notes) fields['Internal Notes'] = notes
  if (county) fields['County'] = county
  if (!isFlexible && preferredDate) fields['Preferred Date'] = preferredDate




  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })




  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }




  return NextResponse.json({
    success: true,
    duplicate: isDuplicate,
    wasNewAgency,
    clientCreated,
  })
}
