// app/api/dawson/agencies/[id]/staff/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params

  // Step 1: fetch agency to get its name (linked field returns primary field value)
  const agencyRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Agencies/${id}`,
    { headers: HEADERS }
  )
  if (!agencyRes.ok) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }
  const agency = await agencyRes.json()
  const agencyName = agency.fields['Agency Name'] as string
  const safeName = agencyName.replace(/"/g, '\\"')

  // Step 2: fetch Active + Unclaimed users for this agency
  const formula = encodeURIComponent(
    `AND({Agency} = "${safeName}", OR({Status} = "Active", {Status} = "Unclaimed"))`
  )
  const usersRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Agency%20Users?filterByFormula=${formula}`,
    { headers: HEADERS }
  )
  if (!usersRes.ok) {
    const err = await usersRes.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }
  const data = await usersRes.json()

  const staff = data.records.map((r: any) => {
    const firstName = ((r.fields['First Name'] as string) ?? '').trim()
    const lastName = ((r.fields['Last Name'] as string) ?? '').trim()
    const email = ((r.fields['Email'] as string) ?? '').trim()
    const fullName = `${firstName} ${lastName}`.trim()
    const displayName = fullName
      ? (email ? `${fullName} (${email})` : fullName)
      : email

    return {
      id: r.id,
      firstName,
      lastName,
      name: fullName,
      email,
      phone: (r.fields['Phone Number'] as string) ?? '',
      status: r.fields['Status'] as string,
      displayName,
    }
  })

  // Sort: named staff first (by last name, then first name), then email-only (by email)
  staff.sort((a: any, b: any) => {
    const aHasName = !!a.name
    const bHasName = !!b.name
    if (aHasName && !bHasName) return -1
    if (!aHasName && bHasName) return 1
    if (aHasName && bHasName) {
      const lastCmp = a.lastName.localeCompare(b.lastName)
      if (lastCmp !== 0) return lastCmp
      return a.firstName.localeCompare(b.firstName)
    }
    return a.email.localeCompare(b.email)
  })

  return NextResponse.json(staff)
}