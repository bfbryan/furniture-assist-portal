// app/api/dawson/referrals/[id]/review/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const { review } = await req.json()

  const validReviews = ['Pending', 'Approved', 'Rejected', 'Withdrawn']
  if (!validReviews.includes(review)) {
    return NextResponse.json({ error: 'Invalid review status' }, { status: 400 })
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { 'Referral Review': review } }),
    }
  )

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })
  return NextResponse.json({ success: true })
}
