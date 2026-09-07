// lib/dawson/needs-action-counts.ts
//
// The four "what needs Dawson" queue sizes, in one place.
//
// Two callers, and they MUST agree:
//   • GET /api/dawson/needs-action/count — feeds the nav badge (client fetch
//     on mount / focus).
//   • app/dawson/page.tsx — the dashboard's three review stat cards
//     (reschedule / newReferrals / agencies; the dashboard leaves
//     awaitingOutcome to the Past-Saturdays card).
//
// Before this module the badge route ran these queries inline; the dashboard
// running its own copy is how the two would have drifted.

import { getAllReferrals, getAllAgencies } from '@/lib/airtable'
import { addDaysISO, easternTodayISO } from '@/lib/dates'
import { isAwaitingOutcome } from '@/lib/referrals/no-show-window'

export type NeedsActionCounts = {
  /** Appointment Status = 'Reschedule' — an agency (or the OCR no-date branch)
      has asked to move a booked appointment. */
  reschedule: number
  /** Referral Review = 'Pending', minus any that are also 'Reschedule' (an
      agency reschedule leaves Review = 'Approved', but belt-and-braces). */
  newReferrals: number
  /** Still 'Scheduled' with a Saturday now in the past — visit may have
      happened, no outcome recorded (scan runs Tuesday). Same derived check the
      Referrals page and the Past-Saturdays card use. */
  awaitingOutcome: number
  /** Agencies with Status = 'Pending'. */
  agencies: number
}

export async function getNeedsActionCounts(
  todayISO: string = easternTodayISO(),
): Promise<NeedsActionCounts> {
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

  return {
    reschedule: reschedule.length,
    newReferrals,
    awaitingOutcome,
    agencies: pendingAgencies.length,
  }
}
