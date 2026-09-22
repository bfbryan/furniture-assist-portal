// lib/referrals/edit-window.ts
//
// When an agency user may still edit their own referral: Client Information
// and Items Requested (agencyEditWindow) — Your Notes has its own, laxer rule
// further down (agencyNotesEditable).
//
// agencyEditWindow, by portal status:
//
//   Submitted, Scheduling, Reschedule   editable, no date gate at all.
//   Scheduled                           editable through the end of the
//                                        Thursday before the Saturday
//                                        appointment (appt − 2 days, Eastern
//                                        calendar day); locked from Friday.
//                                        The warehouse pulls its pick lists
//                                        off the referral in the back half of
//                                        the week, and an agency's edit has
//                                        to reach Dawson before he can act on
//                                        it, not just reach the warehouse.
//   Missed Appointment                  editable exactly while
//                                        withinNoShowRescheduleWindow() is
//                                        true (lib/referrals/no-show-window.ts)
//                                        — the appointment date is already
//                                        past, so there is no Thursday to
//                                        count back from; locked once the
//                                        window closes.
//   Completed, Cancelled, Rejected,
//   Withdrawn                           never editable.
//
// This lives in lib/ rather than in the page because it is enforced twice: the
// page uses it to decide whether to offer an Edit button, and PATCH
// /api/referrals/[id] uses it to decide whether to accept the write. A rule
// that only existed in the UI would be advisory — the endpoint is reachable
// directly, and "the Edit button was hidden" is not access control.
//
// All dates are Eastern. `todayISO` is injected so the caller can pass one
// value for a whole render or request rather than re-reading the clock.

