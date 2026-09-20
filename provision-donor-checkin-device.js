#!/usr/bin/env node
/**
 * provision-donor-checkin-device.js — Mint a Clerk sign-in link for one
 * donor-checkin kiosk device (a phone, or the Chromebook).
 *
 * USAGE:
 *   node provision-donor-checkin-device.js "Phone 1"                    # dry-run (safe)
 *   node provision-donor-checkin-device.js "Phone 1" --go               # mints for real, production key required
 *   node provision-donor-checkin-device.js "Phone 1" --go --allow-dev   # mints for real against a dev/test key, deliberately
 *
 *   Production key for a real --go: put it on the command itself, not in
 *   .env.local (that would point every other local dev session at
 *   production Clerk until someone noticed and reverted it):
 *     CLERK_SECRET_KEY=sk_live_... node provision-donor-checkin-device.js "Phone 1" --go
 *   Get the value with: vercel env pull --environment=production .env.production.local
 *   (this repo is already linked — .vercel/repo.json has the project/org id).
 *
 * WHY THIS EXISTS: lib/auth/donor-checkin-access.ts gates both donor-
 * checkin surfaces on DONOR_CHECKIN_DEVICE_USER_IDS, a Clerk user id
 * allowlist — but nothing in this repo could mint the Clerk identity or
 * the sign-in link a device actually redeems. Whether Clerk's Dashboard
 * UI alone can mint a sign-in token was never confirmed either way; this
 * script makes that moot by minting it directly against Clerk's Backend
 * API — the same call lib/agencies/portal-provisioning.ts already makes
 * (and already proves works) for agency admin invites.
 *
 * WHAT IT DOES, per device name:
 *   1. Looks up a Clerk user by a DETERMINISTIC internal email derived
 *      from the device name (donor-checkin+<slug>@device.furnitureassist.com,
 *      never a real inbox — only Clerk's required unique identifier).
 *      Re-running this script for the same name always finds the same
 *      user, so provisioning "Phone 1" twice reuses one identity rather
 *      than minting a second one. Confirmed live (read-only) that Clerk's
 *      GET /v1/users?email_address=<value> filters to an exact match —
 *      NOT the bracketed email_address[]=<value> form, which was tested
 *      and returns an unrelated, unfiltered set of users. Worth knowing
 *      if this script is ever extended.
 *   2. Creates that user if it doesn't exist (first_name "Donor
 *      Check-In", last_name the device name — so the identity also
 *      reads clearly in the Clerk dashboard's Users list, not just via
 *      this script's own output).
 *   3. Mints a 30-day sign-in token for that user (same expiry window
 *      lib/agencies/portal-provisioning.ts already uses).
 *   4. Prints the Clerk user id and the sign-in URL, both labeled with
 *      the device name on the line itself — not just in a header —
 *      because these get copied into a notes doc across several phones
 *      and a Chromebook, and a link with no name attached is
 *      indistinguishable from any other once it's out of this terminal.
 *
 * WHAT TO DO WITH THE OUTPUT:
 *   - The Clerk user id goes into DONOR_CHECKIN_DEVICE_USER_IDS in
 *     .env.local (local dev) and Vercel (production) — comma-separated;
 *     the parser in lib/auth/donor-checkin-access.ts already
 *     .split(',').map(trim).filter(Boolean)s it, so multiple ids
 *     (several phones plus the Chromebook) is already supported, no
 *     code change needed for that.
 *   - The sign-in URL gets opened ONCE, in that device's own browser
 *     (not this machine's), after which the device stays signed in per
 *     Clerk's own session settings — see donor-checkin-access.ts's own
 *     header for what's still unconfirmed there (Dashboard-only,
 *     couldn't be read via API either).
 *
 * SAFETY: dry-run by default, matching generate-claim-tokens.js's own
 * --go convention. The lookup (read-only) still runs in dry-run, so it
 * tells you whether the name would reuse an existing device or create a
 * new one — nothing is actually created or minted until --go.
 *
 * PRODUCTION GUARD: --go refuses to run unless CLERK_SECRET_KEY starts
 * with sk_live_, unless --allow-dev is also passed. This exists because
 * the printed sign-in URL always shows the production portal origin
 * (portal.furnitureassist.com) no matter which Clerk instance actually
 * backed the mint — a dev-instance token is visually indistinguishable
 * from a production one in the script's own output. Without the guard,
 * the only thing standing between a real device and a dev-instance token
 * is remembering to override CLERK_SECRET_KEY before typing --go — and
 * the failure wouldn't surface until the device hit the real site,
 * likely after Ray had already set it up (a Chromebook kiosk may need a
 * full wipe to redo at that point, not just a re-sign-in).
 *
 * The instance the script would use (or did use) is also always printed,
 * dry-run included, so it's visible before --go is ever added, not just
 * enforced after.
 *
 * Deliberately NOT solved by putting the instance in the printed URL
 * itself instead of relying on this guard — a label embedded in the URL
 * would be exactly as easy to get wrong as today's silence, just with a
 * false sense of having checked something; Clerk's sign-in flow doesn't
 * verify a label like that, so a URL claiming "production" would prove
 * nothing about which instance actually issued the token. The guard, and
 * the instance line printed next to the URL at the moment it's minted,
 * are the trustworthy version of the same information — not a marker
 * baked into a string that then travels unverified into a notes doc.
 *
 * REQUIRES: CLERK_SECRET_KEY — from .env.local for dry-run and dev
 * testing; from a production key supplied inline (see USAGE above) for
 * a real --go.
 *
 * DOES NOT touch .env.local or Vercel itself — those stay Ben's to edit;
 * this only prints what belongs in them.
 */

