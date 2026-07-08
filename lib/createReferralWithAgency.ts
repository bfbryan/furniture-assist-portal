/**
 * createReferralWithAgency
 * ------------------------
 * Single source of truth for the "create a referral" write path.
 *
 * Used by:
 *   - /api/dawson/admin/import-referrals (bulk Excel import)
 *   - /api/dawson/referrals (future portal form)
 *
 * Schema migration (June 2026) — Referring Agency / Referring Staff /
 * Agency Email / Staff Phone on Client Referrals are LOOKUPS through
 * Referring Staff Link. We do NOT write to them.
 *
 * Schema migration (July 2026) — CLIENTS TABLE FORK:
 *   Client identity moved off Client Referrals onto new Clients table.
 *   Referrals now link to a Client via the `Client` single-link field.
 *
 *   FIND-OR-CREATE order (new step 3):
 *     1. Dedupe check on referral (Unique ID = Last-First-DOB-ApptDate)
 *     2. Find or create Agency
 *     3. Find or create Agency User (Staff)  — unchanged
 *     4. Find or create Client               ← NEW
 *     5. Create Referral, linked to Client
 *
 *   Client dedupe key = Unique ID formula on Clients table:
 *     {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 *
 *   Referral fields DROPPED (identity moved to Client):
 *     First Name, Last Name, DOB, Phone, Address, Address 2, City, State,
 *     Zip, County, Preferred Language
 *
 *   Referral fields KEPT (per-visit):
 *     # in HH, # of Children, Items Requested, External Notes,
 *     Internal Notes, Referral Date, Appointment Date/Time, Appointment
 *     Status, Referral Review, Referring Staff Link, all furniture
 *     disbursement fields, Was New Agency, Client (NEW link)
 *
 * Idempotency:
 *   - Agency: normalized Agency Name.
 *   - Agency User: normalized email within agency, else name-only placeholder.
 *   - Client: Unique ID formula (Last-First-DOB) on Clients table.
 *   - Client Referral: Unique ID formula (Last-First-DOB-ApptDate). Same
 *     client on different Saturdays => allowed. Same Saturday reimport
 *     => blocked.
 */

import Airtable from 'airtable'

// ---------- Types ----------

export type ReferralInput = {
  // Client identity (goes to Clients table, not Referral)
  firstName: string
  lastName: string
  dob?: string | null
  phone?: string | null
  address?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  preferredLanguage?: string | null

  // Per-visit (stays on Referral)
  hhSize?: number | null
  children?: number | null

  // Agency + Staff
  agencyName: string
  staffFirstName?: string | null
  staffLastName?: string | null
  staffPhone?: string | null
  staffEmail?: string | null

  // Referral metadata
  referralDate?: string | null
  appointmentDate?: string | null
  appointmentTime?: string | null
  itemsRequested?: string | null
  externalNotes?: string | null
  internalNotes?: string | null
  preferredDate?: string | null
  schedulingFlexibility?: string | null
}

export type CreateResult =
  | {
      status: 'created'
      uniqueId: string          // referral unique id (Last-First-DOB-ApptDate)
      clientUniqueId: string    // client unique id (Last-First-DOB)
      referralId: string
      clientId: string
      agencyId: string
      staffId?: string
      agencyCreated: boolean
      staffCreated: boolean
      clientCreated: boolean
      staffNeedsReview?: boolean
      needsDobBackfill?: boolean  // true when referral was imported without DOB
    }
  | {
      status: 'skipped'
      uniqueId: string
      existingReferralId: string
      reason: 'duplicate_unique_id'
    }
  | { status: 'error'; reason: string; field?: string }

type AirtableRecord = { id: string; get: (field: string) => unknown }

// ---------- Config ----------

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'app0DK6F9KoTm38Po'
const TABLES = {
  AGENCIES: 'Agencies',
  AGENCY_USERS: 'Agency Users',
  CLIENTS: 'Clients',
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
  if (!input) return ''
  const s = input.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, y, m, d] = iso
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`
  }
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`
  }
  return s
}

/**
 * Client unique id — matches the Clients table primary formula:
 *   {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 * DOB is required on Clients (enforced by intake), so no fallback.
 */
function buildClientUniqueId(
  firstName: string,
  lastName: string,
  dob: string | null | undefined,
): string {
  const dobStr = toMDY((dob || '').trim())
  return `${lastName.trim()}-${firstName.trim()}-${dobStr}`
}

