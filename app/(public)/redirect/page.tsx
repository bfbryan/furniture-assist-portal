// app/redirect/page.tsx
//
// Every sign-in lands here (Clerk's after-sign-in URL). Besides routing the
// person to the right portal, this is where a magic-link invite becomes a
// claimed account: an Invited user's first sign-in flips them to Active,
// stamps their Claimed Date, and — when they are the agency's Primary Admin —
// cascades the agency itself to Approved with its own Claimed Date. The
// Airtable automation that used to write those stamps is switched off; this
// code owns them now.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  stampFirstLogin,
  updateAgencyUserStatus,
} from '@/lib/airtable'
import { isDawsonPortalUser } from '@/lib/auth/dawson-access'

export default async function RedirectPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Dawson users go straight to /dawson
  if (isDawsonPortalUser(userId)) {
    redirect('/dawson')
  }

  const agencyUser = await getAgencyUserByClerkId(userId)

  // First sign-in after an invite ('Invited'), or a legacy pre-invite-flow
  // account ('Pending'): write the claim stamps, then activate the user.
  // stampFirstLogin no-ops when Claimed Date is already set, so a normal
  // repeat sign-in does nothing here.
  //
  // ORDER MATTERS. Status is what this block is guarded on, so flipping it to
  // 'Active' first destroys the guard before the work it protects has run. If
  // any of stampFirstLogin's up-to-three Airtable calls then failed — a 429
  // against a base shared with Dawson's portal and the enabled crons, or the
  // person closing the tab — the row was already Active, this branch never
  // ran again on any later sign-in, and stampFirstLogin's own
  // `if (claimedDate) return` kept it a no-op forever. The agency stayed
  // 'Invited' permanently: never Approved, still on Dawson's unclaimed list,
  // and unfixable from the portal, since the status endpoint only accepts
  // Pending/Approved/Rejected/Inactive. Only a hand edit in Airtable cleared
  // it.
  //
  // Stamping first means a failure leaves Status alone and the next sign-in
  // simply retries the whole block.
  if (agencyUser && (agencyUser.status === 'Invited' || agencyUser.status === 'Pending')) {
    await stampFirstLogin(agencyUser)
    await updateAgencyUserStatus(agencyUser.id, 'Active')
  }

  redirect('/dashboard')
}
