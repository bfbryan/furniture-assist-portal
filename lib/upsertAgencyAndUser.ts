// lib/upsertAgencyAndUser.ts
//
// Canonical "find-or-create Agency + find-or-create Agency User" helper.
//
// One code path that ALL agency/user creation flows funnel through:
//   - Self-service portal (admin/invite/route.ts) -> status: 'Pending'  + Clerk user ID
//   - Excel referral import (createReferralWithAgency)   -> status: 'Unclaimed', no Clerk ID
//   - CSV agency-slip import (import-agencies/route)     -> status: 'Unclaimed', no Clerk ID
//
// Why this matters: field mapping must be IDENTICAL across all three paths so we
// don't end up with subtly different records that defeat dedupe.
//
// Dedup keys:
//   Agency       -> Agency Name (case-insensitive, trimmed)
//   Agency User  -> Email (case-insensitive, trimmed)
//
// Field mapping mirrors lib/airtable.ts + app/api/admin/invite/route.ts exactly.

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// ---------- Types ----------

// Status lifecycle (schema migration June 2026):
//   Agencies:     Unclaimed -> Invited -> Pending -> Approved -> Inactive
//                                                 \-> Rejected
//   Agency Users: Unclaimed -> Invited -> Pending -> Active   -> Inactive
export type AgencyStatus =
  | 'Unclaimed'
  | 'Invited'
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Inactive'
export type AgencyUserStatus =
  | 'Unclaimed'
  | 'Invited'
  | 'Pending'
  | 'Active'
  | 'Inactive'
export type AgencyUserRole = 'Admin' | 'Staff'

// Primary-contact fields (First Name / Last Name / Phone Number / Email)
// were REMOVED from the Agencies table in the June 2026 schema migration.
// Admin contact info now lives on Agency Users via the Primary Admin link
// (lookups on Agencies: Admin First Name, Admin Last Name, Admin Email,
// Admin Phone). The caller no longer passes those values here.
export interface AgencyInput {
  name: string                  // required, used for dedupe
  ein?: string | null
  address?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null         // ignored on create — zip automation sets it
  officeName?: string | null
  mainPhone?: string | null      // -> 'Main Phone Number'
  website?: string | null
  status: AgencyStatus
  source?: 'Manual Entry' | 'Created via Referral' | 'Created via Import' | 'Self Registration'
}

export interface AgencyUserInput {
  firstName: string
  lastName: string
  email: string                // required for dedupe (may be empty for OCR placeholders)
  phone?: string | null
  role: AgencyUserRole
  status: AgencyUserStatus
  clerkUserId?: string | null  // null for imports; populated by self-service portal
  invitedByName?: string | null
  invitedDate?: string | null  // YYYY-MM-DD; defaults to today when creating new
  needsReview?: boolean        // true when created without email or with partial data
}

export interface UpsertResult {
  agencyId: string
  agencyCreated: boolean        // true if we just created it, false if we found an existing match
  userId: string | null         // null if no user data was provided
  userCreated: boolean
  warnings: string[]            // non-fatal issues (e.g., email mismatch on existing user)
}

// ---------- Helpers ----------

function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '\\"')
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

async function airtableGet(table: string, params: string = ''): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable GET ${table} failed: ${err}`)
  }
  return res.json()
}

async function airtableCreate(table: string, fields: Record<string, unknown>): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable CREATE ${table} failed: ${err}`)
  }
  return res.json()
}

// ---------- Agency find-or-create ----------

/**
 * Look up an Agency by name (case-insensitive). Returns record ID or null.
 * Airtable formulas are case-sensitive, so we use LOWER() on both sides.
 */
async function findAgencyByName(name: string): Promise<string | null> {
  const safe = escapeFormulaString(name.trim())
  const formula = encodeURIComponent(
    `LOWER(TRIM({Agency Name})) = LOWER("${safe}")`
  )
  const data = await airtableGet('Agencies', `?filterByFormula=${formula}&maxRecords=1`)
  return data.records?.[0]?.id ?? null
}

async function createAgency(input: AgencyInput): Promise<string> {
  // Only write fields that have values. NEVER write computed/auto fields:
  //   Record Creation Date, Approval Date, Invited Date, Rejected Date,
  //   Claimed Date, Agency # (autonumber), Last Modified,
  //   County (zip-driven automation),
  //   Admin First/Last/Email/Phone (lookups via Primary Admin link),
  //   Possible Duplicate (set by dedup logic, not here).
  //
  // These fields were DELETED from Agencies in the June 2026 migration
  // — do not write them: First Name, Last Name, Phone Number, Email,
  // Client Referrals (text), Agency Code, Admin Confirmed.
  const fields: Record<string, unknown> = {
    'Agency Name': input.name.trim(),
    Status: input.status,
  }

  if (input.ein) fields['EIN#'] = input.ein
  if (input.address) fields['Address'] = input.address
  if (input.address2) fields['Address 2'] = input.address2
  if (input.city) fields['City'] = input.city
  if (input.state) fields['State'] = input.state
  if (input.zip) fields['Zip'] = input.zip
  // County intentionally skipped — Airtable automation populates from Zip.
  if (input.officeName) fields['Office Name'] = input.officeName
  if (input.mainPhone) fields['Main Phone Number'] = input.mainPhone
  if (input.website) fields['Website'] = input.website
  if (input.source) fields['Source'] = input.source

  const created = await airtableCreate('Agencies', fields)
  return created.id
}

