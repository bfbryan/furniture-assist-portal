// app/api/donations/drop-off/route.ts
//
// POST — public in-kind donation drop-off intake. Replaces a JotForm ->
// Zapier path: JotForm posted to a Zapier webhook, a JS step parsed six
// pipe-delimited strings into 30 item fields by POSITION, and a Zapier
// action created the In Kind Donations record. This route does the same
// create directly, with named item fields instead of positional parsing,
// and — the actual bug this migration fixes — a response the page can
// use to decide whether to show success. The old path rendered its
// "you're all set" screen unconditionally; a failed Zap run and a
// successful one looked identical to the donor.
//
// Same base as donor-checkin (AIRTABLE_DONOR_BASE_ID / _API_KEY), same
// table, but a different route entirely — this creates the Pending
// donation the phone/desk later check in, not part of that flow itself.
//
// Same shape as app/api/agency/register/route.ts, the precedent named
// for this: CORS for both apex and www, a honeypot, a rate limit,
// server-side re-validation of everything the form would gate
// client-side, real status codes.
//
// PHASE 1 SCOPE — deliberately does NOT do any of this, all of it
// explicitly Phase 2:
//   - No donor lookup, no dedupe, no match-or-create. The existing
//     Airtable automation still does this after the row lands.
//   - No Donor ID or Zip Linked write — same automations, same reason.
//   - Caps ARE enforced, hard, as plain validation below — same as any
//     other bad field, a 400 before anything is written. Drop-off has
//     never had caps before this; this is a deliberate behaviour
//     change, not a bug fix. (An earlier round made these advisory with
//     an over-cap flag; dropped — no soft-cap path, no flag, nothing
//     recorded about an over-cap attempt at all, since it never
//     becomes a donation.)

import { NextResponse } from 'next/server'
import { createDropOffDonation, type DropOffQuantities } from '@/lib/donors/drop-off-intake'
import { DROP_OFF_ITEM_BY_KEY } from '@/lib/donors/drop-off-catalog'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'

// Same two hosts as agency/register — the drop-off form's home is
// furnitureassist.com, and www serves the same page rather than
// redirecting to the apex.
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
  return {}
}

function json(req: Request, status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) })
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// A DEDICATED cap for this route, not agency/register's 5/hour — a
// donation form plausibly sees more submissions than agency sign-ups,
// and this is a deterrent against scripted spam, not a real throughput
// control (donors submit from their own IPs; the honeypot below is
// doing the reliable work — see lib/rate-limit.ts's own header). 20/hour
// is a reasonable-sounding number, not a measured one — nobody has told
// me actual drop-off form volume, so treat this as a starting point to
// revisit once real traffic is seen, not a researched figure.
const RATE_LIMIT_PER_HOUR = 20

export async function POST(req: Request) {
  const ip = clientIpFrom(req)
  if (!checkRateLimit(ip, RATE_LIMIT_PER_HOUR)) {
    return json(req, 429, { error: 'Too many submissions. Please try again later.' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(req, 400, { error: 'Invalid request body.' })
  }

  // Honeypot — WordPress must include a hidden `hp` input that stays
  // empty for a real visitor. A filled one is a bot; report success
  // without writing anything, matching agency/register's own reasoning:
  // never let a bot learn which field to leave blank next time.
  if (str(body.hp) !== '') {
    return json(req, 201, { ok: true })
  }

  // Flat, snake_case — the real form's own field names (`first_name`,
  // `address_street`, `donation_date`, ...), not a shape invented here.
  // A page posting to this route sends exactly what its inputs are
  // named, no client-side remapping required.
  const firstName = str(body.first_name)
  const lastName = str(body.last_name)
  const email = str(body.email)
  const formDate = str(body.donation_date)
  const cellNumber = str(body.cell_number) || null
  const streetAddress = str(body.address_street) || null
  const streetAddress2 = str(body.address_street2) || null
  const city = str(body.address_city) || null
  const state = str(body.address_state) || null
  const zip = str(body.address_zip) || null
  const notes = str(body.item_notes) || null

  // First/last/email/date required. Email specifically isn't just form
  // courtesy: Primary Match Key on the donations table is
  // LOWER(TRIM(Email)) (confirmed against the live formula) — a blank
  // email doesn't fail this write (it's a plain text field) but leaves
  // that key empty, which is exactly the case most likely to confuse
  // whatever match-or-create logic depends on it. Rejecting it here
  // keeps that failure mode out of the donor base entirely rather than
  // creating a row and hoping the automation handles a blank key
  // gracefully.
  if (!firstName || !lastName || !email || !formDate) {
    return json(req, 400, { error: 'First name, last name, email and a donation date are required.' })
  }
  if (!EMAIL_RE.test(email)) {
    return json(req, 400, { error: 'That email address does not look valid.' })
  }
  if (!DATE_RE.test(formDate)) {
    return json(req, 400, { error: 'That donation date is not valid.' })
  }

  // Tax-valuation acknowledgement — required to submit, matching the
  // real form's own checkbox, but not written anywhere: no Airtable
  // field holds it, and none gets invented here. If that ever needs to
  // be recorded, it needs a field first, the same rule as the over-cap
  // flag below.
  if (body.check_tax !== true) {
    return json(req, 400, { error: 'Please acknowledge the tax valuation notice before submitting.' })
  }

  // Quantities — read directly off the flat body by the catalog's own
  // keys (qty_couch, qty_chair, ...), not a nested sub-object. The real
  // form's <select> uses value="" for "not donating this," same as a
  // field never being filled in at all — both mean 0, not an error.
  // Two ways a value can be rejected, both plain 400s: not a
  // non-negative whole number at all (garbage input), or a real number
  // over that item's cap. Caps are hard — this is the enforcement,
  // there's no soft path or flag; an over-cap submission never becomes
  // a donation.
  const quantities: DropOffQuantities = {}
  for (const item of Object.values(DROP_OFF_ITEM_BY_KEY)) {
    const raw = body[item.key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return json(req, 400, { error: `Invalid quantity for ${item.label}.` })
    }
    if (n > item.cap) {
      return json(req, 400, { error: `${item.label}: ${n} is over the limit of ${item.cap}.` })
    }
    if (n > 0) quantities[item.key] = n
  }

  try {
    const result = await createDropOffDonation(
      { firstName, lastName, email, cellNumber, streetAddress, streetAddress2, city, state, zip, formDate, notes },
      quantities,
    )
    // The success screen must depend on this having actually happened —
    // the whole point of this migration. If createDropOffDonation threw,
    // execution never reaches here; the catch below returns a real error
    // instead.
    return json(req, 201, { ok: true, id: result.id })
  } catch (e) {
    console.error('drop-off intake: create failed:', e)
    return json(req, 500, { error: 'Could not save your donation. Please try again, or contact us directly.' })
  }
}
