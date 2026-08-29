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
// The same gap exists on Dawson's history list: getAllReferrals() filters on
// {Appointment Date}, so cancelled and withdrawn referrals fall out of every
// date-bounded range and only show under "All time". That is not fixed here,
// but when it is, this is the helper it should read from.

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
