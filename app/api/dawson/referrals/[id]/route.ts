// app/api/dawson/referrals/[id]/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getReferralById } from '@/lib/airtable'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { id } = await params
  const referral = await getReferralById(id)
  return NextResponse.json(referral)
}
