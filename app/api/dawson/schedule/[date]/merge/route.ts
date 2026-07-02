// app/api/dawson/schedule/[date]/merge/route.ts
//
// Flips the "Mail Merge Complete" flag on the Saturday Schedule record for
// the given date. Called by the print sheets page right before window.print().
//
// TODO (parked cleanup item):
//   This flag currently flips on user action (opening the print dialog),
//   not on downstream Zap confirmation that emails were sent. Move the
//   flag write to the Zap's final step (post-send) so the flag actually
//   means "emails went out" rather than "someone hit Print".

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

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
        fields: { 'Mail Merge Complete': true },
      }),
    }
  )

  if (!updateRes.ok) return NextResponse.json({ error: await updateRes.text() }, { status: 500 })
  return NextResponse.json({ ok: true })
}
