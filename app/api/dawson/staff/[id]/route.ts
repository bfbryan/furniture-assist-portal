// app/api/dawson/staff/[id]/route.ts
//
// GET a single Agency User (staff member) plus their agency link and every
// referral they've submitted (matched via {Referring Staff Link}).
//
// Deployed as the backing endpoint for /dawson/staff/[id]. The page is the
// deep-link target from:
//   • Referral detail page → "Staff" row in the Referral Details card
//   • Agency detail page → Portal Staff list (future)

import { NextRequest, NextResponse } from 'next/server'
import { getStaffWithDetails } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  try {
    const staff = await getStaffWithDetails(id)
    return NextResponse.json(staff)
  } catch (err: any) {
    // airtableFetch throws on non-2xx; treat any read failure as not-found
    // rather than 500 so the page renders "Staff not found" cleanly.
    const msg = typeof err?.message === 'string' ? err.message : ''
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }
    return NextResponse.json({ error: msg || 'Failed to load staff' }, { status: 500 })
  }
}
