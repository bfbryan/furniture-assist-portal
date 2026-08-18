// lib/referrals/requested-slot.ts
//
// What an agency ASKED for on a reschedule, as opposed to what is currently
// booked. Read from 'Preferred Date' / 'Preferred Time' / 'Scheduling
// Flexibility' on Client Referrals (verified against the live base schema:
// Preferred Date is a date field, Preferred Time and Scheduling Flexibility
// are single-selects, the latter with options 'Specific Date' and 'Flexible').
//
// Shared because two agency surfaces render it — the Reschedule Requested
// section of the referral list and the Appointment card on the referral detail
// page — and both were previously showing an em dash there, because both only
// filled that row when the referral was 'Scheduled'.
//
// This is reschedule-only by design. An agency-submitted NEW referral never
// gets a Preferred Date written at all (app/api/referrals/submit/route.ts does
// not set one), so there is nothing to show on those and callers should not
// ask.

export type RequestedSlot =
  /** A specific Saturday was asked for. `time` is null when any hour will do. */
  | { kind: 'date'; date: string; time: string | null }
  /** "Any Saturday" — the agency ticked flexible, so both fields are empty. */
  | { kind: 'flexible' }
  /** Nothing was recorded. See the note below — this is a real state. */
  | { kind: 'unknown' }

/**
 * Classify the reschedule request on a referral.
 *
 * The three states that occur through the portal's own reschedule dialog are
 * `date` with a time, `date` without one, and `flexible`.
 *
 * `unknown` is the fourth, and it is not defensive padding: a scanned
 * reschedule whose handwritten date could not be used lands at Appointment
 * Status = 'Reschedule' with no Preferred Date on purpose
 * (lib/scanning/ocr.ts), and getPortalStatus maps that to 'Reschedule' too, so
 * it reaches these same agency surfaces. Those records must not claim the
 * agency asked for "any Saturday" when it asked for a date we could not read.
 */
export function requestedSlot(referral: {
  preferredDate?: string | null
  preferredTime?: string | null
  schedulingFlexibility?: string | null
}): RequestedSlot {
  if (referral.preferredDate) {
    return {
      kind: 'date',
      date: referral.preferredDate,
      time: referral.preferredTime || null,
    }
  }
  if (referral.schedulingFlexibility === 'Flexible') return { kind: 'flexible' }
  return { kind: 'unknown' }
}
