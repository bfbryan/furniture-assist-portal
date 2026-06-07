// app/api/dawson/referrals/submit/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

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

async function createUnclaimedAgency(name: string, email: string): Promise<{ id: string; name: string }> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agencies`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      fields: {
        'Agency Name': name,
        'Email': email,
        'Status': 'Unclaimed',
        'Source': 'Created via Referral',
        'Admin Confirmed': false,
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
}): Promise<{ id: string; name: string; email: string; phone: string }> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agency%20Users`
  const fields: Record<string, any> = {
    'First Name': params.firstName,
    'Last Name': params.lastName,
    'Email': params.email,
    'Status': 'Unclaimed',
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
  return {
    id: data.id,
    name: `${params.firstName} ${params.lastName}`,
    email: params.email,
    phone: params.phone,
  }
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
    agencyId, agencyName, agencyEmail, staffId, staffName, staffPhone,
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
  let resolvedAgencyName: string
  let resolvedAgencyEmail: string
  let wasNewAgency = false

  try {
    if (newAgency) {
      // Case 3: create unclaimed agency
      if (!newAgency.name || !newAgency.email) {
        return NextResponse.json({ error: 'New agency requires name and email.' }, { status: 400 })
      }
      const created = await createUnclaimedAgency(newAgency.name, newAgency.email)
      resolvedAgencyId = created.id
      resolvedAgencyName = created.name
      resolvedAgencyEmail = newAgency.email
      wasNewAgency = true
    } else {
      // Case 1 or 2: existing agency
      if (!agencyId || !agencyName) {
        return NextResponse.json({ error: 'Agency is required.' }, { status: 400 })
      }
      resolvedAgencyId = agencyId
      resolvedAgencyName = agencyName
      resolvedAgencyEmail = agencyEmail || ''
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Agency creation failed: ${e.message}` }, { status: 500 })
  }

  // ---- Resolve staff (existing or new) ----
  let resolvedStaffName: string
  let resolvedStaffPhone: string

  try {
    if (newStaff) {
      // Case 2 or 3: create unclaimed agency user
      if (!newStaff.firstName || !newStaff.lastName || !newStaff.email) {
        return NextResponse.json({ error: 'New staff requires first name, last name, and email.' }, { status: 400 })
      }
      const created = await createUnclaimedAgencyUser({
        agencyId: resolvedAgencyId,
        firstName: newStaff.firstName,
        lastName: newStaff.lastName,
        email: newStaff.email,
        phone: newStaff.phone || '',
      })
      resolvedStaffName = created.name
      resolvedStaffPhone = created.phone
      // If the agency record itself has no email yet, fall back to staff email for confirmation
      if (!resolvedAgencyEmail) resolvedAgencyEmail = newStaff.email
    } else {
      // Case 1: existing staff
      if (!staffName) {
        return NextResponse.json({ error: 'Staff member is required.' }, { status: 400 })
      }
      resolvedStaffName = staffName
      resolvedStaffPhone = staffPhone || ''
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Staff creation failed: ${e.message}` }, { status: 500 })
  }

  // ---- Build referral fields ----
  const dobFormatted = formatDOB(dob)
  const isDuplicate = await checkDuplicate(lastName, dobFormatted)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

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
    'Referring Agency': resolvedAgencyName,
    'Referring Staff': resolvedStaffName,
    'Agency Email': resolvedAgencyEmail,
    'Referral Review': 'Approved',
    'Appointment Status': 'Unscheduled',
    'Possible Duplicate': isDuplicate,
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    'Was New Agency': wasNewAgency,
  }

  if (address2) fields['Address 2'] = address2
  if (notes) fields['External Notes'] = notes
  if (resolvedStaffPhone) fields['Staff Phone'] = resolvedStaffPhone
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