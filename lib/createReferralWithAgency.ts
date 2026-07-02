/**
 * createReferralWithAgency
 * ------------------------
 * Single source of truth for the "create a referral" write path.
 *
 * Used by:
 *   - /api/dawson/admin/import-referrals (bulk Excel import — Weeks 1-4 scaffolding)
 *   - /api/dawson/referrals (future portal form — Week 5+ when Dawson moves off Excel)
 *
 * Schema migration (June 2026):
 *   - Referring Agency, Referring Staff, Agency Email, Staff Phone on
 *     Client Referrals are now LOOKUPS through the Referring Staff Link
 *     field. We DO NOT write to them — Airtable computes them from the
 *     linked Agency User (and through that user, the Agency).
 *   - When the Excel row has no usable staff identity (no email AND no
 *     first/last name) the referral is created with NO Referring Staff
 *     Link. The agency claim flow will repair the link later.
 *   - When the row has a name but no email (Option B), we create a
 *     placeholder Agency User with Needs Review = true so the agency
 *     admin sees them at claim time and either confirms, merges, or
 *     deletes them.
 *
 * Idempotency:
 *   - Agency: matched by normalized Agency Name (case/whitespace-insensitive).
 *     If new → created with Status="Unclaimed", Source="Created via Referral".
 *   - Agency User: matched by normalized email within that agency's user list.
 *     If new (and email present) → Status="Unclaimed", no Role, no Clerk User ID.
 *     If created from name-only Excel data → Status="Unclaimed", Needs Review=true.
 *   - Client Referral: matched by Unique ID (LastName-FirstName-DOB).
 *     If exists → returns { status: 'skipped' } without any writes.
 *     If new → inserted with Referral Review="Approved" (Dawson pre-vetted),
 *     and Appointment Status="Scheduled" if appointment date provided, else "Pending Schedule".
 */

import Airtable from 'airtable'

// ---------- Types ----------

export type ReferralInput = {
  // Client
  firstName: string
  lastName: string
  // DOB is preferred for dedupe but may be blank — buildUniqueId will fall
  // back to appointmentDate.
  dob?: string | null
  phone?: string | null
  address?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  preferredLanguage?: string | null
  hhSize?: number | null
  children?: number | null

  // Agency + Staff (only agencyName is required — Dawson's intake often has
  // no staff name or email; in that case we just create the Referral without
  // an Agency User and let the agency claim later)
  agencyName: string
  staffFirstName?: string | null
  staffLastName?: string | null
  staffPhone?: string | null
  staffEmail?: string | null

  // Referral metadata. referralDate is optional; falls back to
  // appointmentDate when missing.
  referralDate?: string | null
  appointmentDate?: string | null
  appointmentTime?: string | null
  itemsRequested?: string | null // comma-separated string OR array
  externalNotes?: string | null
  internalNotes?: string | null
  preferredDate?: string | null
  schedulingFlexibility?: string | null
}

export type CreateResult =
  | {
      status: 'created'
      uniqueId: string
      referralId: string
      agencyId: string
      staffId?: string
      agencyCreated: boolean
      staffCreated: boolean
      staffNeedsReview?: boolean // true when staff was created as a name-only placeholder
    }
  | { status: 'skipped'; uniqueId: string; existingReferralId: string; reason: 'duplicate_unique_id' }
  | { status: 'error'; reason: string; field?: string }

// Minimal shape Airtable returns from .create() / .select() — keeps us out of
// the airtable package's overloaded type soup.
type AirtableRecord = { id: string; get: (field: string) => unknown }

// ---------- Config ----------

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'app0DK6F9KoTm38Po'
const TABLES = {
  AGENCIES: 'Agencies',
  AGENCY_USERS: 'Agency Users',
  CLIENT_REFERRALS: 'Client Referrals',
  SATURDAY_SCHEDULE: 'Saturday Schedule',
}

function getBase() {
  const apiKey = process.env.AIRTABLE_API_KEY
  if (!apiKey) throw new Error('AIRTABLE_API_KEY missing')
  return new Airtable({ apiKey }).base(BASE_ID)
}

// ---------- Normalizers ----------

function normName(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normEmail(s: string): string {
  return (s || '').trim().toLowerCase()
}

function toMDY(input: string): string {
  // Accept MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD. Return MM/DD/YYYY.
  if (!input) return ''
  const s = input.trim()
  // ISO YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, y, m, d] = iso
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`
  }
  // MM/DD/YYYY (already)
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`
  }
  return s // pass through — Airtable date field will reject if malformed
}

