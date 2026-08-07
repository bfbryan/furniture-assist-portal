// app/api/dawson/referrals/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getReferralById } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { QUANTITY_FIELDS, DISBURSED_TEXT_FIELDS, type DisbursedTextKey } from '@/lib/items-disbursed'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const referral = await getReferralById(id)
  return NextResponse.json(referral)
}

// PATCH — handles the per-visit editable fields on the referral row:
//   • Items Requested (multi-select — accepts string[] OR a comma-string
//     that we split for you)
//   • # in HH
//   • # Children
//   • Items Disbursed quantities + the four free-text companions
//   • Ready for Post-Appt Email (Dawson's manual audit-complete flag —
//     read by the future Tuesday batch send; does NOT itself mean the
//     email went out, that's a separate "Post-Appt Email Sent" field the
//     batch job will flip)
//
// Client identity fields (name / DOB / address / etc.) live on the Clients
// table and are lookups here, so those edits go through /api/dawson/clients/[id].
// Internal Notes has its own /notes route.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const fields: Record<string, unknown> = {}

  // Items Requested is a multi-select — Airtable rejects a comma-string.
  // Accept either shape from the client and normalize to string[].
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

  // # in HH and # Children on this base are Airtable Number fields with
  // precision = integer. Historical writes have shipped both `parseInt`d
  // numbers (submit route) and raw strings (create/import), and Airtable
  // accepts both for a Number column. Send an integer when we have one,
  // null to clear, and skip the field entirely for unparseable input
  // rather than sending a value that will 422 the whole PATCH.
  //
  // Empirical: sending an integer sometimes trips "cannot accept the
  // provided value" if the column was rebuilt as a formula/lookup or as
  // a text field with a rating widget. We coerceToNumberOrNull below and
  // let the caller see the AT error text verbatim (surfaced above).
  const coerceCount = (raw: unknown): number | null | undefined => {
    if (raw === '' || raw === null || raw === undefined) return null
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      const n = parseInt(trimmed, 10)
      if (!Number.isNaN(n)) return n
    }
    return undefined // signal: don't write this field
  }
  if ('hhSize' in body) {
    const v = coerceCount(body.hhSize)
    if (v !== undefined) fields['# in HH'] = v
  }
  if ('children' in body) {
    const v = coerceCount(body.children)
    if (v !== undefined) fields['# Children'] = v
  }

  // Ready for Post-Appt Email — a plain checkbox. Only accept a real
  // boolean; anything else is dropped so a malformed request can't
  // silently flip it via truthiness (e.g. the string "false").
  if ('readyForPostApptEmail' in body) {
    const v = body.readyForPostApptEmail
    if (typeof v === 'boolean') fields['Ready for Post-Appt Email'] = v
  }

  // ---------------------------------------------------------------------
  // Items Disbursed
  //
  // Payload shape:
  //   itemsDisbursed: {
  //     quantities: { 'LR Lamp': 2, 'BR Dresser': 0, ... },
  //     checkInTime?: string, checkoutTime?: string,
  //     otherItems?: string, distributionNotes?: string,
  //   }
  //
  // Only the 30 field names in QUANTITY_FIELDS are accepted. Anything else
  // is dropped silently rather than forwarded — an unknown key would 422 the
  // entire PATCH and take the valid edits down with it.
  //
  // A quantity of 0 is written as null, not 0. getReferralById() already
  // treats 0 and null identically (both mean "not given"), and null keeps the
  // Airtable grid readable — a wall of zeros is unusable for the volunteers
  // who still work in the base directly.
  // ---------------------------------------------------------------------
  if (body.itemsDisbursed && typeof body.itemsDisbursed === 'object') {
    const d = body.itemsDisbursed as Record<string, unknown>

    const quantities = d.quantities
    if (quantities && typeof quantities === 'object') {
      for (const [fieldName, raw] of Object.entries(quantities as Record<string, unknown>)) {
        if (!QUANTITY_FIELDS.has(fieldName)) continue
        const n = coerceCount(raw)
        if (n === undefined) continue
        fields[fieldName] = n === null || n <= 0 ? null : n
      }
    }

    for (const key of Object.keys(DISBURSED_TEXT_FIELDS) as DisbursedTextKey[]) {
      if (!(key in d)) continue
      const raw = d[key]
      const value = typeof raw === 'string' ? raw.trim() : ''
      fields[DISBURSED_TEXT_FIELDS[key]] = value === '' ? null : value
    }
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: 'No editable fields in payload' },
      { status: 400 },
    )
  }

  const doPatch = (payload: Record<string, unknown>) =>
    fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: payload }),
      },
    )

  let res = await doPatch(fields)

  // Fallback: if AT rejects the numeric HH/Children values with
  // INVALID_VALUE_FOR_COLUMN, the field is almost certainly configured
  // as text (rating/count widget on a text field) rather than a true
  // Number column. Retry once with string values so Ben's edits still
  // land while the schema question is resolved.
  if (!res.ok) {
    const errText = await res.text()
    const isHhOrChildrenType =
      errText.includes('INVALID_VALUE_FOR_COLUMN') &&
      (errText.includes('# in HH') || errText.includes('# Children'))
    if (isHhOrChildrenType) {
      const retry = { ...fields }
      if (typeof retry['# in HH'] === 'number')
        retry['# in HH'] = String(retry['# in HH'])
      if (typeof retry['# Children'] === 'number')
        retry['# Children'] = String(retry['# Children'])
      res = await doPatch(retry)
      if (!res.ok) {
        return NextResponse.json(
          { error: await res.text() },
          { status: 500 },
        )
      }
    } else {
      return NextResponse.json({ error: errText }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
