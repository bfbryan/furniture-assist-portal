// app/api/dawson/referrals/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getReferralById } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

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
