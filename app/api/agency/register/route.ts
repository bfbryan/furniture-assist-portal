// app/api/agency/register/route.ts
//
// POST — public agency self-registration. Replaces a Zapier catch hook the
// WordPress form used to POST to with `mode: 'no-cors'`. That Zap was built
// and never switched on: zero Agencies rows in the base carry
// Source = 'Self Registered' (checked live, 2026-09) — there is no legacy
// behaviour here to match, only the form's own copy to make true.
//
// No Clerk session, no agency context — this is the one route in the app
// reachable by anyone with the URL that also writes. See:
//   - CORS_ORIGINS below — PLACEHOLDER, needs Ben's confirmed WordPress
//     origin before the form can actually be pointed here.
//   - lib/rate-limit.ts — best-effort, in-process, proportionate to a
//     nonprofit's actual registration volume, not a login endpoint's.
//   - The honeypot field (`hp`) below — a bot that fills every input fills
//     the hidden one too; a human never sees it exist.
//
// WHAT IT WRITES, all of it together (none of it works alone):
//   - Agencies row: Status 'Pending' (lands on Needs Action's existing
//     "Agencies to review" card, GET /api/dawson/agencies?status=Pending —
//     already built, already linked, just never had a producer), Source
//     'Self Registered', Office Name, the four certification fields, and
//     (only when the duplicate check below found something) Possible
//     Duplicate + a Notes line naming what matched.
//   - Agency Users row for the primary contact, linked to the agency.
//   - Primary Admin on the Agencies row, linked to that new user — read in
//     five places elsewhere in this codebase, written nowhere until this
//     route. Without it, the agency can never be approved (see
//     status/route.ts's Pending -> Approved branch) or invited.
//   - Membership Status on the new user: left blank, deliberately — it is
//     only ever set at the moment portal access is actually provisioned
//     (see lib/agencies/portal-provisioning.ts's callers), and a
//     self-registered admin hasn't reached that moment yet.
//   - Reconciled: never touched. Still Ben's own pass, same as every other
//     agency.
//
// Duplicate checking (lib/agencies/duplicate-check.ts) never blocks a
// submission — it flags. A name match alone would wrongly turn away a
// legitimate second office (Catholic Charities and Center for Great
// Expectations already hold two Agencies rows apiece, distinguished only
// by Office Name), so this always creates a new row and lets Dawson sort
// out a real collision from a real second office during review.
//
// The "Agency Registration Confirm" email fires from here — the thank-you
// page promises one. It ships Enabled unchecked in Airtable like every
// other automation before go-live, so nothing actually sends until Ben
// flips it. v1 of that template tried a ternary
// (`{{=gives[...] ? ... : ...}}`) to combine Agency Name with an optional
// Office Name — fillTemplate has no conditionals, so it rendered
// literally. v2 moved the composition here instead: see
// "Agency Display Name" below, sent in place of a raw Office Name token.

import { NextResponse } from 'next/server'
import { createAgency, createAgencyUser } from '@/lib/agencies/upsert'
import { checkForDuplicateAgency } from '@/lib/agencies/duplicate-check'
import { formatEIN, isCompleteEIN } from '@/lib/ein'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

// PLACEHOLDER — Ben is confirming the exact WordPress origin, including
// whether `www.` answers separately from the bare domain. Every other
// furnitureassist.com reference in this codebase (agencies@, ben@, the
// logo asset) points at the bare domain, distinct from this app's own
// portal.furnitureassist.com — that's the basis for the guess below, not
// a confirmed fact. DO NOT switch the WordPress form over to this route
// until this list is confirmed correct; until then, requests from the
// real origin may be silently blocked by the browser, which is the safe
// failure direction.
const CORS_ORIGINS = [
  'https://furnitureassist.com',
  'https://www.furnitureassist.com',
]

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  if (origin && CORS_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
  }
  // Unknown origin: no CORS headers at all, so the browser blocks the
  // response on its own — deny by default rather than echo back
  // something unconfirmed.
  return {}
}

function json(req: Request, status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) })
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

