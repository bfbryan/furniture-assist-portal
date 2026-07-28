// app/api/dawson/referrals/submit/route.ts
//
// POST /api/dawson/referrals/submit
//
// Used by:
//   - app/dawson/referrals/new/page.tsx (Dawson's internal "Add Referral" form)
//
// Scheduling behavior (Flexible removed from Dawson's UI):
//   - Date + Time  -> bypass automation. Direct write to 'Scheduled'.
//                     Dawson has AT-level override authority so we do NOT
//                     enforce per-slot caps here.
//   - Date only    -> backend allocator. Reads per-slot booked counts off
//                     the Saturday Schedule row, picks the first slot
//                     under cap (fill order 9am -> 10am -> 11am -> 12pm ->
//                     1pm), and writes 'Scheduled' directly. If all 5
//                     slots are at cap, falls back to 'Unscheduled' +
//                     Preferred Date so the auto-schedule automation can
//                     take a second pass (or ops can intervene).
//
// July 2026 schema migration — CLIENTS TABLE FORK (COMPLETE):
//   Client identity moved off Client Referrals onto the Clients table.
//   Client identity fields on Client Referrals (First Name, Last Name,
//   DOB, Phone, Address, Address 2, City, State, Zip, County, Preferred
//   Language) are now LOOKUPS through the {Client} link — NOT writable.
//   Airtable returns 422 on any write to a lookup field.
//
//   Referral flow:
//     1. Validate scheduling
//     2. Resolve Agency (existing or create Unclaimed)
//     3. Resolve Staff  (existing or create Unclaimed)
//     4. Resolve Client (find by Unique ID / create with identity fields)
//     5. Duplicate check against Client's prior referrals
//     6. Allocate time slot if not provided
//     7. Create referral — writes per-visit fields + Client link only
//
// Duplicate detection:
//   Flags when the same Client already has a referral for the same
//   Preferred Date. Query strategy: find Client by Unique ID, then look
//   for any linked referral whose Preferred Date matches.


import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'


const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}


const VALID_TIMES = new Set(['9am', '10am', '11am', '12pm', '1pm'])


// Per-slot capacities -- MUST match at-auto-schedule-script.js TIME_CAPS,
// components/dawson/modals/RescheduleModal.tsx SLOT_CAP, the
// SLOT_MAX constant on app/dawson/schedule/page.tsx, and the reschedule
// route's TIME_CAPS. Consolidation into lib/schedule/allocator.ts is
// deferred (see session notes).
type TimeSlot = '9am' | '10am' | '11am' | '12pm' | '1pm'
const TIME_CAPS: Record<TimeSlot, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}
const TIME_ORDER: TimeSlot[] = ['9am', '10am', '11am', '12pm', '1pm']


function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}


function formatDOB(dob: string) {
  const [y, m, d] = dob.split('-')
  return `${m}/${d}/${y}`
}


function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return !isNaN(dt.getTime()) && dt.getDay() === 6
}


/**
 * Client dedupe key — matches the Clients table primary formula:
 *   {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 */
function buildClientUniqueId(firstName: string, lastName: string, dobFormatted: string): string {
  return `${lastName.trim()}-${firstName.trim()}-${dobFormatted}`
}


// Duplicate detection (post-fork):
//   Flags when the given Client (by record ID) already has a referral
//   for the same Preferred Date. Returns false when clientId is null
//   (new client) or when preferredDate is absent.
async function checkDuplicate(
  clientId: string | null,
  preferredDate: string | null | undefined,
): Promise<boolean> {
  if (!clientId || !preferredDate) return false
  const formula = encodeURIComponent(
    `AND(FIND("${clientId}", ARRAYJOIN({Client})) > 0, IS_SAME({Preferred Date}, "${preferredDate}", 'day'))`
  )
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  const data = await res.json()
  return data.records && data.records.length > 0
}


