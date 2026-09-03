// app/api/dawson/needs-action/count/route.ts
//
// GET /api/dawson/needs-action/count  — DAWSON-ONLY.
//
// Feeds the nav badge. Runs the same four queries the Needs Action page does
// (card 5, flagged duplicates, has no data source yet and is excluded), so the
// badge and the page can't disagree. Exists as its own endpoint rather than in
// app/dawson/layout.tsx because that layout wraps every /dawson/* page and
// must not do four Airtable reads on every navigation — the badge fetches this
// once on mount and on focus instead.

import { NextResponse } from 'next/server'
import { getAllReferrals, getAllAgencies } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { addDaysISO, easternTodayISO } from '@/lib/dates'
import { isAwaitingOutcome } from '@/lib/referrals/no-show-window'

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const todayISO = easternTodayISO()
  const yesterdayISO = addDaysISO(todayISO, -1)

  const [reschedule, pendingReview, scheduledPast, pendingAgencies] = await Promise.all([
    getAllReferrals({ statuses: ['Reschedule'] }),
    getAllReferrals({ review: 'Pending' }),
    getAllReferrals({ statuses: ['Scheduled'], appointmentDateTo: yesterdayISO }),
    getAllAgencies('Pending'),
  ])

  const newReferrals = pendingReview.filter(
    (r: { appointmentStatus: string }) => r.appointmentStatus !== 'Reschedule',
  ).length
  const awaitingOutcome = scheduledPast.filter(
    (r: { appointmentStatus: string; appointmentDate: string | null }) =>
      isAwaitingOutcome(r.appointmentStatus, r.appointmentDate, todayISO),
  ).length

  const counts = {
    reschedule: reschedule.length,
    newReferrals,
    awaitingOutcome,
    agencies: pendingAgencies.length,
  }

  return NextResponse.json({
    ...counts,
    total: counts.reschedule + counts.newReferrals + counts.awaitingOutcome + counts.agencies,
  })
}
