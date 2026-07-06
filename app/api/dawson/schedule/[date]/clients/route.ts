// app/api/dawson/schedule/[date]/clients/route.ts
//
// Returns the roster of Scheduled Client Referrals for a given Saturday.
// Consumed by the print sheets page (/dawson/schedule/[date]/print).
//
// ---------------------------------------------------------------------------
// July 2026 CLIENTS FORK — identity fields are now lookups
// ---------------------------------------------------------------------------
// On Client Referrals, all 11 client-identity fields (First Name, Last Name,
// DOB, Phone, Address, Address 2, City, State, Zip, County, Preferred
// Language) are now LOOKUPS from the linked Client record, not text/date
// fields on the referral itself. Lookups always return arrays:
//   - string lookups   -> ["Smith"]
//   - date lookups     -> ["1985-04-12"]     (ISO string)
//   - numeric lookups  -> [12345]             (Zip)
// We must unwrap every one of these before serializing to the client.
// ---------------------------------------------------------------------------


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


// Numeric lookups (Zip) return [12345] not ["12345"]. Coerce to string
// so the print sheet renders "07090" not the number 7090.
function safeLookupNumberAsString(value: unknown): string | null {
  const v = unwrapLookup<unknown>(value)
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    if (REC_ID_RE.test(v)) return null
    return v
  }
  return null
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


  // NOTE: We can no longer sort by {Last Name} at the API level — it's a
  // lookup array now, and Airtable's sort doesn't handle those cleanly.
  // We sort in JS below after unwrapping.
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}?filterByFormula=${formula}`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )


  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })


  const data = await res.json()


  const clients = data.records
    .map((r: any) => {
      // Unwrap all identity lookups once, up front.
      const firstName = safeLookupString(r.fields['First Name']) ?? ''
      const lastName = safeLookupString(r.fields['Last Name']) ?? ''


      return {
        id: r.id,
        firstName,
        lastName,
        clientName: `${firstName} ${lastName}`.trim(),
        address: safeLookupString(r.fields['Address']),
        address2: safeLookupString(r.fields['Address 2']),
        city: safeLookupString(r.fields['City']),
        state: safeLookupString(r.fields['State']),
        zip: safeLookupNumberAsString(r.fields['Zip']),
        phone: safeLookupString(r.fields['Phone']),
        dob: safeLookupString(r.fields['DOB']),
        language: safeLookupString(r.fields['Preferred Language']),
        // # in HH / # Children live on Client Referrals directly (not lookups).
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
      }
    })
    .sort((a: any, b: any) => {
      const lastCmp = a.lastName.localeCompare(b.lastName)
      if (lastCmp !== 0) return lastCmp
      return a.firstName.localeCompare(b.firstName)
    })


  return NextResponse.json(clients)
}
