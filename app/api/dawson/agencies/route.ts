// app/api/dawson/agencies/route.ts
// Returns all agencies for Dawson's portal

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAllAgencies } from '@/lib/airtable'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? undefined
  const agencies = await getAllAgencies(status)
  return NextResponse.json(agencies)
}
