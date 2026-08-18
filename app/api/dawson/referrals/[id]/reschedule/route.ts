// app/api/dawson/referrals/[id]/reschedule/route.ts
//
// POST /api/dawson/referrals/:id/reschedule
//
// Reschedule an existing referral. Dawson always picks a specific date.
// Time slot is optional:
//
//   - Date + Time -> uses that slot. Per-slot caps are NOT enforced;
//                    an explicit time is an override, which is Dawson's
//                    call to make.
//   - Date only   -> backend allocator picks the first slot under cap
//                    (fill order 9am -> 10am -> 11am -> 12pm -> 1pm).
//                    If all 5 are at cap, returns an error.
//
// The logic itself lives in lib/referrals/reschedule.ts, because the OCR
// scan pipeline has to perform the identical reschedule when a volunteer
// writes into the RESCH/DATE box on a pickup sheet. This file is now just
// the HTTP shell: authorize, parse the body, and map the shared result onto
// status codes. The response shape is unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import {
  rescheduleReferral,
  type RescheduleFailureReason,
} from '@/lib/referrals/reschedule'

// Everything except an Airtable write failure is a bad request: the caller
// asked for something that cannot be scheduled.
const SERVER_ERROR_REASONS: ReadonlySet<RescheduleFailureReason> = new Set<RescheduleFailureReason>([
  'write-failed',
  'lookup-failed',
])

// Do-not-serve reports itself exactly as it does on the two create paths, so
// the same refusal reads the same wherever it is hit:
//   flagged            -> 403 { error, doNotServe: true }
//   could not verify   -> 502 { error }
// See app/api/dawson/referrals/submit/route.ts and app/api/referrals/submit.
const DO_NOT_SERVE_STATUS: Partial<Record<RescheduleFailureReason, number>> = {
  'do-not-serve': 403,
  'do-not-serve-unverified': 502,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { preferredDate, appointmentTime } = body

  const result = await rescheduleReferral({
    referralId: id,
    preferredDate,
    appointmentTime,
  })

  if (!result.ok) {
    const doNotServeStatus = DO_NOT_SERVE_STATUS[result.reason]
    if (doNotServeStatus) {
      return NextResponse.json(
        result.reason === 'do-not-serve'
          ? { error: result.message, doNotServe: true }
          : { error: result.message },
        { status: doNotServeStatus }
      )
    }
    return NextResponse.json(
      { error: result.message },
      { status: SERVER_ERROR_REASONS.has(result.reason) ? 500 : 400 }
    )
  }

  return NextResponse.json({
    success: true,
    appointmentTime: result.appointmentTime,
    rescheduleNotice: result.rescheduleNotice,
  })
}
