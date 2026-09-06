// app/api/dawson/staff/search/route.ts
//
// Cross-agency staff search for Dawson's new-referral form.
//
// Dawson thinks in terms of PEOPLE ("that woman at Union County
// Social Services"), not agencies. This lets him type a name or an
// email fragment and get back the person AND the agency they belong
// to in one shot, instead of drilling agency-first.
//
// Matching runs against the existing `Staff Label` formula field, so
// search behaves exactly like what Dawson already sees in the base:
//
//     Lutonya Hunter — United Way of Greater Union County (lutonya.hunter@unitedwayguc.org)
//
// That label carries name, AGENCY and email, so one SEARCH() covers all
// three. Every whitespace-separated token in `q` must appear somewhere
// in it, which means all of these find the record above:
//     lutonya            hunter lutonya      unitedwayguc
//     lutonya hunter     hunter              united way
//     hunter united      lutonya.hunter@unitedwayguc.org
//
// Searching the agency name as well is a real win — "union county"
// surfaces every caseworker there without Dawson recalling a name.
//
// Status filter matches the per-agency staff route: Active + Unclaimed.
//
// DOMAIN FALLBACK. The token match above splits on whitespace, so a full
// email address is ONE token and a brand-new person at a known agency matches
// nothing. When the query carries a parseable email domain, this route ALSO
// returns `domainFamily` — every agency record whose staff use that domain,
// with office name, town and staff count so the (real, not duplicate) family
// of offices behind one domain — nine for @pmch.org, six for @dcf.nj.gov — is
// distinguishable. It only SURFACES them; the form lets Dawson add the new
// person to one. It never auto-links.
//
// Response shape: { staff: StaffSearchResult[], domainFamily: DomainFamilyAgency[] }
// (was a bare array). One consumer — app/dawson/referrals/new/page.tsx.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// Formula field on Agency Users: "First Last — Agency (email)".
const STAFF_LABEL_FIELD = 'Staff Label'

const MIN_QUERY_LENGTH = 2
const MAX_RESULTS = 25
const MAX_TOKENS = 5

// ---------------------------------------------------------------------------
// Agency name and status, resolved per request.
//
// This used to be a module-level Map of the WHOLE Agencies table with a five
// minute lifetime, and that cache was the bug behind "an agency I just created
// on the Add Referral form isn't in the search". The person was always found - 
// `Staff Label` is computed by Airtable and carries the new agency's name the
// moment the row exists, so the SEARCH() below matched immediately. What came
// back blank was `agencyName`, because the id was created after the cache was
// warmed and so was missing from the map. The row then rendered as
// "No agency on file", which is what reads as the agency being absent.
//
// Shortening the interval would only narrow the window. There is no cache now:
//
//   • The NAME needs no lookup at all. Agency Users already carries
//     `Agency Name (from Agency)`, a lookup through the same link this route
//     reads for the id, so it arrives with the record for free.
//   • The STATUS is the only thing left on Agencies, and it is needed for at
//     most the 25 records returned - in practice one or two distinct agencies.
//     One bounded fetch of exactly those ids replaces a full-table scan.
//
// Net effect: still two round trips per search, but the second one is now tiny
// and, more to the point, always current.
// ---------------------------------------------------------------------------

/** One Agency Users row as this route asks for it. */
type AirtableUserRecord = { id: string; fields: Record<string, unknown> }

/** Escape a token for safe interpolation into an Airtable formula string literal. */
function escapeFormulaToken(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** First value of an Airtable lookup field, which always arrives as an array. */
function firstLookup(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * A clean email domain from the query, or null. Fires on an `@` anywhere in
 * the query (the part after the last `@`), OR on a bare domain typed on its
 * own ("pmch.org"). Trailing junk ("grojas@pmch.org,") is trimmed.
 */
function extractDomain(q: string): string | null {
  const lower = q.toLowerCase().trim()
  let candidate: string
  if (lower.includes('@')) {
    candidate = lower.slice(lower.lastIndexOf('@') + 1)
  } else if (DOMAIN_RE.test(lower)) {
    candidate = lower
  } else {
    return null
  }
  candidate = candidate.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9.-]+$/, '')
  return DOMAIN_RE.test(candidate) ? candidate : null
}

type DomainFamilyAgency = {
  agencyId: string
  agencyName: string
  officeName: string
  city: string
  staffCount: number
  status: string
}

/**
 * Every agency record whose staff use `domain`, with the fields that make nine
 * near-identically-named PMCH rows tellable apart. Soft-fails to [] — this is
 * additive help, not a reason to 500 the search.
 */
