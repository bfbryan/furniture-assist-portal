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
import { getAgencyUserByClerkId, getReferralById } from '@/lib/airtable'

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

  // The referral belongs to the caller's agency — matched on the record id, not
  // the name. Agency Name is not unique (two offices of one organisation share
  // it by design), so the name comparison this used to do let an admin of one
  // office read and act on the other office's referrals. referringAgencyId is
  // the record id, chased through Referring Staff Link -> Agency Users ->
  // Agency by getReferralById — the same chain the name lookup used, so there
  // is no state where the name would be trustworthy and the id not.
  if (!referral.referringAgencyId) {
    // 472/472 referrals in the base are staff-linked, so this should never
    // fire. A null id means a malformed record with no staff link — deny
    // rather than fall back to a name match, which is exactly where the name
    // collision would reopen, on the records least likely to be watched.
    console.error(
      `[agency-referral-access] referral ${referralId} has no referringAgencyId ` +
        `(missing Referring Staff Link?) — denying access`,
    )
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }
  if (referral.referringAgencyId !== agencyUser.agencyId) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  // The referring staff member's membership must be CONFIRMED by an agency
  // admin. This is the detail-route half of the same gate the list reads
  // apply in their query formula (getReferralsByAgencyId /
  // getReferralsByStaffName). referringStaffMembership is the {Referring
  // Staff Membership} lookup off the referral getReferralById already
  // fetched — no extra staff-row read. Blank (the unconfirmed default) and
  // 'Not At This Office' both fail this, so a referral becomes reachable
  // here only once someone at the agency has vouched for the person who
  // made it.
  if (referral.referringStaffMembership !== 'Confirmed') {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { referral, agencyUser }
}
