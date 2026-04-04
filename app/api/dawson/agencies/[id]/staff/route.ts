// app/api/dawson/agencies/[id]/staff/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  console.log('Staff route - agency id:', id)

  const formula = encodeURIComponent(`FIND("${id}", ARRAYJOIN({Agency}, ","))`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}?filterByFormula=${formula}`
  
  console.log('Staff route - AT url:', url)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Staff route - AT error:', err)
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await res.json()
  console.log('Staff route - records found:', data.records?.length)

  const staff = data.records
    .filter((r: any) => r.fields['Status'] === 'Active')
    .map((r: any) => ({
      id: r.id,
      name: `${r.fields['First Name']} ${r.fields['Last Name']}`,
      email: r.fields['Email'] as string,
      phone: r.fields['Phone Number'] as string ?? null,
      role: r.fields['Role'] as string,
    }))

  console.log('Staff route - active staff:', staff.length)

  return NextResponse.json(staff)
}
