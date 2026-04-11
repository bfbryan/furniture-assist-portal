// app/api/admin/staff/[id]/status/route.ts
// Updates AT Agency User status — no Clerk changes

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAgencyUserByClerkId, updateAgencyUserStatus } from '@/lib/airtable'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only org admins can change staff status
  const currentUser = await getAgencyUserByClerkId(userId)
  if (!currentUser || currentUser.role !== 'Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { status } = await req.json()

  if (!['Active', 'Inactive'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  await updateAgencyUserStatus(id, status)
  return NextResponse.json({ ok: true })
}