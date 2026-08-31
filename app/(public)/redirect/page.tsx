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
// cannot be one: Clerk's sign-in fallback redirect is a single static value
// (it is set to this page, via NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL),
// and Clerk has no knowledge of whether this is someone's first time in the
// PORTAL - that fact lives in Airtable, as Agency Users.Claimed Date. This page
// already had to read it in order to stamp it, so the decision costs nothing
// extra here.
//
// "Fallback" matters: when the sign-in URL carries a ?redirect_url= (an
// unauthenticated deep link that auth.protect() bounced through /sign-in),
// Clerk sends the person straight to that URL and this page never runs. When
// it DOES run with a redirect_url in its own query, it honours it below, after
// the stamping — so a first-time claimer who followed a referral link still
// gets their account claimed on the way through.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  stampFirstLogin,
  stampLastLogin,
  updateAgencyUserStatus,
} from '@/lib/airtable'
import { isDawsonPortalUser } from '@/lib/auth/dawson-access'
import { PORTAL_ORIGIN } from '@/lib/auth/portal-sign-in-link'

// An unvalidated post-sign-in redirect target is an open-redirect vulnerability:
// a crafted ?redirect_url=https://evil.example/phish would bounce a freshly
// authenticated user straight off-site, portal as referrer. Only two shapes are
// safe to hand to redirect():
//   - a site-relative path: exactly one leading "/", and none of the forms a
//     browser treats as protocol-relative or as a scheme ("//host", "/\host",
//     "http://...", an embedded "://", any backslash).
//   - an absolute URL whose origin is exactly PORTAL_ORIGIN, reduced to its
//     pathname + search.
// Anything else returns null and the caller falls through to its normal
// destination — no error page, the bad value is just ignored.
//
// Exported (rather than file-private) so it can be unit-tested directly: it
// is a security boundary and the rejection cases matter more than the page.
export function safeRedirectPath(raw: string | undefined): string | null {
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (parsed.origin !== PORTAL_ORIGIN) return null
      return parsed.pathname + parsed.search
    } catch {
      return null
    }
  }

  if (!raw.startsWith('/')) return null   // must be rooted
  if (raw.startsWith('//')) return null   // protocol-relative -> off-site
  if (raw.startsWith('/\\')) return null  // browsers coerce "/\" to "//"
  if (raw.includes('\\')) return null     // any backslash: treat as hostile
  if (raw.includes('://')) return null    // embedded scheme
  return raw
}

export default async function RedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Dawson users go straight to /dawson — before the redirect_url is even
  // read, so a deep link can never divert a Dawson sign-in.
  if (isDawsonPortalUser(userId)) {
    redirect('/dawson')
  }

  const sp = await searchParams
  const redirectTarget = safeRedirectPath(
    typeof sp.redirect_url === 'string' ? sp.redirect_url : undefined,
  )

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

  // Destination, after the stamping work above, in priority order:
  //   1. Dawson -> /dawson. Already handled at the top of this function, so it
  //      is listed here only to say it outranks everything and ignores
  //      redirect_url by design.
  //   2. A validated redirect_url -> that path. It is the page the person
  //      asked for before auth.protect() bounced them to sign-in, normally a
  //      deep link from an email about one specific referral. This BEATS the
  //      first-login /profile rule on purpose: someone who clicked through
  //      from an appointment email should land on that appointment, not a
  //      profile form, even the first time they sign in. /profile is still one
  //      click away in the nav.
  //   3. First login -> /profile (the note below).
  //   4. Everyone else -> /dashboard.
  if (redirectTarget) redirect(redirectTarget)

  // Ben: land on the profile page the first time, the dashboard every time
  // after. The first thing a newly-claimed account is asked to do is confirm
  // who they are and what agency they belong to, and the profile page is where
  // that happens; sending them to the dashboard first buries it behind a nav
  // click most people never make.
  if (isFirstLogin) redirect('/profile')

  redirect('/dashboard')
}
