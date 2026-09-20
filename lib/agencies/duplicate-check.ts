// lib/agencies/duplicate-check.ts
//
// Non-blocking duplicate signal for a new self-registration. Never refuses
// a submission — Catholic Charities and Center for Great Expectations each
// already hold two Agencies rows sharing one Agency Name, distinguished
// only by Office Name; a legitimate second office registering would match
// on name and be wrongly turned away if a match ever blocked. So every
// signal here is advisory: it flags the new row for Dawson's review
// (Possible Duplicate + a Notes line naming what matched), and creation
// proceeds either way.
//
// Three signals, checked independently, first match wins (reported, not
// merged — one clear reason beats a run-on list):
//
//   1. Email — an Agency User already exists with this email, anywhere in
//      the base. The strongest signal: a person already in the system
//      registering a second agency.
//   2. Agency Name — an existing agency shares this name. Reported WITH
//      whether an Office Name was also given and whether it matches, so a
//      genuine second office (name matches, office differs or is new)
//      reads differently from a straight collision (name matches, no
//      office answer on either side).
//   3. EIN — only 8 of 101 agencies carry one today (checked live,
//      2026-09), so a non-match means almost nothing. A match is strong
//      when it happens. Both sides are normalised through lib/ein.ts
//      before comparing — one stored value has a trailing newline baked
//      in (Family Promise of Essex County, recGamOeNuqtGbET6) that a raw
//      string compare would miss.
//
// Deliberately NOT reusing findAgencyByName / findAgencyUserByEmail from
// lib/agencies/upsert.ts — those back a find-or-create, this backs a
// find-and-flag, and email lookup already exists as getAgencyUserByEmail
// (lib/airtable/agency-users.ts), reused as-is below.

import { getAgencyUserByEmail } from '@/lib/airtable/agency-users'
import { formatEIN } from '@/lib/ein'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '\\"')
}

async function airtableGet(table: string, params: string): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Airtable GET ${table} failed: ${await res.text()}`)
  return res.json()
}

export type DuplicateCheckResult = {
  matched: boolean
  /** Human-readable, ready to drop straight into Notes. Null when matched is false. */
  description: string | null
}

export async function checkForDuplicateAgency(input: {
  email: string
  agencyName: string
  officeName: string | null
  ein: string | null
}): Promise<DuplicateCheckResult> {
  // 1. Email — cross-agency, already built.
  try {
    const existingUser = await getAgencyUserByEmail(input.email)
    if (existingUser) {
      return {
        matched: true,
        description: `Possible duplicate — ${existingUser.email} is already on file for "${existingUser.name || 'an existing contact'}" (Agency User ${existingUser.id}).`,
      }
    }
  } catch (e) {
    // Best-effort, same posture as findClientMatches in the agency referral
    // route: a hiccup here flags nothing, it does not block registration.
    console.error('checkForDuplicateAgency: email lookup failed:', e)
  }

  // 2. Agency Name.
  try {
    const safe = escapeFormulaString(input.agencyName.trim())
    const formula = encodeURIComponent(`LOWER(TRIM({Agency Name})) = LOWER("${safe}")`)
    const data = await airtableGet('Agencies', `?filterByFormula=${formula}&maxRecords=5`)
    const matches = (data.records ?? []) as any[]
    if (matches.length > 0) {
      const existingOffice = (matches[0].fields?.['Office Name'] as string | undefined)?.trim() || null
      const officeNote = input.officeName
        ? existingOffice
          ? (existingOffice.toLowerCase() === input.officeName.toLowerCase()
              ? `same office name ("${existingOffice}")`
              : `different office name (existing: "${existingOffice}", submitted: "${input.officeName}") — may be a legitimate second office`)
          : `submitted office name "${input.officeName}", existing record has none on file`
        : existingOffice
          ? `existing record has office name "${existingOffice}", none submitted`
          : `neither record has an office name — cannot tell offices apart`
      return {
        matched: true,
        description: `Possible duplicate — an existing agency named "${input.agencyName}" is already on file (${matches[0].id}); ${officeNote}.`,
      }
    }
  } catch (e) {
    console.error('checkForDuplicateAgency: name lookup failed:', e)
  }

  // 3. EIN — only checked when one was actually submitted. Not required.
  const normalizedEin = input.ein ? formatEIN(input.ein) : ''
  if (normalizedEin) {
    try {
      // TRIM() catches the one live record with a trailing newline baked
      // into the stored value; a plain `=` would miss it.
      const safe = escapeFormulaString(normalizedEin)
      const formula = encodeURIComponent(`TRIM({EIN#}) = "${safe}"`)
      const data = await airtableGet('Agencies', `?filterByFormula=${formula}&maxRecords=1`)
      const match = (data.records ?? [])[0]
      if (match) {
        const name = (match.fields?.['Agency Name'] as string) ?? 'an existing agency'
        return {
          matched: true,
          description: `Possible duplicate — EIN ${normalizedEin} already on file for "${name}" (${match.id}).`,
        }
      }
    } catch (e) {
      console.error('checkForDuplicateAgency: EIN lookup failed:', e)
    }
  }

  return { matched: false, description: null }
}
