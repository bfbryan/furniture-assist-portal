// app/api/dawson/referrals/[id]/reschedule/route.ts
//
// POST /api/dawson/referrals/:id/reschedule
//
// Reschedule an existing referral. Dawson always picks a specific date.
// Time slot is optional:
//
//   - Date + Time -> bypass automation. Looks up the Saturday Schedule
//                    row for that date, writes the link (which drives the
//                    Appointment Date lookup), writes Appointment Time,
//                    and sets Appointment Status = 'Scheduled'.
//   - Date only   -> backend allocator: reads per-slot booked counts off
//                    the Saturday Schedule row and picks the first slot
//                    under cap (fill order 9am -> 10am -> 11am -> 12pm ->
//                    1pm). Also writes Scheduled directly. If all 5 slots
//                    are at cap, returns an error.
//
// Dawson has AT-level override authority so, when he explicitly picks a
// time, we do NOT enforce per-slot caps here. When he does NOT pick a
// time and we allocate for him, we DO respect caps (no auto-override).
//
// Whenever the referral currently has a Saturday Schedule + Appointment
// Time set, the pre-reschedule values are copied into 'Original Appointment
// Date' / 'Original Appointment Time' (overwrite-every-time policy).
//
// Whenever that snapshot happens (i.e. this referral was already
// Scheduled and is genuinely being moved, not scheduled for the first
// time), we also fire the Reschedule Notice: regenerates the slip PDF for
// the new date, overwrites it in Blob + Airtable, and emails the
// referring agency with the new + previous appointment details. That
// email failing does NOT fail this request — the Airtable write is what
// matters operationally, and the notice runs after it's already committed.



import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendRescheduleNotice } from '@/lib/reschedule-notice'



const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}



const VALID_TIMES = new Set(['9am', '10am', '11am', '12pm', '1pm'])



// Per-slot capacities -- MUST match at-auto-schedule-script.js TIME_CAPS,
// components/dawson/modals/RescheduleModal.tsx SLOT_CAP, and the SLOT_MAX
// constant on app/dawson/schedule/page.tsx.
type TimeSlot = '9am' | '10am' | '11am' | '12pm' | '1pm'
const TIME_CAPS: Record<TimeSlot, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}
// Fill order for auto-allocation when Dawson picks a date but no time.
const TIME_ORDER: TimeSlot[] = ['9am', '10am', '11am', '12pm', '1pm']



function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return !isNaN(dt.getTime()) && dt.getDay() === 6
}



function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}



