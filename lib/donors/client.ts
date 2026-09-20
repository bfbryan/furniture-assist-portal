// lib/donors/client.ts
//
// Low-level Airtable transport for the donor base — a SEPARATE Airtable base
// from the one every other lib/ module in this repo talks to. AIRTABLE_BASE_ID
// / AIRTABLE_API_KEY (agency/referral base) and the modules built on them are
// unrelated to this file and untouched by it.
//
// One shared client, not the scattered per-module pattern several agency
// routes use (each defining its own local BASE_ID/API_KEY) — that pattern
// exists there because those modules touch genuinely separate concerns
// (agencies, users, email automations). Everything donor-checkin touches is
// one table, one feature — the shape lib/airtable/client.ts + lib/airtable/
// agencies.ts already establish for "one base, several related operations."
//
// DONOR_TABLE reads from AIRTABLE_DONOR_TABLE_DONATIONS rather than being
// hardcoded — a deliberate departure from the rest of this codebase's own
// convention (three AIRTABLE_TABLE_* env vars exist for the other base and
// are never read; table names are hardcoded as literals everywhere instead).
// This env var was created specifically for this work, so reading it costs
// nothing and gives Ben a way to repoint the table without a code change if
// the donor base's table is ever renamed.

export const DONOR_BASE_ID = process.env.AIRTABLE_DONOR_BASE_ID!
export const DONOR_API_KEY = process.env.AIRTABLE_DONOR_API_KEY!
export const DONOR_TABLE = process.env.AIRTABLE_DONOR_TABLE_DONATIONS || 'In Kind Donations'

const DONOR_HEADERS = {
  Authorization: `Bearer ${DONOR_API_KEY}`,
  'Content-Type': 'application/json',
}

export async function donorFetch(
  pathOrParams: string = '',
  options?: { method?: string; body?: unknown }
) {
  const url = `https://api.airtable.com/v0/${DONOR_BASE_ID}/${encodeURIComponent(DONOR_TABLE)}${pathOrParams}`
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: DONOR_HEADERS,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Donor Airtable error: ${err}`)
  }
  return res.json()
}
