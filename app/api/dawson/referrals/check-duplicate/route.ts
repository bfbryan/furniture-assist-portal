// app/api/dawson/referrals/check-duplicate/route.ts
//
// POST /api/dawson/referrals/check-duplicate
//
// Called by the Add Referral form (app/dawson/referrals/new/page.tsx)
// BEFORE submit, to surface possible existing-Client matches and their
// recent appointment history so staff can confirm intent in a modal
// instead of silently creating a duplicate Client + Client Referrals
// record. See lib/referrals/match.ts for the matching/bucketing logic.
//
// Request body: { firstName, lastName, dob, phone }
//   dob expected as M/D/YYYY (same formatDOB() convention used elsewhere).
//
// Response: { matches: ClientMatch[] }
//   Each match includes the candidate Client and any 'completed' / 'no-show'
//   / 'cancelled' scenarios found within their respective windows
//   (Completed 12mo, No Show 6mo, Cancelled 12mo). The frontend renders the
//   modal from this directly -- no scenario means no modal is needed.

import { NextRequest, NextResponse } from 'next/server'
import { findClientMatches } from '@/lib/referrals/match'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function POST(req: NextRequest) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { firstName, lastName, dob, phone } = await req.json()

  if (!lastName) {
    return NextResponse.json({ error: 'Last name is required.' }, { status: 400 })
  }

  try {
    const matches = await findClientMatches({ firstName, lastName, dob, phone })
    return NextResponse.json({ matches })
  } catch (e: any) {
    console.error('check-duplicate failed:', e)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
