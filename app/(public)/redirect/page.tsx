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
  // account ('Pending'): activate the user and write the claim stamps.
  // stampFirstLogin no-ops when Claimed Date is already set, so a normal
  // repeat sign-in does nothing here.
  if (agencyUser && (agencyUser.status === 'Invited' || agencyUser.status === 'Pending')) {
    await updateAgencyUserStatus(agencyUser.id, 'Active')
    await stampFirstLogin(agencyUser)
  }

  redirect('/dashboard')
}