async function patchAirtable(table: string, recordId: string, fields: Record<string, unknown>) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) throw new Error(`Airtable ${table} update failed: ${await res.text()}`)
  return res.json()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(req: Request) {
  // Rate limit first — a request the honeypot would have caught still
  // counts against the sender's quota.
  const ip = clientIpFrom(req)
  if (!checkRateLimit(ip)) {
    return json(req, 429, { error: 'Too many registration attempts. Please try again later.' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'Invalid request body.' })
  }

  // Honeypot — WordPress must include a hidden `hp` input that stays
  // empty for a real visitor. A filled one is a bot; report success
  // without writing anything, so it never learns which field to leave
  // blank next time.
  if (str(body.hp) !== '') {
    return json(req, 201, { ok: true })
  }

  const agencyName = str(body.agency_name)
  const officeName = str(body.office_name) || null
  const einRaw = str(body.ein)
  const agencyPhone = str(body.agency_phone) || null
  const website = str(body.website) || null
  const addrStreet = str(body.addr_street) || null
  const addrStreet2 = str(body.addr_street2) || null
  const addrCity = str(body.addr_city) || null
  const addrState = str(body.addr_state) || null
  const addrZip = str(body.addr_zip) || null
  const firstName = str(body.first_name)
  const lastName = str(body.last_name)
  const phone = str(body.phone) || null
  const email = str(body.email)
  const certified501c3 = body.certified_501c3 === true
  const termsAccepted = body.terms_accepted === true

  if (!agencyName || !firstName || !lastName || !email) {
    return json(req, 400, { error: 'Agency name, first name, last name and email are required.' })
  }
  if (!EMAIL_RE.test(email)) {
    return json(req, 400, { error: 'That email address does not look valid.' })
  }

  const einFormatted = einRaw ? formatEIN(einRaw) : ''
  if (einRaw && !isCompleteEIN(einFormatted)) {
    return json(req, 400, { error: 'EIN must be nine digits (##-#######).' })
  }

  // The two checkboxes gate submit client-side on the form; re-asserted
  // here because there is no client to trust on a public route.
  if (!certified501c3) {
    return json(req, 400, { error: 'You must certify your organization’s 501(c)(3) status.' })
  }
  if (!termsAccepted) {
    return json(req, 400, { error: 'You must accept the Terms to register.' })
  }

  // Non-blocking — see the module header. Best-effort: a failure here
  // flags nothing rather than blocking a real registration.
  let flaggedDuplicate = false
  let duplicateNote: string | null = null
  try {
    const dup = await checkForDuplicateAgency({
      email,
      agencyName,
      officeName,
      ein: einFormatted || null,
    })
    flaggedDuplicate = dup.matched
    duplicateNote = dup.description
  } catch (e) {
    console.error('agency register: duplicate check failed (flag left false):', e)
  }

  const now = new Date().toISOString()

  let agencyId: string
  try {
    agencyId = await createAgency({
      name: agencyName,
      ein: einFormatted || null,
      address: addrStreet,
      address2: addrStreet2,
      city: addrCity,
      state: addrState,
      zip: addrZip,
      officeName,
      mainPhone: agencyPhone,
      website,
      status: 'Pending',
      source: 'Self Registered',
      possibleDuplicate: flaggedDuplicate,
      notes: duplicateNote,
      cert501c3: true,
      cert501c3At: now,
      termsAccepted: true,
      termsAcceptedAt: now,
    })
  } catch (e) {
    console.error('agency register: createAgency failed:', e)
    return json(req, 500, { error: 'Could not save your registration. Please try again.' })
  }

  let userId: string
  try {
    userId = await createAgencyUser(
      {
        firstName,
        lastName,
        email,
        phone,
        role: 'Admin',
        status: 'Unclaimed',
      },
      agencyId,
    )
  } catch (e) {
    console.error('agency register: createAgencyUser failed (agency row already created):', agencyId, e)
    return json(req, 500, {
      error: 'Your agency was recorded, but we could not save your contact details. Please email agencies@furnitureassist.com.',
    })
  }

  // Primary Admin — the link nothing else writes. Without it the agency
  // can never be approved or invited (see status/route.ts, invite/route.ts).
  try {
    await patchAirtable('Agencies', agencyId, { 'Primary Admin': [userId] })
  } catch (e) {
    console.error('agency register: Primary Admin link failed (agency + user created, unlinked):', agencyId, userId, e)
    return json(req, 500, {
      error: 'Your registration was saved but not fully linked. Please email agencies@furnitureassist.com so we can fix it.',
    })
  }

  // Confirmation email. Never allowed to change the verdict — the
  // registration has already succeeded by this point.
  //
  // v2 template composes its own "Agency Display Name" instead of taking
  // Office Name as a separate token — fillTemplate has no conditionals
  // (that's exactly what the v1 ternary bug was), so the composition has
  // to happen here. Office Name itself is NOT sent as its own token any
  // more; the template doesn't use it.
  const agencyDisplayName = officeName ? `${agencyName} — ${officeName}` : agencyName
  try {
    await sendPortalAccountEmail({
      automationName: 'Agency Registration Confirm',
      to: email,
      tokens: {
        'First Name': firstName,
        'Last Name': lastName,
        'Agency Name': agencyName,
        'Agency Display Name': agencyDisplayName,
        'EIN#': einFormatted,
        Email: email,
      },
      agencyRecordId: agencyId,
    })
  } catch (e) {
    console.error('agency register: confirmation email failed (registration still succeeded):', e)
  }

  return json(req, 201, { ok: true, agencyId, userId, flaggedDuplicate })
}
