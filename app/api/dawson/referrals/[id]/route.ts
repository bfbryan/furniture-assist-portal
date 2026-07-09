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

  if ('hhSize' in body && typeof body.hhSize === 'string') {
    fields['# in HH'] = body.hhSize
  }
  if ('children' in body && typeof body.children === 'string') {
    fields['# Children'] = body.children
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: 'No editable fields in payload' },
      { status: 400 },
    )
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    },
  )

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
