// app/api/agency/profile/route.ts
// Update the caller's own Agency record.
// Admin-only — Staff role cannot edit agency-wide fields.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAgencyUserByClerkId, updateAgencyProfile } from '@/lib/airtable'

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser || !agencyUser.agencyId) {
    return NextResponse.json({ error: 'No agency linked' }, { status: 403 })
  }
  if (agencyUser.role !== 'Admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Whitelist — anything else is ignored.
  const patch: Parameters<typeof updateAgencyProfile>[1] = {}
  if (typeof body.name === 'string') patch.agencyName = body.name.trim()
  if ('officeName' in body) patch.officeName = body.officeName?.trim() || null
  if ('ein' in body) patch.ein = body.ein?.trim() || null
  if (typeof body.address === 'string') patch.address = body.address.trim()
  if ('address2' in body) patch.address2 = body.address2?.trim() || null
  if (typeof body.city === 'string') patch.city = body.city.trim()
  if (typeof body.state === 'string') patch.state = body.state.trim()
  if (typeof body.zip === 'string') patch.zip = body.zip.trim()
  if (typeof body.phone === 'string') patch.phone = body.phone.trim()
  if ('website' in body) patch.website = body.website?.trim() || null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  try {
    await updateAgencyProfile(agencyUser.agencyId, patch)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('PATCH /api/agency/profile error:', err)
    return NextResponse.json({ error: 'Failed to update agency' }, { status: 500 })
  }
}
