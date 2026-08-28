// app/api/referrals/[id]/route.ts
//
// Agency-facing referral read + edit.
//
// GET   — the referral, scoped to the caller's agency (and to the caller
//         personally when they are not an agency admin).
// PATCH — the fields an agency user owns on their own referral:
//           • client identity (name / DOB / phone / language / address)
//           • per-visit household counts
//           • Items Requested
//           • External Notes ("Your Notes" in the portal)
//
// Identity fields live on the Clients table and reach this referral as
// lookups, exactly as on the Dawson side, so those go out as a second write
// through updateClient(). Both writes are gated by one authorization check and
// one edit-window check, which is the reason this is a single endpoint rather
// than an agency clone of /api/dawson/clients/[id].
//
// The edit window is enforced HERE, not just in the page. The page hides its
// Edit buttons using the same helper, but a hidden button is not a closed door.

import { NextRequest, NextResponse } from 'next/server'
import { updateClient } from '@/lib/airtable'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'
import { agencyEditWindow, agencyNotesEditable, getPortalStatus } from '@/lib/referrals/edit-window'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

// Payload key → Airtable field on the Clients table. Mirrors FIELD_MAP in
// app/api/dawson/clients/[id]/route.ts; the two tables of truth are the same
// table, so these must stay identical.
const CLIENT_FIELD_MAP: Record<string, string> = {
  firstName: 'First Name',
  lastName:  'Last Name',
  dob:       'DOB',              // stored as MDY text on Clients
  phone:     'Phone',
  language:  'Preferred Language',
  address:   'Address',
  address2:  'Address 2',
  city:      'City',
  state:     'State',
  zip:       'Zip',
  county:    'County',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await requireAgencyReferralAccess(id)
  if (access.denied) return access.denied

  return NextResponse.json(access.referral)
}

// Same integer coercion the Dawson referral PATCH uses: write an int when we
// have one, null to clear, and skip the field entirely for unparseable input
// rather than sending a value that 422s the whole request.
function coerceCount(raw: unknown): number | null | undefined {
  if (raw === '' || raw === null || raw === undefined) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    const n = parseInt(trimmed, 10)
    if (!Number.isNaN(n)) return n
  }
  return undefined
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await requireAgencyReferralAccess(id)
  if (access.denied) return access.denied

  const { referral } = access

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  // "Your Notes" (External Notes) has a laxer rule than everything else: no
  // warehouse pick list rides on a note, so it edits until the referral reaches
  // a terminal state, with no Monday cutoff — see agencyNotesEditable(). Every
  // other field stays on agencyEditWindow (portal status + Monday cutoff). A
  // payload touching both is held to the stricter agencyEditWindow; the portal
  // never sends a mixed one (each card saves on its own).
  const touchesOther =
    'items' in body || 'hhSize' in body || 'children' in body ||
    !!(body.client && typeof body.client === 'object')
  const notesOnly = 'externalNotes' in body && !touchesOther

  if (notesOnly) {
    if (!agencyNotesEditable(referral.referralReview, referral.appointmentStatus)) {
      return NextResponse.json(
        { error: 'This referral can no longer be edited.', reason: 'status', cutoffDate: null },
        { status: 409 },
      )
    }
  } else {
    const window = agencyEditWindow({
      portalStatus: getPortalStatus(referral.referralReview, referral.appointmentStatus),
      appointmentDate: referral.appointmentDate,
    })

    if (!window.editable) {
      return NextResponse.json(
        {
          error:
            window.reason === 'status'
              ? 'This referral can no longer be edited.'
              : 'Editing closed on the Monday before the appointment. Contact Furniture Assist to make a change.',
          reason: window.reason,
          cutoffDate: window.cutoffDate,
        },
        { status: 409 },
      )
    }
  }

  // ---- Fields on the Client Referrals row itself.
  const fields: Record<string, unknown> = {}

  // Items Requested is a multi-select — Airtable rejects a comma-string.
  // Accept either shape and normalize, same as the Dawson route.
  if ('items' in body) {
    const raw = body.items
    let arr: string[] = []
    if (Array.isArray(raw)) {
      arr = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    } else if (typeof raw === 'string') {
      arr = raw.split(',').map(s => s.trim()).filter(Boolean)
    }
    fields['Items Requested'] = arr
  }

  if ('hhSize' in body) {
    const v = coerceCount(body.hhSize)
    if (v !== undefined) fields['# in HH'] = v
  }
  if ('children' in body) {
    const v = coerceCount(body.children)
    if (v !== undefined) fields['# Children'] = v
  }

  // "Your Notes" on the agency portal. Internal Notes is deliberately absent —
  // that field is Furniture Assist's, and an agency user must not be able to
  // write to it.
  if ('externalNotes' in body) {
    const raw = body.externalNotes
    const value = typeof raw === 'string' ? raw.trim() : ''
    fields['External Notes'] = value === '' ? null : value
  }

  // ---- Identity fields, which live on Clients.
  const clientFields: Record<string, unknown> = {}
  const client = body.client
  if (client && typeof client === 'object') {
    for (const [key, airtableField] of Object.entries(CLIENT_FIELD_MAP)) {
      const val = (client as Record<string, unknown>)[key]
      // Only strings; empty string is valid and clears the cell.
      if (typeof val === 'string') clientFields[airtableField] = val
    }
  }

  const hasReferralWrite = Object.keys(fields).length > 0
  const hasClientWrite = Object.keys(clientFields).length > 0

  if (!hasReferralWrite && !hasClientWrite) {
    return NextResponse.json({ error: 'No editable fields in payload' }, { status: 400 })
  }

  if (hasClientWrite && !referral.clientId) {
    return NextResponse.json(
      { error: 'This referral has no linked client record to update.' },
      { status: 409 },
    )
  }

  try {
    if (hasClientWrite) {
      await updateClient(referral.clientId!, clientFields)
    }

    if (hasReferralWrite) {
      const res = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields, typecast: true }),
        },
      )
      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: err }, { status: 500 })
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