async function getDomainFamily(domain: string): Promise<DomainFamilyAgency[]> {
  const esc = escapeFormulaToken(domain)
  // SEARCH is a coarse filter (matches "@domain" anywhere in the address); the
  // exact endsWith check happens in JS below.
  const formula =
    `AND(OR({Status} = "Active", {Status} = "Unclaimed", {Status} = "Invited"), ` +
    `SEARCH("@${esc}", LOWER({Email})))`

  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agency Users`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', '300')
  url.searchParams.append('fields[]', 'Email')
  url.searchParams.append('fields[]', 'Agency')
  url.searchParams.append('fields[]', 'Agency Name (from Agency)')

  let usersData: { records?: AirtableUserRecord[] }
  try {
    const res = await fetch(url.toString(), { headers: HEADERS })
    if (!res.ok) return []
    usersData = await res.json()
  } catch {
    return []
  }

  const suffix = `@${domain}`
  const byAgency = new Map<string, { name: string; count: number }>()
  for (const r of usersData.records ?? []) {
    const email = String(r.fields['Email'] ?? '').toLowerCase().trim()
    if (!email.endsWith(suffix)) continue
    const agencyLink = r.fields['Agency']
    const aid = Array.isArray(agencyLink) && typeof agencyLink[0] === 'string' ? agencyLink[0] : null
    if (!aid) continue
    const cur = byAgency.get(aid) ?? {
      name: firstLookup(r.fields['Agency Name (from Agency)']).trim(),
      count: 0,
    }
    cur.count += 1
    byAgency.set(aid, cur)
  }
  if (byAgency.size === 0) return []

  // Office Name / City / Status for those agencies — one bounded fetch.
  const ids = [...byAgency.keys()]
  const clauses = ids.map(id => `RECORD_ID() = "${escapeFormulaToken(id)}"`).join(', ')
  const aUrl = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agencies`)
  aUrl.searchParams.set('filterByFormula', ids.length > 1 ? `OR(${clauses})` : clauses)
  aUrl.searchParams.set('maxRecords', String(ids.length))
  for (const f of ['Agency Name', 'Office Name', 'City', 'Status']) {
    aUrl.searchParams.append('fields[]', f)
  }
  const meta = new Map<string, { name: string; officeName: string; city: string; status: string }>()
  try {
    const ar = await fetch(aUrl.toString(), { headers: HEADERS })
    if (ar.ok) {
      const ad = await ar.json()
      for (const r of ad.records ?? []) {
        meta.set(r.id, {
          name: (r.fields['Agency Name'] as string) ?? '',
          officeName: (r.fields['Office Name'] as string) ?? '',
          city: (r.fields['City'] as string) ?? '',
          status: (r.fields['Status'] as string) ?? '',
        })
      }
    }
  } catch {
    // soft — fall back to the name off the Agency Users lookup, no office/city
  }

  return ids
    .map(id => {
      const c = byAgency.get(id)!
      const m = meta.get(id)
      return {
        agencyId: id,
        agencyName: (m?.name || c.name || '').trim(),
        officeName: (m?.officeName ?? '').trim(),
        city: (m?.city ?? '').trim(),
        staffCount: c.count,
        status: (m?.status ?? '').trim(),
      }
    })
    // Most staff on file first — the "main" office. An email-named record
    // (itself a symptom of the bug this fixes) sorts last regardless, so the
    // real offices are what Dawson sees first.
    .sort((a, b) => {
      const aJunk = a.agencyName.includes('@') ? 1 : 0
      const bJunk = b.agencyName.includes('@') ? 1 : 0
      return aJunk - bJunk || b.staffCount - a.staffCount || a.agencyName.localeCompare(b.agencyName)
    })
}

/**
 * Status for a specific set of agency ids. Empty in, empty out - no request.
 *
 * Failure is deliberately soft: status is only used to seed the form's agency
 * object when the picked person's agency is outside the list the page already
 * loaded, and every one of those falls back to the loaded record when there is
 * one. A search that still returns the right people with a blank status beats a
 * search that 500s.
 */
