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

  await updateAgencyNotes(id, notes)
  return NextResponse.json({ ok: true })
}