// Look up Client by Unique ID (Last-First-DOB). Returns record ID or null.
async function findClientByUniqueId(clientUniqueId: string): Promise<string | null> {
  const safe = clientUniqueId.replace(/"/g, '\\"')
  const formula = encodeURIComponent(`{Unique ID} = "${safe}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Clients?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Client lookup failed: ${await res.text()}`)
  const data = await res.json()
  if (!data.records || data.records.length === 0) return null
  return data.records[0].id as string
}


// Create a Client record. Called only when findClientByUniqueId returned null.
// Note: on returning-client visits we do NOT update Client contact/address —
// that lives on the profile-claim flow. This prevents accidental overwrites.
async function createClient(params: {
  firstName: string
  lastName: string
  dobFormatted: string
  phone?: string
  address?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  preferredLanguage?: string
}): Promise<string> {
  const fields: Record<string, any> = {
    'First Name': params.firstName,
    'Last Name': params.lastName,
    'DOB': params.dobFormatted,
    'Status': 'Active',
  }
  if (params.phone) fields['Phone'] = params.phone
  if (params.address) fields['Address'] = params.address
  if (params.address2) fields['Address 2'] = params.address2
  if (params.city) fields['City'] = params.city
  if (params.state) fields['State'] = params.state
  if (params.zip) fields['Zip'] = params.zip
  if (params.county) fields['County'] = params.county
  if (params.preferredLanguage) fields['Preferred Language'] = params.preferredLanguage


  const url = `https://api.airtable.com/v0/${BASE_ID}/Clients`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to create client: ${await res.text()}`)
  const data = await res.json()
  return data.id
}


// Look up a Saturday Schedule record by ISO date. Returns the record id
// plus per-slot booked counts, or null if not found. Uses DATETIME_FORMAT
// to compare on YYYY-MM-DD regardless of AT's stored datetime precision.
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


async function createUnclaimedAgency(name: string): Promise<{ id: string; name: string }> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agencies`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      fields: {
        'Agency Name': name,
        'Status': 'Unclaimed',
        'Source': 'Created via Referral',
      },
      typecast: true,
    }),
  })
  if (!res.ok) throw new Error(`Failed to create agency: ${await res.text()}`)
  const data = await res.json()
  return { id: data.id, name: data.fields['Agency Name'] }
}


async function createUnclaimedAgencyUser(params: {
  agencyId: string
  firstName: string
  lastName: string
  email: string
  phone: string
}): Promise<string> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Agency%20Users`
  const fields: Record<string, any> = {
    'First Name': params.firstName,
    'Last Name': params.lastName,
    'Email': params.email,
    'Status': 'Unclaimed',
    'Role': 'Staff',
    'Agency': [params.agencyId],
  }
  if (params.phone) fields['Phone Number'] = params.phone


  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to create agency user: ${await res.text()}`)
  const data = await res.json()
  return data.id
}


