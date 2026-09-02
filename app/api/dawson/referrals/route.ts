// app/api/dawson/referrals/route.ts
// Returns filtered referrals for Dawson's portal (Scheduled, Pending, etc.)

import { NextRequest, NextResponse } from 'next/server'
import { getAllReferrals } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function GET(req: NextRequest) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const review = searchParams.get('review') ?? undefined
  const statuses = searchParams.getAll('status')
  const appointmentDateFrom =
    searchParams.get('appointmentDateFrom')
    ?? searchParams.get('dateFrom')
    ?? undefined
  const appointmentDateTo = searchParams.get('appointmentDateTo') ?? undefined
  const agency = searchParams.get('agency') ?? undefined
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined

  const referrals = await getAllReferrals({
    review,
    statuses: statuses.length > 0 ? statuses : undefined,
    appointmentDateFrom,
    appointmentDateTo,
    agency,
    limit,
  })

  return NextResponse.json(referrals)
}