try {
  require('dotenv').config({ path: '.env.local' })
} catch (_) {}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY
if (!CLERK_SECRET_KEY) {
  console.error('❌ Missing CLERK_SECRET_KEY in .env.local.')
  console.error('   Run from repo root so .env.local is loaded.')
  process.exit(1)
}

const args = process.argv.slice(2)
const deviceName = args.find(a => !a.startsWith('--'))
const LIVE = args.includes('--go')
const ALLOW_DEV = args.includes('--allow-dev')

if (!deviceName) {
  console.error('Usage: node provision-donor-checkin-device.js "<device name>" [--go] [--allow-dev]')
  console.error('  e.g. node provision-donor-checkin-device.js "Phone 1"')
  console.error('       node provision-donor-checkin-device.js "Chromebook" --go')
  process.exit(1)
}

// Which Clerk instance CLERK_SECRET_KEY actually points at. Clerk's own
// prefix convention: sk_live_ is production, sk_test_ is the dev/test
// instance. See the header's PRODUCTION GUARD section for why this is
// checked and printed rather than trusted silently.
function clerkKeyInstance(key) {
  if (key.startsWith('sk_live_')) return { label: 'production', production: true }
  if (key.startsWith('sk_test_')) return { label: 'development/test', production: false }
  return { label: 'unrecognized (neither sk_live_ nor sk_test_)', production: false }
}
const instance = clerkKeyInstance(CLERK_SECRET_KEY)
console.log(`\nClerk instance: ${instance.label}  (key starts "${CLERK_SECRET_KEY.slice(0, 8)}...")`)

if (LIVE && !instance.production && !ALLOW_DEV) {
  console.error(`\n❌ Refusing --go against the ${instance.label} Clerk instance.`)
  console.error('   The printed sign-in URL always shows the production portal origin')
  console.error('   no matter which instance backed the mint, so a dev-instance token')
  console.error('   looks identical to a production one in this script\'s own output —')
  console.error('   this would only surface once the device hit the real site.')
  console.error('')
  console.error('   To mint for production, supply the production key for this one')
  console.error('   command (not in .env.local, which every other local session reads):')
  console.error(`     CLERK_SECRET_KEY=sk_live_... node provision-donor-checkin-device.js "${deviceName}" --go`)
  console.error('   Get that value with: vercel env pull --environment=production .env.production.local')
  console.error('')
  console.error('   To deliberately test against the dev instance instead, add --allow-dev.')
  process.exit(1)
}

