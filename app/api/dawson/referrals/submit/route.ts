// app/api/dawson/referrals/submit/route.ts
//
// POST /api/dawson/referrals/submit
//
// Used by:
//   - app/dawson/referrals/new/page.tsx (Dawson's internal "Add Referral" form)
//
// Scheduling behavior (June 30, 2026):
//
//   This route creates the referral with Appointment Status = 'Unscheduled'.
//   The Airtable auto-schedule automation handles BOTH branches:
//
//     - Specific Date: script looks up the Saturday Schedule record for
//       the Preferred Date written here, picks the first open time slot,
//       flips status to Scheduled. Minimum lead time: 7 days.
//     - Flexible: script finds the next Saturday >= 21 days out with
//       Open status, Ready to Schedule = 1, and an open slot, picks it.
//
//   The form's available-dates endpoint already enforces the 7-day floor
//   on the date picker, so the specific-date path won't get a sub-7-day
//   date in normal use.
//
// June 2026 schema migration — what this route had to change:
//
//   STOPPED writing these (they're now Lookups via Referring Staff Link,
//   and Airtable rejects writes with INVALID_VALUE_FOR_COLUMN):
//     - Client Referrals: Referring Agency, Referring Staff,
//       Agency Email, Staff Phone
//     - Agencies: Email (deleted), Admin Confirmed (deleted)
//
//   STARTED writing:
//     - Client Referrals: Referring Staff Link = [agencyUserId]
//       Everything else (agency name, staff name, agency email,
//       staff phone) is derived automatically by Airtable through
//       the link's lookup chain.
//     - Agencies: Source = 'Created via Referral' (already present),
//       Status = 'Unclaimed' (already present)
//
//   Item names cleaned in the form to the 6 valid select options
//   (verified in Airtable 06/30/26):
//     Bedroom Furniture, Dining Room Furniture, Living Room Furniture,
//     Household Items (including kitchen & linens), Clothes, Baby Items



import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'



// Match the Dawson area allowlist so Ben/Ray/Chase can also submit referrals.
// (Previously this was Dawson-only — likely an oversight.)
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



async function checkDuplicate(lastName: string, dobFormatted: string): Promise<boolean> {
  const safeLast = lastName.replace(/"/g, '\\"')
  const formula = encodeURIComponent(
    `AND({Last Name} = "${safeLast}", IS_SAME({DOB}, "${dobFormatted}", 'day'))`
  )
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  const data = await res.json()
  return data.records && data.records.length > 0
}



// Create an Agency in 'Unclaimed' status (Source = Created via Referral).
//
// June 2026 schema: contact fields (First/Last Name, Email, Phone Number)
// were REMOVED from Agencies. Admin email now lives on the linked Primary
// Admin in Agency Users. We do NOT set Primary Admin here — the Agency
// User created next will be unclaimed, and Dawson promotes one via the
// invite flow later.
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



// Create an Agency User in 'Unclaimed' status, linked to the given Agency.
// Returns the record ID so we can set Referring Staff Link on the referral.
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
    // case 1 (both exist) — we now ONLY need the IDs; lookups derive
    // the rest from Referring Staff Link.
    agencyId, staffId,
    // case 2 + 3 (new staff)
    newStaff,
    // case 3 only (new agency)
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
      // Case 3: create unclaimed agency
      if (!newAgency.name) {
        return NextResponse.json({ error: 'New agency requires a name.' }, { status: 400 })
      }
      const created = await createUnclaimedAgency(newAgency.name)
      resolvedAgencyId = created.id
      wasNewAgency = true
      // Note: newAgency.email collected by the form is intentionally NOT
      // written to the Agency. The form treats it as the primary admin's
      // email — it will land on the Agency User created below (when
      // newStaff is supplied alongside, which the form enforces).
    } else {
      // Case 1 or 2: existing agency
      if (!agencyId) {
        return NextResponse.json({ error: 'Agency is required.' }, { status: 400 })
      }
      resolvedAgencyId = agencyId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Agency creation failed: ${e.message}` }, { status: 500 })
  }



  // ---- Resolve staff (existing or new) ----
  // We need a record ID for Referring Staff Link. Lookups (Referring Agency,
  // Referring Staff, Agency Email, Staff Phone) populate automatically.
  let resolvedStaffId: string



  try {
    if (newStaff) {
      // Case 2 or 3: create unclaimed agency user
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
      // Case 1: existing staff
      if (!staffId) {
        return NextResponse.json({ error: 'Staff member is required.' }, { status: 400 })
      }
      resolvedStaffId = staffId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Staff creation failed: ${e.message}` }, { status: 500 })
  }



  // ---- Build referral fields ----
  const dobFormatted = formatDOB(dob)
  const isDuplicate = await checkDuplicate(lastName, dobFormatted)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })



  // June 2026: Referring Staff Link is the SINGLE source of truth for who
  // referred this client. Agency, agency email, staff name, and staff
  // phone are all Lookups derived from that link — do NOT write them.
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



  return NextResponse.json({ success: true, duplicate: isDuplicate, wasNewAgency })
}
