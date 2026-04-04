import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAllReferrals } from '@/lib/airtable'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const review = searchParams.get('review') ?? undefined
  const statuses = searchParams.getAll('status')
  const dateFrom = searchParams.get('dateFrom') ?? undefined

  const referrals = await getAllReferrals({
    review,
    statuses: statuses.length > 0 ? statuses : undefined,
    dateFrom,
  })

  return NextResponse.json(referrals)
}