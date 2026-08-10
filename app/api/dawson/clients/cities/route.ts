// app/api/dawson/clients/cities/route.ts
//
// GET /api/dawson/clients/cities
//
// Returns City values already on file in the Clients table, most frequent
// first, so the Add Referral form can offer a native <datalist>
// autocomplete on the City field instead of Dawson retyping "Elizabeth"
// for the thousandth time. Fetched once on page load and cached
// client-side -- never re-queried per keystroke, so this stays fast.
//
// Capped at a few pages of Clients (a few hundred records) rather than
// paging through the entire table -- more than enough to see which towns
// actually repeat, and keeps this endpoint quick.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const MAX_PAGES = 5 // ~500 records -- plenty to see which cities repeat

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  try {
    const counts = new Map<string, number>()
    let offset: string | undefined
    let pages = 0

    do {
      const url =
        `https://api.airtable.com/v0/${BASE_ID}/Clients` +
        `?fields%5B%5D=City&pageSize=100` +
        (offset ? `&offset=${offset}` : '')
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()

      for (const r of data.records || []) {
        const city = String(r.fields['City'] || '').trim()
        if (!city) continue
        counts.set(city, (counts.get(city) || 0) + 1)
      }

      offset = data.offset
      pages += 1
    } while (offset && pages < MAX_PAGES)

    const cities = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([city]) => city)

    return NextResponse.json({ cities })
  } catch (e: any) {
    console.error('cities lookup failed:', e)
    // Non-fatal -- the City field just falls back to a plain text input.
    return NextResponse.json({ cities: [] })
  }
}
