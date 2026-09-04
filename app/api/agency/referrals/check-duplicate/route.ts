// app/api/agency/referrals/check-duplicate/route.ts
//
// POST /api/agency/referrals/check-duplicate
// body: { firstName, lastName, dob }   (dob 'YYYY-MM-DD')
//
// Called by the agency New Referral form before submit. Returns ONE outcome,
// carrying only the fields that outcome needs.
//
// ============================================================
// THE PRIVACY RULE
// ============================================================
// findClientMatches (Dawson's check) returns global history across every
// agency. An agency must NEVER learn that another agency is working with the
// same family — these are vulnerable clients and this is a confidentiality
// problem, not a UX preference.
//
// That rule is enforced here as a property of WHAT THIS ENDPOINT EMITS, not as
// a filter applied to a fuller payload:
//
//   • A cross-agency conflict yields exactly
//       { outcome: 'blocked-active', scope: 'cross' }
//     and nothing else. No agency name, no date, no referral id — nothing to
//     leak, and no boolean a client could flip to reveal more.
//   • "Served by another agency, no conflict" is indistinguishable from "new
//     client": both return { outcome: 'proceed' }.
//   • Same-agency details (a referral id, an appointment date/time) are the
//     caller's OWN records, matched by {Referring Agency ID} == the caller's
//     agency id, so returning them discloses nothing.
//
// A filter PARAMETER on Dawson's route was rejected for this: one boolean from
// being bypassed, and the raw cross-agency data would still cross the wire.
//
// ============================================================
// How the client is resolved
// ============================================================
// By EXACT key (Last-First-DOB), the same way POST /api/referrals/submit links.
// Not the fuzzy scorer — a fuzzy near-match must never silently drive a link
// or a block (the Clients table carries same-surname/same-DOB near-duplicate
// pairs; attaching to the wrong twin strands history on a record no one
// looks at). Fuzzy matching stays Dawson-side, behind a human in a modal.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAgencyUserByClerkId } from '@/lib/airtable'
import { findClientByIdentity } from '@/lib/referrals/match'
import { isDoNotServeStatus } from '@/lib/clients/do-not-serve'
import { withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const ACTIVE_STATUSES = new Set(['Scheduled', 'Pending Schedule'])

export type CheckDuplicateResult =
  // Paths 1, 2, 4, 5, 8 — new client, or history needing no agency-facing
  // notice (served elsewhere with no conflict / aged-out no-show / prior
  // cancellation / completed). The form submits normally; Dawson still gets the
  // Possible Duplicate flag, which the submit route sets on its own.
  | { outcome: 'proceed' }
  // Path 7 — do-not-serve. The submit route also 403s; this lets the form say
  // so without a failed request. Never states the reason.
  | { outcome: 'dns' }
  // Path 6 (active appointment now) and the cross-agency form of path 9.
  // `scope: 'cross'` carries NOTHING else.
  | { outcome: 'blocked-active'; scope: 'same'; referralId: string; date: string | null; time: string | null }
  | { outcome: 'blocked-active'; scope: 'cross' }
  // Path 3 — no-show within the window, same agency. The form offers to update
  // the existing referral into a reschedule request.
  | { outcome: 'convert-noshow'; referralId: string }
  // Path 9 — a reschedule request from this agency is already pending. The form
  // offers to change that one to the new date instead of adding a second.
  | { outcome: 'convert-inflight'; referralId: string }

type ReferralRow = {
  id: string
  status: string
  date: string | null
  time: string | null
  mine: boolean
}

function unwrap(v: unknown): string {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : ''
  return typeof v === 'string' ? v : ''
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
  return res.json()
}

async function loadClientReferrals(
  referralIds: string[],
  callerAgencyId: string | null,
): Promise<ReferralRow[]> {
  const CHUNK = 40
  const rows: ReferralRow[] = []
  for (let i = 0; i < referralIds.length; i += CHUNK) {
    const chunk = referralIds.slice(i, i + CHUNK)
    const formula = `OR(${chunk.map((id) => `RECORD_ID()="${id}"`).join(',')})`
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}` +
      `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100` +
      `&fields%5B%5D=${encodeURIComponent('Appointment Status')}` +
      `&fields%5B%5D=${encodeURIComponent('Appointment Date')}` +
      `&fields%5B%5D=${encodeURIComponent('Appointment Time')}` +
      `&fields%5B%5D=${encodeURIComponent('Referring Agency ID')}`
    const data = await fetchJson(url)
    for (const r of data.records ?? []) {
      const agencyId = unwrap(r.fields['Referring Agency ID'])
      rows.push({
        id: r.id,
        status: (r.fields['Appointment Status'] as string) ?? '',
        date: unwrap(r.fields['Appointment Date']) || null,
        time: (r.fields['Appointment Time'] as string) ?? null,
        // A row with no agency id (no staff link) fails toward "not mine" —
        // never toward disclosing same-agency detail.
        mine: !!agencyId && !!callerAgencyId && agencyId === callerAgencyId,
      })
    }
  }
  return rows
}

function classify(rows: ReferralRow[]): CheckDuplicateResult {
  // Most restrictive wins: an active appointment blocks outright, then an
  // in-flight reschedule, then a reschedulable no-show, then nothing.
  const active = rows.find((r) => ACTIVE_STATUSES.has(r.status))
  if (active) {
    return active.mine
      ? { outcome: 'blocked-active', scope: 'same', referralId: active.id, date: active.date, time: active.time }
      : { outcome: 'blocked-active', scope: 'cross' }
  }

  const reschedule = rows.find((r) => r.status === 'Reschedule')
  if (reschedule) {
    return reschedule.mine
      ? { outcome: 'convert-inflight', referralId: reschedule.id }
      : { outcome: 'blocked-active', scope: 'cross' }
  }

  const noShow = rows.find(
    (r) => r.status === 'No Show' && r.mine && withinNoShowRescheduleWindow(r.date),
  )
  if (noShow) {
    return { outcome: 'convert-noshow', referralId: noShow.id }
  }

  return { outcome: 'proceed' }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) return NextResponse.json({ error: 'No agency linked' }, { status: 403 })
  const callerAgencyId = agencyUser.agencyId

  const body = await req.json().catch(() => ({}))
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  const dob = typeof body.dob === 'string' ? body.dob.trim() : ''
  if (!lastName) {
    return NextResponse.json({ error: 'Last name is required.' }, { status: 400 })
  }

  let result: CheckDuplicateResult
  try {
    const clientId = await findClientByIdentity({ firstName, lastName, dob })
    if (!clientId) {
      result = { outcome: 'proceed' }
    } else {
      const clientRec = await fetchJson(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Clients')}/${clientId}`,
      )
      if (isDoNotServeStatus(clientRec.fields?.['Status'])) {
        result = { outcome: 'dns' }
      } else {
        const referralIds: string[] = clientRec.fields?.['Client Referrals'] ?? []
        result = referralIds.length === 0
          ? { outcome: 'proceed' }
          : classify(await loadClientReferrals(referralIds, callerAgencyId))
      }
    }
  } catch (e) {
    console.error('agency check-duplicate failed:', e)
    return NextResponse.json(
      { error: 'Could not check this referral against existing records. Try again.' },
      { status: 502 },
    )
  }

  return NextResponse.json(result)
}
