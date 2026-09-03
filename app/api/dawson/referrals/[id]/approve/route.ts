// app/api/dawson/referrals/[id]/approve/route.ts
//
// POST /api/dawson/referrals/:id/approve  — DAWSON-ONLY.
//
// Approve a new referral from the Needs Action "New referrals" card. Approve
// must APPROVE AND BOOK — set Referral Review = 'Approved', link the Saturday
// Schedule row, write the time, set Appointment Status = 'Scheduled' — in one
// write, so there is no window where the referral is approved but booked
// nowhere (the disappearing-referral failure the card exists to prevent).
//
// The booking itself is rescheduleReferral() — the one shared booker. It
// already no-ops the original-appointment snapshot and the reschedule-notice
// email for a first booking; the `review` param flips Referral Review in the
// same PATCH. The Wednesday appointment-slip-notice cron sends the agency the
// confirmation + slip, exactly as it does for an Add Referral submission.
//
//   Specific date  -> rescheduleReferral with the agency's Preferred Date/Time.
//   Flexible       -> findNextFlexibleSlot() picks the next Saturday >= 14 days
//                     out with room; 409 if none in six months (an honest
//                     failure — the referral stays Pending).
//
// Body: { preferredDate?, preferredTime?, flexible? } — the card passes these
// from the same getAllReferrals it rendered, matching the reschedule route's
// trust model. `flexible` (or a missing preferredDate) routes to the allocator.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { rescheduleReferral, type RescheduleFailureReason } from '@/lib/referrals/reschedule'
import { findNextFlexibleSlot, FLEXIBLE_LEAD_DAYS } from '@/lib/schedule/flexible'

const SERVER_ERROR_REASONS: ReadonlySet<RescheduleFailureReason> = new Set<RescheduleFailureReason>([
  'write-failed',
  'lookup-failed',
])
const DO_NOT_SERVE_STATUS: Partial<Record<RescheduleFailureReason, number>> = {
  'do-not-serve': 403,
  'do-not-serve-unverified': 502,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { preferredDate, preferredTime, flexible } = body as {
    preferredDate?: string | null
    preferredTime?: string | null
    flexible?: boolean
  }

  let bookDate: string
  let bookTime: string | null

  if (flexible === true || !preferredDate) {
    let assignment
    try {
      assignment = await findNextFlexibleSlot()
    } catch (e) {
      return NextResponse.json(
        { error: `Could not look up available Saturdays: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 },
      )
    }
    if (!assignment) {
      return NextResponse.json(
        {
          error:
            `No Saturday in the next six months has room for this referral ` +
            `(needs to be at least ${FLEXIBLE_LEAD_DAYS} days out, under the 50-appointment ` +
            `day cap, with a time slot under its own cap). Open the referral to pick a date.`,
        },
        { status: 409 },
      )
    }
    bookDate = assignment.date
    bookTime = assignment.time
  } else {
    bookDate = preferredDate
    bookTime = preferredTime ?? null
  }

  const result = await rescheduleReferral({
    referralId: id,
    preferredDate: bookDate,
    appointmentTime: bookTime,
    review: 'Approved',
  })

  if (!result.ok) {
    const doNotServeStatus = DO_NOT_SERVE_STATUS[result.reason]
    if (doNotServeStatus) {
      return NextResponse.json(
        result.reason === 'do-not-serve'
          ? { error: result.message, doNotServe: true }
          : { error: result.message },
        { status: doNotServeStatus },
      )
    }
    return NextResponse.json(
      { error: result.message },
      { status: SERVER_ERROR_REASONS.has(result.reason) ? 500 : 400 },
    )
  }

  return NextResponse.json({ success: true, appointmentTime: result.appointmentTime })
}
