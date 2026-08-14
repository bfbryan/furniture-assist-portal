// lib/auth/agency-referral-access.ts
//
// Ownership guard for the agency-facing /api/referrals/[id]/* handlers.
//
// GET /api/referrals/[id] already did these three checks inline. The action
// routes next to it (cancel, reschedule, withdraw) only checked that SOMEONE
// was signed in, so any authenticated agency user could act on any referral in
// the base by guessing or reading an ID — including referrals belonging to a
// different agency. Wiring buttons to those routes from the detail page made
// that reachable in one click, so the check moved here and all four routes now
// share it.
//
// The rules, unchanged from what GET enforced:
//   1. Signed in.
//   2. The Clerk user maps to an Agency Users row.
//   3. Non-admins only reach referrals they personally submitted, which is the
//      same rule ReferralTable and the dashboard scope their lists by.
//   4. The referral belongs to the caller's agency.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getAgencyUserByClerkId, getAgencyById, getReferralById } from '@/lib/airtable'

type Referral = Awaited<ReturnType<typeof getReferralById>>

export type AgencyReferralAccess =
  | { denied: NextResponse; referral?: undefined; agencyUser?: undefined }
  | {
      denied?: undefined
      referral: NonNullable<Referral>
      agencyUser: NonNullable<Awaited<ReturnType<typeof getAgencyUserByClerkId>>>
    }

/**
 * Resolve and authorize a referral for the signed-in agency user.
 *
 * Returns either `{ denied }` — which the handler should return immediately —
 * or the loaded referral plus the agency user, so callers do not pay for a
 * second fetch.
 */
export async function requireAgencyReferralAccess(
  referralId: string,
): Promise<AgencyReferralAccess> {
  const { userId } = await auth()
  if (!userId) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) {
    return { denied: NextResponse.json({ error: 'No agency linked' }, { status: 403 }) }
  }

  const referral = await getReferralById(referralId)
  if (!referral) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  // Staff see only their own referrals; admins see the whole agency.
  if (agencyUser.role !== 'Admin' && referral.referredBy !== agencyUser.name) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const agency = await getAgencyById(agencyUser.agencyId!)
  if (referral.referringAgency !== agency.name) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { referral, agencyUser }
}