import { addDaysISO, differenceInDaysISO, easternHour, easternTodayISO } from '@/lib/dates'
import { withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'

/**
 * Days between the agency edit cutoff and a Scheduled appointment. Saturday
 * minus two days is the Thursday before it. Not used for Missed Appointment,
 * which has no cutoff day at all — see agencyEditWindow, which checks
 * withinNoShowRescheduleWindow() instead.
 */
export const AGENCY_EDIT_CUTOFF_DAYS_BEFORE = 2

// Portal-facing statuses (getPortalStatus output) that agencyEditWindow
// considers open at all. 'Missed Appointment' is deliberately NOT here — it
// has its own window check, handled as its own branch in agencyEditWindow
// before this list is even consulted. Of the four below, only Scheduled is
// further gated by the Thursday cutoff; the other three are unconditional.
//
// TWO LISTS, KEEP THEM IN STEP. This one governs Client Information and Items
// Requested; NOTES_EDITABLE_APPOINTMENT_STATUS (raw Airtable statuses, further
// down) governs Your Notes. They diverged once — 'Reschedule' was added to the
// notes list and missed here, so a client's address locked while the agency
// was asking us to move the appointment *because the address had changed*. If
// you add a status, decide whether it belongs in both.
export const EDITABLE_STATUSES = ['Submitted', 'Scheduling', 'Scheduled', 'Reschedule'] as const

/**
 * The status an agency user sees, derived from the two Airtable fields.
 * Shared so the page and the API classify a referral identically.
 */
export function getPortalStatus(review: string, status: string): string {
  if (review === 'Rejected') return 'Rejected'
  if (review === 'Withdrawn') return 'Withdrawn'
  if (status === 'Cancelled') return 'Cancelled'
  if (status === 'Completed') return 'Completed'
  // An agency reschedule request sets Appointment Status = 'Reschedule' and
  // leaves Referral Review as 'Approved'. This line is what keeps that reading
  // as 'Reschedule' rather than falling through to 'Scheduled'. (It also sat
  // ahead of the Pending check below to cover the old behaviour, where the
  // request forced review to 'Pending' too; harmless to keep it here.)
  if (status === 'Reschedule') return 'Reschedule'
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

// "Your Notes" (External Notes) edits later into a referral's life than the
// identity / items fields do. Those freeze on the Thursday before the
// appointment because the warehouse builds its pick list off them mid-week; a
// note carries no such downstream action, so it has no Thursday cutoff — only
// a terminal-state one. Editable while the review is Pending or Approved AND
// the appointment is at one of the (raw) statuses below — OR it's a no-show
// still inside its reschedule window (see the withinNoShowRescheduleWindow
// check in the function body): the same carve-out agencyEditWindow makes for
// Client Information and Items Requested, and for the same reason — an
// agency picking up the Reschedule button on a no-show may have new context
// worth adding (why the client missed it, a better number to reach them at)
// right when they're acting on it.
//
// Expressed on the raw Airtable fields (not the portal status) because that is
// the form the rule was given in, and getPortalStatus() collapses distinctions
// this rule needs — e.g. Approved + Reschedule and Approved + Pending Schedule
// both stay note-editable but map to portal statuses outside EDITABLE_STATUSES.
// Airtable's raw no-show value is 'No Show' (the portal calls it "Missed
// Appointment"), checked on its own below rather than folded into the list —
// it needs the date-window check the others don't.
//
// Enforced in PATCH /api/referrals/[id] as well as used to show the Edit button.
export const NOTES_EDITABLE_REVIEW = ['Pending', 'Approved'] as const
export const NOTES_EDITABLE_APPOINTMENT_STATUS = [
  'Pending Schedule',
  'Scheduled',
  'Reschedule',
] as const

export function agencyNotesEditable(
  review: string,
  appointmentStatus: string,
  appointmentDate?: string | null,
  todayISO: string = easternTodayISO(),
): boolean {
  if (!(NOTES_EDITABLE_REVIEW as readonly string[]).includes(review)) return false
  if ((NOTES_EDITABLE_APPOINTMENT_STATUS as readonly string[]).includes(appointmentStatus)) return true
  return appointmentStatus === 'No Show' && withinNoShowRescheduleWindow(appointmentDate, todayISO)
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
  // A no-show's own rule, not EDITABLE_STATUSES below: the appointment date
  // is already in the past by the time a referral reaches this status, so
  // there is no Thursday to count back from. Editable exactly while
  // withinNoShowRescheduleWindow() says so — the same shared check that
  // gates the agency Reschedule button and the detail page's "Reschedule
  // available until" line, so the three can never drift apart.
  //
  // Checked against BOTH strings a caller might pass: getPortalStatus()
  // returns Airtable's raw 'No Show' unrelabelled (PATCH /api/referrals/[id]
  // calls this with that raw value), while the agency detail page relabels
  // to 'Missed Appointment' for display before calling this with ITS value.
  // One missing branch here would silently lock the PATCH route while the
  // page's own Edit button still showed, or the reverse — exactly the kind
  // of drift this function exists to prevent.
  //
  // Neither string is in EDITABLE_STATUSES below, so this has to run first.
  // Dawson's own dawsonEditWindow still treats a no-show as simply closed —
  // unchanged; that's his own, older, separate rule (noShowAged).
  if (portalStatus === 'Missed Appointment' || portalStatus === 'No Show') {
    return withinNoShowRescheduleWindow(appointmentDate, todayISO)
      ? { editable: true, cutoffDate: null }
      : { editable: false, reason: 'status', cutoffDate: null }
  }

  if (!(EDITABLE_STATUSES as readonly string[]).includes(portalStatus)) {
    return { editable: false, reason: 'status', cutoffDate: null }
  }

  // Submitted, Scheduling, Reschedule: no Thursday cutoff at all. Only
  // Scheduled counts down to a Saturday appointment.
  if (portalStatus !== 'Scheduled') {
    return { editable: true, cutoffDate: null }
  }

  // Scheduled: editable through the end of the Thursday before the Saturday
  // appointment (appt - 2 days). No cutoffDate at all falls back to
  // editable — a Scheduled referral should always carry an appointment date,
  // but if one is somehow missing there's no Thursday to have passed.
  const cutoffDate = appointmentDate
    ? addDaysISO(appointmentDate, -AGENCY_EDIT_CUTOFF_DAYS_BEFORE)
    : null
  if (!cutoffDate) return { editable: true, cutoffDate: null }

  // Editable through the end of the cutoff day itself (Eastern calendar day —
  // no hour check, unlike Dawson's own Friday-5pm boundary below).
  const daysLeft = differenceInDaysISO(todayISO, cutoffDate)
  if (daysLeft === null) return { editable: true, cutoffDate }
  if (daysLeft < 0) return { editable: false, reason: 'past-cutoff', cutoffDate }

  return { editable: true, cutoffDate }
}

// ---------------------------------------------------------------------------
// Dawson's own edit window — Client Information / Items Requested on the
// internal referral detail page. A DIFFERENT cutoff from agencyEditWindow's:
// 5pm the Friday before the Saturday appointment, not the end of the Thursday
// two days out. Both exist for the same reason (the warehouse builds its pick
// list off these fields), just drawn at different points by each side — an
// agency's edit has to reach Dawson before he can act on it, not just reach
// the warehouse directly, so its own cutoff sits a day earlier in the week
// and Dawson's stays a plain calendar-day-plus-hour check rather than
// needing the no-show carve-out agencyEditWindow has (a no-show is simply
// closed on Dawson's side; see noShowAged elsewhere on his detail page).
//
// Deliberately NOT used for Reschedule/Cancel eligibility — those follow
// agencyReferralActions() + isAwaitingOutcome() instead, unchanged from what
// the agency side already does, so Dawson can still record a Saturday-morning
// cancellation instead of it silently becoming a no-show. This window is for
// the FIELD edits only.
//
// Same two-gate shape as agencyEditWindow, for the same reason:
//
//   1. Status gate, reusing EDITABLE_STATUSES rather than deciding a second
//      list. Needed because gate 2 alone would misread a closed record: a
//      Cancelled or Withdrawn referral's appointmentDate empties to null (see
//      the referral detail page's own note on that field), and with no date
//      to compute a cutoff from, gate 2 alone would call it editable forever.
//
//   2. No appointment date yet (Awaiting review, Approved-no-date) → editable,
//      same fallback agencyEditWindow uses — there is no Friday to have
//      passed, and these are exactly the states editing matters most in.
//
//      Reschedule gets the same treatment, and for the same reason
//      agencyEditWindow already exempts it: a Reschedule-status referral
//      DOES carry an appointmentDate, but it's the CURRENT slot — the one
//      about to be superseded, not "approved and scheduled, nothing left
//      to decide." Running the Friday math against that soon-to-be-replaced
//      date would lock the Edit button while Dawson is actively working out
//      a new one, exactly the wrong moment. Missed porting this the first
//      time; ported now to match the agency side's own established rule
//      rather than leave a second, divergent one.
export function dawsonEditWindow({
  portalStatus,
  appointmentDate,
  now = new Date(),
}: {
  portalStatus: string
  appointmentDate: string | null | undefined
  now?: Date
}): EditWindow {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(portalStatus)) {
    return { editable: false, reason: 'status', cutoffDate: null }
  }
  if (!appointmentDate || portalStatus === 'Reschedule') {
    return { editable: true, cutoffDate: null }
  }

  const todayISO = easternTodayISO(now)
  // Friday = the Saturday appointment minus one day.
  const cutoffDate = addDaysISO(appointmentDate, -1)
  const daysUntilCutoff = differenceInDaysISO(todayISO, cutoffDate)
  if (daysUntilCutoff === null) return { editable: true, cutoffDate }
  if (daysUntilCutoff > 0) return { editable: true, cutoffDate }
  if (daysUntilCutoff < 0) return { editable: false, reason: 'past-cutoff', cutoffDate }

  // daysUntilCutoff === 0: today IS the cutoff Friday. Editable until 5pm
  // Eastern, not all day — Ben's cutoff is a working-day boundary, not a
  // calendar one.
  return easternHour(now) < 17
    ? { editable: true, cutoffDate }
    : { editable: false, reason: 'past-cutoff', cutoffDate }
}
