// app/api/agency/schedule/route.ts
//
// GET /api/agency/schedule?from=YYYY-MM-DD[&to=YYYY-MM-DD]
//
// AGENCY-FACING grid data for SaturdayCapacityGrid (capacityDisplay="binary").
//
// The same windowed { rows: SaturdayGridRow[], horizon } shape as the Dawson
// grid endpoint (app/api/dawson/schedule/route.ts grid mode), so the shared
// component consumes either by pointing its `endpoint` prop at one or the
// other. Three deliberate differences:
//
//   • AUTH — any signed-in agency user, not the Dawson allowlist.
//   • NO soft counts, NO exclude — the agency grid shows Open/Full only and
//     has no "reschedule this referral" hold to net out. `soft` is 0 and
//     `current` false on every slot.
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
    const slots = {} as Record<TimeSlot, SaturdayGridSlot>
    for (const t of TIME_ORDER) {
      slots[t] = {
        booked: flat[t] ?? 0,
        cap: TIME_CAPS[t],
        soft: 0,
        current: false,
      }
    }
    return {
      id: s.id,
      date,
      status: s.status,
      totalCapacity: s.totalCapacity,
      totalFilled: s.totalFilled,
      slotsRemaining: s.slotsRemaining,
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
