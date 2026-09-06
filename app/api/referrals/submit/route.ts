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
// The referral lands as a REQUEST, not a booking — Referral Review 'Pending',
// Appointment Status 'Pending Schedule'. If the form sent a preferred slot
// (`preferredDate` / `preferredTime`), it is written as Preferred Date / Time
// with Scheduling Flexibility 'Specific Date' — what the agency asked for. The
// slot is confirmed (or swapped) by Dawson from the "Needs action" / "New
// referrals" card. No Saturday Schedule lookup or cap enforcement here: the
// grid enforces the 50/day cap client-side, and a stale request is visible to
// Dawson against the live rail before he books, not silent.
//
// CONVERT BRANCH: with `rescheduleReferralId` in the body, this does not create
// anything — it turns that existing referral into a reschedule REQUEST (agency
// New Referral form, paths 3 / 6-same / 9) and writes any edited client
// details in the same call. See the branch for why it does not route through
// PATCH /api/referrals/[id].

import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getAgencyUserByClerkId, updateClient } from '@/lib/airtable'
import { REC_ID_RE } from '@/lib/airtable/client'
import {
  assertClientMayBeReferred,
  assertReferralClientMayBeRescheduled,
  findDoNotServeClientByIdentity,
  doNotServeMessage,
  doNotServeUnverifiedMessage,
  DoNotServeError,
} from '@/lib/clients/do-not-serve'
import { findClientByIdentity, createClient, findClientMatches } from '@/lib/referrals/match'
import { buildRescheduleRequestFields } from '@/lib/referrals/reschedule-request'
import { isSaturday } from '@/lib/referrals/reschedule'
import { VALID_TIMES } from '@/lib/schedule/capacity'
import {
  withinNoShowRescheduleWindow,
  isAwaitingOutcome,
  NO_SHOW_RESCHEDULE_WINDOW_DAYS,
} from '@/lib/referrals/no-show-window'
import { requireAgencyReferralAccess } from '@/lib/auth/agency-referral-access'
import { AGENCY_SUBMISSION_ENABLED } from '@/lib/flags'

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

  // Phase 1 gate — agency submission is closed in production until launch.
  // Covers BOTH branches below (a normal create and the rescheduleReferralId
  // convert), since both are the agency New Referral form. The reschedule
  // REQUEST endpoint POST /api/referrals/[id]/reschedule is separate and stays
  // open. The page at /referrals/new redirects for the same reason. Flip
  // AGENCY_SUBMISSION_ENABLED in lib/flags.ts to open both.
  if (!AGENCY_SUBMISSION_ENABLED) {
    return NextResponse.json(
      { error: 'Online referral submission is not available yet.' },
      { status: 403 },
    )
  }

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

  // ------------------------------------------------------------------
  // CONVERT BRANCH — turn an existing referral into a reschedule REQUEST.
  //
  // The agency New Referral form routes here (with rescheduleReferralId) for a
  // no-show it can pick back up (path 3), an active appointment the agency
  // wants a new date for (path 6, same agency), or a reschedule already in
  // flight (path 9). It flips the referral to Appointment Status 'Reschedule'
  // with the new Preferred Date/Time and writes any edited client details in
  // the same call. Creates nothing; returns early.
  //
  // Deliberately NOT routed through PATCH /api/referrals/[id]: that endpoint
  // runs agencyEditWindow(), and EDITABLE_STATUSES has no 'Reschedule', so it
  // would 409 a referral already in that state — the paused lock investigation.
  // Handling the write here keeps that bug contained to its own branch. The
  // reschedule request IS the authorization to update the details, so there is
  // no separate edit-window gate to apply.
  // ------------------------------------------------------------------
  if (body.rescheduleReferralId != null && body.rescheduleReferralId !== '') {
    return convertToRescheduleRequest(body.rescheduleReferralId, body)
  }

  const {
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
    preferredDate, preferredTime,
  } = body as Record<string, string | string[] | undefined>

  const wantsSlot = typeof preferredDate === 'string' && preferredDate.trim() !== ''
  const pd = wantsSlot ? (preferredDate as string).trim() : ''
  if (wantsSlot && !isSaturday(pd)) {
    return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
  }
  const pt = typeof preferredTime === 'string' ? preferredTime.trim() : ''
  if (pt && !VALID_TIMES.has(pt)) {
    return NextResponse.json({ error: `Invalid appointment time: ${pt}` }, { status: 400 })
  }

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

  // ---- Do-not-serve, IDENTITY check — FIRST, before any Client is resolved
  //      or created. A dismissed DNS match must never leave an unflagged
  //      Clients row behind, because the exact-key lookup would then reuse it
  //      forever. Needs only name + DOB, all present here. Ordering note by the
  //      record-id assert below.
  try {
    const flagged = await findDoNotServeClientByIdentity({ firstName: fn, lastName: ln, dob: dobFormatted })
    if (flagged) {
      console.warn(
        `[do-not-serve] identity backstop blocked an agency referral before client creation: ` +
        `first/last/DOB match flagged client ${flagged.id} (${flagged.name}).`,
      )
      throw new DoNotServeError(doNotServeMessage(flagged.name), flagged.id)
    }
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

  // ---- Do-not-serve, RECORD-ID assert — on the resolved/linked Client. ----
  //
  // ORDER, end to end — DO NOT REORDER. This exact reordering (assert then
  // identity) once left an orphaned, unflagged Clients row for a client we'd
  // decided not to serve, which the next submit then happily reused:
  //   1. identity DNS check   — name + DOB, BEFORE any write (above). Blocks a
  //                             typed identity that matches a flagged person,
  //                             creating nothing.
  //   2. resolve the Client   — exact-key find → link, else createClient.
  //   3. record-id DNS assert  — here, on that record. Catches what step 1
  //                             can't: the linked Client is itself flagged
  //                             (matched by the Clients unique-id key, which
  //                             normalizes differently from step 1).
  //   4. build + create the referral (below).
  //
  // Both DNS checks fail closed: DoNotServeError → 403 (one message, one
  // wall); any other throw → 502 "could not verify".
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
  // The slot the agency asked for. Stays a preference — Dawson books it (or
  // swaps it) from Needs Action. Time is optional.
  if (wantsSlot) {
    fields['Scheduling Flexibility'] = 'Specific Date'
    fields['Preferred Date'] = pd
    if (pt) fields['Preferred Time'] = pt
  }

  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    return NextResponse.json(
      { error: (await res.text()) || 'Airtable rejected the referral.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, duplicate: isDuplicate })
}

/** Trim a possibly-array/undefined body value down to a plain string. */
function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] ?? '').trim()
  return typeof v === 'string' ? v.trim() : ''
}

