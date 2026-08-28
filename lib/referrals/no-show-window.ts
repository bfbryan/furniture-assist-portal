// lib/referrals/no-show-window.ts
//
// The window during which a missed appointment can still be picked back up
// rather than re-referred from scratch. Airtable's Appointment Status value is
// 'No Show'; the agency portal shows it as "Missed Appointment".
//
// This is enforced in two places that must not drift:
//
//   • app/(agency)/referrals/[id]/page.tsx hides the Reschedule button once a
//     missed appointment is past the window.
//   • POST /api/referrals/[id]/reschedule refuses the request for the same
//     reason — a hidden button is presentation, not permission, the same
//     argument lib/referrals/edit-window.ts makes for the edit cutoff.
//
// COPIES THIS REPO STILL CARRIES (flagged, not yet converged — all Dawson-side,
// all currently agreeing at 25 days):
//   • app/dawson/referrals/[id]/page.tsx      — NO_SHOW_ACTION_WINDOW_DAYS
//   • app/dawson/referrals/history/page.tsx   — a bare `<= 25`
// lib/referrals/match.ts now imports NO_SHOW_RESCHEDULE_WINDOW_DAYS from here.
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
