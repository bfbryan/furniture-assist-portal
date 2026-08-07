// app/api/dawson/referrals/[id]/cancel/route.ts
//
// POST /api/dawson/referrals/:id/cancel
//
// Cancels a referral. Handles what the "Cancellation" Airtable automation
// previously did, now inline:
//
//   1. Read current Saturday Schedule + Appointment Time from the referral
//   2. Look up the linked Saturday Schedule's Date (for the Original snapshot)
//   3. Single PATCH:
//        - Appointment Status  = 'Cancelled'
//        - Original Appointment Date = previous Appointment Date (if scheduled)
//        - Original Appointment Time = previous Appointment Time (if scheduled)
//        - Saturday Schedule = [] (clear link)
//        - Appointment Time  = null (clear time)
//   4. If the referral was actually Scheduled (not just Unscheduled being
//      cancelled outright), fire the Cancellation Notice — emails the
//      referring agency confirming the cancellation with the original
//      appointment details. Email-only, no PDF work (see
//      lib/cancellation-notice.ts). A failure here doesn't fail this
//      request — the Airtable write above already committed and is the
//      part that matters operationally.
//
// The AT "Cancellation" automation is now redundant for Dawson's flow.
// Leave it on as a safety net for agency-portal cancellations until we
// port that path too.



import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendCancellationNotice } from '@/lib/cancellation-notice'



const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}



export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied



  const { id } = await params



  // ---- Read current referral to snapshot originals.
  const refUrl = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`
  const refRes = await fetch(refUrl, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!refRes.ok) {
    return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
  }
  const ref = await refRes.json()



  const currentScheduleLinks: string[] = ref?.fields?.['Saturday Schedule'] ?? []
  const currentTime: string | undefined = ref?.fields?.['Appointment Time']



  // Appointment Date is a lookup (array of ISO date strings). Use the
  // first entry as the snapshot value.
  const currentApptDateLookup = ref?.fields?.['Appointment Date']
  const currentApptDate: string | null = Array.isArray(currentApptDateLookup)
    ? (currentApptDateLookup[0] as string) ?? null
    : (currentApptDateLookup as string) ?? null



  const wasScheduled =
    currentScheduleLinks.length > 0 && !!currentTime && !!currentApptDate



  // ---- Build the cancel PATCH.
  const fields: Record<string, any> = {
    'Appointment Status': 'Cancelled',
    'Saturday Schedule': [],
    'Appointment Time': null,
  }
  if (wasScheduled) {
    fields['Original Appointment Date'] = currentApptDate
    fields['Original Appointment Time'] = currentTime
  }



  const patchRes = await fetch(refUrl, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })



  if (!patchRes.ok) {
    const err = await patchRes.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }



  // ---- Fire the Cancellation Notice.
  //   Only when this referral was actually Scheduled -- an Unscheduled
  //   referral being cancelled never had a confirmed appointment to notify
  //   anyone about.
  let cancellationNotice: Awaited<ReturnType<typeof sendCancellationNotice>> | null = null
  if (wasScheduled) {
    cancellationNotice = await sendCancellationNotice(id, currentApptDate, currentTime ?? null)
  }



  return NextResponse.json({
    success: true,
    snapshottedOriginal: wasScheduled,
    cancellationNotice,
  })
}
