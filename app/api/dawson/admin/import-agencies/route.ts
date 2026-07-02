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
  const denied = await requireDawsonAccess()
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

  // ---- Process sequentially with throttle ----
  const results: AgencyImportRowResult[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const agencyName = (row.agencyName || '').trim()
    const email = (row.email || '').trim()
    const firstName = (row.firstName || '').trim()
    const lastName = (row.lastName || '').trim()

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
      const safeAgencyName = agencyName || `Unknown Agency (Row ${i + 2})`

      const result = await upsertAgencyAndUser({
        agency: {
          name: safeAgencyName,
          officeName: row.officeName || null,
          status: 'Unclaimed',
          source: 'Created via Import',
        },
        user: (email || firstName || lastName)
          ? {
              firstName: firstName || '',
              lastName: lastName || '',
              email: email || '',
              phone: row.phone || null,
              role: 'Staff',
              status: 'Unclaimed',
              clerkUserId: null,
            }
          : undefined,
      })

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
      results.push({
        rowIndex: i,
        agencyName,
        email,
        status: 'error',
        reason: msg,
      })
    }

    if (i < rows.length - 1) await new Promise(r => setTimeout(r, 250))
  }

  const summary = {
    total: results.length,
    bothCreated: results.filter(r => r.status === 'created').length,
    agencyExisted: results.filter(r => r.status === 'agency_existed_user_created').length,
    bothExisted: results.filter(r => r.status === 'both_existed').length,
    errors: results.filter(r => r.status === 'error').length,
  }

  return NextResponse.json({ summary, results })
}
