// app/api/dawson/admin/import-agencies/route.ts
//
// Bulk-import agencies + agency users from Dawson's OCR'd referral-slip CSV.
//
// Body shape:
//   { rows: AgencyImportRow[] }
//
// Each row goes through upsertAgencyAndUser:
//   - Agency: find-or-create by name, status = 'Unclaimed'
//   - Agency User: find-or-create by email, status = 'Unclaimed', role = 'Staff'
//
// Returns per-row results so the UI can show success/skipped/error counts.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { upsertAgencyAndUser } from '@/lib/upsertAgencyAndUser'

// Bump serverless function timeout to 60s. 33 rows × ~500ms each = ~16s,
// but we want headroom for slow Airtable responses. Default (10s on Hobby /
// 15s on Pro) will kill the request mid-loop and return nothing to the UI.
export const maxDuration = 60

export interface AgencyImportRow {
  agencyName: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  officeName?: string
}

export interface AgencyImportRowResult {
  rowIndex: number
  agencyName: string
  email: string
  status: 'created' | 'agency_existed_user_created' | 'both_existed' | 'error'
  agencyId?: string
  userId?: string | null
  agencyCreated?: boolean
  userCreated?: boolean
  warnings?: string[]
  reason?: string
}

export async function POST(req: Request) {
  // ---- Auth ----
  // Use the canonical Dawson-access helper (same as every other Dawson admin
  // route). Handles Ben + Dawson + Ray + Chase and centralizes the allowlist.
  const denied = await requireDawsonAccess({ status: 401 })
  if (denied) return denied

  // ---- Parse body ----
  let body: { rows: AgencyImportRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'rows array is required and must not be empty' },
      { status: 400 }
    )
  }

  // ---- Process sequentially ----
  // Sequential await already caps us at Airtable's ~5 req/sec limit given
  // each row's 2-4 network round-trips. No extra throttle needed.
  const results: AgencyImportRowResult[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const agencyName = (row.agencyName || '').trim()
    const email = (row.email || '').trim()
    const firstName = (row.firstName || '').trim()
    const lastName = (row.lastName || '').trim()

    // Validation policy (per user): no required fields here — the UI passes
    // everything through. The one hard-stop is a completely blank row
    // (no agency name AND no email AND no last name) since the upsert helper
    // would have nothing to dedupe on.
    if (!agencyName && !email && !lastName && !firstName) {
      results.push({
        rowIndex: i,
        agencyName,
        email,
        status: 'error',
        reason: 'Row is completely blank',
      })
      continue
    }

    try {
      // If Agency Name is missing, fall back to a placeholder so the helper
      // has a non-empty dedup key. The user can fix in Airtable after import.
      const safeAgencyName = agencyName || `Unknown Agency (Row ${i + 2})`

      const result = await upsertAgencyAndUser({
        agency: {
          name: safeAgencyName,
          officeName: row.officeName || null,
          status: 'Unclaimed',
          source: 'Created via Import',
          // NOTE: do not pass email, contactFirstName/LastName, contactPhone,
          // or mainPhone here. Those Agency-row fields are reserved for the
          // Agency Admin, who is identified when an Agency User claims the
          // record. The staff person's contact info lives on the Agency User
          // row below, not on the Agency itself.
        },
        // Only attempt to create a user record when we have SOMETHING to
        // identify them by — a name or an email. Pure-blank user rows just
        // create the agency.
        user: (email || firstName || lastName)
          ? {
              firstName: firstName || '',
              lastName: lastName || '',
              email: email || '',
              phone: row.phone || null,
              role: 'Staff',
              status: 'Unclaimed',
              clerkUserId: null,
              // invitedByName intentionally omitted — leave blank for CSV imports
            }
          : undefined,
      })

      // Categorize for cleaner UI reporting
      let status: AgencyImportRowResult['status']
      if (result.agencyCreated && result.userCreated) status = 'created'
      else if (!result.agencyCreated && result.userCreated) status = 'agency_existed_user_created'
      else status = 'both_existed'

      results.push({
        rowIndex: i,
        agencyName,
        email,
        status,
        agencyId: result.agencyId,
        userId: result.userId,
        agencyCreated: result.agencyCreated,
        userCreated: result.userCreated,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[import-agencies] Row ${i} failed:`, msg)
      results.push({
        rowIndex: i,
        agencyName,
        email,
        status: 'error',
        reason: msg,
      })
    }
  }

  // ---- Summary counts ----
  const summary = {
    total: results.length,
    bothCreated: results.filter(r => r.status === 'created').length,
    agencyExisted: results.filter(r => r.status === 'agency_existed_user_created').length,
    bothExisted: results.filter(r => r.status === 'both_existed').length,
    errors: results.filter(r => r.status === 'error').length,
  }

  return NextResponse.json({ summary, results })
}