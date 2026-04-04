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

async function checkDuplicate(lastName: string, dobFormatted: string): Promise<boolean> {
  const formula = encodeURIComponent(`AND({Last Name} = "${lastName}", IS_SAME({DOB}, "${dobFormatted}", 'day'))`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  const data = await res.json()
  return data.records && data.records.length > 0
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()

  const {
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
    agencyName, agencyEmail, staffName, staffPhone,
  } = body

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
    'Referring Agency': agencyName,
    'Referring Staff': staffName,
    'Agency Email': agencyEmail,
    'Referral Review': 'Pending',
    'Appointment Status': 'Unscheduled',
    'Possible Duplicate': isDuplicate,
  }

  if (address2) fields['Address 2'] = address2
  if (notes) fields['External Notes'] = notes
  if (staffPhone) fields['Staff Phone'] = staffPhone
  if (county) fields['County'] = county

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

  return NextResponse.json({ success: true, duplicate: isDuplicate })
}