/**
 * Referral unique id — matches the Client Referrals table primary formula:
 *   {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 *     & IF({Appointment Date}, "-" & DATETIME_FORMAT({Appointment Date}, 'MM/DD/YYYY'), "")
 *
 * TRANSITION NOTE: Client Referrals still has plain-text First Name / Last Name
 * / DOB columns during this migration. After the schema trim step, those
 * columns move to lookups from Client. This formula will need to be re-pointed
 * at that time.
 */
function buildReferralUniqueId(
  firstName: string,
  lastName: string,
  dob: string | null | undefined,
  appointmentDate: string | null | undefined,
): string {
  const dobStr = toMDY((dob || '').trim())
  const apptStr = (appointmentDate || '').trim()
  const suffix = apptStr ? `-${toMDY(apptStr)}` : ''
  return `${lastName.trim()}-${firstName.trim()}-${dobStr}${suffix}`
}

// ---------- Saturday Schedule lookup ----------

export type SaturdayMap = Map<string, string>

export async function loadSaturdayScheduleMap(): Promise<SaturdayMap> {
  const base = getBase()
  const map: SaturdayMap = new Map()
  const records = (await base(TABLES.SATURDAY_SCHEDULE)
    .select({ fields: ['Date'] })
    .all()) as unknown as AirtableRecord[]
  for (const r of records) {
    const raw = r.get('Date')
    if (!raw) continue
    const iso = String(raw).slice(0, 10)
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) continue
    const key = `${m[2]}/${m[3]}/${m[1]}`
    map.set(key, r.id)
  }
  return map
}

