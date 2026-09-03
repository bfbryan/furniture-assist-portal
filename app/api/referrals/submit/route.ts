// app/api/referrals/submit/route.ts
//
// POST /api/referrals/submit — the AGENCY-side New Referral write.
//
// Not linked from the agency nav yet; the form rebuild is a later branch. This
// route is the foundation it sits on, and is written to work end to end when
// called directly.
//
// ============================================================
// Client-first, post-migration (July 2026)
// ============================================================
// First Name, Last Name, DOB, Phone, Address, Address 2, City, State, Zip,
// County and Preferred Language on Client Referrals are LOOKUPS through the
// `Client` link; Referring Agency / Referring Staff / Agency Email / Staff
// Phone are lookups through `Referring Staff Link`. Airtable rejects direct
// writes to all of them. The previous version of this route wrote every one as
// a plain field, so every submission 500'd.
//
// This version:
//   1. Resolves the Client — exact-key lookup (Last-First-DOB), create on
//      miss. Never writes identity onto Client Referrals; the lookups fill
//      themselves once `Client` is linked.
//   2. Do-not-serve: assertClientMayBeReferred(clientId) by record id — the
//      real guard, fails closed. Replaces the weaker name+DOB identity lookup
//      the old route used because it had no Client record to point at.
//   3. Possible Duplicate: findClientMatches() — fuzzy, advisory. Best-effort:
//      a hiccup in duplicate detection flags nothing, it does not block a
//      legitimate referral.
//   4. Links `Referring Staff Link` to the submitting Agency User; the agency
//      is derived from that link.
//
// No scheduling. An agency submission lands unbooked — Referral Review
// 'Pending', Appointment Status 'Pending Schedule' — in the Dawson "Needs
// action" / "New referrals" card, which is where the slot gets chosen.

import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getAgencyUserByClerkId } from '@/lib/airtable'
import { assertClientMayBeReferred, DoNotServeError } from '@/lib/clients/do-not-serve'
import { findClientByIdentity, createClient, findClientMatches } from '@/lib/referrals/match'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// 'YYYY-MM-DD' (HTML date input) -> 'M/D/YYYY', the convention createClient and
// the rest of the codebase write DOB in. The Clients DOB column is a real Date
// field, so Airtable normalises the stored value either way.
function formatDOB(dob: string): string {
  const [y, m, d] = dob.split('-')
  return `${m}/${d}/${y}`
}

function toIntOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: Request) {
  const { userId, orgId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Inactive agency org — a hard block, same as before.
  if (orgId) {
    const client = await clerkClient()
    const org = await client.organizations.getOrganization({ organizationId: orgId })
    if (org.publicMetadata?.status === 'Inactive') {
      return NextResponse.json({ error: 'Your agency account is inactive.' }, { status: 403 })
    }
  }

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) return NextResponse.json({ error: 'No agency linked' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const {
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
  } = body as Record<string, string | string[] | undefined>

  const fn = typeof firstName === 'string' ? firstName.trim() : ''
  const ln = typeof lastName === 'string' ? lastName.trim() : ''
  const dobRaw = typeof dob === 'string' ? dob.trim() : ''
  if (!fn || !ln || !dobRaw) {
    return NextResponse.json(
      { error: 'First name, last name and date of birth are required.' },
      { status: 400 },
    )
  }
  const dobFormatted = formatDOB(dobRaw)

  // ---- Resolve the Client: exact-key match, else create. ----
  // findClientByIdentity throws (not returns null) on a failed lookup — if we
  // cannot tell whether this client already exists, we must not create a
  // second record. createClient owns the only identity write, onto the
  // Clients row.
  let clientId: string
  try {
    const existing = await findClientByIdentity({ firstName: fn, lastName: ln, dob: dobRaw })
    clientId =
      existing ??
      (await createClient({
        firstName: fn,
        lastName: ln,
        dob: dobFormatted,
        address: str(address),
        address2: str(address2),
        city: str(city),
        state: str(state),
        zip: str(zip),
        county: str(county),
        phone: str(phone),
        language: str(language),
      }))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Could not resolve the client record, so the referral was not submitted: ${msg}` },
      { status: 502 },
    )
  }

  // ---- Do-not-serve: on the resolved record, by id. No override. ----
  try {
    await assertClientMayBeReferred(clientId)
  } catch (e: unknown) {
    if (e instanceof DoNotServeError) {
      return NextResponse.json({ error: e.message, doNotServe: true }, { status: 403 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Could not verify this client's do-not-serve status, so the referral was not submitted: ${msg}` },
      { status: 502 },
    )
  }

  // ---- Possible Duplicate (advisory). Best-effort — a failure here flags
  //      nothing rather than blocking a real referral. The Client link above
  //      is exact; this only decides whether Dawson sees a "possible
  //      duplicate" marker in Needs Action. ----
  let isDuplicate = false
  try {
    const matches = await findClientMatches({ firstName: fn, lastName: ln, dob: dobFormatted, phone: str(phone) })
    isDuplicate = matches.length > 0
  } catch (e) {
    console.error('agency submit: findClientMatches failed (flag left false):', e)
  }

  // ---- Create the referral. Only fields still writable directly on Client
  //      Referrals — identity and agency/staff arrive via the two links. ----
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const fields: Record<string, unknown> = {
    Client: [clientId],
    'Referring Staff Link': [agencyUser.id],
    '# in HH': toIntOrNull(hhSize),
    '# Children': toIntOrNull(children),
    'Items Requested': Array.isArray(items) ? items : items ? [items] : [],
    'Referral Date': today,
    'Referral Review': 'Pending',
    'Appointment Status': 'Pending Schedule',
    'Possible Duplicate': isDuplicate,
  }
  if (typeof notes === 'string' && notes.trim()) fields['External Notes'] = notes.trim()

  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: 500 })
  }

  return NextResponse.json({ success: true, duplicate: isDuplicate })
}

/** Trim a possibly-array/undefined body value down to a plain string. */
function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] ?? '').trim()
  return typeof v === 'string' ? v.trim() : ''
}
