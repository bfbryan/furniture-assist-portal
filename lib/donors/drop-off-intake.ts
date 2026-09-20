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
 *  the same as "didn't select this item." */
export type DropOffQuantities = Record<string, number>

export type CapOverage = { key: string; label: string; field: string; qty: number; cap: number }

/** Advisory only — see drop-off-catalog.ts's header. Never blocks a
 *  submission; the route decides what to do with the result. */
export function checkCaps(quantities: DropOffQuantities): CapOverage[] {
  const overages: CapOverage[] = []
  for (const [key, qty] of Object.entries(quantities)) {
    if (!(qty > 0)) continue
    const item = DROP_OFF_ITEM_BY_KEY[key]
    if (!item) continue // unknown keys are the route's problem, not this function's
    if (qty > item.cap) {
      overages.push({ key, label: item.label, field: item.field, qty, cap: item.cap })
    }
  }
  return overages
}

// The flag goes into Notes — see the PR description for why: it's the
// only existing free-text field on this record (no new Airtable field
// introduced), already carries the donor's own optional description, so
// this appends rather than overwrites, clearly marked so it reads as a
// system note and not something the donor typed.
function formatOverCapNote(overages: CapOverage[]): string | null {
  if (overages.length === 0) return null
  const lines = overages.map(o => `${o.label}: ${o.qty} (cap ${o.cap})`)
  return `⚠ Over cap — ${lines.join('; ')}`
}

function buildNotes(donorNotes: string | null, overages: CapOverage[]): string | null {
  const flag = formatOverCapNote(overages)
  const parts = [donorNotes?.trim() || null, flag].filter((s): s is string => !!s)
  return parts.length ? parts.join('\n\n') : null
}

export type CreateDropOffResult = { id: string; overCap: boolean }

export async function createDropOffDonation(
  contact: DropOffContact,
  quantities: DropOffQuantities,
): Promise<CreateDropOffResult> {
  const overages = checkCaps(quantities)

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

  const notes = buildNotes(contact.notes, overages)
  if (notes) fields.Notes = notes

  for (const [key, qty] of Object.entries(quantities)) {
    if (!(qty > 0)) continue
    const item = DROP_OFF_ITEM_BY_KEY[key]
    if (!item) continue
    fields[item.field] = Math.round(qty)
  }

  const data = await donorFetch('', { method: 'POST', body: { fields } })
  return { id: data.id, overCap: overages.length > 0 }
}
