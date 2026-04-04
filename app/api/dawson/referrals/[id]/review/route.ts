import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

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