// app/api/dawson/needs-action/count/route.ts
//
// GET /api/dawson/needs-action/count  — DAWSON-ONLY.
//
// Feeds the nav badge. The four queue counts live in
// lib/dawson/needs-action-counts.ts so the badge, the Needs Action page and
// the dashboard's review stat cards can't disagree. (Card 5, flagged
// duplicates, has no data source yet and is excluded from the total.)
//
// Its own endpoint rather than in app/dawson/layout.tsx because that layout
// wraps every /dawson/* page and must not do these reads on every navigation
// — the badge fetches this once on mount and on focus instead.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { getNeedsActionCounts } from '@/lib/dawson/needs-action-counts'

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const counts = await getNeedsActionCounts()

  return NextResponse.json({
    ...counts,
    total:
      counts.reschedule + counts.newReferrals + counts.awaitingOutcome + counts.agencies,
  })
}
