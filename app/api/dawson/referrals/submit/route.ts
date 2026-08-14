// app/api/dawson/referrals/submit/route.ts
//
// POST /api/dawson/referrals/submit
//
// Used by:
//   - app/dawson/referrals/new/page.tsx (Dawson's internal "Add Referral" form)
//
// ============================================================
// August 2026 — Clients-table rewrite (fixes a live write bug)
// ============================================================
// Client Referrals.First Name, Last Name, Address, Address 2, City, State,
// Zip, County, DOB, Preferred Language, and Phone are now ALL Lookup
// fields sourced from the linked Clients table (via the "Client" link
// field on Client Referrals). Airtable rejects direct writes to Lookup
// fields outright, and record creation is atomic -- the previous version
// of this route wrote all of those as plain fields on a brand-new Client
// Referrals record, so every submission was failing entirely.
//
// This rewrite makes the route client-first:
//
//   1. If `clientId` is present in the body, the frontend already called
//      /api/dawson/referrals/check-duplicate and the user confirmed this
//      is an existing Client in the modal -- link to that Client rather
//      than creating a new one. The form prefills DOB/phone/address/
//      city/state/zip from that Client so Dawson doesn't retype them, but
//      leaves them fully editable. If what actually gets submitted no
//      longer agrees with what's on file for that Client (see
//      clientDataDiverges in lib/referrals/match.ts), staff effectively told
//      us -- by editing it -- that this isn't confidently the same
//      person, so a fresh Client is created from the submitted values
//      instead of linking to (and disagreeing with) the matched one. We
//      still never overwrite the existing Client's fields directly, to
//      avoid a typo clobbering correct data on file.
//   2. If `rescheduleReferralId` is present, the user chose "reschedule
//      the existing no-show" in the banner -- moves that Client Referrals
//      record straight to a new date/time and Appointment Status =
//      Scheduled, using the same proven logic as
//      app/api/dawson/referrals/[id]/reschedule (ported in Aug 2026 -- see
//      rescheduleExistingReferral below). Returns early; nothing else in
//      this route runs.
//   3. Otherwise, find-or-create the Client (demographic fields live
//      there now), then create a new Client Referrals record linked to it
//      via the "Client" field, writing only fields that are still
//      genuinely writable on Client Referrals.
//
// Also NOT handled: if a no-show is being rebooked, this reuses whatever
// Referring Staff Link is already on that record rather than re-resolving
// agency/staff from the form. Flagging in case a different agency is
// re-engaging the same client.
//
// ============================================================
// Reschedule-existing-no-show branch (Aug 2026)
// ============================================================
// First shipped writing 'Appointment Status': 'Unscheduled' and a
// Preferred Date, on the assumption the same create-time auto-schedule
// automation would pick it up and assign a real Appointment Date/Time
// (see "new referral" scheduling behavior below). In practice it doesn't
// -- that automation appears to trigger on record CREATION, not on a
// PATCH to an already-existing record, so the status flipped but the
// date/time never got set. Fixed by porting the proven, synchronous
// logic from app/api/dawson/referrals/[id]/reschedule directly into
// rescheduleExistingReferral() below: look up the Saturday Schedule row
// for the picked date, resolve a time slot (explicit pick bypasses the
// cap; no pick auto-allocates the first open slot under cap), and write
// the Saturday Schedule link + Appointment Time + Scheduled status
// directly -- no automation dependency. Also carries over that route's
// Original Appointment Date/Time snapshot and Reschedule Notice email,
// since a no-show reopened back into a real appointment is, from the
// referring agency's perspective, genuinely the same kind of event.
//
// Scheduling behavior for a brand-new referral (June 30, 2026), unchanged:
//
//   This route creates the referral with Appointment Status = 'Unscheduled'.
//   The Airtable auto-schedule automation handles BOTH branches:
//
//     - Specific Date: script looks up the Saturday Schedule record for
//       the Preferred Date written here, picks the first open time slot,
//       flips status to Scheduled. Minimum lead time: 7 days.
//     - Flexible: script finds the next Saturday >= 21 days out with
//       Open status, Ready to Schedule = 1, and an open slot, picks it.
//
//   The form's available-dates endpoint already enforces the 7-day floor
//   on the date picker, so the specific-date path won't get a sub-7-day
//   date in normal use.
//
//   Item names cleaned in the form to the 6 valid select options
//   (verified in Airtable 06/30/26):
//     Bedroom Furniture, Dining Room Furniture, Living Room Furniture,
//     Household Items (including kitchen & linens), Clothes, Baby Items

