// lib/referrals/reschedule-request.ts
//
// The field bag a reschedule REQUEST writes onto an existing referral.
//
// A request is the agency-facing "I want a different date" — it flips
// Appointment Status to 'Reschedule', which parks the record in Dawson's
// Needs Action "Reschedule requested" card, and records what was asked for.
// It does NOT move the appointment: the client keeps the slot they hold until
// Dawson accepts the date or picks another. That booking lives in
// lib/referrals/reschedule.ts (rescheduleReferral) and is a different thing.
//
// Shared so its two writers cannot drift — the same reason rescheduleReferral
// itself is shared:
//   • POST /api/referrals/[id]/reschedule   — the standalone request from the
//     agency detail page.
//   • POST /api/referrals/submit (convert branch) — the agency New Referral
//     form turning a no-show / active appointment into a request in one step,
//     alongside any edited client details.
//
// Referral Review is deliberately NOT in this bag: a reschedule request leaves
// the referral 'Approved'. The Needs Action card filters on Appointment Status
// = 'Reschedule', so there is nothing to flip.

import { VALID_TIMES } from '@/lib/schedule/capacity'

export type RescheduleRequestInput = {
  /** 'YYYY-MM-DD'. Must be a Saturday — the caller validates that. */
  preferredDate: string
  /** One of the five slot strings, or blank/undefined to let Dawson allocate. */
  preferredTime?: string | null
  /** Agencies never send this today (no flexible option), but the standalone
   *  route supports it, so it stays a parameter. */
  flexible?: boolean
}

export function buildRescheduleRequestFields(
  input: RescheduleRequestInput,
): Record<string, unknown> {
  const isFlexible = input.flexible === true
  const hasTime =
    !isFlexible &&
    typeof input.preferredTime === 'string' &&
    VALID_TIMES.has(input.preferredTime)

  return {
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    // This alone is what the Needs Action "Reschedule requested" card keys on.
    'Appointment Status': 'Reschedule',
    // Request age, for that card. Also stamped by the OCR no-usable-date branch
    // (lib/scanning/ocr.ts) — the only other writer of status 'Reschedule'.
    'Reschedule Requested At': new Date().toISOString(),
    // Cleared rather than left alone so a stale preference from an earlier
    // request can't be read as this one's.
    'Preferred Date': isFlexible ? null : input.preferredDate,
    'Preferred Time': isFlexible ? null : hasTime ? input.preferredTime : null,
  }
}
