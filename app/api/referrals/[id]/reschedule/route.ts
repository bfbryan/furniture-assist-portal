// app/api/referrals/[id]/reschedule/route.ts
// Agency-facing reschedule:
//   { flexible: true }
//   { flexible: false, preferredDate: 'YYYY-MM-DD', preferredTime?: '10am' }
//
// This is a REQUEST, not a booking. Ben's design: the request parks the record
// in Dawson's queue and changes nothing about the appointment.
//
//   Appointment Status-> 'Reschedule'   is what puts the record in the
//                                       Reschedule Requests queue on
//                                       /dawson/referrals/review (and on the
//                                       Dawson home page). That queue keys on
//                                       this status directly.
//   Preferred Date / Preferred Time     what the agency actually asked for
//
// Referral Review is left ALONE — the referral stays 'Approved'. It used to be
// forced to 'Pending' so the review queue (which keyed on Pending) would pick
// it up; the queue now filters on Appointment Status = 'Reschedule' instead, so
// there is nothing to flip. Dawson accepting/overriding no longer has to flip
// it back either.
//
// The appointment itself is untouched until Dawson acts — the client keeps the
// slot they have until he either accepts the requested date or picks a
// different one.
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
import {
  NO_SHOW_RESCHEDULE_WINDOW_DAYS,
  withinNoShowRescheduleWindow,
} from '@/lib/referrals/no-show-window'
import {
  assertReferralClientMayBeRescheduled,
  doNotServeUnverifiedMessage,
  DoNotServeError,
} from '@/lib/clients/do-not-serve'

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

  // Do-not-serve, reported exactly as the create paths report it: 403 with
  // `doNotServe: true` for the flag, 502 when the status could not be read.
  //
  // This route only files a REQUEST — it does not move the appointment — but a
  // request that can only ever be refused is not worth accepting. Refusing it
  // here tells the agency why, in the same words the submit route uses,
  // instead of parking it in Dawson's queue for him to decline by hand.
  //
  // requireAgencyReferralAccess already loaded the referral, so the client
  // identity comes free.
  try {
    await assertReferralClientMayBeRescheduled({
      clientId: access.referral.clientId,
      firstName: access.referral.firstName,
      lastName: access.referral.lastName,
      dob: access.referral.dob,
    })
  } catch (e: unknown) {
    if (e instanceof DoNotServeError) {
      return NextResponse.json({ error: e.message, doNotServe: true }, { status: 403 })
    }
    return NextResponse.json(
      {
        error: doNotServeUnverifiedMessage(
          'the reschedule request was not submitted',
          e instanceof Error ? e.message : String(e),
        ),
      },
      { status: 502 },
    )
  }

  // A missed appointment (Airtable 'No Show', shown to agencies as "Missed
  // Appointment") can still be picked back up from the agency side, but only
  // inside the reschedule window — past that it is a closed record and a fresh
  // referral is the right move. The detail page hides the Reschedule button on
  // the same rule; enforced here as well because this route is reachable
  // directly and a hidden button is not access control — the same reasoning
  // lib/referrals/edit-window.ts gives for the edit cutoff.
  if (
    access.referral.appointmentStatus === 'No Show' &&
    !withinNoShowRescheduleWindow(access.referral.appointmentDate)
  ) {
    return NextResponse.json(
      {
        error: `This appointment was missed more than ${NO_SHOW_RESCHEDULE_WINDOW_DAYS} days ago. Please submit a new referral instead.`,
      },
      { status: 409 },
    )
  }

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
    // This alone parks the record in the Reschedule Requests queue — that
    // queue filters on Appointment Status = 'Reschedule' directly. Referral
    // Review is deliberately not touched: the referral stays 'Approved'.
    'Appointment Status': 'Reschedule',
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