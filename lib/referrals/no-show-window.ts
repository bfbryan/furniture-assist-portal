// lib/referrals/no-show-window.ts
//
// The window during which a missed appointment can still be picked back up
// rather than re-referred from scratch. Airtable's Appointment Status value is
// 'No Show'; the agency portal shows it as "Missed Appointment".
//
// Everything that gates on this window now imports from here, so a change to
// the number moves every surface together:
//
//   • app/(agency)/referrals/[id]/page.tsx      — hides the agency Reschedule
//     button once a missed appointment is past the window.
//   • POST /api/referrals/[id]/reschedule       — refuses the request for the
//     same reason. A hidden button is presentation, not permission — the same
//     argument lib/referrals/edit-window.ts makes for the edit cutoff.
//   • app/dawson/referrals/[id]/page.tsx        — `noShowAged` gate (locks the
//     record, drops the Reschedule/Cancel meta actions).
//   • app/dawson/referrals/history/page.tsx     — `canManageNoShow` (the
//     Reschedule/Cancel buttons on a No Show row).
//   • lib/referrals/match.ts                    — `eligibleForReschedule` on
//     the Add Referral duplicate-check scenarios.
//
// The Dawson pages keep their own `daysSince…` computations and compare against
// the constant directly rather than calling withinNoShowRescheduleWindow(); the
// helper additionally rejects a future-dated appointment, which those call
// sites historically did not, and this was a behaviour-preserving refactor.
//
// All dates are Eastern. `todayISO` is injected so a caller can pass one value
// for a whole render or request rather than re-reading the clock, and so this
// stays testable.

import { differenceInDaysISO, easternTodayISO } from '@/lib/dates'

/**
 * Days between a missed appointment and the point it stops being reschedulable.
 * Confirmed Aug 2026: realistically ~14 days, padded to 25 to absorb a holiday
 * closure pushing a return visit late.
 */
export const NO_SHOW_RESCHEDULE_WINDOW_DAYS = 25

/**
 * Whole days from the appointment date to today, Eastern. Negative when the
 * appointment is in the future; null when the date is missing or unparseable.
 */
export function daysSinceAppointment(
  appointmentDate: string | null | undefined,
  todayISO: string = easternTodayISO(),
): number | null {
  return differenceInDaysISO(appointmentDate, todayISO)
}

/**
 * True while a missed appointment can still be rescheduled in place: the
 * appointment date is today or earlier and no more than
 * NO_SHOW_RESCHEDULE_WINDOW_DAYS ago.
 *
 * Computed with the date-only helpers in lib/dates (UTC-anchored calendar
 * arithmetic against an Eastern "today"), not `new Date(iso)`, so a client in
 * New Jersey and a Vercel box in UTC agree on the boundary day.
 */
export function withinNoShowRescheduleWindow(
  appointmentDate: string | null | undefined,
  todayISO: string = easternTodayISO(),
): boolean {
  const days = daysSinceAppointment(appointmentDate, todayISO)
  return days !== null && days >= 0 && days <= NO_SHOW_RESCHEDULE_WINDOW_DAYS
}

/**
 * True for a still-Scheduled referral whose appointment date is strictly
 * before today (Eastern): the visit may already have happened but Furniture
 * Assist has not recorded the outcome yet (the scan runs Tuesday).
 *
 * Such a referral must not be rescheduled or cancelled from the agency side —
 * cancelling an appointment the client attended would corrupt the record. The
 * referral detail page and the Dashboard's Last Saturday card both show it as
 * "Awaiting outcome" with no actions; POST /api/referrals/[id]/reschedule and
 * /cancel reject it. A hidden button is not access control — the same
 * reasoning withinNoShowRescheduleWindow carries for the missed-visit window.
 *
 * `appointmentStatus` is the RAW Airtable value ('Scheduled'), not the portal
 * status.
 */
export function isAwaitingOutcome(
  appointmentStatus: string | null | undefined,
  appointmentDate: string | null | undefined,
  todayISO: string = easternTodayISO(),
): boolean {
  if (appointmentStatus !== 'Scheduled') return false
  const days = daysSinceAppointment(appointmentDate, todayISO)
  return days !== null && days > 0
}
