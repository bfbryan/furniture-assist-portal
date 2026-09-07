// app/api/dawson/search/route.ts
//
// GET /api/dawson/search?q=  — the internal portal's one universal lookup.
//
// Searches three tables and returns them grouped:
//   clients   — name, DOB, phone
//   agencies  — name, office name, town, AND email domain (a domain token is
//               matched against the agencies' staff emails, then grouped up to
//               the agency — the picker work proved typing an email is how
//               Dawson identifies an agency)
//   staff     — name, email
//
// COST MODEL. Airtable has no cross-table query, so this is three parallel
// `filterByFormula` fetches per request — never per keystroke (the client
// debounces 250ms and requires 3 chars). Each formula is capped at 400 chars
// (tokens dropped from the end, then weak fields) to stay well under
// Airtable's limits. A domain token adds at most one bounded Agencies fetch.
//
// CACHE. A module-level Map keyed by the normalised query, 60s TTL, filled
// lazily — no warm-up, no cron. Per serverless instance: Vercel runs several,
// each warms its own copy, so the worst case is a few cold fetches on
// instances that haven't seen a given query. 60s (not 5min) because the
// failure mode is "Dawson adds a referral, searches for the client, a stale
// index says they don't exist" — the exact reasoning that mints duplicates.
// No write-invalidation: at 60s it isn't worth coupling every create path to
// this cache, and a stale hit only ever leads to a detail page that shows
// current state.
//
// Ranking, grouping and the top-6-per-group trim are CLIENT-side
// (components/internal/DawsonUniversalSearch.tsx) — this route returns the
// raw matched rows, shaped, with the fields the scorer and the UI need.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const MIN_QUERY = 3
const MAX_TOKENS = 5
const TTL_MS = 60_000
const FORMULA_MAX = 400

export type ClientHit = {
  id: string
  firstName: string
  lastName: string
  dob: string // ISO 'YYYY-MM-DD' or ''
  phone: string
  status: string // Clients.Status — only 'DNS' is acted on in the UI
  referralIds: string[]
}
export type AgencyHit = {
  id: string
  name: string
  officeName: string
  city: string
  status: string
  /** Matched only because a staffer's email is on this domain, not on the
      agency's own fields. */
  domainMatch: boolean
}
export type StaffHit = {
  id: string
  name: string
  email: string
  agencyId: string | null
  agencyName: string
  status: string
}
export type DawsonSearchResponse = {
  clients: ClientHit[]
  agencies: AgencyHit[]
  staff: StaffHit[]
}

const cache = new Map<string, { res: DawsonSearchResponse; at: number }>()

