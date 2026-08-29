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
// First shipped writing a no-slot Appointment Status ('Pending Schedule')
// and a Preferred Date, on the assumption the same create-time auto-schedule
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
// Scheduling behavior for a brand-new referral (Aug 2026):
//
//   Both branches are resolved HERE, synchronously, before the record is
//   created. Nothing is left for an automation to finish.
//
//     - Specific Date: look up the Saturday Schedule record for the
//       Preferred Date, take the explicitly picked time if there is one
//       (Dawson's override, uncapped) or the first slot under cap if not,
//       and create the referral already Scheduled.
//     - Flexible: findNextFlexibleSlot() in lib/schedule/flexible.ts picks
//       the next Saturday at least 14 days out that is under the 50-appointment
//       day cap and still has an hour under its own cap.
//
//   The form's available-dates endpoint already enforces the 7-day floor
//   on the date picker, so the specific-date path won't get a sub-7-day
//   date in normal use.
//
//   HISTORY, because the numbers here were wrong for a while: this used to
//   create the referral with no slot and rely on the Airtable automation
//   at-auto-schedule-script.js to assign a date — 7 days minimum on the
//   specific-date branch, 21 on the flexible one. That automation has been
//   switched off. The specific-date branch was moved into code first; the
//   flexible branch followed, at the 14 days Ben confirmed. 21 is dead.
//
//   Item names cleaned in the form to the 6 valid select options
//   (verified in Airtable 06/30/26):
//     Bedroom Furniture, Dining Room Furniture, Living Room Furniture,
//     Household Items (including kitchen & linens), Clothes, Baby Items

import { NextResponse } from 'next/server'
import { findClientMatches, createClient, clientDataDiverges } from '@/lib/referrals/match'
import { sendRescheduleNotice } from '@/lib/notifications/reschedule-notice'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { pickFirstOpenSlot, VALID_TIMES, type TimeSlot } from '@/lib/schedule/capacity'
import { findNextFlexibleSlot, FLEXIBLE_LEAD_DAYS } from '@/lib/schedule/flexible'
import { assertClientMayBeReferred, DoNotServeError } from '@/lib/clients/do-not-serve'

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

// Read the current referral so we can snapshot its pre-reschedule
// Saturday Schedule + Appointment Time into the Original fields.
async function getReferral(id: string): Promise<any | null> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) return null
  return await res.json()
}

