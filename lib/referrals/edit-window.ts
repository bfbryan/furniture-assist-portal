// lib/referrals/edit-window.ts
//
// When an agency user may still edit their own referral.
//
// Two gates, both of which have to pass:
//
//   1. The referral is still open — pending review, waiting to be scheduled,
//      or scheduled. Once it is completed, cancelled, rejected, withdrawn or
//      a no-show, the record is history and stops accepting edits.
//
//   2. It is still on or before the Monday preceding the appointment.
//      Appointments are Saturdays, so that Monday is five days earlier.
//      Editing closes at the end of that Monday: on the Monday you can still
//      edit, from the Tuesday you cannot. The warehouse pulls its pick lists
//      off the referral in the back half of the week, so a change after that
//      point would not reach the volunteers who act on it.
//
//      A referral with no appointment date yet has nothing to count back
//      from, so only gate 1 applies.
//
// This lives in lib/ rather than in the page because it is enforced twice: the
// page uses it to decide whether to offer an Edit button, and PATCH
// /api/referrals/[id] uses it to decide whether to accept the write. A rule
// that only existed in the UI would be advisory — the endpoint is reachable
// directly, and "the Edit button was hidden" is not access control.
//
// All dates are Eastern. `todayISO` is injected so the caller can pass one
// value for a whole render or request rather than re-reading the clock.

import { addDaysISO, differenceInDaysISO, easternTodayISO } from '@/lib/dates'

/**
 * Days between the edit cutoff and the appointment. Saturday minus five days
 * is the Monday before it.
 */
export const EDIT_CUTOFF_DAYS_BEFORE = 5

/** Portal-facing statuses during which a referral is still open to edits. */
export const EDITABLE_STATUSES = ['Submitted', 'Scheduling', 'Scheduled'] as const

/**
 * The status an agency user sees, derived from the two Airtable fields.
 * Shared so the page and the API classify a referral identically.
 */
export function getPortalStatus(review: string, status: string): string {
  if (review === 'Rejected') return 'Rejected'
  if (review === 'Withdrawn') return 'Withdrawn'
  if (status === 'Cancelled') return 'Cancelled'
  if (status === 'Completed') return 'Completed'
  if (review === 'Pending') return 'Submitted'
  if (status === 'Pending Schedule') return 'Scheduling'
  if (status === 'Scheduled') return 'Scheduled'
  return status
}

export type EditWindow =
  | { editable: true; cutoffDate: string | null }
  | {
      editable: false
      /** 'status' = the referral is closed; 'past-cutoff' = too near the appointment. */
      reason: 'status' | 'past-cutoff'
      cutoffDate: string | null
    }

export function agencyEditWindow({
  portalStatus,
  appointmentDate,
  todayISO = easternTodayISO(),
}: {
  portalStatus: string
  appointmentDate: string | null | undefined
  todayISO?: string
}): EditWindow {
  const cutoffDate = appointmentDate
    ? addDaysISO(appointmentDate, -EDIT_CUTOFF_DAYS_BEFORE)
    : null

  if (!(EDITABLE_STATUSES as readonly string[]).includes(portalStatus)) {
    return { editable: false, reason: 'status', cutoffDate }
  }

  // Nothing scheduled yet — no appointment to count back from.
  if (!cutoffDate) return { editable: true, cutoffDate: null }

  // Editable through the end of the cutoff day itself.
  const daysLeft = differenceInDaysISO(todayISO, cutoffDate)
  if (daysLeft === null) return { editable: true, cutoffDate }
  if (daysLeft < 0) return { editable: false, reason: 'past-cutoff', cutoffDate }

  return { editable: true, cutoffDate }
}
