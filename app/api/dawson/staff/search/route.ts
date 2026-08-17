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
// Agency id -> name/status map.
//
// Airtable returns link fields as record IDs, not display text, so we
// need this join to show "Jane Smith · Union County Social Services".
// Cached at module scope because this route is hit on every keystroke
// (debounced) and the agency list changes rarely.
// ---------------------------------------------------------------------------

type AgencyMeta = { name: string; status: string }

let agencyCache: { map: Map<string, AgencyMeta>; fetchedAt: number } | null = null
const AGENCY_CACHE_TTL_MS = 5 * 60 * 1000

async function getAgencyMap(): Promise<Map<string, AgencyMeta>> {
  if (agencyCache && Date.now() - agencyCache.fetchedAt < AGENCY_CACHE_TTL_MS) {
    return agencyCache.map
  }

  const map = new Map<string, AgencyMeta>()
  let offset: string | undefined

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agencies`)
    url.searchParams.set('pageSize', '100')
    url.searchParams.append('fields[]', 'Agency Name')
    url.searchParams.append('fields[]', 'Status')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), { headers: HEADERS })
    if (!res.ok) break

    const data = await res.json()
    for (const r of data.records ?? []) {
      map.set(r.id, {
        name: (r.fields['Agency Name'] as string) ?? '',
        status: (r.fields['Status'] as string) ?? '',
      })
    }
    offset = data.offset
  } while (offset)

  agencyCache = { map, fetchedAt: Date.now() }
  return map
}

/** Escape a token for safe interpolation into an Airtable formula string literal. */
function escapeFormulaToken(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function GET(req: Request) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json([])
  }

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS)

  if (tokens.length === 0) {
    return NextResponse.json([])
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

  const [usersRes, agencyMap] = await Promise.all([
    fetch(url.toString(), { headers: HEADERS }),
    getAgencyMap(),
  ])

  if (!usersRes.ok) {
    const err = await usersRes.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await usersRes.json()

  const results = (data.records ?? []).map((r: any) => {
    const firstName = ((r.fields['First Name'] as string) ?? '').trim()
    const lastName = ((r.fields['Last Name'] as string) ?? '').trim()
    const email = ((r.fields['Email'] as string) ?? '').trim()
    const fullName = `${firstName} ${lastName}`.trim()
    const staffLabel = ((r.fields[STAFF_LABEL_FIELD] as string) ?? '').trim()

    const agencyLink = r.fields['Agency']
    const agencyId: string | null = Array.isArray(agencyLink) ? agencyLink[0] ?? null : null
    const agencyMeta = agencyId ? agencyMap.get(agencyId) : undefined

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
      agencyName: agencyMeta?.name ?? '',
      agencyStatus: agencyMeta?.status ?? '',
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

  return NextResponse.json(results)
}
