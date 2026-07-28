// app/api/dawson/schedule/route.ts
//
// GET /api/dawson/schedule
//
// Returns the Saturday Schedule table for the Dawson internal admin views.


import { NextResponse } from 'next/server'
import { getSaturdaySchedule } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'


export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied


  const schedule = await getSaturdaySchedule()
  return NextResponse.json(schedule)
}
