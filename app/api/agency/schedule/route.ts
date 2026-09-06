// app/api/agency/schedule/route.ts
//
// GET /api/agency/schedule?from=YYYY-MM-DD[&to=YYYY-MM-DD][&exclude=<referralId>]
//
// AGENCY-FACING grid data for SaturdayCapacityGrid (capacityDisplay="binary").
//
// The same windowed { rows: SaturdayGridRow[], horizon } shape as the Dawson
// grid endpoint (app/api/dawson/schedule/route.ts grid mode), so the shared
// component consumes either by pointing its `endpoint` prop at one or the
// other. Deliberate differences from the Dawson route:
//
//   • AUTH — any signed-in agency user, not the Dawson allowlist.
//   • NO soft counts — `soft` is 0 on every slot. The pending-request tally is
//     Dawson's to see, not the agencies'.
//   • `exclude=<referralId>` IS honoured, narrowly. It nets exactly ONE
//     referral's held slot out of the counts (booked, totalFilled,
//     slotsRemaining) and flags that one cell `current`. What the route is
//     allowed to know: that referral must belong to the CALLER'S agency —
//     requireAgencyReferralAccess checks ownership — so this cannot be used to
//     probe which slots another agency's referrals sit in. A failed check is a
//     silent no-op, not a 403: the grid still renders, just without the
//     netting. Without it, an agency rescheduling a client at a full hour would
//     see that client's own current slot as Full and unselectable.
//     RescheduleModal is the only caller and only opens on the agency's own
//     referrals.
//   • The 50/day cap is HARD for agencies. This route does not enforce it
//     (the grid renders a full cell struck and unselectable via enforceCap);
//     it just reports the numbers the grid turns into Open/Full.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import {
  getAgencyUserByClerkId,
  getSaturdaySchedule,
  getScheduleHorizon,
} from '@/lib/airtable'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'
import { REC_ID_RE } from '@/lib/airtable/client'
import { TIME_CAPS, TIME_ORDER, type TimeSlot } from '@/lib/schedule/capacity'
import type {
  SaturdayGridRow,
  SaturdayGridSlot,
  SaturdayGridResponse,
} from '@/lib/schedule/grid'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) {
    return NextResponse.json({ error: 'No agency linked' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  if (!from) {
    return NextResponse.json({ error: 'from is required (YYYY-MM-DD)' }, { status: 400 })
  }
  const to = searchParams.get('to') ?? from
  const excludeId = searchParams.get('exclude')

  // The one held slot to net out — see the header. requireAgencyReferralAccess
  // is the same ownership guard the reschedule POST uses: if the caller's
  // agency doesn't own `excludeId`, `held` stays null and the grid comes back
  // with untouched counts, so a probe with someone else's referral id learns
  // nothing. `appointmentDate` is empty for a referral that holds no slot (a
  // no-show whose Saturday was released), which is also a clean no-op.
  let held: { date: string; time: TimeSlot } | null = null
  if (excludeId && REC_ID_RE.test(excludeId)) {
    const access = await requireAgencyReferralAccess(excludeId)
    const t = access.referral?.appointmentTime
    if (
      !access.denied &&
      access.referral.appointmentDate &&
      typeof t === 'string' &&
      (TIME_ORDER as readonly string[]).includes(t)
    ) {
      held = { date: access.referral.appointmentDate.slice(0, 10), time: t as TimeSlot }
    }
  }

  const [schedule, horizonDate] = await Promise.all([
    getSaturdaySchedule(from, to),
    getScheduleHorizon(),
  ])

  const rows: SaturdayGridRow[] = schedule.map((s) => {
    const date = String(s.date).slice(0, 10)
    const flat: Record<TimeSlot, number> = {
      '9am': s.slots9am,
      '10am': s.slots10am,
      '11am': s.slots11am,
      '12pm': s.slots12pm,
      '1pm': s.slots1pm,
    }
    const heldOnThisDate = held != null && held.date === date
    const slots = {} as Record<TimeSlot, SaturdayGridSlot>
    for (const t of TIME_ORDER) {
      const isCurrent = heldOnThisDate && held!.time === t
      slots[t] = {
        booked: Math.max(0, (flat[t] ?? 0) - (isCurrent ? 1 : 0)),
        cap: TIME_CAPS[t],
        soft: 0,
        current: isCurrent,
      }
    }
    return {
      id: s.id,
      date,
      status: s.status,
      totalCapacity: s.totalCapacity,
      totalFilled: Math.max(0, s.totalFilled - (heldOnThisDate ? 1 : 0)),
      slotsRemaining: s.slotsRemaining + (heldOnThisDate ? 1 : 0),
      slots,
    }
  })

  const body: SaturdayGridResponse = {
    rows,
    horizon: {
      lastDate: horizonDate,
      truncated: horizonDate == null || to > horizonDate,
    },
  }
  return NextResponse.json(body)
}
