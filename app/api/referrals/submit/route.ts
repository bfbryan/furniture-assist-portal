import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'

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
  const { userId, orgId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if agency org is inactive
  if (orgId) {
    const client = await clerkClient()
    const org = await client.organizations.getOrganization({ organizationId: orgId })
    if (org.publicMetadata?.status === 'Inactive') {
      return NextResponse.json({ error: 'Your agency account is inactive.' }, { status: 403 })
    }
  }

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) return NextResponse.json({ error: 'No agency linked' }, { status: 403 })

  const agency = await getAgencyById(agencyUser.agencyId!)
  const body = await req.json()

  const {
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
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
    'Referring Agency': agency.name,
    'Referring Staff': agencyUser.name,
    'Agency Email': agencyUser.email,
    'Referral Review': 'Pending',
    'Appointment Status': 'Unscheduled',
    'Possible Duplicate': isDuplicate,
  }

  if (address2) fields['Address 2'] = address2
  if (notes) fields['External Notes'] = notes
  if (agencyUser.phone) fields['Staff Phone'] = agencyUser.phone

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