function buildUniqueId(
  firstName: string,
  lastName: string,
  dob: string | null | undefined,
  fallbackDate: string | null | undefined = '',
): string {
  // DOB is the preferred dedupe key. When Dawson didn't capture DOB, fall back
  // to the appointment date so two different "John Smith"s on different
  // Saturdays don't collide. If both are missing, the unique id becomes
  // "Last-First-" which is intentionally collision-prone — caller should
  // ensure at least one of dob/appt-date exists (currently enforced in page.tsx
  // via the appointmentDate validation).
  const dobStr = (dob || '').trim()
  const fallbackStr = (fallbackDate || '').trim()
  const datePart = dobStr ? toMDY(dobStr) : (fallbackStr ? toMDY(fallbackStr) : '')
  return `${lastName.trim()}-${firstName.trim()}-${datePart}`
}

// ---------- Saturday Schedule lookup ----------

export type SaturdayMap = Map<string, string> // "MM/DD/YYYY" -> Saturday Schedule record id

/**
 * Loads every Saturday Schedule record once. Returns a Map keyed by MM/DD/YYYY
 * for O(1) lookups inside the per-row create loop. Call once per import batch.
 */
export async function loadSaturdayScheduleMap(): Promise<SaturdayMap> {
  const base = getBase()
  const map: SaturdayMap = new Map()
  const records = await base(TABLES.SATURDAY_SCHEDULE)
    .select({ fields: ['Date'] })
    .all() as unknown as AirtableRecord[]
  for (const r of records) {
    const raw = r.get('Date')
    if (!raw) continue
    // Airtable returns date fields as ISO YYYY-MM-DD strings
    const iso = String(raw).slice(0, 10)
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) continue
    const key = `${m[2]}/${m[3]}/${m[1]}` // MM/DD/YYYY
    map.set(key, r.id)
  }
  return map
}

/**
 * Maps Dawson's freeform Excel Ptime to the Airtable single-select slot.
 * Returns null when the input is HOLD, blank, or doesn't match any slot.
 */
