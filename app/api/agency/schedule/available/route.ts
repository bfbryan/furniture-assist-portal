// app/api/agency/schedule/available/route.ts
//
// GET /api/agency/schedule/available
//
// AGENCY-FACING. The Saturdays an agency user may choose from when picking a
// preferred date on a new referral or a reschedule request.
//
// Two reasons this exists rather than the agency reusing the Dawson one:
//
//   1. AUTHORIZATION. The agency side used to call
//      /api/dawson/schedule/available, which is behind the Dawson user
//      allowlist. Every agency user got a 403 and an empty list, which is the
//      "agency reschedule isn't pulling Saturdays" report from 10 Aug. The
//      picker was not broken; it was being told it had no permission and
//      failing quietly.
//
//   2. POLICY. 50 is a real limit for agencies and is enforced here, by the
//      `{Slots Remaining} > 0` clause that the Dawson endpoint deliberately
//      no longer carries. Dawson is the human scheduler and is not capped;
//      agencies fill a Saturday to 50 and no further. The two rules now live
//      in two files instead of one file trying to be both.
//
// Response shape is identical to the Dawson endpoint so the shared pickers
// can consume either without branching.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAgencyUserByClerkId } from '@/lib/airtable'
import { addDaysISO, easternTodayISO } from '@/lib/dates'
import { DAY_CAPACITY, totalBooked } from '@/lib/schedule/capacity'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const SCHEDULE_TABLE = 'Saturday Schedule'

// Agencies book further out than Dawson does; 14 is what the agency callers
// were already passing explicitly.
const DEFAULT_LEAD_DAYS = 14
const LEAD_DAYS_MIN = 0
const LEAD_DAYS_MAX = 60

function parseLeadDays(raw: string | null): number {
  if (raw === null) return DEFAULT_LEAD_DAYS
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return DEFAULT_LEAD_DAYS
  return Math.min(Math.max(n, LEAD_DAYS_MIN), LEAD_DAYS_MAX)
}

/** Airtable record as this route consumes it. */
type ScheduleRecord = { id: string; fields: Record<string, unknown> }

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: Request) {
  // Any signed-in user attached to an agency. The schedule is not
  // agency-specific — availability is the same for everyone — so there is
  // nothing further to scope by here.
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) {
    return NextResponse.json({ error: 'No agency linked' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const weeksAhead = Math.min(parseInt(searchParams.get('weeks') || '8'), 26)
    const leadDays = parseLeadDays(searchParams.get('leadDays'))

    const today = easternTodayISO()
    const minDate = addDaysISO(today, leadDays)
    const endDate = addDaysISO(today, weeksAhead * 7)

    // {Slots Remaining} > 0 is the 50 cap. Airtable computes that field, so
    // it stays the authority on whether a Saturday is full rather than this
    // route recomputing it.
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

    const res = await fetch(url, { headers: HEADERS })

    if (!res.ok) {
      const err = await res.text()
      console.error('Agency schedule available - AT error:', err)
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })
    }

    const data = await res.json()

    const records: ScheduleRecord[] = data.records ?? []

    const dates = records
      .map((r) => {
        const slots = {
          slots9am:  toInt(r.fields['9am']  ?? r.fields['9am Booked']),
          slots10am: toInt(r.fields['10am'] ?? r.fields['10am Booked']),
          slots11am: toInt(r.fields['11am'] ?? r.fields['11am Booked']),
          slots12pm: toInt(r.fields['12pm'] ?? r.fields['12pm Booked']),
          slots1pm:  toInt(r.fields['1pm']  ?? r.fields['1pm Booked']),
        }
        const booked = totalBooked(slots)
        return {
          date: r.fields.Date,
          slotsRemaining: r.fields['Slots Remaining'],
          ...slots,
          totalBooked: booked,
          dayCapacity: DAY_CAPACITY,
          // Always false in practice — a full Saturday is filtered out above.
          // Present so the shape matches the Dawson endpoint exactly.
          isFull: booked >= DAY_CAPACITY,
        }
      })
      .filter((d) => d.date && typeof d.slotsRemaining === 'number')

    return NextResponse.json(dates)
  } catch (e) {
    console.error('Agency schedule available error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
