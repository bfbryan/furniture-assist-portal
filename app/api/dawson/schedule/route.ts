// app/api/dawson/schedule/route.ts
//
// GET /api/dawson/schedule
//
// DAWSON-ONLY.
//
// Two modes on one route (extension, not a new endpoint):
//
//   • No `from` param — the whole Saturday Schedule table, ascending, in the
//     shape it has always returned. The Saturday Schedule page and the
//     dashboard use this and are untouched.
//
//   • `?from=YYYY-MM-DD[&to=…][&soft=1][&exclude=<referralId>]` — "grid" mode
//     for the shared Saturday capacity grid. Returns
//     { rows: SaturdayGridRow[], horizon } — a windowed slice with per-hour
//     { booked, cap, soft, current } and a horizon marker so the grid can
//     tell "end of window" from "end of the published schedule". See
//     lib/schedule/grid.ts.

import { NextRequest, NextResponse } from 'next/server'
import {
  getSaturdaySchedule,
  getScheduleHorizon,
  getSoftSlotCounts,
  getReferralHeldSlot,
  type SoftSlotCounts,
} from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { TIME_CAPS, TIME_ORDER, type TimeSlot } from '@/lib/schedule/capacity'
import type {
  SaturdayGridRow,
  SaturdayGridSlot,
  SaturdayGridResponse,
} from '@/lib/schedule/grid'

export async function GET(req: NextRequest) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')

  // Legacy mode — whole table, original shape.
  if (!from) {
    return NextResponse.json(await getSaturdaySchedule())
  }

  // Grid mode.
  const to = searchParams.get('to') ?? from
  const wantSoft = searchParams.get('soft') === '1'
  const excludeId = searchParams.get('exclude')

  // `exclude` is the referral being rescheduled (the Pick Another modal). It
  // subtracts that referral from BOTH sides of a cell:
  //   • HARD — its held slot, so the cell isn't shown one booking fuller than
  //     it is. Done in the row map below via `held`. No-op when the held
  //     Saturday is outside the window: no row here matches its date.
  //   • SOFT — its own pending request, so the soft count reads "what else
  //     wants this hour", not an echo of the decision being made. Done here,
  //     by passing the id into getSoftSlotCounts.
  const [schedule, horizonDate, soft, held] = await Promise.all([
    getSaturdaySchedule(from, to),
    getScheduleHorizon(),
    wantSoft
      ? getSoftSlotCounts(from, to, excludeId ?? undefined)
      : Promise.resolve({} as SoftSlotCounts),
    excludeId ? getReferralHeldSlot(excludeId) : Promise.resolve(null),
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
    const softRow = soft[date] ?? {}
    const heldOnThisDate = held != null && held.date === date

    const slots = {} as Record<TimeSlot, SaturdayGridSlot>
    for (const t of TIME_ORDER) {
      const isCurrent = heldOnThisDate && held!.time === t
      slots[t] = {
        // Hard side of `exclude` — see the note by the Promise.all above.
        booked: Math.max(0, (flat[t] ?? 0) - (isCurrent ? 1 : 0)),
        cap: TIME_CAPS[t],
        soft: softRow[t] ?? 0,
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
