/**
 * lib/scanning/batches.ts
 *
 * Airtable helpers for the Scan Batches table. Handles create, update,
 * PDF attachment, and record-URL construction.
 *
 * Table schema (Scan Batches):
 *   - Batch ID (Autonumber, primary)
 *   - Batch Name (Formula: "Batch #" & {Batch ID} & " — " & datetime)
 *   - Uploaded By (Email)
 *   - Uploaded At (Date/Time)
 *   - Original Filename (Text)
 *   - Original Size MB (Number)
 *   - Original PDF (Attachment) — the consolidated scan for audit
 *   - Page Count (Number)
 *   - Success Count (Number) — split successes
 *   - Failure Count (Number) — split failures
 *   - OCR Success Count (Number)
 *   - OCR Failure Count (Number)
 *   - Status (Single select: Uploading / Splitting / OCR Processing /
 *            Complete / Partial / Failed)
 *   - Notes (Long text)
 *   - Error Log (Long text)
 *   - Failed Pages (Long text)
 *   - Processed Referrals (Link to Client Referrals — auto-reciprocal)
 */

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_SCAN_BATCHES_TABLE_ID = process.env.AIRTABLE_SCAN_BATCHES_TABLE_ID
  || 'Scan Batches' // fallback to table name if ID not set

const AIRTABLE_TABLE = 'Scan Batches'

export type BatchStatus =
  | 'Uploading'
  | 'Splitting'
  | 'OCR Processing'
  | 'Complete'
  | 'Partial'
  | 'Failed'

export interface ScanBatchRecord {
  id: string           // Airtable record ID (recXXX)
  batchId: number      // Autonumber (human-readable batch number)
  uploadedAt: string   // ISO timestamp
}


function requireEnv() {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_BASE_ID or AIRTABLE_API_KEY not set')
  }
  return { baseId: AIRTABLE_BASE_ID, apiKey: AIRTABLE_API_KEY }
}


/**
 * Build the Airtable web URL to a specific Scan Batches record.
 * Used as the "Sheet Drive Link" value on processed Client Referrals so
 * volunteers can jump straight to the batch record to download the audit PDF.
 *
 * Note: This is a best-effort URL. Airtable record URLs require the base ID +
 * table ID + record ID. If AIRTABLE_SCAN_BATCHES_TABLE_ID env var is not set,
 * we fall back to a base-level URL that still works but doesn't jump directly
 * to the record.
 */
export function batchRecordUrl(recordId: string): string {
  if (!AIRTABLE_BASE_ID) return ''
  if (AIRTABLE_SCAN_BATCHES_TABLE_ID.startsWith('tbl')) {
    return `https://airtable.com/${AIRTABLE_BASE_ID}/${AIRTABLE_SCAN_BATCHES_TABLE_ID}/${recordId}`
  }
  return `https://airtable.com/${AIRTABLE_BASE_ID}`
}


/**
 * Create a new Scan Batches record for the upload event.
 * Called at the top of the upload flow before splitting starts.
 */
export async function createScanBatch({
  uploadedBy,
  originalFilename,
  originalSizeMb,
  notes,
}: {
  uploadedBy: string
  originalFilename: string
  originalSizeMb: number
  notes?: string
}): Promise<ScanBatchRecord> {
  const { baseId, apiKey } = requireEnv()

  const fields: Record<string, unknown> = {
    'Uploaded By': uploadedBy,
    'Uploaded At': new Date().toISOString(),
    'Original Filename': originalFilename,
    'Original Size MB': Number(originalSizeMb.toFixed(1)),
    'Status': 'Uploading' satisfies BatchStatus,
  }
  if (notes) fields['Notes'] = notes

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(AIRTABLE_TABLE)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ fields, typecast: true }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`createScanBatch failed: ${res.status} ${body}`)
  }

  const data = await res.json() as {
    id: string
    fields: {
      'Batch ID': number
      'Uploaded At': string
    }
  }

  return {
    id: data.id,
    batchId: data.fields['Batch ID'],
    uploadedAt: data.fields['Uploaded At'],
  }
}


/**
 * Update an existing Scan Batches record with partial fields.
 * Used throughout the upload flow to reflect progress.
 */
export async function updateScanBatch(
  recordId: string,
  updates: {
    status?: BatchStatus
    pageCount?: number
    successCount?: number      // split successes
    failureCount?: number      // split failures
    ocrSuccessCount?: number
    ocrFailureCount?: number
    errorLog?: string
    failedPages?: string       // human-readable per-page failure log
  },
): Promise<void> {
  const { baseId, apiKey } = requireEnv()

  const fields: Record<string, unknown> = {}
  if (updates.status !== undefined) fields['Status'] = updates.status
  if (updates.pageCount !== undefined) fields['Page Count'] = updates.pageCount
  if (updates.successCount !== undefined) fields['Success Count'] = updates.successCount
  if (updates.failureCount !== undefined) fields['Failure Count'] = updates.failureCount
  if (updates.ocrSuccessCount !== undefined) fields['OCR Success Count'] = updates.ocrSuccessCount
  if (updates.ocrFailureCount !== undefined) fields['OCR Failure Count'] = updates.ocrFailureCount
  if (updates.errorLog !== undefined) fields['Error Log'] = updates.errorLog
  if (updates.failedPages !== undefined) fields['Failed Pages'] = updates.failedPages

  if (Object.keys(fields).length === 0) return

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ fields, typecast: true }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`updateScanBatch failed: ${res.status} ${body}`)
  }
}


/**
 * Attach the original consolidated PDF to the Scan Batches record.
 *
 * Airtable attachment API accepts either a public URL (Airtable fetches it)
 * or a raw upload via the new content endpoint (added 2024). We use the
 * content upload endpoint so we don't need to host the PDF ourselves.
 *
 * NOTE: This uses Airtable's Web API upload attachment endpoint:
 *   POST https://content.airtable.com/v0/{baseId}/{recordId}/{fieldNameOrId}/uploadAttachment
 * Requires the API key to have content upload scope.
 */
export async function attachOriginalPdf(
  recordId: string,
  filename: string,
  pdfBytes: Buffer,
): Promise<void> {
  const { baseId, apiKey } = requireEnv()

  const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent('Original PDF')}/uploadAttachment`

  const body = {
    contentType: 'application/pdf',
    file: pdfBytes.toString('base64'),
    filename,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`attachOriginalPdf failed: ${res.status} ${text}`)
  }
}
