/**
 * POST /api/dawson/admin/import-referrals
 *
 * Body: { rows: ReferralInput[] }
 * Returns: { results: Array<{ rowIndex, ...CreateResult }> }
 *
 * Processes rows sequentially to avoid Airtable rate limits (5 req/sec/base).
 * Each row: dedupe-check → find/create agency → find/create staff → create referral.
 *
 * Auth: Dawson portal allowlist (Ben/Ray/Dawson/Chase).
 */

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import {
  createReferralWithAgency,
  loadSaturdayScheduleMap,
  type ReferralInput,
  type CreateResult,
  type SaturdayMap,
} from '@/lib/createReferralWithAgency'

export async function POST(req: Request) {
  // ---- Auth ---- (preserve original 401 status for this admin endpoint)
  const denied = await requireDawsonAccess({ status: 401 })
  if (denied) return denied

  // ---- Parse ----
  let body: { rows?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const rows = body.rows
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: '`rows` must be an array' }, { status: 400 })
  }
  if (rows.length === 0) {
    return NextResponse.json({ results: [] })
  }
  if (rows.length > 200) {
    return NextResponse.json(
      { error: `Too many rows (${rows.length}). Max 200 per request.` },
      { status: 400 }
    )
  }

  // ---- Load Saturday Schedule map once (one full-table scan per batch) ----
  let saturdayMap: SaturdayMap
  try {
    saturdayMap = await loadSaturdayScheduleMap()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Failed to load Saturday Schedule: ${msg}` },
      { status: 500 }
    )
  }

  // ---- Process sequentially ----
  const results: Array<{ rowIndex: number } & CreateResult> = []
  for (let i = 0; i < rows.length; i++) {
    const input = rows[i] as ReferralInput
    try {
      const result = await createReferralWithAgency(input, saturdayMap)
      results.push({ rowIndex: i, ...result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ rowIndex: i, status: 'error', reason: msg })
    }
    if (i < rows.length - 1) await new Promise(r => setTimeout(r, 220))
  }

  // ---- Summary ----
  const summary = {
    total: results.length,
    created: results.filter(r => r.status === 'created').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
  }

  return NextResponse.json({ summary, results })
}