export async function POST(req: Request) {
  const denied = await requireDawsonAccess()
  if (denied) return denied


  const body = await req.json()


  const {
    // client info
    firstName, lastName, address, address2, city, state, zip,
    phone, county, hhSize, children, dob, language, items, notes,
    // scheduling
    preferredDate, appointmentTime,
    // case 1 (both exist)
    agencyId, staffId,
    // case 2 + 3
    newStaff,
    // case 3 only
    newAgency,
  } = body


  // ---- Scheduling validation ----
  // Dawson's form always requires a preferred Saturday now (Flexible was
  // removed from his UI). Time is optional; if omitted we allocate.
  if (!preferredDate) {
    return NextResponse.json({ error: 'Preferred date is required.' }, { status: 400 })
  }
  if (!isSaturday(preferredDate)) {
    return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
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


  // ---- Resolve agency (existing or new) ----
  let resolvedAgencyId: string
  let wasNewAgency = false


  try {
    if (newAgency) {
      if (!newAgency.name) {
        return NextResponse.json({ error: 'New agency requires a name.' }, { status: 400 })
      }
      const created = await createUnclaimedAgency(newAgency.name)
      resolvedAgencyId = created.id
      wasNewAgency = true
    } else {
      if (!agencyId) {
        return NextResponse.json({ error: 'Agency is required.' }, { status: 400 })
      }
      resolvedAgencyId = agencyId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Agency creation failed: ${e.message}` }, { status: 500 })
  }


  // ---- Resolve staff (existing or new) ----
  let resolvedStaffId: string


  try {
    if (newStaff) {
      if (!newStaff.firstName || !newStaff.lastName || !newStaff.email) {
        return NextResponse.json({ error: 'New staff requires first name, last name, and email.' }, { status: 400 })
      }
      resolvedStaffId = await createUnclaimedAgencyUser({
        agencyId: resolvedAgencyId,
        firstName: newStaff.firstName,
        lastName: newStaff.lastName,
        email: newStaff.email,
        phone: newStaff.phone || '',
      })
    } else {
      if (!staffId) {
        return NextResponse.json({ error: 'Staff member is required.' }, { status: 400 })
      }
      resolvedStaffId = staffId
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Staff creation failed: ${e.message}` }, { status: 500 })
  }


  // ---- Resolve client (existing or new) ----
  const dobFormatted = formatDOB(dob)
  const clientUniqueId = buildClientUniqueId(firstName, lastName, dobFormatted)
  let resolvedClientId: string
  let clientCreated = false


  try {
    const existingClientId = await findClientByUniqueId(clientUniqueId)
    if (existingClientId) {
      resolvedClientId = existingClientId
    } else {
      resolvedClientId = await createClient({
        firstName,
        lastName,
        dobFormatted,
        phone,
        address,
        address2,
        city,
        state,
        zip,
        county,
        preferredLanguage: language,
      })
      clientCreated = true
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Client resolution failed: ${e.message}` }, { status: 500 })
  }


  // ---- Duplicate flag ----
  const isDuplicate = await checkDuplicate(resolvedClientId, preferredDate)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })


  // ---- Look up Saturday Schedule row (needed for both time-picked and
  //      allocator paths). Fail fast if the row doesn't exist.
  const scheduleRow = await findScheduleRecordByDate(preferredDate)
  if (!scheduleRow) {
    return NextResponse.json(
      { error: `No Saturday Schedule row found for ${preferredDate}.` },
      { status: 400 }
    )
  }


  // ---- Resolve time slot: Dawson-picked wins; otherwise allocate.
  //   - Dawson-picked: override allowed, no cap check.
  //   - Allocator:     first slot under cap in fill order. If all 5 are
  //                    full we fall through to Unscheduled + Preferred
  //                    Date and let auto-schedule take another pass.
  let resolvedTime: TimeSlot | null
  if (hasTime) {
    resolvedTime = appointmentTime as TimeSlot
  } else {
    resolvedTime = pickFirstOpenSlot(scheduleRow.bookedByTime)
  }


  // ---- Build referral fields ----
  const fields: Record<string, any> = {
    '# in HH': parseInt(hhSize),
    '# Children': parseInt(children),
    'Items Requested': items,
    'Referral Date': today,
    'Referring Staff Link': [resolvedStaffId],
    'Client': [resolvedClientId],
    'Referral Review': 'Approved',
    'Possible Duplicate': isDuplicate,
    'Scheduling Flexibility': 'Specific Date',
    'Preferred Date': preferredDate,
    'Was New Agency': wasNewAgency,
  }


  if (notes) fields['Internal Notes'] = notes


  if (resolvedTime) {
    fields['Saturday Schedule'] = [scheduleRow.id]
    fields['Appointment Time'] = resolvedTime
    fields['Appointment Status'] = 'Scheduled'
  } else {
    // All 5 slots at cap on the requested date. Leave Unscheduled with
    // Preferred Date set so ops (or the auto-schedule automation, if
    // still on) can retry. Dawson can also re-open and override.
    fields['Appointment Status'] = 'Unscheduled'
  }


  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })


  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }


  return NextResponse.json({
    success: true,
    duplicate: isDuplicate,
    wasNewAgency,
    clientCreated,
    appointmentTime: resolvedTime,
    allocated: !hasTime && resolvedTime !== null,
    allSlotsFull: !hasTime && resolvedTime === null,
  })
}
