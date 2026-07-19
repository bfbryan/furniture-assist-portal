// lib/status-labels.ts
// Polite display labels for agency-facing UI.
// Airtable and internal tooling keep the raw values ("No Show", etc.).
// Only the agency portal shows these politer versions.

export const AGENCY_STATUS_LABELS: Record<string, string> = {
  'Pending': 'Pending',
  'Scheduled': 'Scheduled',
  'Completed': 'Completed',
  'No Show': 'Missed appointment',
  'Cancelled': 'Cancelled',
}

/**
 * Convert a raw Airtable status value into the agency-facing display label.
 * Returns "—" if status is null/undefined.
 * Falls through to the raw value if no mapping exists.
 */
export function agencyStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return AGENCY_STATUS_LABELS[status] ?? status
}
