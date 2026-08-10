// lib/airtable/import-log.ts

import { BASE_ID, HEADERS } from './client'

// ============================================================================
// Import Log — durable audit trail for every bulk import
// ============================================================================
//
// Table: Import Log (tbloKAl3QopcEv1hP)
//
// Fields (created 07/08/26):
//   Import ID              (Autonumber, primary)
//   Timestamp              (Created time)
//   Import Type            (Single select: Referrals | Agencies | Agency Users)
//   Uploaded By            (Single line text — email of Ben/Ray/Dawson/Chase)
//   Total                  (Number)
//   Created                (Number)
//   Skipped                (Number)
//   Errors                 (Number)
//   Success Rate           (Formula — not written)
//   Results JSON           (Long text — full response body)
//   Skipped Rows Summary   (Long text — human-readable list of non-created rows)
//   Source Filename        (Single line text)
//   Notes                  (Long text — user annotations)
//
// This helper is NON-THROWING by design. If Airtable is down, or the field
// names drift, we log the error to console and return null so the caller's
// import result is still returned to the user. Audit logging must never
// block the actual work.

export type ImportLogInput = {
  importType: 'Referrals' | 'Agencies' | 'Agency Users'
  uploadedBy: string
  total: number
  created: number
  skipped: number
  errors: number
  resultsJson: unknown        // will be JSON.stringify'd
  skippedRowsSummary: string  // pre-formatted human text
  sourceFilename?: string
}

export async function writeImportLog(input: ImportLogInput): Promise<string | null> {
  try {
    // Airtable long-text fields cap at 100k chars. Stringify + truncate defensively.
    const rawJson = JSON.stringify(input.resultsJson)
    const jsonField = rawJson.length > 95000
      ? rawJson.slice(0, 95000) + '\n\n...[truncated, ' + (rawJson.length - 95000) + ' chars omitted]'
      : rawJson

    const fields: Record<string, unknown> = {
      'Import Type': input.importType,
      'Uploaded By': input.uploadedBy,
      'Total': input.total,
      'Created': input.created,
      'Skipped': input.skipped,
      'Errors': input.errors,
      'Results JSON': jsonField,
      'Skipped Rows Summary': input.skippedRowsSummary.slice(0, 95000),
    }
    if (input.sourceFilename) fields['Source Filename'] = input.sourceFilename

    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Import Log')}`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ fields }),
      },
    )
    if (!res.ok) {
      const errText = await res.text()
      console.error('[writeImportLog] Airtable rejected write:', errText)
      return null
    }
    const data = await res.json()
    return data?.id ?? null
  } catch (err) {
    console.error('[writeImportLog] Threw:', err)
    return null
  }
}