// Create an Agency in 'Unclaimed' status (Source = Created via Referral).
//
// Name only, and that is not an omission. The Add Referral form used to collect
// a required "Agency Email" alongside it; this function never read it, and
// Agencies has had no general-email column since the June 2026 migration moved
// agency contact details onto the Primary Admin link. The field has been
// removed from both places that asked for it.
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
//
// OPEN QUESTION (raised in the PR, deliberately not decided here): when this
// runs as part of creating a NEW agency, the person is created with Role
// 'Staff' and the Agency is left with no Primary Admin. Ben has described this
// person both as "staff" and as "admin name and email to start". The two are
// not the same: the invite flow cascades an agency to Approved through its
// Primary Admin (see stampFirstLogin in lib/airtable/agency-users.ts), so an
// agency created this way currently has nobody who can claim it. Role is
// UNCHANGED until Ben says which he meant.
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

  // Do-not-serve applies here too. This branch writes no new Client Referrals
  // record, so it is not "creating a referral" in the literal sense — but it
  // takes a no-show and puts that client back on a Saturday with a real time
  // slot, which is the thing the flag exists to prevent. Leaving it out would
  // mean the SAME banner that warns Dawson a client is flagged also carries a
  // "Reschedule this appointment" button that sails straight past the block,
  // while the button beside it is refused.
  //
  // Throws DoNotServeError, which the POST handler turns into a 403 rather
  // than the generic 500 this function's other failures produce.
  const currentClientLinks: string[] = current?.fields?.['Client'] ?? []
  if (currentClientLinks[0]) {
    await assertClientMayBeReferred(currentClientLinks[0])
  }

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
    // Re-arm the Monday reminder for the NEW date. The "Reminder Email Pending"
    // view only matches rows where 'Reminder Email Sent' is blank, so a record
    // that was already reminded for its previous appointment never re-enters
    // the view and the client is never reminded about the new one.
    //
    // This is the same re-arm lib/referrals/reschedule.ts does. It was added
    // there and missed here, because this branch is a second copy of that
    // logic rather than a call to it. Two live records rescheduled through
    // this path onto 2026-08-22 were skipped by the 2026-08-17 reminder run
    // for exactly this reason.
    'Reminder Email Sent': false,
    'Reminder Sent At': null,
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
      if (e instanceof DoNotServeError) {
        return NextResponse.json({ error: e.message, doNotServe: true }, { status: 403 })
      }
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  // ---- Resolve scheduling for a brand-new referral ----
  // Previously just set Appointment Status to a no-slot value + Preferred
  // Date and relied on an Airtable auto-schedule automation to assign a
  // real Saturday Schedule link + Appointment Time. Confirmed Aug 2026
  // that isn't reliably happening -- referrals were landing with no
  // date/time ever assigned, same symptom as the no-show reschedule bug.
  // Fixed the same way: look up the Saturday Schedule row directly and
  // write the assignment ourselves.
  //
  // BOTH branches are now in code. Flexible used to be left on the old
  // automation, which has since been switched off entirely -- so a flexible
  // referral was created with no slot and then nothing on earth moved it.
  // See lib/schedule/flexible.ts for the rule it now follows.
  //
  // The initial value is the fall-through only: both branches below
  // overwrite it with 'Scheduled'. 'Pending Schedule' is the single
  // no-slot-yet Appointment Status.
  let scheduleFields: Record<string, any> = { 'Appointment Status': 'Pending Schedule' }

  if (isFlexible) {
    // No date was asked for, so pick one: next Saturday at least
    // FLEXIBLE_LEAD_DAYS out that is under the 50 day cap and still has an
    // hour under its own cap.
    let assignment
    try {
      assignment = await findNextFlexibleSlot()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: `Could not look up available Saturdays: ${msg}` },
        { status: 500 },
      )
    }
    if (!assignment) {
      // Refused rather than created-and-left-unscheduled. A referral sitting
      // with no slot forever and nobody watching it is precisely the failure
      // this replaced, so it must not be reintroduced as the error path.
      return NextResponse.json(
        {
          error:
            `No Saturday in the next six months has room for a flexible referral ` +
            `(needs to be at least ${FLEXIBLE_LEAD_DAYS} days out, under the 50-appointment ` +
            `day cap, and with a time slot under its own cap). Pick a specific date and time instead.`,
        },
        { status: 409 },
      )
    }
    scheduleFields = {
      'Saturday Schedule': [assignment.scheduleId],
      'Appointment Time': assignment.time,
      'Appointment Status': 'Scheduled',
      // Deliberately NOT writing Preferred Date. Nobody preferred this date --
      // we chose it. Scheduling Flexibility below records 'Flexible', which is
      // what says so, and leaving Preferred Date empty keeps "what the agency
      // asked for" honest on the Awaiting Review page.
    }
  } else if (preferredDate) {
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

  // ---- Do-not-serve block ----
  // The last thing checked before a referral record comes into existence, and
  // deliberately placed AFTER client resolution rather than earlier: which
  // Client this referral attaches to is only settled above, and that Client is
  // what the flag lives on. Checking any sooner would be checking the wrong
  // record in the divergence case, where a submitted edit forks off a fresh
  // Client from the one the form matched.
  //
  // A freshly created Client cannot be flagged, so in practice this fires only
  // on the branch that LINKS an existing one. It is run unconditionally
  // anyway, because "this branch can't be blocked" is the kind of thing that
  // stops being true quietly.
  //
  // No override exists here by design. See lib/clients/do-not-serve.ts.
  try {
    await assertClientMayBeReferred(resolvedClientId)
  } catch (e: unknown) {
    if (e instanceof DoNotServeError) {
      return NextResponse.json({ error: e.message, doNotServe: true }, { status: 403 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Could not verify this client's do-not-serve status, so the referral was not created: ${msg}` },
      { status: 502 },
    )
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
