// app/api/dawson/schedule/[date]/clients/route.ts
//
// Returns the roster of Scheduled Client Referrals for a given Saturday.
// Consumed by the print sheets page (/dawson/schedule/[date]/print).

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

// --- Lookup helpers (defensive) --------------------------------------------
// Airtable lookup fields ALWAYS return arrays, even when the source is a
// single-record link. And if a "lookup" is misconfigured to point at another
// link field, it will surface record IDs (e.g. "recAbCd1234...") that would
// render verbatim in the UI. `safeLookupString` normalizes both cases:
//   - unwraps single-element arrays
//   - filters out record-ID strings so they never leak to the UI

const REC_ID_RE = /^rec[a-zA-Z0-9]{14,}$/

function unwrapLookup<T = string>(value: unknown): T | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value[0] as T
  }
  return value as T
}

function safeLookupString(value: unknown): string | null {
  const v = unwrapLookup<string>(value)
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  if (REC_ID_RE.test(v)) return null
  return v
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { date } = await params

  // AT stores Appointment Date as a lookup from Saturday Schedule; compare
  // as a day-level date so timezone shifts don't cause off-by-one misses.
  const [year, month, day] = date.split('-')
  const atDate = `${parseInt(month)}/${parseInt(day)}/${year}`

  const formula = encodeURIComponent(
    `AND({Appointment Status} = "Scheduled", IS_SAME({Appointment Date}, "${atDate}", 'day'))`
  )

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}?filterByFormula=${formula}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })

  const data = await res.json()

  const clients = data.records
    .map((r: any) => ({
      id: r.id,
      firstName: (r.fields['First Name'] as string) ?? '',
      lastName: (r.fields['Last Name'] as string) ?? '',
      clientName: `${(r.fields['First Name'] as string) ?? ''} ${(r.fields['Last Name'] as string) ?? ''}`.trim(),
      address: (r.fields['Address'] as string) ?? null,
      address2: (r.fields['Address 2'] as string) ?? null,
      city: (r.fields['City'] as string) ?? null,
      state: (r.fields['State'] as string) ?? null,
      zip: (r.fields['Zip'] as string) ?? null,
      phone: (r.fields['Phone'] as string) ?? null,
      dob: (r.fields['DOB'] as string) ?? null,
      language: (r.fields['Preferred Language'] as string) ?? null,
      hhSize: (r.fields['# in HH'] as string) ?? null,
      children: (r.fields['# Children'] as string) ?? null,
      items: (r.fields['Items Requested'] as string) ?? null,
      // Appointment Date is a lookup from Saturday Schedule -> array shape.
      appointmentDate: (r.fields['Appointment Date'] as string[])?.[0] ?? null,
      appointmentTime: (r.fields['Appointment Time'] as string) ?? null,
      // Referring Staff / Referring Agency are lookups through Referring
      // Staff Link -> Agency Users. Use safeLookupString to unwrap the
      // array and defensively strip record IDs (in case the lookup is
      // ever reconfigured to point at a link field again).
      referredBy: safeLookupString(r.fields['Referring Staff']),
      referringAgency: safeLookupString(r.fields['Referring Agency']),
      externalNotes: (r.fields['External Notes'] as string) ?? null,
    }))
    .sort((a: any, b: any) => a.lastName.localeCompare(b.lastName))

  return NextResponse.json(clients)
}
