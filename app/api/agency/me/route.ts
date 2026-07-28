// app/api/agency/me/route.ts
// Update the caller's own Agency User record (self-service).
// Any active agency user can edit their own name + phone.
// Email is not editable here — Clerk manages that separately.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAgencyUserByClerkId, updateAgencyUserProfile } from '@/lib/airtable'

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) {
    return NextResponse.json({ error: 'No agency user found' }, { status: 403 })
  }
  if (agencyUser.status === 'Inactive') {
    return NextResponse.json({ error: 'Inactive account' }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Parameters<typeof updateAgencyUserProfile>[1] = {}
  if (typeof body.firstName === 'string') patch.firstName = body.firstName.trim()
  if (typeof body.lastName === 'string') patch.lastName = body.lastName.trim()
  if ('phone' in body) patch.phone = body.phone?.trim() || null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  try {
    await updateAgencyUserProfile(agencyUser.id, patch)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('PATCH /api/agency/me error:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
