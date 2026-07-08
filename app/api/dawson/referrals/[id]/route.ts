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

// PATCH — currently only handles Items Requested on the referral row.
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
  const body = await req.json().catch(() => ({}))
  const { items } = body as { items?: string }

  if (typeof items !== 'string') {
    return NextResponse.json(
      { error: 'Expected { items: string } in body' },
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
      body: JSON.stringify({ fields: { 'Items Requested': items } }),
    },
  )

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
