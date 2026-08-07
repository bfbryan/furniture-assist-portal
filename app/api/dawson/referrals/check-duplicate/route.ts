// app/api/dawson/referrals/check-duplicate/route.ts
//
// POST /api/dawson/referrals/check-duplicate
//
// Called by the Add Referral form (app/dawson/referrals/new/page.tsx)
// BEFORE submit, to surface possible existing-Client matches and their
// recent appointment history so staff can confirm intent in a modal
// instead of silently creating a duplicate Client + Client Referrals
// record. See lib/client-match.ts for the matching/bucketing logic.
//
// Request body: { firstName, lastName, dob, phone }
//   dob expected as M/D/YYYY (same formatDOB() convention used elsewhere).
//
// Response: { matches: ClientMatch[] }
//   Each match includes the candidate Client and any 'completed' / 'no-show'
//   / 'cancelled' scenarios found within their respective windows
//   (Completed 12mo, No Show 6mo, Cancelled 12mo). The frontend renders the
//   modal from this directly -- no scenario means no modal is needed.

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { findClientMatches } from '@/lib/client-match'

const ALLOWED_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', // Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM', // Ray
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg', // Dawson
  'user_3DE1gUnIeNmWZpQyd7LjdZb9vnN', // Chase
]

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

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
