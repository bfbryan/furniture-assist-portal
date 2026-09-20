// app/api/donor-checkin/route.ts
//
// POST — the phone kiosk's one write. GET-then-maybe-PATCH: read the
// record first (to know already-received vs. not-found, and to get the
// name for the confirm screen), write only if it's still Pending.
//
// Response shapes — deliberately not a uniform success/error binary:
//   200 { ok: true, donorName }                                    — first check-in
//   200 { ok: true, alreadyReceived: true, donorName, receivedAt } — NOT an error;
//        same status family as success, since a duplicate scan is routine
//        and shouldn't read as a problem to the volunteer holding the phone
//   404 { ok: false, code: 'not_found' }                           — bad scan / wrong code
//   400 { ok: false, code: 'invalid_input' }                       — couldn't extract an id at all
//
// "Offline" has no response shape here — it's the client never reaching
// this route at all (fetch throws), not something the server can signal.

import { NextResponse } from 'next/server'
import { requireDonorCheckinAccess } from '@/lib/auth/donor-checkin-access'
import { parseScanInput } from '@/lib/donors/parse-scan-input'
import { getDonationById, markReceived } from '@/lib/donors/in-kind-donations'

export async function POST(req: Request) {
  const denied = await requireDonorCheckinAccess()
  if (denied) return denied

  let body: { input?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 })
  }

  const raw = typeof body.input === 'string' ? body.input : ''
  const id = parseScanInput(raw)
  if (!id) {
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
