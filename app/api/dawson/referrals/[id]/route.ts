// app/api/dawson/referrals/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getReferralById } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

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
  // as a Single Line Text (or similar) on this base. Retry once with
  // string values so the edit still lands.
  if (!res.ok) {
    const errText = await res.clone().text()
    const isHhOrChildrenType =
      errText.includes('INVALID_VALUE_FOR_COLUMN') &&
      (errText.includes('# in HH') || errText.includes('# Children'))
    if (isHhOrChildrenType) {
      const retry: Record<string, unknown> = { ...fields }
      if (typeof retry['# in HH'] === 'number')
        retry['# in HH'] = String(retry['# in HH'])
      if (typeof retry['# Children'] === 'number')
        retry['# Children'] = String(retry['# Children'])
      res = await doPatch(retry)
    }
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}