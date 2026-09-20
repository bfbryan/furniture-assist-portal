// app/api/donor-checkin/route.ts
//
// POST — the phone kiosk's one write. Called ONLY from the volunteer's
// tap on the pending confirmation screen, never from a scan. The scan
// only ever calls POST /api/donor-checkin/lookup, which writes nothing
// and hands the client back the record id and donor name; that id is
// what this route requires (`{ id }`), not a raw scan string.
//
// This used to be one endpoint that parsed a raw scan, looked the record
// up, and wrote in the same call — which meant the write happened the
// instant a code was decoded, with no human confirmation in between. See
// app/(donor)/checkin/page.tsx's own header for the full account of why
// that was wrong and how the lookup/confirm split fixes it.
//
// Still does its own GET-then-maybe-PATCH (not a blind write) — the id
// this route receives was resolved by a lookup call that may be seconds
// old, and another phone or the desk could have checked the same donor
// in in the meantime. Re-reading the record before writing means that
// race lands on "already received," not a needless second write.
//
// Response shapes — deliberately not a uniform success/error binary:
//   200 { ok: true, donorName }                                    — first check-in, wrote it
//   200 { ok: true, alreadyReceived: true, donorName, receivedAt } — NOT an error;
//        someone else confirmed this same donor between this device's
//        lookup and its tap. Routine, not a problem.
//   404 { ok: false, code: 'not_found' }                           — bad or stale id
//   400 { ok: false, code: 'invalid_input' }                       — not a well-formed record id
//
// "Offline" has no response shape here — it's the client never reaching
// this route at all (fetch throws), not something the server can signal.

import { NextResponse } from 'next/server'
import { requireDonorCheckinAccess } from '@/lib/auth/donor-checkin-access'
import { REC_ID_RE } from '@/lib/airtable/client'
import { getDonationById, markReceived } from '@/lib/donors/in-kind-donations'

export async function POST(req: Request) {
  const denied = await requireDonorCheckinAccess()
  if (denied) return denied

  let body: { id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!REC_ID_RE.test(id)) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 })
  }

  const donation = await getDonationById(id)
  if (!donation) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 })
  }

  const donorName = `${donation.firstName} ${donation.lastName}`.trim()

  if (donation.status === 'Received') {
    return NextResponse.json({
      ok: true,
      alreadyReceived: true,
      donorName,
      receivedAt: donation.lastUpdated,
    })
  }

  // Not just "if Pending" — a record the six-week script already flipped
  // to No Show still gets marked Received on a genuine late scan. That's
  // the whole point of this branch: the scan was never made, so fixing
  // scanning is what stops a real donation from staying wrongly flagged,
  // not a second automation to widen a grace period.
  await markReceived(donation.id)
  return NextResponse.json({ ok: true, donorName })
}
