// app/api/referrals/[id]/reschedule/route.ts
// Agency-facing reschedule: accepts { flexible: true } OR { flexible: false, preferredDate: 'YYYY-MM-DD' }
//
// This is a REQUEST, not a booking: it sets Appointment Status to
// 'Reschedule' and records the preferred date for Furniture Assist to confirm.
// Dawson's own /api/dawson/referrals/[id]/reschedule is the one that actually
// moves an appointment and emails the agency.
//
// Ownership is checked with the shared guard — it previously only verified
// that someone was signed in, which let any agency user reschedule any
// referral in the base.

import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'

function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return !isNaN(dt.getTime()) && dt.getDay() === 6
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await requireAgencyReferralAccess(id)
  if (access.denied) return access.denied

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