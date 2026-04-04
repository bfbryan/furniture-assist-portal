// app/api/dawson/schedule/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getSaturdaySchedule } from '@/lib/airtable'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

export async function GET() {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const schedule = await getSaturdaySchedule()
  return NextResponse.json(schedule)
}