// Client-detail fields the convert branch may update, keyed to the Clients
// table (address / phone live there — they reach Client Referrals as lookups).
const CONVERT_CLIENT_FIELD_MAP: Record<string, string> = {
  address: 'Address',
  address2: 'Address 2',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  language: 'Preferred Language',
}

async function convertToRescheduleRequest(
  rawId: unknown,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Malformed id is a 400, not a 500. A caller (Pass B's form, or a retry)
  // sending a stray space would otherwise reach getReferralById with a broken
  // URL, which throws — and an unhandled throw here is a bare 500 with no body.
  const referralId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!REC_ID_RE.test(referralId)) {
    return NextResponse.json({ error: 'Invalid referral id.' }, { status: 400 })
  }

  // Every path out of here returns JSON. The outer catch turns any unexpected
  // throw — a thrown requireAgencyReferralAccess, a network blip in
  // updateClient — into a diagnosable 500 body instead of an empty one.
  try {
    const access = await requireAgencyReferralAccess(referralId)
    if (access.denied) return access.denied
    const { referral } = access

    // Non-convertible states, mirroring POST /api/referrals/[id]/reschedule.
    const review = referral.referralReview
    const status = referral.appointmentStatus
    if (review === 'Rejected' || review === 'Withdrawn' || status === 'Completed' || status === 'Cancelled') {
      return NextResponse.json({ error: 'This referral can no longer be changed.' }, { status: 409 })
    }
    if (status === 'No Show' && !withinNoShowRescheduleWindow(referral.appointmentDate)) {
      return NextResponse.json(
        { error: `This appointment was missed more than ${NO_SHOW_RESCHEDULE_WINDOW_DAYS} days ago. Please submit a new referral instead.` },
        { status: 409 },
      )
    }
    if (isAwaitingOutcome(status, referral.appointmentDate)) {
      return NextResponse.json(
        { error: "This appointment's date has passed and the outcome hasn't been recorded yet. Contact Furniture Assist if it needs to change." },
        { status: 409 },
      )
    }

    // Do-not-serve — same reporting as the create paths.
    try {
      await assertReferralClientMayBeRescheduled({
        clientId: referral.clientId,
        firstName: referral.firstName,
        lastName: referral.lastName,
        dob: referral.dob,
      })
    } catch (e: unknown) {
      if (e instanceof DoNotServeError) {
        return NextResponse.json({ error: e.message, doNotServe: true }, { status: 403 })
      }
      return NextResponse.json(
        { error: doNotServeUnverifiedMessage('the reschedule request was not submitted', e instanceof Error ? e.message : String(e)) },
        { status: 502 },
      )
    }

    const pd = typeof body.preferredDate === 'string' ? body.preferredDate.trim() : ''
    if (!pd || !isSaturday(pd)) {
      return NextResponse.json({ error: 'A preferred Saturday is required.' }, { status: 400 })
    }
    const pt = typeof body.preferredTime === 'string' ? body.preferredTime.trim() : ''
    if (pt && !VALID_TIMES.has(pt)) {
      return NextResponse.json({ error: `Invalid appointment time: ${pt}` }, { status: 400 })
    }

    // Referral row: the shared reschedule-request bag + any edited per-visit
    // fields. Only keys the caller actually sent are touched.
    const refFields: Record<string, unknown> = {
      ...buildRescheduleRequestFields({ preferredDate: pd, preferredTime: pt }),
    }
    if ('hhSize' in body) refFields['# in HH'] = toIntOrNull(body.hhSize)
    if ('children' in body) refFields['# Children'] = toIntOrNull(body.children)
    if ('items' in body) {
      const raw = body.items
      refFields['Items Requested'] = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
    }
    if (typeof body.notes === 'string') {
      refFields['External Notes'] = body.notes.trim() || null
    }

    // Client row: address / phone / etc.
    const clientFields: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(CONVERT_CLIENT_FIELD_MAP)) {
      if (typeof body[key] === 'string') clientFields[field] = (body[key] as string).trim()
    }

    if (Object.keys(clientFields).length > 0 && referral.clientId) {
      await updateClient(referral.clientId, clientFields)
    }
    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${referralId}`,
      { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ fields: refFields, typecast: true }) },
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: (await res.text()) || 'Airtable rejected the reschedule request.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, converted: true, referralId })
  } catch (e: unknown) {
    console.error('convert-to-reschedule-request failed:', e)
    return NextResponse.json(
      { error: `The reschedule request could not be completed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }
}