import { NextResponse } from 'next/server'
import { findClientMatches, createClient, clientDataDiverges } from '@/lib/referrals/match'
import { sendRescheduleNotice } from '@/lib/notifications/reschedule-notice'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { TIME_CAPS, TIME_ORDER, VALID_TIMES, type TimeSlot } from '@/lib/schedule/capacity'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
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

// Slot names, capacities and fill order for the no-show reschedule branch.

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

// Look up a Saturday Schedule record by ISO date. Returns the full record
// (id + per-slot booked counts) or null.
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
      '9am': toInt(rec.fields['9am'] ?? rec.fields['9am Booked']),
      '10am': toInt(rec.fields['10am'] ?? rec.fields['10am Booked']),
      '11am': toInt(rec.fields['11am'] ?? rec.fields['11am Booked']),
      '12pm': toInt(rec.fields['12pm'] ?? rec.fields['12pm Booked']),
      '1pm': toInt(rec.fields['1pm'] ?? rec.fields['1pm Booked']),
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

// Create an Agency in 'Unclaimed' status (Source = Created via Referral).
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

// Create an Agency User in 'Unclaimed' status, linked to the given Agency.
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

// Reopens an existing no-show Client Referrals record as a fresh booking,
// instead of creating a brand-new record -- the "reschedule the existing
// no-show" branch from the Add Referral banner. Mirrors
// app/api/dawson/referrals/[id]/reschedule exactly: looks up the Saturday
// Schedule row for the picked date, resolves a time slot (an explicit
// pick from the time-slot pills bypasses the per-slot cap, same override
// authority Dawson has elsewhere; no pick auto-allocates the first open
// slot and DOES respect the cap), and writes the Saturday Schedule link +
// Appointment Time + Appointment Status = 'Scheduled' directly -- no
// dependency on the create-time auto-schedule automation, which doesn't
// appear to fire on an update to an already-existing record.
async function rescheduleExistingReferral(
  referralId: string,
  params: { preferredDate: string; appointmentTime?: string | null }
): Promise<{ appointmentTime: TimeSlot; rescheduleNotice: any }> {
  const hasTime = typeof params.appointmentTime === 'string' && VALID_TIMES.has(params.appointmentTime)

  // Snapshot current values for Original Appointment Date/Time -- a
  // no-show record typically still has its original Saturday Schedule
  // link + Appointment Time on file from before it was marked No Show, so
  // this fires the same as any other reschedule.
  const current = await getReferral(referralId)
  const currentScheduleLinks: string[] = current?.fields?.['Saturday Schedule'] ?? []
  const currentApptDateLookup = current?.fields?.['Appointment Date']
  const currentApptTime: string | undefined = current?.fields?.['Appointment Time']
  const currentApptDate: string | null = Array.isArray(currentApptDateLookup)
    ? (currentApptDateLookup[0] as string) ?? null
    : (currentApptDateLookup as string) ?? null
  const shouldSnapshot = currentScheduleLinks.length > 0 && !!currentApptTime && !!currentApptDate

  const scheduleRow = await findScheduleRecordByDate(params.preferredDate)
  if (!scheduleRow) {
    throw new Error(`No Saturday Schedule row found for ${params.preferredDate}.`)
  }

  let resolvedTime: TimeSlot
  if (hasTime) {
    resolvedTime = params.appointmentTime as TimeSlot
  } else {
    const picked = pickFirstOpenSlot(scheduleRow.bookedByTime)
    if (!picked) {
      throw new Error(
        `All 5 time slots on ${params.preferredDate} are at capacity. Pick a specific time to override, or choose a different Saturday.`
      )
    }
    resolvedTime = picked
  }

  const fields: Record<string, any> = {
    'Scheduling Flexibility': 'Specific Date',
    'Preferred Date': params.preferredDate,
    'Saturday Schedule': [scheduleRow.id],
    'Appointment Time': resolvedTime,
    'Appointment Status': 'Scheduled',
  }
  if (shouldSnapshot) {
    fields['Original Appointment Date'] = currentApptDate
    fields['Original Appointment Time'] = currentApptTime
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${referralId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`Failed to reschedule existing referral: ${await res.text()}`)

  // Same as the proven route: only fire the notice when there was a
  // genuine previous appointment to report. That failing does NOT fail
  // this request -- the Airtable write above is what matters
  // operationally.
  let rescheduleNotice: any = null
  if (shouldSnapshot) {
    rescheduleNotice = await sendRescheduleNotice(referralId, currentApptDate, currentApptTime ?? null)
  }

  return { appointmentTime: resolvedTime, rescheduleNotice }
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
    preferredDate, flexible, appointmentTime,
    // case 1 (both exist)
    agencyId, staffId,
    // case 2 + 3 (new staff)
    newStaff,
    // case 3 only (new agency)
    newAgency,
    // Clients-table dedup -- set by the Add Referral form after the user
    // confirms a match in the check-duplicate modal (omitted entirely if
    // no match was found / this is a genuinely new client).
    clientId,
    rescheduleReferralId,
    // True once the frontend has already resolved the duplicate-check step
    // (modal shown and dismissed, or check-duplicate came back with no
    // scenarios worth surfacing) -- tells this route to trust that and
    // skip its own findClientMatches fallback, so a Dawson-confirmed "not
    // the same person" doesn't get silently re-flagged as a duplicate.
    skipDuplicateCheck,
  } = body

  // ---- Scheduling validation ----
  const isFlexible = flexible === true
  if (!isFlexible) {
    if (!preferredDate) {
      return NextResponse.json({ error: 'Preferred date is required when not flexible.' }, { status: 400 })
    }
    if (!isSaturday(preferredDate)) {
      return NextResponse.json({ error: 'Preferred date must be a Saturday.' }, { status: 400 })
    }
  }

  // ---- Reschedule-existing-no-show branch ----
  // Short-circuits everything else -- no new Client or Client Referrals
  // record gets created.
  if (rescheduleReferralId) {
    try {
      const result = await rescheduleExistingReferral(rescheduleReferralId, { preferredDate, appointmentTime })
      return NextResponse.json({ success: true, rescheduled: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  // ---- Resolve scheduling for a brand-new referral ----
  // Previously just set Appointment Status = 'Unscheduled' + Preferred
  // Date and relied on an Airtable auto-schedule automation to assign a
  // real Saturday Schedule link + Appointment Time. Confirmed Aug 2026
  // that isn't reliably happening -- referrals were landing Unscheduled
  // with no date/time ever assigned, same symptom as the no-show
  // reschedule bug. Fixed the same way: look up the Saturday Schedule row
  // directly and write the assignment ourselves. Only covers the
  // Specific Date path -- the only one reachable from the current UI
  // (there's no Flexible toggle exposed on the form, so isFlexible is
  // always false in practice today). Flexible is left on the old
  // automation-dependent behavior since it's untested/unused right now --
  // flagging rather than guessing at the "next Saturday >= 21 days out"
  // allocation logic that automation was supposed to handle.
  let scheduleFields: Record<string, any> = { 'Appointment Status': 'Unscheduled' }

  if (!isFlexible && preferredDate) {
    const scheduleRow = await findScheduleRecordByDate(preferredDate)
    if (!scheduleRow) {
      return NextResponse.json({ error: `No Saturday Schedule row found for ${preferredDate}.` }, { status: 400 })
    }
    const hasTime = typeof appointmentTime === 'string' && VALID_TIMES.has(appointmentTime)
    let resolvedTime: TimeSlot
    if (hasTime) {
      resolvedTime = appointmentTime as TimeSlot
    } else {
      const picked = pickFirstOpenSlot(scheduleRow.bookedByTime)
      if (!picked) {
        return NextResponse.json(
          { error: `All 5 time slots on ${preferredDate} are at capacity. Pick a specific time to override, or choose a different Saturday.` },
          { status: 400 }
        )
      }
      resolvedTime = picked
    }
    scheduleFields = {
      'Saturday Schedule': [scheduleRow.id],
      'Appointment Time': resolvedTime,
      'Appointment Status': 'Scheduled',
      'Preferred Date': preferredDate,
    }
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

  // ---- Resolve client (existing Clients record, or create a new one) ----
  const dobFormatted = formatDOB(dob)
  let resolvedClientId: string
  let isDuplicate = false

  try {
    if (clientId) {
      // Frontend already ran check-duplicate and the user confirmed this
      // is the same person -- but the demographic fields on the form were
      // prefilled from that Client and left editable, so double-check
      // what was actually submitted still agrees with what's on file
      // before linking to it. An edit that diverges (different DOB,
      // phone, or address) means staff effectively decided mid-form this
      // isn't confidently the same record -- fork off a fresh Client from
      // what they actually typed instead.
      const diverges = await clientDataDiverges(clientId, { dob: dobFormatted, phone, address, city, state, zip })
      if (diverges) {
        isDuplicate = false
        resolvedClientId = await createClient({
          firstName, lastName, dob: dobFormatted, address, address2, city, state, zip, county, phone, language,
        })
      } else {
        resolvedClientId = clientId
        isDuplicate = true
      }
    } else if (skipDuplicateCheck) {
      // Frontend already resolved this (modal shown and dismissed as "not
      // the same person", or check-duplicate found nothing worth
      // surfacing) -- trust it rather than re-running the check and
      // potentially flagging a false positive Dawson already ruled out.
      isDuplicate = false
      resolvedClientId = await createClient({
        firstName,
        lastName,
        dob: dobFormatted,
        address,
        address2,
        city,
        state,
        zip,
        county,
        phone,
        language,
      })
    } else {
      // No confirmed match passed in and the frontend never resolved this
      // (e.g. programmatic call bypassing the UI) -- double-check
      // server-side so 'Possible Duplicate' still reflects reality.
      const matches = await findClientMatches({ firstName, lastName, dob: dobFormatted, phone })
      isDuplicate = matches.length > 0

      resolvedClientId = await createClient({
        firstName,
        lastName,
        dob: dobFormatted,
        address,
        address2,
        city,
        state,
        zip,
        county,
        phone,
        language,
      })
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Client resolution failed: ${e.message}` }, { status: 500 })
  }

  // ---- Build referral fields ----
  // Only fields that are still genuinely writable directly on Client
  // Referrals. First Name, Last Name, Address, Address 2, City, State,
  // Zip, County, DOB, Preferred Language, and Phone are all Lookups from
  // the linked Client now -- do NOT write them here.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const fields: Record<string, any> = {
    'Client': [resolvedClientId],
    '# in HH': parseInt(hhSize),
    '# Children': parseInt(children),
    'Items Requested': items,
    'Referral Date': today,
    'Referring Staff Link': [resolvedStaffId],
    'Referral Review': 'Approved',
    'Possible Duplicate': isDuplicate,
    'Scheduling Flexibility': isFlexible ? 'Flexible' : 'Specific Date',
    'Was New Agency': wasNewAgency,
    ...scheduleFields,
  }

  if (notes) fields['Internal Notes'] = notes

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

  return NextResponse.json({ success: true, duplicate: isDuplicate, wasNewAgency })
}
