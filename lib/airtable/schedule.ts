// lib/airtable/schedule.ts
//
// Reads against the Saturday Schedule table (appointment capacity per date),
// plus the per-slot "soft" demand that lives on Client Referrals rather than
// on the schedule row, and the held slot of a single referral (for the
// capacity grid's excludeReferralId).

import { airtableFetch } from './client'
import { TIME_ORDER, type TimeSlot } from '@/lib/schedule/capacity'

const SCHEDULE_TABLE = 'Saturday Schedule'
const REFERRALS_TABLE = 'Client Referrals'

export type SaturdayScheduleRow = {
  id: string
  date: string
  status: string
  slots9am: number
  slots10am: number
  slots11am: number
  slots12pm: number
  slots1pm: number
  totalFilled: number
  totalCapacity: number
  slotsRemaining: number
  mailMergeComplete: boolean
}

/**
 * Saturday Schedule rows, ascending by date.
 *
 * With no arguments this returns the whole table exactly as it always has —
 * the Saturday Schedule page and the dashboard depend on that. `fromISO` /
 * `toISO` add an inclusive {Date} filter for the capacity-grid endpoint; the
 * returned shape is identical either way.
 */
export async function getSaturdaySchedule(
  fromISO?: string,
  toISO?: string,
): Promise<SaturdayScheduleRow[]> {
  const conds: string[] = []
  if (fromISO) conds.push(`NOT(IS_BEFORE({Date}, '${fromISO}'))`)
  if (toISO) conds.push(`NOT(IS_AFTER({Date}, '${toISO}'))`)
  const filter = conds.length
    ? `&filterByFormula=${encodeURIComponent(conds.length > 1 ? `AND(${conds.join(', ')})` : conds[0])}`
    : ''

  const data = await airtableFetch(
    SCHEDULE_TABLE,
    `?sort[0][field]=Date&sort[0][direction]=asc${filter}`,
  )

  return data.records.map((record: any) => ({
    id: record.id,
    date: record.fields['Date'] as string,
    status: (record.fields['Status'] as string) ?? 'Open',
    slots9am: (record.fields['9am'] as number) ?? 0,
    slots10am: (record.fields['10am'] as number) ?? 0,
    slots11am: (record.fields['11am'] as number) ?? 0,
    slots12pm: (record.fields['12pm'] as number) ?? 0,
    slots1pm: (record.fields['1pm'] as number) ?? 0,
    totalFilled: (record.fields['Total Slots Filled'] as number) ?? 0,
    totalCapacity: (record.fields['Total Capacity'] as number) ?? 50,
    slotsRemaining: (record.fields['Slots Remaining'] as number) ?? 0,
    mailMergeComplete: (record.fields['Mail Merge Complete'] as boolean) ?? false,
  }))
}

/**
 * The last published Saturday — max {Date} across the whole table, 'YYYY-MM-DD'
 * or null if the table is empty. The capacity grid uses this to tell "end of
 * the requested window" from "end of the schedule".
 */
export async function getScheduleHorizon(): Promise<string | null> {
  const data = await airtableFetch(
    SCHEDULE_TABLE,
    `?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=1&fields%5B%5D=Date`,
  )
  const d = data.records?.[0]?.fields?.['Date']
  return typeof d === 'string' && d ? d.slice(0, 10) : null
}

export type SoftSlotCounts = Record<string, Partial<Record<TimeSlot, number>>>

/**
 * Per-slot "soft" demand between two dates (inclusive): referrals that have
 * REQUESTED an hour without holding it — Appointment Status 'Reschedule'
 * today, plus 'Pending Schedule' once agency submission ships. They carry
 * {Preferred Date} + {Preferred Time} but are NOT linked to the Saturday
 * Schedule row, so no rollup there sees them; this query does.
 *
 * Keyed preferred-date -> preferred-time -> count. A request with a preferred
 * date but no preferred time (a flexible ask) lands in no bucket here — it has
 * no cell. The set is small (it drains as Dawson books), so a single
 * 100-record page is enough.
 *
 * `excludeReferralId` drops that one referral from the tally — the Pick
 * Another modal passes the referral being rescheduled, so its own pending
 * request doesn't show as competition for the slot it's asking for. The soft
 * number is then "what ELSE wants this hour", not an echo of the decision
 * being made.
 */
export async function getSoftSlotCounts(
  fromISO: string,
  toISO: string,
  excludeReferralId?: string,
): Promise<SoftSlotCounts> {
  const formula =
    `AND(` +
    `OR({Appointment Status}='Reschedule', {Appointment Status}='Pending Schedule'), ` +
    `{Preferred Date}!='', ` +
    `NOT(IS_BEFORE({Preferred Date}, '${fromISO}')), ` +
    `NOT(IS_AFTER({Preferred Date}, '${toISO}'))` +
    (excludeReferralId ? `, RECORD_ID() != '${excludeReferralId}'` : '') +
    `)`

  const data = await airtableFetch(
    REFERRALS_TABLE,
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=100` +
      `&fields%5B%5D=Preferred%20Date&fields%5B%5D=Preferred%20Time`,
  )

  const out: SoftSlotCounts = {}
  for (const rec of data.records) {
    const dRaw = rec.fields['Preferred Date']
    const time = rec.fields['Preferred Time']
    if (typeof dRaw !== 'string' || !dRaw) continue
    if (typeof time !== 'string' || !TIME_ORDER.includes(time as TimeSlot)) continue
    const date = dRaw.slice(0, 10)
    const bucket = (out[date] ??= {})
    bucket[time as TimeSlot] = (bucket[time as TimeSlot] ?? 0) + 1
  }
  return out
}

/**
 * The date + time a single referral currently HOLDS. Feeds the capacity grid's
 * excludeReferralId: the referral being rescheduled must not count against its
 * own current cell. Returns null when the id is unknown or the referral holds
 * no slot — in which case the grid subtracts nothing (the prop is a no-op,
 * including when the held Saturday is outside the visible window: no row there
 * matches the returned date).
 */
export async function getReferralHeldSlot(
  id: string,
): Promise<{ date: string; time: TimeSlot } | null> {
  const rec = await airtableFetch(REFERRALS_TABLE, `/${id}`).catch(() => null)
  if (!rec) return null
  const raw = rec.fields?.['Appointment Date']
  const dRaw = Array.isArray(raw) ? raw[0] : raw
  const time = rec?.fields?.['Appointment Time']
  if (typeof dRaw !== 'string' || !dRaw) return null
  if (typeof time !== 'string' || !TIME_ORDER.includes(time as TimeSlot)) return null
  return { date: dRaw.slice(0, 10), time: time as TimeSlot }
}
