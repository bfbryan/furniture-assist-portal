// lib/airtable/client.ts
//
// Low-level Airtable transport + lookup helpers shared by every module in
// this folder. Internal to lib/airtable — deliberately NOT re-exported from
// the lib/airtable.ts barrel, so the public surface stays exactly the 23
// domain functions it has always been.

export const BASE_ID = process.env.AIRTABLE_BASE_ID!
export const API_KEY = process.env.AIRTABLE_API_KEY!
export const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

export async function airtableFetch(
  table: string,
  pathOrParams: string = '',
  options?: { method?: string; body?: unknown }
) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${pathOrParams}`
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      ...HEADERS,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable error: ${err}`)
  }
  return res.json()
}

// Airtable caps a single fetch at 100 records. When we need the FULL table
// (e.g. building a name→id index across all Agencies), loop through the
// `offset` cursor until Airtable stops returning one.
//
// Only use this for reasonably-sized tables (Agencies, Agency Users). Do
// NOT use for Client Referrals — that table is filtered per request and
// unbounded pagination would be wasteful.
export async function airtableFetchAll(table: string, params: string = '') {
  const allRecords: any[] = []
  let offset: string | undefined = undefined
  do {
    const paged: string = offset
      ? `${params}${params.includes('?') ? '&' : '?'}offset=${offset}`
      : params
    const data = await airtableFetch(table, paged)
    if (Array.isArray(data.records)) allRecords.push(...data.records)
    offset = data.offset
  } while (offset)
  return { records: allRecords }
}

// Read a plain (non-lookup) text field that Airtable may omit.
//
// Airtable leaves blank fields OUT of the API response entirely, so any
// optional column reads back `undefined`. The mappers used to write
// `f['City'] as string`, which told the type system the value was always
// there. It is not — 75 of 129 unclaimed agencies have no City — and that
// lie is what let `undefined.toLowerCase()` reach a live search box.
//
// Note that `as string` also silently defeats a `?? null` written next to
// it: the cast makes the left side non-nullable, so the fallback becomes
// dead code AND the inferred property type stays `string`. Reading through
// this helper instead is what makes the resulting type honestly nullable.
//
// Empty string collapses to null too — a blank cell and a missing cell mean
// the same thing here, and neither should match a search.
export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// Lookups return arrays even when the underlying field is a single value.
// This unwraps `["foo"]` -> `"foo"` and `[]` / undefined -> null. Used for
// all admin-* lookups on Agencies and all staff/agency lookups on Client
// Referrals after the June 2026 migration.
export function unwrapLookup<T = string>(value: unknown): T | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value[0] as T
  }
  return value as T
}

// DEFENSIVE GUARD (June 2026):
//   If a "Referring Agency" / "Referring Staff" / "Agency Email" /
//   "Staff Phone" field is configured as a Link to another record
//   instead of a Lookup, Airtable will return an array of record IDs
//   (e.g. ["recAbCd1234..."]) and unwrapLookup will hand us a string
//   like "recAbCd1234EFGHIJ" — which then renders verbatim in the UI.
//
//   This guard catches that case and returns null so the page shows
//   a clean em-dash instead of a record ID. If you see lots of nulls
//   where you expect names, the underlying Airtable field is still a
//   link and needs to be converted to a lookup (or the lookup needs
//   its "Field to look up" pointed at a text column, not a record id).
export const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/
export function safeLookupString(value: unknown): string | null {
  const v = unwrapLookup<string>(value)
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  if (REC_ID_RE.test(v)) return null
  return v
}
