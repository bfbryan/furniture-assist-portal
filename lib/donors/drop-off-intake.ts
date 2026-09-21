// lib/donors/drop-off-intake.ts
//
// The one write this route makes: a single In Kind Donations record,
// shaped to be indistinguishable from what the Zap it replaces writes
// today. See the PR description for the field-by-field comparison this
// was built against (a live, recent Zap-written record).
//
// Deliberately NOT written here, matching the Zap's own observed
// behaviour and the boundary Ben drew for this phase:
//   - Donation Date — stamped by the existing Received automation.
//   - Donor ID, Zip Linked — resolved by existing automations after
//     create; setting either here would race or duplicate them.
//   - Ready to Send / Receipt Sent / No Show Email / LGL Created /
//     PDF Receipt / QR Image — all downstream of Received or the QR
//     send, neither of which this phase touches.
//   - Any item field at 0 — Airtable's number fields reject an empty
//     string without typecast (never used here, matching
//     lib/agencies/upsert.ts's own precedent), and every sampled
//     Zap-written record omits every unselected item entirely rather
//     than writing 0. Same behaviour here.

import { donorFetch } from './client'
import { DROP_OFF_ITEM_BY_KEY } from './drop-off-catalog'

export type DropOffContact = {
  firstName: string
  lastName: string
  email: string
  cellNumber: string | null
  streetAddress: string | null
  streetAddress2: string | null
  city: string | null
  state: string | null
  zip: string | null
  /** 'YYYY-MM-DD' — becomes Form Date, never Donation Date. */
  formDate: string
  notes: string | null
}

/** key -> quantity. Only positive entries matter; 0/negative/missing are
 *  the same as "didn't select this item." Every entry here is already
 *  cap-checked by the route before this function ever sees it — caps
 *  are hard, enforced as plain validation (see the route's own
 *  comments), not something this layer re-checks or works around. */
export type DropOffQuantities = Record<string, number>

export type CreateDropOffResult = { id: string }

export async function createDropOffDonation(
  contact: DropOffContact,
  quantities: DropOffQuantities,
): Promise<CreateDropOffResult> {
  const fields: Record<string, unknown> = {
    'First Name': contact.firstName,
    'Last Name': contact.lastName,
    // Primary Match Key = LOWER(TRIM(Email)) — confirmed live against the
    // formula itself, not inferred. An empty Email here doesn't fail the
    // write (it's a plain text field), but it does leave Primary Match
    // Key as "" — worth knowing if a submission is ever missing one; the
    // route requires it for exactly this reason, not just form courtesy.
    Email: contact.email,
    'Form Date': contact.formDate,
    // Exactly "Pending" — one of three real choices on this field
    // (Pending / Received / No Show). The pickup form's own current
    // page sends "Pending Review", which isn't a valid option; flagged
    // as a trap to avoid, not copied here.
    Status: 'Pending',
    'Manual or Automatic': ['Automatic'],
    'Pickup or Drop Off': 'Drop Off',
  }

  if (contact.cellNumber) fields['Cell Number'] = contact.cellNumber
  if (contact.streetAddress) fields['Street Address'] = contact.streetAddress
  if (contact.streetAddress2) fields['Street Address 2'] = contact.streetAddress2
  if (contact.city) fields.City = contact.city
  if (contact.state) fields.State = contact.state
  if (contact.zip) fields.Zip = contact.zip

  // Notes carries ONLY the donor's own text, verbatim — it prints as-is
  // on their tax receipt, so nothing else may write to it.
  if (contact.notes?.trim()) fields.Notes = contact.notes.trim()

  for (const [key, qty] of Object.entries(quantities)) {
    if (!(qty > 0)) continue
    const item = DROP_OFF_ITEM_BY_KEY[key]
    if (!item) continue
    fields[item.field] = Math.round(qty)
  }

  const data = await donorFetch('', { method: 'POST', body: { fields } })
  return { id: data.id }
}