async function fetchAgencyStatuses(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const clauses = ids.map(id => `RECORD_ID() = "${escapeFormulaToken(id)}"`).join(', ')
  const formula = ids.length > 1 ? `OR(${clauses})` : clauses

  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agencies`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', String(ids.length))
  url.searchParams.append('fields[]', 'Status')

  try {
    const res = await fetch(url.toString(), { headers: HEADERS })
    if (!res.ok) return map
    const data = await res.json()
    for (const r of data.records ?? []) {
      map.set(r.id, (r.fields['Status'] as string) ?? '')
    }
  } catch {
    // Soft failure - see the note above.
  }
  return map
}

export async function GET(req: Request) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  const empty = { staff: [], domainFamily: [] }

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(empty)
  }

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS)

  if (tokens.length === 0) {
    return NextResponse.json(empty)
  }

  // The staff label already contains name, agency and email, so it is
  // the whole haystack.
  const haystack = `LOWER({${STAFF_LABEL_FIELD}})`

  const tokenClauses = tokens
    .map(t => `SEARCH("${escapeFormulaToken(t)}", ${haystack})`)
    .join(', ')

  const matchClause =
    tokens.length > 1 ? `AND(${tokenClauses})` : tokenClauses

  // 'Invited' is included alongside Active/Unclaimed: an agency user sits in
  // that status between being invited and their first sign-in, and dropping
  // them from this search for the whole of that window would take the person
  // Dawson is most likely to be looking for out of the Add Referral form
  // exactly while their agency is being onboarded.
  const formula = `AND(OR({Status} = "Active", {Status} = "Unclaimed", {Status} = "Invited"), ${matchClause})`

  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agency Users`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', String(MAX_RESULTS))
  url.searchParams.append('fields[]', STAFF_LABEL_FIELD)
  url.searchParams.append('fields[]', 'First Name')
  url.searchParams.append('fields[]', 'Last Name')
  url.searchParams.append('fields[]', 'Email')
  url.searchParams.append('fields[]', 'Phone Number')
  url.searchParams.append('fields[]', 'Status')
  url.searchParams.append('fields[]', 'Agency')
  // The agency's name, through the same link as the id above - this is what
  // replaced the cached copy of the Agencies table.
  url.searchParams.append('fields[]', 'Agency Name (from Agency)')

  const usersRes = await fetch(url.toString(), { headers: HEADERS })

  if (!usersRes.ok) {
    const err = await usersRes.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await usersRes.json()
  const records: AirtableUserRecord[] = data.records ?? []

  const agencyIds = Array.from(
    new Set(
      records
        .map(r => (Array.isArray(r.fields['Agency']) ? r.fields['Agency'][0] : null))
        .filter((id): id is string => typeof id === 'string'),
    ),
  )

  const agencyStatuses = await fetchAgencyStatuses(agencyIds)

  const results = records.map(r => {
    const firstName = ((r.fields['First Name'] as string) ?? '').trim()
    const lastName = ((r.fields['Last Name'] as string) ?? '').trim()
    const email = ((r.fields['Email'] as string) ?? '').trim()
    const fullName = `${firstName} ${lastName}`.trim()
    const staffLabel = ((r.fields[STAFF_LABEL_FIELD] as string) ?? '').trim()

    const agencyLink = r.fields['Agency']
    const agencyId: string | null =
      Array.isArray(agencyLink) && typeof agencyLink[0] === 'string' ? agencyLink[0] : null

    return {
      id: r.id,
      firstName,
      lastName,
      name: fullName,
      email,
      phone: (r.fields['Phone Number'] as string) ?? '',
      status: (r.fields['Status'] as string) ?? '',
      // Prefer the base's own label so the portal and Airtable agree.
      displayName:
        staffLabel || (fullName ? (email ? `${fullName} (${email})` : fullName) : email),
      agencyId,
      agencyName: firstLookup(r.fields['Agency Name (from Agency)']).trim(),
      agencyStatus: agencyId ? agencyStatuses.get(agencyId) ?? '' : '',
    }
  })

  // Rank: exact-ish prefix matches on name or email first, then named
  // records, then everything else alphabetically. Keeps the obvious
  // answer at the top when Dawson types a full first name.
  const lowerQ = q.toLowerCase()
  results.sort((a: any, b: any) => {
    const aPrefix =
      a.name.toLowerCase().startsWith(lowerQ) || a.email.toLowerCase().startsWith(lowerQ)
    const bPrefix =
      b.name.toLowerCase().startsWith(lowerQ) || b.email.toLowerCase().startsWith(lowerQ)
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1

    if (!!a.name !== !!b.name) return a.name ? -1 : 1

    if (a.name && b.name) {
      const lastCmp = a.lastName.localeCompare(b.lastName)
      if (lastCmp !== 0) return lastCmp
      return a.firstName.localeCompare(b.firstName)
    }
    return a.email.localeCompare(b.email)
  })

  const domain = extractDomain(q)
  const domainFamily = domain ? await getDomainFamily(domain) : []

  return NextResponse.json({ staff: results, domainFamily })
}
