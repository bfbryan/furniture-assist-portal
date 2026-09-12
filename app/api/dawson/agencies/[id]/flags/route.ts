// app/api/dawson/agencies/[id]/flags/route.ts
//
// PATCH — Reconciled / Live Referrals, the two checkboxes on the agency
// detail page's actions bar. Neither had a write path before this route:
// Reconciled was only ever ticked by hand in Airtable; Live Referrals is
// unused everywhere else in the codebase.
//
// Live Referrals in particular: this writes the field faithfully, but no
// referral-visibility read (getReferralsByAgencyId, getAllReferrals, etc.)
// checks it yet. Ticking it here records a fact and changes nothing else —
// see the agency-detail-rebuild PR notes.

import { NextRequest, NextResponse } from 'next/server'
import { updateAgencyFlags } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { reconciled, liveReferrals } = body as { reconciled?: boolean; liveReferrals?: boolean }

  if (reconciled === undefined && liveReferrals === undefined) {
    return NextResponse.json({ error: 'No change specified' }, { status: 400 })
  }

  await updateAgencyFlags(id, { reconciled, liveReferrals })
  return NextResponse.json({ ok: true })
}
