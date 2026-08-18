// app/api/dawson/referrals/[id]/cancel/route.ts
//
// POST /api/dawson/referrals/:id/cancel
//
// Cancels a referral from the internal portal.
//
// The work itself — releasing the Saturday slot, snapshotting the previous
// appointment into the Original fields, and firing the Cancellation Notice —
// now lives in lib/referrals/end-referral.ts, because the two agency-facing
// ending routes have to do exactly the same thing and previously did not.
// This file is the HTTP shell: authorize, call, map the result. The response
// shape is unchanged apart from an added `releasedSlot`, which is the same
// boolean this route used to return as `snapshottedOriginal` (still returned,
// under its old name, so nothing reading it breaks).
//
// The comment this file used to carry — that the Airtable "Cancellation"
// automation stayed on as a safety net for agency-portal cancellations until
// that path was ported — described something that was not running. Ben's
// automations are off while this work moves into code. The agency path is now
// ported, which is what actually makes it true.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { endReferral } from '@/lib/referrals/end-referral'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params

  const result = await endReferral({ referralId: id, outcome: 'cancelled', notify: true })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    releasedSlot: result.releasedSlot,
    // Kept under its original name for the two pages that read it.
    snapshottedOriginal: result.releasedSlot,
    cancellationNotice: result.cancellationNotice,
  })
}
