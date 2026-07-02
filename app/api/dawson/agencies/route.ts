// app/api/dawson/agencies/route.ts
// Returns all agencies for Dawson's portal

import { NextRequest, NextResponse } from 'next/server'
import { getAllAgencies } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function GET(req: NextRequest) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? undefined
  const agencies = await getAllAgencies(status)
  return NextResponse.json(agencies)
}
