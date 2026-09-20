// app/api/donor-checkin/today/route.ts
//
// GET — today's live check-in list for the desk view. Polled, not pushed;
// the volume (a few dozen a week) doesn't justify anything heavier, and
// nothing in this codebase does real-time push today.

import { NextResponse } from 'next/server'
import { requireDonorCheckinAccess } from '@/lib/auth/donor-checkin-access'
import { easternTodayISO } from '@/lib/dates'
import { getTodaysCheckins } from '@/lib/donors/in-kind-donations'

export async function GET() {
  const denied = await requireDonorCheckinAccess()
  if (denied) return denied

  const entries = await getTodaysCheckins(easternTodayISO())
  return NextResponse.json({ entries })
}
