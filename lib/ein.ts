// lib/ein.ts
//
// A US Employer Identification Number is exactly nine digits, written as two,
// a hyphen, then seven: 12-3456789. Not ten digits, not a variable split — the
// leading pair is an IRS campus prefix and the shape is fixed.
//
// This was already implemented, correctly, inside the agency claim form, and
// the agency Profile page's EIN box had nothing at all: it was a free-text
// input whose only nod to the format was a placeholder. So the same agency
// could type "22-1487327" while claiming and "221487327 ext" on their profile
// a week later, into the same Airtable field (EIN#, a single-line text field —
// Airtable does no validation of its own here).
//
// Lifted out of app/agency/claim/[token]/page.tsx unchanged rather than
// reimplemented, so the two surfaces cannot drift.

/**
 * Format EIN input as it is typed: digits only, capped at nine, hyphen after
 * the second.
 *
 * Cosmetic and forgiving by design — it never rejects, it only shapes, so a
 * half-typed value is left alone rather than fought with. Pasting
 * "22-1487327", "221487327" or "22 148 7327" all land on "22-1487327".
 */
export function formatEIN(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

/** Nine digits present. An empty EIN is allowed — the field is optional. */
export function isCompleteEIN(value: string | null | undefined): boolean {
  return String(value ?? '').replace(/\D/g, '').length === 9
}
