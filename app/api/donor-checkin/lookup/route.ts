// app/api/donor-checkin/lookup/route.ts
//
// POST — read-only. Resolves a scan to a donor's name WITHOUT writing
// anything, so the phone can show "is this who's here?" before any write
// happens. The actual write stays in POST /api/donor-checkin, called only
// when the volunteer taps Received on the pending screen this feeds.
//
// This split exists because the single combined endpoint (lookup-then-
// write in one call) meant every scan committed a write the instant it
// was decoded — a misscan or a stale code got marked Received with no
// human confirmation at all, exactly the "beep-only" failure a phone with
// a screen was chosen to avoid. See app/(donor)/checkin/page.tsx's own
// header for the full account.
//
// Response shapes:
//   200 { ok: true, id, donorName, alreadyReceived, receivedAt } — `id` is
//        what the client must send back to POST /api/donor-checkin when
//        the volunteer taps Received; that route no longer re-parses raw
//        scan input, only this resolved id.
//   404 { ok: false, code: 'not_found' }
//   400 { ok: false, code: 'invalid_input' }

import { NextResponse } from 'next/server'
import { requireDonorCheckinAccess } from '@/lib/auth/donor-checkin-access'
import { parseScanInput } from '@/lib/donors/parse-scan-input'
import { getDonationById } from '@/lib/donors/in-kind-donations'

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

  return NextResponse.json({
    ok: true,
    id: donation.id,
    donorName: `${donation.firstName} ${donation.lastName}`.trim(),
    alreadyReceived: donation.status === 'Received',
    receivedAt: donation.lastUpdated,
  })
}
