// app/api/dawson/schedule/available/route.ts
//
// GET /api/dawson/schedule/available
//
// Returns the list of Saturdays the Dawson-facing forms + modals can offer
// as a preferred date. Each entry now includes per-slot booked counts so
// the reschedule modal (and new-referral form) can show slot-level load
// and let Dawson override full slots.
//
// Filter policy (form vs. auto-schedule):
//   FORM (this endpoint, Dawson manually scheduling):
//     - Date >= today + `leadDays` days (?leadDays=N, default 7, clamped 0-60)
//     - Status = 'Open'
//     - Slots Remaining > 0
//   AUTO-SCHEDULE (Airtable automation, new submissions):
//     - Date >= today + 21 days
//     - Status = 'Open'
//     - Slots Remaining > 0
//     - Ready to Schedule = 1
//     - At least one time slot under cap
// The form does NOT enforce 'Ready to Schedule' or per-slot caps -- those
// gates live in the auto-schedule script. Dawson manually schedules, so
// the form trusts him with Slots Remaining as the headline number AND
// exposes per-slot counts for visibility. Per-slot caps are hardcoded to
// match at-auto-schedule-script.js's TIME_CAPS.


import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { addDaysISO, easternTodayISO } from '@/lib/dates'


const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
}


const SCHEDULE_TABLE = 'Saturday Schedule'

// How far out a date must be before this endpoint will offer it. Callers can
// override per-picker with ?leadDays=N; anything that doesn't pass the param
// keeps the historical 7, so existing callers are unchanged.
const DEFAULT_LEAD_DAYS = 7
const LEAD_DAYS_MIN = 0
const LEAD_DAYS_MAX = 60


// addDays lived here and shifted a Date via toISOString, i.e. the UTC day. On
// Vercel that made the lead-day window start a day early every evening after
// 8pm Eastern, offering a Saturday that was inside the lead time. addDaysISO
// works on the Eastern calendar date instead.


// Missing or non-numeric -> DEFAULT_LEAD_DAYS; otherwise clamped into range.
function parseLeadDays(raw: string | null): number {
  if (raw === null) return DEFAULT_LEAD_DAYS
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return DEFAULT_LEAD_DAYS
  return Math.min(Math.max(n, LEAD_DAYS_MIN), LEAD_DAYS_MAX)
}


export async function GET(request: Request) {
  const denied = await requireDawsonAccess()
  if (denied) return denied


  try {
    const { searchParams } = new URL(request.url)
    const debug = searchParams.get('debug') === '1'
    const weeksAhead = Math.min(parseInt(searchParams.get('weeks') || '8'), 26)
    const leadDays = parseLeadDays(searchParams.get('leadDays'))


    const today = easternTodayISO()
    const minDate = addDaysISO(today, leadDays) // inclusive lower bound
    const endDate = addDaysISO(today, weeksAhead * 7) // exclusive upper bound


    // IS_SAME_OR_AFTER doesn't exist in Airtable formulas; use
    // NOT(IS_BEFORE(...)) for inclusive >=.
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


    console.log(
      'Schedule available route - minDate:', minDate,
      'endDate:', endDate,
      'leadDays:', leadDays
    )


    const res = await fetch(url, { headers: HEADERS })


    if (!res.ok) {
      const err = await res.text()
      console.error('Schedule available route - AT error:', err)
      return NextResponse.json(
        { error: 'Failed to load schedule' },
        { status: 500 }
      )
    }


    const data = await res.json()
    console.log('Schedule available route - records found:', data.records?.length)


    if (debug) {
      return NextResponse.json({
        minDate,
        endDate,
        weeksAhead,
        leadDays,
        recordCount: data.records?.length || 0,
        records: (data.records || []).map((r: any) => ({
          id: r.id,
          date: r.fields.Date,
          status: r.fields.Status,
          slotsRemaining: r.fields['Slots Remaining'],
          readyToSchedule: r.fields['Ready to Schedule'],
          slots9am: r.fields['9am'] ?? r.fields['9am Booked'],
          slots10am: r.fields['10am'] ?? r.fields['10am Booked'],
          slots11am: r.fields['11am'] ?? r.fields['11am Booked'],
          slots12pm: r.fields['12pm'] ?? r.fields['12pm Booked'],
          slots1pm: r.fields['1pm'] ?? r.fields['1pm Booked'],
        })),
      })
    }


    // Per-slot fields exist on Saturday Schedule (same fields the internal
    // /api/dawson/schedule endpoint returns as slots9am / slots10am / ...).
    // We accept either raw label form ('9am') or the '9am Booked' form to
    // stay defensive if the schema is renamed.
    const dates = (data.records || [])
      .map((r: any) => ({
        date: r.fields.Date,
        slotsRemaining: r.fields['Slots Remaining'],
        slots9am:  toInt(r.fields['9am']  ?? r.fields['9am Booked']),
        slots10am: toInt(r.fields['10am'] ?? r.fields['10am Booked']),
        slots11am: toInt(r.fields['11am'] ?? r.fields['11am Booked']),
        slots12pm: toInt(r.fields['12pm'] ?? r.fields['12pm Booked']),
        slots1pm:  toInt(r.fields['1pm']  ?? r.fields['1pm Booked']),
      }))
      .filter((d: any) => d.date && typeof d.slotsRemaining === 'number')


    return NextResponse.json(dates)
  } catch (e: any) {
    console.error('Schedule available endpoint error:', e)
    return NextResponse.json(
      { error: e.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}