function normalizeApptTimeSlot(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  if (!s || s === 'hold') return null
  const m = s.match(/^(\d{1,2})(?::\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  const hour = parseInt(m[1], 10)
  const ampm = m[2]
  if (hour === 9 && (ampm === 'am' || !ampm)) return '9am'
  if (hour === 10 && (ampm === 'am' || !ampm)) return '10am'
  if (hour === 11 && (ampm === 'am' || !ampm)) return '11am'
  if (hour === 12 && (ampm === 'pm' || !ampm)) return '12pm'
  if (hour === 1 && (ampm === 'pm' || !ampm)) return '1pm'
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

async function findAgencyByName(
  base: ReturnType<typeof getBase>,
  agencyName: string,
): Promise<AirtableRecord | null> {
  const target = normName(agencyName)
  const records = (await base(TABLES.AGENCIES)
    .select({
      filterByFormula: `FIND(LOWER("${agencyName.split(' ')[0].replace(/"/g, '\\"')}"), LOWER({Agency Name})) > 0`,
      maxRecords: 50,
    })
    .all()) as unknown as AirtableRecord[]
  return records.find(r => normName(String(r.get('Agency Name') || '')) === target) || null
}

async function findAgencyUserByEmailAndAgency(
  base: ReturnType<typeof getBase>,
  email: string,
  agencyRecordId: string,
): Promise<AirtableRecord | null> {
  const target = normEmail(email)
  if (!target) return null
  const records = (await base(TABLES.AGENCY_USERS)
    .select({
      filterByFormula: `LOWER({Email}) = "${target.replace(/"/g, '\\"')}"`,
      maxRecords: 10,
    })
    .all()) as unknown as AirtableRecord[]
  return (
    records.find(r => {
      const linked = (r.get('Agency') as string[]) || []
      return linked.includes(agencyRecordId)
    }) || null
  )
}

async function findClientByUniqueId(
  base: ReturnType<typeof getBase>,
  clientUniqueId: string,
): Promise<AirtableRecord | null> {
  const records = (await base(TABLES.CLIENTS)
    .select({
      filterByFormula: `{Unique ID} = "${clientUniqueId.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    })
    .all()) as unknown as AirtableRecord[]
  return records[0] || null
}

async function findReferralByUniqueId(
  base: ReturnType<typeof getBase>,
  uniqueId: string,
): Promise<AirtableRecord | null> {
  const records = (await base(TABLES.CLIENT_REFERRALS)
    .select({
      filterByFormula: `{Unique ID} = "${uniqueId.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    })
    .all()) as unknown as AirtableRecord[]
  return records[0] || null
}

// ---------- Main ----------

export async function createReferralWithAgency(
  input: ReferralInput,
  saturdayMap?: SaturdayMap,
): Promise<CreateResult> {
  // Validate required fields
  const missing: string[] = []
  if (!input.firstName?.trim()) missing.push('firstName')
  if (!input.lastName?.trim()) missing.push('lastName')
  if (!input.agencyName?.trim()) missing.push('agencyName')
  // DOB is NOT required during the OCR/Excel-import transition period.
  // Rationale (07/08/26): Dawson's referral slips sometimes arrive without
  // a DOB. Requiring it here blocks the whole referral, which is worse than
  // importing a partial record that can be enriched later. The portal path
  // (once live) WILL enforce DOB via form validation, so data integrity
  // improves naturally as we cut over from Excel to portal submissions.
  //
  // Downstream effects of blank DOB:
  //   • Client Unique ID formula becomes "Last-First-" (trailing dash), so
  //     two blank-DOB clients with the same name will collide into ONE
  //     Client record. Accepted risk — rare in practice, portal will fix.
  //   • Referral Unique ID formula becomes "Last-First--ApptDate" (double
  //     dash) which is still unique per appointment. Dedupe still works.
  //   • The Client Referrals "DOB" text column is left blank (see the
  //     conditional write further down).
  const needsDobBackfill = !input.dob || !input.dob.trim()
  if (missing.length) {
    return {
      status: 'error',
      reason: `Missing required field(s): ${missing.join(', ')}`,
      field: missing[0],
    }
  }

  const base = getBase()

  const clientUniqueId = buildClientUniqueId(input.firstName, input.lastName, input.dob)
  const referralUniqueId = buildReferralUniqueId(
    input.firstName,
    input.lastName,
    input.dob,
    input.appointmentDate,
  )

  try {
    // 1. Dedupe: same client + same appointment date already exists?
    const existingReferral = await findReferralByUniqueId(base, referralUniqueId)
    if (existingReferral) {
      return {
        status: 'skipped',
        uniqueId: referralUniqueId,
        existingReferralId: existingReferral.id,
        reason: 'duplicate_unique_id',
      }
    }

    // 2. Find or create Agency
    let agencyRecord = await findAgencyByName(base, input.agencyName)
    let agencyCreated = false
    if (!agencyRecord) {
      const created = (await base(TABLES.AGENCIES).create([
        {
          fields: {
            'Agency Name': input.agencyName.trim(),
            Status: 'Unclaimed',
            Source: 'Created via Referral',
          },
        },
      ])) as unknown as AirtableRecord[]
      agencyRecord = created[0]
      agencyCreated = true
    }

    // 3. Find or create Agency User (Staff)
    let staffRecord: AirtableRecord | null = null
    let staffCreated = false
    let staffNeedsReview = false

    const hasStaffEmail = !!(input.staffEmail && input.staffEmail.trim())
    const hasStaffName = !!(
      (input.staffFirstName && input.staffFirstName.trim()) ||
      (input.staffLastName && input.staffLastName.trim())
    )

    if (hasStaffEmail) {
      staffRecord = await findAgencyUserByEmailAndAgency(
        base,
        input.staffEmail!,
        agencyRecord.id,
      )
      if (!staffRecord) {
        const created = (await base(TABLES.AGENCY_USERS).create([
          {
            fields: {
              'First Name': (input.staffFirstName || '').trim(),
              'Last Name': (input.staffLastName || '').trim(),
              Email: input.staffEmail!.trim(),
              ...(input.staffPhone ? { 'Phone Number': input.staffPhone } : {}),
              Agency: [agencyRecord.id],
              Status: 'Unclaimed',
              Role: 'Staff',
            },
          },
        ])) as unknown as AirtableRecord[]
        staffRecord = created[0]
        staffCreated = true
      }
    } else if (hasStaffName) {
      const created = (await base(TABLES.AGENCY_USERS).create([
        {
          fields: {
            'First Name': (input.staffFirstName || '').trim(),
            'Last Name': (input.staffLastName || '').trim(),
            ...(input.staffPhone ? { 'Phone Number': input.staffPhone } : {}),
            Agency: [agencyRecord.id],
            Status: 'Unclaimed',
            Role: 'Staff',
            'Needs Review': true,
          },
        },
      ])) as unknown as AirtableRecord[]
      staffRecord = created[0]
      staffCreated = true
      staffNeedsReview = true
    }

    // 4. Find or create Client (NEW STEP)
    let clientRecord = await findClientByUniqueId(base, clientUniqueId)
    let clientCreated = false
    if (!clientRecord) {
      const clientFields: Record<string, unknown> = {
        'First Name': input.firstName.trim(),
        'Last Name': input.lastName.trim(),
        Status: 'Active',
      }
      // DOB write is conditional — during the OCR/Excel transition period the
      // upstream row may not carry a DOB. See the top-of-function comment on
      // `needsDobBackfill` for downstream effects (Client Unique ID collapses
      // to "Last-First-" for blank-DOB clients).
      if (input.dob && input.dob.trim()) {
        clientFields['DOB'] = toMDY(input.dob)
      }
      if (input.phone) clientFields['Phone'] = input.phone
      if (input.address) clientFields['Address'] = input.address
      if (input.address2) clientFields['Address 2'] = input.address2
      if (input.city) clientFields['City'] = input.city
      if (input.state) clientFields['State'] = input.state
      if (input.zip) clientFields['Zip'] = input.zip
      if (input.county) clientFields['County'] = input.county
      if (input.preferredLanguage) {
        clientFields['Preferred Language'] = input.preferredLanguage
      }
      const created = (await base(TABLES.CLIENTS).create([
        { fields: clientFields as Partial<Record<string, unknown>> as never },
      ])) as unknown as AirtableRecord[]
      clientRecord = created[0]
      clientCreated = true
    }
    // NOTE: When Client already exists, we do NOT update its contact/address
    // info. If a returning client has a new phone or address, that update is
    // manual (via the eventual profile-claim flow). This prevents accidental
    // overwrites when Dawson's Excel row has stale/blank data for a client
    // we already know well.

    // 5. Create the Client Referral
    const hasAppointment = !!input.appointmentDate?.trim()
    const effectiveReferralDate =
      (input.referralDate || '').trim() ||
      (input.appointmentDate || '').trim() ||
      ''

    let saturdayLinkId: string | null = null
    if (hasAppointment && saturdayMap) {
      saturdayLinkId = saturdayMap.get(toMDY(input.appointmentDate!)) || null
    }
    const apptTimeSlot = normalizeApptTimeSlot(input.appointmentTime)
    const fullyScheduled = !!(saturdayLinkId && apptTimeSlot)

    // TRANSITION-WINDOW NOTE: Client Referrals still has First Name /
    // Last Name / DOB / Phone / Address / Address 2 / City / State / Zip /
    // County / Preferred Language as writable text columns during this
    // migration. We continue to write them so:
    //   (a) the existing Unique ID formula on Client Referrals still
    //       resolves cleanly (it references {Last Name}, {First Name},
    //       {DOB} directly on the referral)
    //   (b) all existing read paths, print sheets, and Saturday sheet
    //       workflows keep working unchanged this Saturday
    // AFTER the AT schema trim step, these become lookups from {Client}
    // and this block collapses to just the per-visit fields.
    const referralFields: Record<string, unknown> = {
      // Identity — still written during transition (see note above)
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
      // Per-visit
      '# in HH': input.hhSize ?? null,
      '# Children': input.children ?? null,
      'Items Requested': parseItems(input.itemsRequested),
      'External Notes': input.externalNotes || '',
      'Internal Notes': input.internalNotes || '',
      'Referral Review': 'Approved',
      'Appointment Status': fullyScheduled ? 'Scheduled' : 'Pending Schedule',
      'Was New Agency': agencyCreated,
      // NEW: link to Client
      Client: [clientRecord.id],
    }

    if (staffRecord) {
      referralFields['Referring Staff Link'] = [staffRecord.id]
    }
    if (input.dob && input.dob.trim()) {
      referralFields['DOB'] = toMDY(input.dob)
    }
    if (effectiveReferralDate) {
      referralFields['Referral Date'] = toMDY(effectiveReferralDate)
    }
    if (saturdayLinkId) {
      referralFields['Saturday Schedule'] = [saturdayLinkId]
    }
    if (apptTimeSlot) {
      referralFields['Appointment Time'] = apptTimeSlot
    }
    if (input.preferredDate) {
      referralFields['Preferred Date'] = toMDY(input.preferredDate as string)
    }
    if (input.schedulingFlexibility) {
      referralFields['Scheduling Flexibility'] = input.schedulingFlexibility
    }

    const createdReferral = (await base(TABLES.CLIENT_REFERRALS).create([
      { fields: referralFields as Partial<Record<string, unknown>> as never },
    ])) as unknown as AirtableRecord[]

    return {
      status: 'created',
      uniqueId: referralUniqueId,
      clientUniqueId,
      referralId: createdReferral[0].id,
      clientId: clientRecord.id,
      agencyId: agencyRecord.id,
      staffId: staffRecord?.id,
      agencyCreated,
      staffCreated,
      clientCreated,
      staffNeedsReview,
      needsDobBackfill,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason: msg }
  }
}
