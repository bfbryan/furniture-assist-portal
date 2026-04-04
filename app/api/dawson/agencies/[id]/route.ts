// app/api/dawson/agencies/[id]/route.ts
// Returns full agency detail for Dawson's portal

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAgencyWithDetails } from '@/lib/airtable'

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
  const agency = await getAgencyWithDetails(id)
  return NextResponse.json(agency)
}