// Look up a Saturday Schedule record by ISO date. Returns the full record
// (id + per-slot booked counts) or null. Uses DATETIME_FORMAT to compare
// on YYYY-MM-DD regardless of AT's stored datetime precision.
async function findScheduleRecordByDate(isoDate: string): Promise<{
  id: string
  bookedByTime: Record<TimeSlot, number>
} | null> {
  const formula = `DATETIME_FORMAT({Date}, 'YYYY-MM-DD') = '${isoDate}'`
  const url =
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Saturday Schedule')}?` +
    `filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) throw new Error(`Saturday Schedule lookup failed: ${await res.text()}`)
  const data = await res.json()
  if (!data.records || data.records.length === 0) return null
  const rec = data.records[0]
  return {
    id: rec.id as string,
    bookedByTime: {
      '9am':  toInt(rec.fields['9am']  ?? rec.fields['9am Booked']),
      '10am': toInt(rec.fields['10am'] ?? rec.fields['10am Booked']),
      '11am': toInt(rec.fields['11am'] ?? rec.fields['11am Booked']),
      '12pm': toInt(rec.fields['12pm'] ?? rec.fields['12pm Booked']),
      '1pm':  toInt(rec.fields['1pm']  ?? rec.fields['1pm Booked']),
    },
  }
}



// First slot under cap using TIME_ORDER. Null if all 5 are at cap.
function pickFirstOpenSlot(bookedByTime: Record<TimeSlot, number>): TimeSlot | null {
  for (const slot of TIME_ORDER) {
    if (bookedByTime[slot] < TIME_CAPS[slot]) return slot
  }
  return null
}



// Read the current referral so we can snapshot its pre-reschedule
// Saturday Schedule + Appointment Time into the Original fields.
async function getReferral(id: string): Promise<any | null> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) return null
  return await res.json()
}



export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied



  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { preferredDate, appointmentTime } = body



  if (!preferredDate) {
    return NextResponse.json(
      { error: 'Preferred date is required.' },
      { status: 400 }
    )
  }
  if (!isSaturday(preferredDate)) {
    return NextResponse.json(
      { error: 'Preferred date must be a Saturday.' },
      { status: 400 }
    )
  }



  const hasTime =
    typeof appointmentTime === 'string' &&
    VALID_TIMES.has(appointmentTime)



  if (
    appointmentTime !== undefined &&
    appointmentTime !== null &&
    appointmentTime !== '' &&
    !hasTime
  ) {
    return NextResponse.json(
      { error: `Invalid appointment time: ${appointmentTime}` },
      { status: 400 }
    )
  }



  // ---- Snapshot current values for the Original Appointment fields.
  //   Policy: overwrite every time. Only writes when the referral is
  //   currently scheduled (has a Saturday Schedule link + Time). If it's
  //   currently Unscheduled/Reschedule, there's nothing to snapshot.
  const current = await getReferral(id)
  const currentScheduleLinks: string[] =
    current?.fields?.['Saturday Schedule'] ?? []
  const currentApptDateLookup: string[] | string | undefined =
    current?.fields?.['Appointment Date']
  const currentApptTime: string | undefined =
    current?.fields?.['Appointment Time']



  // Appointment Date is a lookup (array of strings from Saturday Schedule).
  // Normalize to a single ISO date string for the Original field.
  const currentApptDate: string | null = Array.isArray(currentApptDateLookup)
    ? (currentApptDateLookup[0] as string) ?? null
    : (currentApptDateLookup as string) ?? null



  const shouldSnapshot =
    currentScheduleLinks.length > 0 && !!currentApptTime && !!currentApptDate



  // ---- Look up the Saturday Schedule row for the requested date.
  const scheduleRow = await findScheduleRecordByDate(preferredDate)
  if (!scheduleRow) {
    return NextResponse.json(
      { error: `No Saturday Schedule row found for ${preferredDate}.` },
      { status: 400 }
    )
  }



  // ---- Decide the time slot.
  //   - Explicit time from Dawson -> use it (override allowed, no cap check)
  //   - No time -> pick first open slot under cap
  let resolvedTime: TimeSlot
  if (hasTime) {
    resolvedTime = appointmentTime as TimeSlot
  } else {
    const picked = pickFirstOpenSlot(scheduleRow.bookedByTime)
    if (!picked) {
      return NextResponse.json(
        {
          error: `All 5 time slots on ${preferredDate} are at capacity. Pick a specific time to override, or choose a different Saturday.`,
        },
        { status: 400 }
      )
    }
    resolvedTime = picked
  }



  const fields: Record<string, any> = {
    'Scheduling Flexibility': 'Specific Date',
    'Preferred Date': preferredDate,
    'Saturday Schedule': [scheduleRow.id],
    'Appointment Time': resolvedTime,
    'Appointment Status': 'Scheduled',
  }



  if (shouldSnapshot) {
    fields['Original Appointment Date'] = currentApptDate
    fields['Original Appointment Time'] = currentApptTime
  }



  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields, typecast: true }),
    }
  )



  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }



  // ---- Fire the Reschedule Notice.
  //   Only when this referral was already Scheduled (shouldSnapshot true) --
  //   i.e. there's a genuine previous appointment to report. A first-time
  //   Unscheduled -> Scheduled transition is handled by the Wednesday
  //   Appointment Confirmation cron instead, not here.
  let rescheduleNotice: Awaited<ReturnType<typeof sendRescheduleNotice>> | null = null
  if (shouldSnapshot) {
    rescheduleNotice = await sendRescheduleNotice(
      id,
      currentApptDate,
      currentApptTime ?? null
    )
  }



  return NextResponse.json({
    success: true,
    appointmentTime: resolvedTime,
    rescheduleNotice,
  })
}
