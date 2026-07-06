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
 * Schema migration (July 2026) — CLIENTS TABLE FORK (COMPLETE):
 *   Client identity moved off Client Referrals onto the Clients table.
 *   Referrals now link to a Client via the `Client` single-link field.
 *   Identity fields on Client Referrals (First Name, Last Name, DOB,
 *   Phone, Address, Address 2, City, State, Zip, County, Preferred
 *   Language) are LOOKUPS through the {Client} link — NOT writable.
 *
 *   FIND-OR-CREATE order:
 *     1. Dedupe check on referral (Unique ID = Last-First-DOB-ApptDate)
 *     2. Find or create Agency
 *     3. Find or create Agency User (Staff)
 *     4. Find or create Client
 *     5. Create Referral, linked to Client (identity flows via lookups)
 *
 *   Client dedupe key = Unique ID formula on Clients table:
 *     {Last Name} & "-" & {First Name} & "-" & DATETIME_FORMAT({DOB}, 'MM/DD/YYYY')
 *
 *   Referral fields WRITTEN (per-visit only):
 *     # in HH, # Children, Items Requested, External Notes,
 *     Internal Notes, Referral Date, Appointment Time, Appointment
 *     Status, Referral Review, Referring Staff Link, Saturday Schedule
 *     link, Preferred Date, Scheduling Flexibility, Was New Agency,
 *     Client (link).
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
  const mdy4 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy4) {
    const [, m, d, y] = mdy4
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`
  }
  // 2-digit year (M/D/YY or MM/DD/YY). Pivot: 00-30 = 2000s, 31-99 = 1900s.
  // Client DOBs are historical, so >30 years ago rolls to 19xx.
  const mdy2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdy2) {
    const [, m, d, yy] = mdy2
    const yNum = parseInt(yy, 10)
    const fullYear = yNum <= 30 ? 2000 + yNum : 1900 + yNum
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${fullYear}`
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
 * Referral unique id — matches the Client Referrals table primary formula
 * (post-July-2026 migration; identity fields are now lookups through
 * {Client}, but the formula still resolves to the same string via
 * ARRAYJOIN):
 *   ARRAYJOIN({Last Name}) & "-" & ARRAYJOIN({First Name}) & "-"
 *     & IF({DOB}, DATETIME_FORMAT({DOB}, 'MM/DD/YYYY'), "")
 *     & IF({Appointment Date}, "-" & DATETIME_FORMAT({Appointment Date}, 'MM/DD/YYYY'), "")
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
  // DOB is now REQUIRED — it's the Client primary key.
  if (!input.dob || !input.dob.trim()) missing.push('dob')
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


    // 4. Find or create Client
    let clientRecord = await findClientByUniqueId(base, clientUniqueId)
    let clientCreated = false
    if (!clientRecord) {
      const clientFields: Record<string, unknown> = {
        'First Name': input.firstName.trim(),
        'Last Name': input.lastName.trim(),
        DOB: toMDY(input.dob!),
        Status: 'Active',
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


    // Client identity fields (First Name, Last Name, DOB, Phone, Address,
    // Address 2, City, State, Zip, County, Preferred Language) are now
    // LOOKUPS on Client Referrals sourced from the {Client} link — they
    // are NOT writable. Airtable returns 422 on any write to a lookup.
    // Identity data lives on the Clients table (written above in step 4)
    // and flows through to the referral via lookups. See lib/airtable.ts
    // for the read path (safeLookupString unwraps the array shape).
    const referralFields: Record<string, unknown> = {
      // Per-visit fields only
      '# in HH': input.hhSize ?? null,
      '# Children': input.children ?? null,
      'Items Requested': parseItems(input.itemsRequested),
      'External Notes': input.externalNotes || '',
      'Internal Notes': input.internalNotes || '',
      'Referral Review': 'Approved',
      'Appointment Status': fullyScheduled ? 'Scheduled' : 'Pending Schedule',
      'Was New Agency': agencyCreated,
      // Link to Client — drives all identity lookups on the referral
      Client: [clientRecord.id],
    }


    if (staffRecord) {
      referralFields['Referring Staff Link'] = [staffRecord.id]
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
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason: msg }
  }
}
