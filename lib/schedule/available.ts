// lib/schedule/available.ts
//
// The shape of one row from GET /api/dawson/schedule/available — the Saturdays
// the internal card UIs offer (the Needs Action "Accept date" rows and the Add
// Referral form's over-cap echo). Lived in components/internal/modals/
// RescheduleModal.tsx until that modal was folded into PickSlotModal; the type
// outlived it, so it moved here.
//
// The picker MODALS no longer use this — PickSlotModal / SaturdayCapacityGrid
// fetch /api/dawson/schedule directly. This is only for code that reads the
// day-load numbers off the /available endpoint.

export type AvailableDate = {
  date: string
  slotsRemaining: number
  slots9am?: number
  slots10am?: number
  slots11am?: number
  slots12pm?: number
  slots1pm?: number
  // Day-level load from the availability endpoint, so a full Saturday can be
  // labelled rather than hidden.
  totalBooked?: number
  dayCapacity?: number
  isFull?: boolean
}
