// app/api/dawson/agencies/[id]/route.ts
// Returns full agency detail for Dawson's portal

import { NextRequest, NextResponse } from 'next/server'
import { getAgencyWithDetails } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const agency = await getAgencyWithDetails(id)
  return NextResponse.json(agency)
}
