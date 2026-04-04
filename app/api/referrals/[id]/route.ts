// app/api/referrals/[id]/route.ts

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAgencyUserByClerkId, getReferralById } from '@/lib/airtable'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) return NextResponse.json({ error: 'No agency linked' }, { status: 403 })

  const { id } = await params
  const referral = await getReferralById(id)

  if (!referral) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Staff can only view their own referrals
  if (agencyUser.role !== 'Admin' && referral.referredBy !== agencyUser.name) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Make sure referral belongs to this agency
  if (referral.referringAgency !== (await import('@/lib/airtable').then(m => m.getAgencyById(agencyUser.agencyId!))).name) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  return NextResponse.json(referral)
}
