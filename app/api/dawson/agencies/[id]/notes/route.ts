// app/api/dawson/agencies/[id]/notes/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { updateAgencyNotes } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const { notes } = await req.json()

  // Same gap the flags route had (agency-detail-rebuild): updateAgencyNotes
  // throws on a rejected Airtable write, and left uncaught that became
  // Next's generic 500 with no indication of what Airtable rejected.
  // Corrected here to match, so the two don't diverge on the same shape.
  try {
    await updateAgencyNotes(id, notes)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('updateAgencyNotes failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    )
  }
}
