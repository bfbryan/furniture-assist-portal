// app/api/dawson/schedule/available/route.ts
// Available-Saturday endpoint. Called by BOTH Dawson (internal portal) AND
// agencies (agency portal reschedule modal).
//
// Auth: any signed-in Clerk user. Read-only, low-risk — agencies see the
// same public-ish schedule Dawson does.
//
// Query params:
//   weeks     — number of weeks ahead to consider (default 8, max 26)
//   leadDays  — minimum days from today (default 7 for Dawson, agency
//               callers pass 14 to enforce a 2-week floor)

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
}

const SCHEDULE_TABLE = 'Saturday Schedule'
const REFERRALS_TABLE = 'Client Referrals'

// Filter policy (form vs. auto-schedule):
//   FORM (this endpoint, Dawson/agency manually scheduling):
//     - Date >= today + leadDays (default 7 Dawson, 14 agency)
//     - Status = 'Open'
//     - Slots Remaining > 0
//     - At least one time slot under cap
//   AUTO-SCHEDULE (Airtable automation, new submissions):
//     - Date >= today + 21 days
//     - Status = 'Open'
//     - Slots Remaining > 0
//     - Ready to Schedule = 1   <-- form does NOT enforce this
//     - At least one time slot under cap
// 'Ready to Schedule' is an ops-readiness gate for unattended scheduling.
// Dawson/agencies can book a not-yet-ready date by hand; the script cannot.
const DEFAULT_LEAD_DAYS = 7

// Time-slot capacity caps from the auto-schedule script's tryAssignTime():
//   9:00 AM  -> < 5
//   10:00 AM -> < 14
//   11:00 AM -> < 14
//   12:00 PM -> < 14
//   1:00 PM  -> < 3
// A date is only truly bookable if AT LEAST ONE time slot still has room.
const TIME_SLOT_CAPS: Array<{ label: string; cap: number }> = [
  { label: '9:00 AM', cap: 5 },
  { label: '10:00 AM', cap: 14 },
  { label: '11:00 AM', cap: 14 },
  { label: '12:00 PM', cap: 14 },
  { label: '1:00 PM', cap: 3 },
]

function addDays(d: Date, days: number): string {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out.toISOString().split('T')[0]
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const weeksAhead = Math.min(parseInt(searchParams.get('weeks') || '8'), 26)
    const leadDays = Math.max(
      parseInt(searchParams.get('leadDays') || String(DEFAULT_LEAD_DAYS)),
      DEFAULT_LEAD_DAYS
    )

    const today = new Date()
    const minDate = addDays(today, leadDays) // inclusive lower bound
    const endDate = addDays(today, weeksAhead * 7) // exclusive upper bound

    // IS_SAME_OR_AFTER doesn't exist in Airtable formulas; use
    // NOT(IS_BEFORE(...)) for inclusive >=.
    // NOTE: 'Ready to Schedule' is intentionally NOT filtered here -- the
    // form lets Dawson/agency book a date even before ops marks it ready.
    const formula = `AND(
      NOT(IS_BEFORE({Date}, '${minDate}')),
      IS_BEFORE({Date}, '${endDate}'),
      {Status} = 'Open',
      {Slots Remaining} > 0
    )`.replace(/\s+/g, ' ')

    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE)}?` +
      `filterByFormula=${encodeURIComponent(formula)}&` +
      `sort[0][field]=Date&sort[0][direction]=asc&` +
      `maxRecords=100`

    console.log('Schedule route - url:', url)

    const res = await fetch(url, { headers: HEADERS })

    if (!res.ok) {
      const err = await res.text()
      console.error('Schedule route - AT error:', err)
      return NextResponse.json(
        { error: 'Failed to load schedule' },
        { status: 500 }
      )
    }

    const data = await res.json()
    console.log('Schedule route - candidate dates:', data.records?.length)

    const candidates: Array<{ id: string; date: string; slotsRemaining: number }> =
      (data.records || [])
        .map((r: any) => ({
          id: r.id,
          date: r.fields.Date,
          slotsRemaining: r.fields['Slots Remaining'],
        }))
        .filter(
          (d: any) =>
            d.date && typeof d.slotsRemaining === 'number' && d.slotsRemaining > 0
        )

    if (candidates.length === 0) {
      return NextResponse.json([])
    }

    // For each candidate date, verify at least one time slot still has room.
    // Pull all scheduled referrals across the candidate date range in ONE query,
    // then bucket by (date, time) locally.
    const candidateDates = candidates.map((c) => c.date)
    const dateListFormula = candidateDates
      .map((d) => `{Saturday Schedule Date} = '${d}'`)
      .join(', ')

    const refFormula = `AND(
      {Appointment Status} = 'Scheduled',
      OR(${dateListFormula})
    )`.replace(/\s+/g, ' ')

    const refUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REFERRALS_TABLE)}?` +
      `filterByFormula=${encodeURIComponent(refFormula)}&` +
      `fields%5B%5D=${encodeURIComponent('Saturday Schedule Date')}&` +
      `fields%5B%5D=${encodeURIComponent('Appointment Time')}&` +
      `pageSize=100`

    // Paginate (>100 scheduled across 8 weeks is possible)
    const counts = new Map<string, number>() // key = `${date}|${time}`
    let nextUrl: string | null = refUrl
    while (nextUrl) {
      const r: Response = await fetch(nextUrl, { headers: HEADERS })
      if (!r.ok) {
        const err = await r.text()
        console.error('Schedule route - referrals fetch error:', err)
        // Fall back to permissive behavior: return all candidates without
        // slot-cap verification rather than 500. The script is the source
        // of truth and will reject if truly full.
        return NextResponse.json(
          candidates.map((c) => ({
            date: c.date,
            slotsRemaining: c.slotsRemaining,
          }))
        )
      }
      const j: any = await r.json()
      for (const rec of j.records || []) {
        const d = rec.fields['Saturday Schedule Date']
        const t = rec.fields['Appointment Time']
        if (!d || !t) continue
        const dateStr = Array.isArray(d) ? d[0] : d
        const key = `${dateStr}|${t}`
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      nextUrl = j.offset
        ? `${refUrl}&offset=${encodeURIComponent(j.offset)}`
        : null
    }

    const bookable = candidates.filter((c) => {
      // bookable if ANY time slot still has room
      return TIME_SLOT_CAPS.some(({ label, cap }) => {
        const used = counts.get(`${c.date}|${label}`) || 0
        return used < cap
      })
    })

    console.log(
      'Schedule route - bookable after slot-cap check:',
      bookable.length
    )

    return NextResponse.json(
      bookable.map((c) => ({
        date: c.date,
        slotsRemaining: c.slotsRemaining,
      }))
    )
  } catch (e: any) {
    console.error('Schedule endpoint error:', e)
    return NextResponse.json(
      { error: e.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
