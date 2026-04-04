// app/api/dawson/schedule/[date]/clients/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', 'user_3BodwTW4I7Vamt4t7wD3qeA7boM', 'user_3BtKn01OMXSmi7eSsWvzvnEroCg']
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!



export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { date } = await params

  // AT stores date as M/D/YYYY format
  const [year, month, day] = date.split('-')
  const atDate = `${parseInt(month)}/${parseInt(day)}/${year}`

  const formula = encodeURIComponent(
    `AND({Appointment Status} = "Scheduled", IS_SAME({Appointment Date}, "${atDate}", 'day'))`
  )

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}?filterByFormula=${formula}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })

  const data = await res.json()

  const clients = data.records
    .map((r: any) => ({
      id: r.id,
      firstName: r.fields['First Name'] as string,
      lastName: r.fields['Last Name'] as string,
      clientName: `${r.fields['First Name']} ${r.fields['Last Name']}`,
      address: r.fields['Address'] as string ?? null,
      address2: r.fields['Address 2'] as string ?? null,
      city: r.fields['City'] as string ?? null,
      state: r.fields['State'] as string ?? null,
      zip: r.fields['Zip'] as string ?? null,
      phone: r.fields['Phone'] as string ?? null,
      dob: r.fields['DOB'] as string ?? null,
      language: r.fields['Preferred Language'] as string ?? null,
      hhSize: r.fields['# in HH'] as string ?? null,
      children: r.fields['# Children'] as string ?? null,
      items: r.fields['Items Requested'] as string ?? null,
      appointmentDate: (r.fields['Appointment Date'] as string[])?.[0] ?? null,
      appointmentTime: r.fields['Appointment Time'] as string ?? null,
      referredBy: r.fields['Referring Staff'] as string ?? null,
      referringAgency: r.fields['Referring Agency'] as string ?? null,
      externalNotes: r.fields['External Notes'] as string ?? null,
    }))
    .sort((a: any, b: any) => a.lastName.localeCompare(b.lastName))

  return NextResponse.json(clients)
}
