// lib/schedule/grid.ts
//
// Wire shape + windowing logic for the shared Saturday capacity grid
// (components/internal/SaturdayCapacityGrid.tsx). Kept out of the component so
// the walk is a pure function the route and any test can call, and so the
// route isn't importing types out of a 'use client' file.
//
// The grid is Dawson-only for now. `cap` on a slot is TIME_CAPS; 50 is a SOFT
// ceiling here (a full cell stays selectable, with a warning) — see the
// component's `enforceCap` prop for the future agency variant.

import type { TimeSlot } from '@/lib/schedule/capacity'

/** One hour on one Saturday, as the grid endpoint returns it. */
export type SaturdayGridSlot = {
  /** Airtable's per-hour rollup, net of the excludeReferralId hold (if any). */
  booked: number
  /** TIME_CAPS for this hour. Sent on the wire so the client needs no constant. */
  cap: number
  /** Referrals requesting this hour without holding it. 0 unless ?soft=1. */
  soft: number
  /** True only for the excludeReferralId referral's own current slot. */
  current: boolean
}

/** One Saturday. `status` drives blackout rendering — never the counts. */
export type SaturdayGridRow = {
  id: string
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'Open' | 'Blackout' | 'Full' (Airtable single-select). */
  status: string
  /** Row's own Total Capacity (50 for every live row today; not enforced against TIME_CAPS). */
  totalCapacity: number
  /** Row's Total Slots Filled, net of the excludeReferralId hold (if on this date). */
  totalFilled: number
  slotsRemaining: number
  slots: Record<TimeSlot, SaturdayGridSlot>
}

export type SaturdayGridResponse = {
  rows: SaturdayGridRow[]
  horizon: {
    /** Max Date across the whole Saturday Schedule table, or null if empty. */
    lastDate: string | null
    /** The requested window reached past the last published Saturday. */
    truncated: boolean
  }
}

/**
 * The "four bookable Saturdays" walk.
 *
 * Rows ascending by date from `fromISO` (the window start, normally today).
 * A row counts toward the target only when it is BOOKABLE — not a blackout,
 * and on or after `firstBookableISO` (today + leadDays). Non-bookable rows in
 * the span are still shown: a blackout struck through, a pre-lead Saturday
 * greyed. Collecting stops once `weeks` bookable rows have been taken, so
 * trailing blackouts after the last bookable one are dropped and a closure
 * never costs a bookable week.
 *
 * `bookableShown < weeks` on return means the schedule table ran out before
 * the window filled — the caller shows a "published through {date}" note.
 */
export function selectBookableWindow(
  rows: SaturdayGridRow[],
  opts: { weeks: number; fromISO: string; firstBookableISO: string },
): { visible: SaturdayGridRow[]; bookableShown: number } {
  const sorted = rows
    .filter(r => r.date >= opts.fromISO)
    .sort((a, b) => a.date.localeCompare(b.date))

  const visible: SaturdayGridRow[] = []
  let bookableShown = 0
  for (const row of sorted) {
    const bookable = row.status !== 'Blackout' && row.date >= opts.firstBookableISO
    visible.push(row)
    if (bookable && ++bookableShown === opts.weeks) break
  }
  return { visible, bookableShown }
}
