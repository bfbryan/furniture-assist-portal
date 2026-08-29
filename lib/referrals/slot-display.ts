// lib/referrals/slot-display.ts
//
// One-line rendering of an appointment slot / a requested slot, shared by the
// referral detail page's RequestedRows and the Active referrals list so the
// two phrase them identically ("Sep 26, 2026 at 10am", "Any Saturday",
// "No date requested").
//
// `formatDate` is injected — each surface owns its own date formatter, and
// they happen to agree ("Mon D, YYYY"), but this module does not need to.

import type { RequestedSlot } from './requested-slot'

/** A booked slot: "Sep 26, 2026 at 10am", just the date if no time, "—" if no date. */
export function formatSlot(
  dateIso: string | null | undefined,
  time: string | null | undefined,
  formatDate: (iso: string) => string,
): string {
  if (!dateIso) return '—'
  return time ? `${formatDate(dateIso)} at ${time}` : formatDate(dateIso)
}

/**
 * A reschedule request: the specific slot the agency asked for, or one of the
 * two non-date cases requestedSlot() defines.
 */
export function formatRequestedSlot(
  slot: RequestedSlot,
  formatDate: (iso: string) => string,
): string {
  if (slot.kind === 'flexible') return 'Any Saturday'
  if (slot.kind === 'unknown') return 'No date requested'
  return formatSlot(slot.date, slot.time, formatDate)
}
