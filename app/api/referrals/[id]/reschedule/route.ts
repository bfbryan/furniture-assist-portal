// app/api/referrals/[id]/reschedule/route.ts
// Agency-facing reschedule:
//   { flexible: true }
//   { flexible: false, preferredDate: 'YYYY-MM-DD', preferredTime?: '10am' }
//
// This is a REQUEST, not a booking. Ben's design: the request parks the record
// in Dawson's queue and changes nothing about the appointment.
//
//   Referral Review   -> 'Pending'      puts it on /dawson/referrals/review
//   Appointment Status-> 'Reschedule'   is what sorts it into the reschedule
//                                       group there rather than the new-referral one
//   Preferred Date / Preferred Time     what the agency actually asked for
//
// Both are existing single-select options; neither is new. The appointment
// itself is untouched until Dawson acts — the client keeps the slot they have
// until he either accepts the requested date or picks a different one.
//
// Dawson's own /api/dawson/referrals/[id]/reschedule is the one that actually
// moves an appointment and emails the agency.
//
// Preferred Time's options are the same five strings as Appointment Time, so
// the value passes straight through to rescheduleReferral() with no mapping.
//
// Ownership is checked with the shared guard — it previously only verified
// that someone was signed in, which let any agency user reschedule any
// referral in the base.

import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'
import { VALID_TIMES } from '@/lib/schedule/capacity'

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
  const { preferredDate, preferredTime, flexible } = body

  const isFlexible = flexible === true

  if (!isFlexible) {
    if (!preferredDate) {
      return NextResponse.json({ error: 'Preferred date is required when not flexible.' }, { status: 400 })
    }
    if (!isSaturday(preferredDate)) {
      return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
    }
  }

  // Time is optional even on a specific-date request — an agency that has no
  // preference leaves it blank and Dawson allocates.
  const hasTime =
    !isFlexible && typeof preferredTime === 'string' && VALID_TIMES.has(preferredTime)

  if (
    !isFlexible &&
    preferredTime !== undefined &&
    preferredTime !== null &&
    preferredTime !== '' &&
    !hasTime
  ) {
    return NextResponse.json(
      { error: `Invalid appointment time: ${preferredTime}` },
      { status: 400 }
    )
  }

  const fields: Record<string, any> = {
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    'Appointment Status': 'Reschedule',
    // Back into Dawson's Awaiting Review queue. Without this the request set a
    // status nobody was watching and simply sat there.
    'Referral Review': 'Pending',
  }

  if (isFlexible) {
    fields['Preferred Date'] = null
    fields['Preferred Time'] = null
  } else {
    fields['Preferred Date'] = preferredDate
    // Cleared rather than left alone when no time is given, so a stale
    // preference from an earlier request cannot be read as this one's.
    fields['Preferred Time'] = hasTime ? preferredTime : null
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