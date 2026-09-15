// lib/referrals/effective-date.ts
//
// The appointment date a terminal referral should be *filed under* — for the
// History page's month grouping, its within-month sort, and the Appointment
// column it prints.
//
// A cancelled referral has no live Appointment Date: lib/referrals/end-referral.ts
// clears the Saturday Schedule link on cancel, which empties that lookup, and
// (only when it actually released a booked slot — its `releasedSlot` gate)
// snapshots the date it had into Original Appointment Date. So the real date is
// in one of two places, or — for a cancel that released nothing — neither.
//
// Sep 2026, undated-terminal-referrals / consolidate-file-date: that "neither"
// case — cancelled or withdrawn before a slot was ever booked, so Effective
// Appointment Date itself coalesces two blank fields — is what
// isRequestStatus() / fileDateOf() below exist to handle, by falling back to
// Preferred Date. Fixed first on Dawson's referrals list (the one with an
// actual fetch-level exclusion bug: its server query bounds on Effective
// Appointment Date, which a blank-dated row can never match). This module is
// now the shared home those two functions were always meant to have —
// app/dawson/referrals/page.tsx, app/dawson/staff/[id]/page.tsx and
// app/dawson/agencies/[id]/page.tsx each carried their own copy, already
// diverged in small ways, and import from here instead.

export type WithAppointmentDates = {
  appointmentDate: string | null | undefined
  originalAppointmentDate?: string | null | undefined
}

/**
 * The live Appointment Date if the referral still has one, else the
 * Original Appointment Date snapshot, else null.
 */
export function effectiveAppointmentDate(r: WithAppointmentDates): string | null {
  return r.appointmentDate || r.originalAppointmentDate || null
}

// The shape fileDateOf/isRequestStatus need — NOT the same fields as
// WithAppointmentDates above. That type is the INPUT to
// effectiveAppointmentDate() (the raw Appointment Date / Original
// Appointment Date pair); this is a referral that already HAS its effective
// date computed (however that happened upstream — a server-side formula
// field in every current caller) plus the two fields needed to decide
// whether to trust it or fall back to what was asked for.
export type WithFileDate = {
  appointmentStatus: string
  preferredDate: string | null | undefined
  effectiveAppointmentDate: string | null | undefined
}

/**
 * Whether a referral holds no confirmed slot — an unscheduled request or a
 * pending reschedule — and so is filed by what was asked for (Preferred
 * Date) rather than an appointment date. A Reschedule row usually still has
 * a live effective date (its current, pre-reschedule appointment); it files
 * by Preferred Date anyway, on purpose — that is a name-based rule about
 * what Dawson needs to act on, not a fallback for missing data.
 */
export function isRequestStatus(appointmentStatus: string): boolean {
  return appointmentStatus === 'Reschedule' || appointmentStatus === 'Pending Schedule'
}

/**
 * The date a referral is filed, grouped and sorted under.
 *
 * A request-status row files under Preferred Date (falling back to the
 * effective date for the rare reschedule asked for with no specific
 * Saturday). Everything else files under the effective appointment date —
 * except when that's blank too: cancelled or withdrawn before the referral
 * was ever scheduled, which has nothing for Effective Appointment Date to
 * coalesce. That row falls back to Preferred Date as well, additively —
 * this branch is unreachable for any row that already has an effective
 * date, so nothing that already filed correctly moves.
 */
export function fileDateOf(r: WithFileDate): string | null {
  if (isRequestStatus(r.appointmentStatus)) {
    return r.preferredDate || r.effectiveAppointmentDate || null
  }
  return r.effectiveAppointmentDate || r.preferredDate || null
}