// The portal's own origin — a constant, never NEXT_PUBLIC_APP_URL. See
// lib/auth/portal-sign-in-link.ts's own header: that var has never been
// set in any environment and previously produced links starting with the
// literal word "undefined". generate-claim-tokens.js (this repo's other
// standalone provisioning script) still reads NEXT_PUBLIC_APP_URL for its
// own links — a pre-existing issue in that script, not repeated here.
const PORTAL_ORIGIN = 'https://portal.furnitureassist.com'

const CLERK_HEADERS = {
  Authorization: `Bearer ${CLERK_SECRET_KEY}`,
  'Content-Type': 'application/json',
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Deterministic, not random — see the header note on why this has to be
// stable across re-runs.
const deviceEmail = `donor-checkin+${slugify(deviceName)}@device.furnitureassist.com`

async function findUserByEmail(email) {
  const url = `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`
  const res = await fetch(url, { headers: CLERK_HEADERS })
  if (!res.ok) throw new Error(`Clerk user lookup failed (${res.status}): ${await res.text()}`)
  const users = await res.json()
  return users[0] ?? null
}

async function createUser(email, name) {
  const res = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: CLERK_HEADERS,
    body: JSON.stringify({
      email_address: [email],
      first_name: 'Donor Check-In',
      last_name: name,
      skip_password_checks: true,
      skip_password_requirement: true,
    }),
  })
  if (!res.ok) throw new Error(`Clerk user creation failed (${res.status}): ${await res.text()}`)
  return res.json()
}

async function mintSignInToken(userId) {
  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: CLERK_HEADERS,
    body: JSON.stringify({
      user_id: userId,
      expires_in_seconds: 60 * 60 * 24 * 30, // 30 days, unopened — see header
    }),
  })
  if (!res.ok) throw new Error(`Sign-in token mint failed (${res.status}): ${await res.text()}`)
  return res.json()
}

async function main() {
  console.log(`\n[${deviceName}] Lookup key: ${deviceEmail}`)

  const existing = await findUserByEmail(deviceEmail)
  if (existing) {
    console.log(`[${deviceName}] Existing Clerk identity found (${existing.id}) — will reuse it, not create a second one.`)
  } else {
    console.log(`[${deviceName}] No existing Clerk identity.${LIVE ? '' : ' Would create one on --go.'}`)
  }

  if (!LIVE) {
    console.log(`\n[${deviceName}] Dry run only — nothing created or minted.`)
    console.log(`Re-run with --go to actually provision "${deviceName}".\n`)
    return
  }

  const user = existing || (await createUser(deviceEmail, deviceName))
  const tokenData = await mintSignInToken(user.id)
  const signInUrl = `${PORTAL_ORIGIN}/sign-in?__clerk_ticket=${encodeURIComponent(tokenData.token)}`

  const rule = '-'.repeat(66)
  console.log(`\n${rule}`)
  console.log(`  DEVICE: ${deviceName}`)
  console.log(`  CLERK INSTANCE: ${instance.label}`)
  console.log(rule)
  console.log(`Clerk user id for "${deviceName}" (add to DONOR_CHECKIN_DEVICE_USER_IDS):`)
  console.log(`  ${user.id}`)
  console.log('')
  console.log(`Sign-in link for "${deviceName}" — open ONCE, in that device's own`)
  console.log(`browser, then leave it signed in. Do not open this anywhere else:`)
  console.log(`  ${signInUrl}`)
  console.log(`  (minted against: ${instance.label})`)
  console.log(rule)
  console.log(`This link expires in 30 days if never opened. Once opened, "${deviceName}"'s`)
  console.log(`session lifetime is governed by Clerk's own dashboard settings, not`)
  console.log(`this token — see lib/auth/donor-checkin-access.ts's header for what's`)
  console.log(`still unconfirmed there.\n`)
}

main().catch(err => {
  console.error(`❌ [${deviceName}]`, err.message)
  process.exit(1)
})
