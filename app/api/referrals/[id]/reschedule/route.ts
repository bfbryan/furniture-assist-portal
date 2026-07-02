// app/api/dawson/referrals/[id]/reschedule/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return !isNaN(dt.getTime()) && dt.getDay() === 6
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { preferredDate, flexible } = body

  const isFlexible = flexible === true

  if (!isFlexible) {
    if (!preferredDate) {
      return NextResponse.json({ error: 'Preferred date is required when not flexible.' }, { status: 400 })
    }
    if (!isSaturday(preferredDate)) {
      return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
    }
  }

  const fields: Record<string, any> = {
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    'Appointment Status': 'Reschedule',
  }

  if (isFlexible) {
    fields['Preferred Date'] = null
  } else {
    fields['Preferred Date'] = preferredDate
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Client%20Referrals/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