function esc(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Domain-shaped: "pmch.org" or "@pmch.org". */
function domainOf(token: string): string | null {
  const t = token.replace(/^@/, '')
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(t) &&
    /\.[a-z]{2,}$/.test(t)
    ? t
    : null
}

/**
 * AND the per-token clauses, greedily, stopping before the formula would
 * exceed FORMULA_MAX. At least one token always survives.
 */
function buildFormula(tokens: string[], clauseFor: (t: string) => string): string {
  const clauses: string[] = []
  for (const t of tokens) {
    const c = clauseFor(t)
    const candidate = clauses.length ? `AND(${[...clauses, c].join(',')})` : c
    if (candidate.length > FORMULA_MAX && clauses.length > 0) break
    clauses.push(c)
  }
  if (clauses.length === 0) return 'FALSE()'
  return clauses.length === 1 ? clauses[0] : `AND(${clauses.join(',')})`
}

async function fetchTable(
  table: string,
  formula: string,
  fields: string[],
  maxRecords: number,
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', String(maxRecords))
  for (const f of fields) url.searchParams.append('fields[]', f)
  try {
    const res = await fetch(url.toString(), { headers: HEADERS })
    if (!res.ok) {
      console.error(`[dawson-search] ${table} fetch failed: ${res.status}`)
      return []
    }
    const data = await res.json()
    return (data.records ?? []) as Array<{ id: string; fields: Record<string, unknown> }>
  } catch {
    console.error(`[dawson-search] ${table} fetch threw`)
    return []
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '')

export async function GET(req: Request) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  const empty: DawsonSearchResponse = { clients: [], agencies: [], staff: [] }
  if (q.length < MIN_QUERY) return NextResponse.json(empty)

  const key = q.toLowerCase().replace(/\s+/g, ' ')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.res)

  const tokens = key.split(' ').filter(Boolean).slice(0, MAX_TOKENS)
  const domainToken = tokens.map(domainOf).find(Boolean) ?? null
  // A query that is ONLY a domain ("pmch.org") wants the agency, not a wall of
  // its staff — mirror the Add Referral picker.
  const domainOnly = tokens.length === 1 && domainToken !== null

  const clientClause = (t: string) => {
    const e = esc(t)
    return (
      `OR(SEARCH("${e}",LOWER({First Name}&" "&{Last Name})),` +
      `SEARCH("${e}",DATETIME_FORMAT({DOB},'M/D/YYYY')),` +
      `SEARCH("${e}",REGEX_REPLACE({Phone}&"","[^0-9]","")))`
    )
  }
  const agencyClause = (t: string) => {
    const e = esc(t)
    return `OR(SEARCH("${e}",LOWER({Agency Name})),SEARCH("${e}",LOWER({Office Name})),SEARCH("${e}",LOWER({City})))`
  }
  const staffClause = (t: string) => {
    const e = esc(t)
    return `OR(SEARCH("${e}",LOWER({First Name}&" "&{Last Name})),SEARCH("${e}",LOWER({Email})))`
  }

  const [clientRows, agencyRows, staffRows] = await Promise.all([
    domainOnly
      ? Promise.resolve([])
      : fetchTable('Clients', buildFormula(tokens, clientClause),
          ['First Name', 'Last Name', 'DOB', 'Phone', 'Status', 'Client Referrals'], 50),
    fetchTable('Agencies', buildFormula(tokens, agencyClause),
      ['Agency Name', 'Office Name', 'City', 'Status'], 50),
    fetchTable('Agency Users', buildFormula(tokens, staffClause),
      ['First Name', 'Last Name', 'Email', 'Agency', 'Agency Name (from Agency)', 'Status'], 60),
  ])

  const clients: ClientHit[] = clientRows.map(r => ({
    id: r.id,
    firstName: str(r.fields['First Name']).trim(),
    lastName: str(r.fields['Last Name']).trim(),
    dob: str(r.fields['DOB']).slice(0, 10),
    phone: str(r.fields['Phone']).trim(),
    status: str(r.fields['Status']).trim(),
    referralIds: Array.isArray(r.fields['Client Referrals'])
      ? (r.fields['Client Referrals'] as string[])
      : [],
  }))

  const staff: StaffHit[] = staffRows.map(r => {
    const agencyLink = r.fields['Agency']
    return {
      id: r.id,
      name: `${str(r.fields['First Name'])} ${str(r.fields['Last Name'])}`.trim(),
      email: str(r.fields['Email']).trim(),
      agencyId: Array.isArray(agencyLink) && typeof agencyLink[0] === 'string' ? agencyLink[0] : null,
      agencyName: str(r.fields['Agency Name (from Agency)']).trim(),
      status: str(r.fields['Status']).trim(),
    }
  })

  const agencies: AgencyHit[] = agencyRows.map(r => ({
    id: r.id,
    name: str(r.fields['Agency Name']).trim(),
    officeName: str(r.fields['Office Name']).trim(),
    city: str(r.fields['City']).trim(),
    status: str(r.fields['Status']).trim(),
    domainMatch: false,
  }))

  // Domain → agencies: staff already matched by the domain token above; group
  // them up and pull any agency not already in the list. One bounded fetch.
  if (domainToken) {
    const suffix = `@${domainToken}`
    const seen = new Set(agencies.map(a => a.id))
    const needed = new Set<string>()
    for (const s of staff) {
      if (s.email.toLowerCase().endsWith(suffix) && s.agencyId && !seen.has(s.agencyId)) {
        needed.add(s.agencyId)
      }
    }
    if (needed.size > 0) {
      const ids = [...needed]
      const clauses = ids.map(id => `RECORD_ID()="${esc(id)}"`).join(',')
      const extra = await fetchTable(
        'Agencies',
        ids.length > 1 ? `OR(${clauses})` : clauses,
        ['Agency Name', 'Office Name', 'City', 'Status'],
        ids.length,
      )
      for (const r of extra) {
        agencies.push({
          id: r.id,
          name: str(r.fields['Agency Name']).trim(),
          officeName: str(r.fields['Office Name']).trim(),
          city: str(r.fields['City']).trim(),
          status: str(r.fields['Status']).trim(),
          domainMatch: true,
        })
      }
    }
  }

  const res: DawsonSearchResponse = {
    clients,
    // A domain-only query returns no individual staff — they were only a means
    // to the agency family.
    agencies,
    staff: domainOnly ? [] : staff,
  }
  cache.set(key, { res, at: Date.now() })
  return NextResponse.json(res)
}
