// app/redirect/page.tsx
//
// Every sign-in lands here (Clerk's after-sign-in URL). Besides routing the
// person to the right portal, this is where a magic-link invite becomes a
// claimed account: an Invited user's first sign-in flips them to Active,
// stamps their Claimed Date, and — when they are the agency's Primary Admin —
// cascades the agency itself to Approved with its own Claimed Date and
// Approval Date. The Airtable automation that used to write those stamps is
// switched off; this code owns them now.
//
// It is also where Last Login is stamped, on every sign-in rather than only
// the first.
//
// And it is where "first login goes to the profile page, every login after
// that goes to the dashboard" is decided. That is NOT a Clerk setting and
// cannot be one: Clerk's after-sign-in URL is a single static value (it is set
// to this page, via NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL), and Clerk has no
// knowledge of whether this is someone's first time in the PORTAL - that fact
// lives in Airtable, as Agency Users.Claimed Date. This page already had to
// read it in order to stamp it, so the decision costs nothing extra here.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  stampFirstLogin,
  stampLastLogin,
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
  //
  // `isFirstLogin` is deliberately "we stamped the Claimed Date on THIS
  // request", not "their status is Invited" and not "Claimed Date is empty".
  // It is true exactly once per person, for the same reason stampFirstLogin is
  // a no-op after the first run, so it cannot send a returning user to the
  // profile page a second time - and it cannot strand someone on it forever if
  // their row somehow never reaches 'Invited'.
  let isFirstLogin = false
  if (agencyUser && (agencyUser.status === 'Invited' || agencyUser.status === 'Pending')) {
    isFirstLogin = !agencyUser.claimedDate
    await stampFirstLogin(agencyUser)
    await updateAgencyUserStatus(agencyUser.id, 'Active')
  }

  // Last Login, on EVERY sign-in rather than only the first. The field has
  // always existed on Agency Users and nothing has ever written to it, so it
  // reads blank for every user in the base.
  //
  // Last, and after the block above, for two reasons. It must not run before
  // stampFirstLogin, whose ordering comment above is load-bearing; and it must
  // not be able to interfere with it — stampLastLogin swallows its own errors,
  // so a rate-limited or failed stamp costs an audit row and nothing else.
  // Dawson users returned at the top: Last Login is an Agency Users field and
  // they have no row in that table.
  if (agencyUser) await stampLastLogin(agencyUser.id)

  // Ben: land on the profile page the first time, the dashboard every time
  // after. The first thing a newly-claimed account is asked to do is confirm
  // who they are and what agency they belong to, and the profile page is where
  // that happens; sending them to the dashboard first buries it behind a nav
  // click most people never make.
  if (isFirstLogin) redirect('/profile')

  redirect('/dashboard')
}
