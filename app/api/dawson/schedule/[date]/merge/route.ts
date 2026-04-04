// app/api/dawson/schedule/[date]/merge/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', 'user_3BodwTW4I7Vamt4t7wD3qeA7boM']
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { date } = await params

  // Find the Saturday Schedule record by date
  const [year, month, day] = date.split('-')
  const atDate = `${parseInt(month)}/${parseInt(day)}/${year}`
  const formula = encodeURIComponent(`IS_SAME({Date}, "${atDate}", 'day')`)

  const findRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Saturday Schedule')}?filterByFormula=${formula}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )

  if (!findRes.ok) return NextResponse.json({ error: await findRes.text() }, { status: 500 })

  const findData = await findRes.json()
  if (!findData.records?.length) {
    return NextResponse.json({ error: 'Schedule record not found' }, { status: 404 })
  }

  const recordId = findData.records[0].id

  // Update Mail Merge Complete field
  const updateRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Saturday Schedule')}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: { 'Mail Merge Complete': true }
      }),
    }
  )

  if (!updateRes.ok) return NextResponse.json({ error: await updateRes.text() }, { status: 500 })
  return NextResponse.json({ ok: true })
}