function normalizeApptTimeSlot(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  if (!s || s === 'hold') return null
  // Strip whitespace, colons, am/pm markers — we just need the hour digit(s)
  // and an AM/PM indicator.
  const m = s.match(/^(\d{1,2})(?::\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  const hour = parseInt(m[1], 10)
  const ampm = m[2] // 'am' | 'pm' | undefined
  // Bare hour without AM/PM — disambiguate by typical slot range
  // (9-11 default to AM, 12-1 to PM)
  if (hour === 9  && (ampm === 'am' || !ampm)) return '9am'
  if (hour === 10 && (ampm === 'am' || !ampm)) return '10am'
  if (hour === 11 && (ampm === 'am' || !ampm)) return '11am'
  if (hour === 12 && (ampm === 'pm' || !ampm)) return '12pm'
  if (hour === 1  && (ampm === 'pm' || !ampm)) return '1pm'
  return null
}

function parseItems(input: string | null | undefined): string[] {
  if (!input) return []
  return input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// ---------- Lookup helpers ----------

async function findAgencyByName(base: ReturnType<typeof getBase>, agencyName: string): Promise<AirtableRecord | null> {
  const target = normName(agencyName)
  const records = await base(TABLES.AGENCIES)
    .select({
      // Cheap filter: limit to candidates whose name contains the first word.
      // Then we do exact normalized match in JS to be case/whitespace tolerant.
      filterByFormula: `FIND(LOWER("${agencyName.split(' ')[0].replace(/"/g, '\\"')}"), LOWER({Agency Name})) > 0`,
      maxRecords: 50,
    })
    .all() as unknown as AirtableRecord[]
  return records.find(r => normName(String(r.get('Agency Name') || ''))  === target) || null
}

async function findAgencyUserByEmailAndAgency(
  base: ReturnType<typeof getBase>,
  email: string,
  agencyRecordId: string
): Promise<AirtableRecord | null> {
  const target = normEmail(email)
  if (!target) return null
  const records = await base(TABLES.AGENCY_USERS)
    .select({
      filterByFormula: `LOWER({Email}) = "${target.replace(/"/g, '\\"')}"`,
      maxRecords: 10,
    })
    .all() as unknown as AirtableRecord[]
  return (
    records.find(r => {
      const linked = (r.get('Agency') as string[]) || []
      return linked.includes(agencyRecordId)
    }) || null
  )
}

async function findReferralByUniqueId(base: ReturnType<typeof getBase>, uniqueId: string): Promise<AirtableRecord | null> {
  const records = await base(TABLES.CLIENT_REFERRALS)
    .select({
      filterByFormula: `{Unique ID} = "${uniqueId.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    })
    .all() as unknown as AirtableRecord[]
  return records[0] || null
}

// ---------- Main ----------

export async function createReferralWithAgency(
  input: ReferralInput,
  saturdayMap?: SaturdayMap,
): Promise<CreateResult> {
  // Validate required fields up front. Dawson's intake is messy — DOB is
  // missing on ~40% of rows, staff names/email frequently absent. Only the
  // bare minimum is enforced here; everything else is best-effort.
  const missing: string[] = []
  if (!input.firstName?.trim()) missing.push('firstName')
  if (!input.lastName?.trim()) missing.push('lastName')
  if (!input.agencyName?.trim()) missing.push('agencyName')
  // Need at least one of DOB / appointmentDate for the unique id to be stable
  const hasDob = !!input.dob && input.dob.trim() !== ''
  const hasAppt = !!input.appointmentDate && input.appointmentDate.trim() !== ''
  if (!hasDob && !hasAppt) {
    missing.push('dob-or-appointmentDate')
  }
  if (missing.length) {
    return { status: 'error', reason: `Missing required field(s): ${missing.join(', ')}`, field: missing[0] }
  }

  const base = getBase()
  const uniqueId = buildUniqueId(input.firstName, input.lastName, input.dob, input.appointmentDate)

  try {
    // 1. Dedupe check on referral first (cheapest exit)
    const existing = await findReferralByUniqueId(base, uniqueId)
    if (existing) {
      return {
        status: 'skipped',
        uniqueId,
        existingReferralId: existing.id,
        reason: 'duplicate_unique_id',
      }
    }

    // 2. Find or create Agency
    let agencyRecord = await findAgencyByName(base, input.agencyName)
    let agencyCreated = false
    if (!agencyRecord) {
      const created = await base(TABLES.AGENCIES).create([
        {
          fields: {
            'Agency Name': input.agencyName.trim(),
            Status: 'Unclaimed',
            Source: 'Created via Referral',
            // Record Creation Date is a computed field in Airtable — do not set.
            // First Name / Last Name / Email / Phone Number / Client Referrals /
            // Agency Code / Admin Confirmed were REMOVED in the June 2026
            // schema migration — do not write them.
            // Admin contact info (Admin First/Last/Email/Phone) is now a
            // lookup through the Primary Admin link and is populated when
            // the agency claims and assigns its admin.
          },
        },
      ]) as unknown as AirtableRecord[]
      agencyRecord = created[0]
      agencyCreated = true
    }

    // 3. Find or create Agency User (Staff) — three branches:
    //
    //    (a) staffEmail present  -> find-or-create by email within agency.
    //                               Trusted identity; Needs Review = false.
    //    (b) name only (no email) -> create a placeholder user with the
    //                               name, link to agency, set Needs Review
    //                               = true. The agency admin will see this
    //                               at claim time and confirm/merge/delete.
    //                               This is Option B from the schema review.
    //    (c) nothing usable      -> no user created; referral has no
    //                               Referring Staff Link. The agency claim
    //                               flow will repair the link later.
    //
    // The Referring Agency / Referring Staff / Agency Email / Staff Phone
    // fields on Client Referrals are now LOOKUPS — they're computed from
    // the user via Referring Staff Link, so we never write them directly.
    let staffRecord: AirtableRecord | null = null
    let staffCreated = false
    let staffNeedsReview = false

    const hasStaffEmail = !!(input.staffEmail && input.staffEmail.trim())
    const hasStaffName = !!(
      (input.staffFirstName && input.staffFirstName.trim()) ||
      (input.staffLastName && input.staffLastName.trim())
    )

    if (hasStaffEmail) {
      // Branch (a): email-based dedupe + create
      staffRecord = await findAgencyUserByEmailAndAgency(base, input.staffEmail!, agencyRecord.id)
      if (!staffRecord) {
        const created = await base(TABLES.AGENCY_USERS).create([
          {
            fields: {
              'First Name': (input.staffFirstName || '').trim(),
              'Last Name': (input.staffLastName || '').trim(),
              Email: input.staffEmail!.trim(),
              ...(input.staffPhone ? { 'Phone Number': input.staffPhone } : {}),
              Agency: [agencyRecord.id],
              Status: 'Unclaimed',
              Role: 'Staff',
              // Record Creation Date is computed — do not set.
              // Clerk User ID is set when user claims their account.
              // Role defaults to Staff; agency admins can promote to Admin later.
            },
          },
        ]) as unknown as AirtableRecord[]
        staffRecord = created[0]
        staffCreated = true
      }
    } else if (hasStaffName) {
      // Branch (b): Option B placeholder. Cannot dedupe (no email), so
      // always create — the agency admin will resolve duplicates at claim
      // time via the Needs Review flag.
      const created = await base(TABLES.AGENCY_USERS).create([
        {
          fields: {
            'First Name': (input.staffFirstName || '').trim(),
            'Last Name': (input.staffLastName || '').trim(),
            // Email intentionally omitted — placeholder.
            ...(input.staffPhone ? { 'Phone Number': input.staffPhone } : {}),
            Agency: [agencyRecord.id],
            Status: 'Unclaimed',
            Role: 'Staff',
            'Needs Review': true,
            // Clerk User ID is set when user claims their account.
            // Role defaults to Staff; agency admins can promote to Admin later.
          },
        },
      ]) as unknown as AirtableRecord[]
      staffRecord = created[0]
      staffCreated = true
      staffNeedsReview = true
    }
    // Branch (c): nothing usable — staffRecord stays null, referral
    // proceeds without a Referring Staff Link.

    // 4. Create the Client Referral
    const hasAppointment = !!input.appointmentDate?.trim()
    // Fall back to appt date when intake date is missing
    const effectiveReferralDate =
      (input.referralDate || '').trim() ||
      (input.appointmentDate || '').trim() ||
      ''

    // Saturday Schedule wiring: 'Appointment Date' is a LOOKUP field pulling
    // from the linked Saturday Schedule record's Date field. To populate it
    // we link the referral to the matching Saturday Schedule row. The Excel
    // Ptime maps to the 'Appointment Time' single-select directly.
    // 'Appointment Status' is 'Scheduled' only when BOTH the Saturday link
    // resolves AND the time slot is valid; otherwise 'Pending Schedule'.
    let saturdayLinkId: string | null = null
    if (hasAppointment && saturdayMap) {
      saturdayLinkId = saturdayMap.get(toMDY(input.appointmentDate!)) || null
    }
    const apptTimeSlot = normalizeApptTimeSlot(input.appointmentTime)
    const fullyScheduled = !!(saturdayLinkId && apptTimeSlot)

    // Build referral fields. Airtable date fields reject empty strings —
    // they want a valid date OR no field at all. Same for any computed fields.
    //
    // DELETED writes (June 2026 migration — these are now LOOKUPS through
    // the Referring Staff Link field, NOT writable):
    //   'Referring Agency', 'Referring Staff', 'Agency Email', 'Staff Phone'
    const referralFields: Record<string, unknown> = {
      'First Name': input.firstName.trim(),
      'Last Name': input.lastName.trim(),
      Phone: input.phone || '',
      Address: input.address || '',
      'Address 2': input.address2 || '',
      City: input.city || '',
      State: input.state || '',
      Zip: input.zip || '',
      County: input.county || '',
      'Preferred Language': input.preferredLanguage || 'English',
      '# in HH': input.hhSize ?? null,
      '# Children': input.children ?? null,
      'Items Requested': parseItems(input.itemsRequested),
      'External Notes': input.externalNotes || '',
      'Internal Notes': input.internalNotes || '',
      'Referral Review': 'Approved',
      'Appointment Status': fullyScheduled ? 'Scheduled' : 'Pending Schedule',
      // Flag when this referral introduced a brand-new agency (no _Staff/Airtable
      // match). Lets Dawson review the agency record for typos/dupes before
      // it gets used downstream.
      'Was New Agency': agencyCreated,
    }
    // Referring Staff Link: link to the resolved Agency User (when we have
    // one). When null (Branch c), omit the field entirely — Airtable link
    // fields reject empty arrays on some bases and the lookups will simply
    // be blank on the referral.
    if (staffRecord) {
      referralFields['Referring Staff Link'] = [staffRecord.id]
    }
    // Date fields — only set when populated, never as empty string
    if (input.dob && input.dob.trim()) {
      referralFields['DOB'] = toMDY(input.dob)
    }
    if (effectiveReferralDate) {
      referralFields['Referral Date'] = toMDY(effectiveReferralDate)
    }
    // Link to Saturday Schedule when we found a matching row — this drives
    // the 'Appointment Date' lookup on Client Referrals. The auto-schedule
    // automation should early-exit when this link is already populated.
    if (saturdayLinkId) {
      referralFields['Saturday Schedule'] = [saturdayLinkId]
    }
    // Appointment Time is a writable single-select — set directly when
    // Dawson's Ptime mapped cleanly. HOLD / blank / unmappable leave this
    // blank and 'Appointment Status' falls back to 'Pending Schedule'.
    if (apptTimeSlot) {
      referralFields['Appointment Time'] = apptTimeSlot
    }
    if (input.preferredDate) referralFields['Preferred Date'] = toMDY(input.preferredDate as string)
    if (input.schedulingFlexibility) referralFields['Scheduling Flexibility'] = input.schedulingFlexibility

    const createdReferral = await base(TABLES.CLIENT_REFERRALS).create([
      { fields: referralFields as Partial<Record<string, unknown>> as never },
    ]) as unknown as AirtableRecord[]

    return {
      status: 'created',
      uniqueId,
      referralId: createdReferral[0].id,
      agencyId: agencyRecord.id,
      staffId: staffRecord?.id,
      agencyCreated,
      staffCreated,
      staffNeedsReview,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason: msg }
  }
}