// ---------- Agency User find-or-create ----------

async function findAgencyUserByEmail(email: string): Promise<string | null> {
  const safe = escapeFormulaString(email.trim())
  const formula = encodeURIComponent(
    `LOWER(TRIM({Email})) = LOWER("${safe}")`
  )
  const data = await airtableGet('Agency Users', `?filterByFormula=${formula}&maxRecords=1`)
  return data.records?.[0]?.id ?? null
}

async function createAgencyUser(input: AgencyUserInput, agencyId: string): Promise<string> {
  // Only write non-empty values — Airtable text fields accept empty strings
  // but it's cleaner to omit them so the column stays visually blank.
  //
  // Invited Date is intentionally only written when the caller passes it.
  // CSV import omits it (these contacts weren't invited — they were imported
  // from referral slips). The self-service portal invite flow should pass
  // today's date when it sends a magic link.
  //
  // Computed/auto fields — do not set:
  //   Display Name (formula, primary), Agency Name (from Agency) (lookup),
  //   Referrals Submitted (reverse link), Record Creation Date,
  //   Last Login, User #, Staff Label (legacy formula).
  const fields: Record<string, unknown> = {
    Role: input.role,
    Status: input.status,
    Agency: [agencyId],
  }
  if (input.invitedDate) fields['Invited Date'] = input.invitedDate

  const fn = (input.firstName || '').trim()
  const ln = (input.lastName || '').trim()
  const em = (input.email || '').trim()
  if (fn) fields['First Name'] = fn
  if (ln) fields['Last Name'] = ln
  if (em) fields['Email'] = em
  if (input.phone) fields['Phone Number'] = input.phone
  if (input.clerkUserId) fields['Clerk User ID'] = input.clerkUserId
  if (input.invitedByName) fields['Invited By'] = input.invitedByName
  if (input.needsReview) fields['Needs Review'] = true

  const created = await airtableCreate('Agency Users', fields)
  return created.id
}

// ---------- Main upsert ----------

/**
 * Find-or-create an Agency, then optionally find-or-create an Agency User linked to it.
 *
 * Behavior:
 *   - Agency lookup: case-insensitive trimmed match on 'Agency Name'
 *   - User lookup: case-insensitive trimmed match on 'Email' (across ALL agencies — global)
 *   - If user already exists under a DIFFERENT agency, we leave them alone and add a warning
 *     (we don't move users between agencies — that's a manual call for Dawson)
 *
 * Returns IDs and "created" flags so callers can report (e.g., "12 new, 5 existing").
 */
export async function upsertAgencyAndUser(args: {
  agency: AgencyInput
  user?: AgencyUserInput   // optional — CSV imports may have just an Agency with no user
}): Promise<UpsertResult> {
  const warnings: string[] = []

  if (!args.agency.name || !args.agency.name.trim()) {
    throw new Error('Agency name is required')
  }

  // 1. Find or create Agency
  let agencyId = await findAgencyByName(args.agency.name)
  let agencyCreated = false
  if (!agencyId) {
    agencyId = await createAgency(args.agency)
    agencyCreated = true
  }

  // 2. Find or create Agency User (if user data was provided)
  let userId: string | null = null
  let userCreated = false

  if (args.user) {
    const userEmail = (args.user.email || '').trim()
    if (userEmail) {
      // Email-based dedupe: skip create if a user with this email already exists.
      const existingUserId = await findAgencyUserByEmail(userEmail)
      if (existingUserId) {
        userId = existingUserId
        warnings.push(`User with email ${userEmail} already exists (id ${existingUserId})`)
      } else {
        userId = await createAgencyUser(args.user, agencyId)
        userCreated = true
      }
    } else {
      // No email — we can't dedupe, so always create. Caller (CSV import)
      // explicitly wants name-only contacts to land in Airtable as Unclaimed
      // for Dawson to enrich later.
      userId = await createAgencyUser(args.user, agencyId)
      userCreated = true
      warnings.push('User created without email — cannot dedupe future runs')
    }
  }

  return { agencyId, agencyCreated, userId, userCreated, warnings }
}
