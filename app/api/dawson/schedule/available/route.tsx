// app/api/dawson/schedule/available/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
}

const SCHEDULE_TABLE = 'Saturday Schedule'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const weeksAhead = Math.min(parseInt(searchParams.get('weeks') || '8'), 26)

    const endDate = new Date(Date.now() + weeksAhead * 7 * 86400000)
      .toISOString().split('T')[0]

    const formula = `AND(
      IS_AFTER({Date}, DATEADD(TODAY(), -1, 'days')),
      IS_BEFORE({Date}, '${endDate}'),
      {Status} = 'Open',
      {Slots Remaining} > 0
    )`.replace(/\s+/g, ' ')

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE)}?` +
      `filterByFormula=${encodeURIComponent(formula)}&` +
      `sort[0][field]=Date&sort[0][direction]=asc&` +
      `maxRecords=100`

    console.log('Schedule route - url:', url)

    const res = await fetch(url, { headers: HEADERS })

    if (!res.ok) {
      const err = await res.text()
      console.error('Schedule route - AT error:', err)
      return NextResponse.json(
        { error: 'Failed to load schedule' },
        { status: 500 }
      )
    }

    const data = await res.json()
    console.log('Schedule route - records found:', data.records?.length)

    const dates = data.records
      .map((r: any) => ({
        date: r.fields.Date,
        slotsRemaining: r.fields['Slots Remaining'],
      }))
      .filter((d: any) => d.date && typeof d.slotsRemaining === 'number')

    return NextResponse.json(dates)
  } catch (e: any) {
    console.error('Schedule endpoint error:', e)
    return NextResponse.json(
      { error: e.message || 'Internal server error' },
      { status: 500 }
    )
  }
}