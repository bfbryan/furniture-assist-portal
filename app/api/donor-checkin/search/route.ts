// app/api/donor-checkin/search/route.ts
//
// GET ?q=<last name> — the desk's search box, for a donor who arrives
// without a usable QR code.
//
// Two-tier, not one: tier 1 is scoped to Manual or Automatic = 'Automatic'
// AND Status = 'Pending' (~108 records) — small enough that a search
// returns one or two results, little room to check in the wrong person.
// If that comes back empty, tier 2 searches without the Status/Manual
// filter, so an already-received donor shows as "already received at
// 11:42" rather than a bare empty result, which would read as "not in the
// system at all" — the wrong and alarming message.
//
// Response fields are deliberately narrow (see the header comment on
// shapeSearchResult in lib/donors/in-kind-donations.ts) — this list is
// visible on a desk in a warehouse, more exposure than the phone, which
// only ever shows the one donor just scanned.

import { NextResponse } from 'next/server'
import { requireDonorCheckinAccess } from '@/lib/auth/donor-checkin-access'
import { searchPendingByLastName, searchAnyByLastName } from '@/lib/donors/in-kind-donations'

export async function GET(req: Request) {
  const denied = await requireDonorCheckinAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  if (!q) {
    return NextResponse.json({ results: [], tier: null })
  }

  const primary = await searchPendingByLastName(q)
  if (primary.length > 0) {
    return NextResponse.json({ results: primary, tier: 'pending' })
  }

  const fallback = await searchAnyByLastName(q)
  return NextResponse.json({ results: fallback, tier: 'any' })
}
