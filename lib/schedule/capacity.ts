// lib/schedule/capacity.ts
//
// THE per-hour pickup capacities. One definition, imported everywhere.
//
// These five numbers used to be copied into five files — the Saturday
// schedule page, the Add Referral form, the reschedule modal, the referral
// submit route and lib/referrals/reschedule.ts — each carrying a comment
// telling the reader to keep it in step with the others by hand. This module
// is that comment made mechanical.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ THERE IS A SIXTH COPY THIS REPO CANNOT REACH.                        │
// │                                                                      │
// │ `at-auto-schedule-script.js` is an Airtable automation script that   │
// │ Ben maintains inside the Airtable base, not in this repository. It   │
// │ carries its own TIME_CAPS with the same five numbers and it runs the │
// │ auto-scheduler for new agency submissions.                           │
// │                                                                      │
// │ Changing a capacity here does NOT change it there. Any edit to       │
// │ TIME_CAPS below has to be mirrored into that script by hand, or the  │
// │ auto-scheduler and the portal will disagree about when an hour is    │
// │ full.                                                                │
// └──────────────────────────────────────────────────────────────────────┘

export type TimeSlot = '9am' | '10am' | '11am' | '12pm' | '1pm'

/** Fill order used whenever a slot has to be chosen automatically. */
export const TIME_ORDER: TimeSlot[] = ['9am', '10am', '11am', '12pm', '1pm']

/** Membership test for untrusted input (form bodies, OCR output). */
export const VALID_TIMES: ReadonlySet<string> = new Set<string>(TIME_ORDER)

/**
 * How many appointments each hour holds.
 *
 * Enforced for agencies and for automatic allocation. Dawson can book past
 * an hour's cap deliberately — that override already exists and is not
 * governed here.
 */
export const TIME_CAPS: Record<TimeSlot, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}

/**
 * Appointments a Saturday holds in total: the ceiling an AGENCY is held to
 * when it picks its own date.
 *
 * The authoritative check is Airtable's own `Slots Remaining` field on
 * Saturday Schedule, which the agency availability endpoint filters on. This
 * constant exists so the Dawson-facing UI can render "34 of 50 booked" —
 * display only, never a gate.
 *
 * Dawson is deliberately NOT capped, here or anywhere: he is the human
 * scheduler and routinely lands past 50. Do not turn this into a limit for
 * him, and do not add a second, higher ceiling — that was asked and declined.
 */
export const DAY_CAPACITY = 50

/** Per-slot booked counts as the schedule endpoints return them. */
export interface SlotCounts {
  slots9am: number
  slots10am: number
  slots11am: number
  slots12pm: number
  slots1pm: number
}

/**
 * Appointments booked on a Saturday, summed from the five hours.
 *
 * Summed rather than derived from `Slots Remaining` because that field stops
 * being a reliable measure of load once a day is past its cap — which is
 * exactly the case this is needed for.
 */
export function totalBooked(s: SlotCounts): number {
  return s.slots9am + s.slots10am + s.slots11am + s.slots12pm + s.slots1pm
}

/**
 * How full a Saturday is, for Dawson's date pickers — "34/50 booked", or
 * "52/50 booked · FULL" once it is at or past capacity.
 *
 * Full Saturdays stay selectable for him; this is what stops that being a
 * blind choice. Deliberately the same booked/capacity shape the per-hour
 * pills already use, so the date list and the time list read alike.
 */
export function describeDayLoad(booked: number, capacity: number = DAY_CAPACITY): string {
  const base = `${booked}/${capacity} booked`
  return booked >= capacity ? `${base} · FULL` : base
}
