/**
 * app/api/dawson/scans/upload/route.ts
 *
 * OPTION I: portal-native OCR pipeline.
 *
 * Flow:
 *   1. Receive consolidated multi-page PDF from Dawson's browser
 *   2. Create Scan Batches record (Status = Uploading)
 *   3. Attach original PDF to batch record (for audit)
 *   4. Split PDF into per-page PDFs using pdf-lib (in Node.js)
 *   5. Update batch: Status = OCR Processing, Success Count = pageCount
 *   6. For each page (concurrency-limited parallel):
 *        - Call Gemini OCR
 *        - Resolve record ID against Airtable candidates for that date
 *        - PATCH Client Referrals record with outcome/items/notes/etc
 *        - On failure: flagManualReview + increment OCR Failure Count
 *   7. Update batch with final OCR counts + Status (Complete/Partial/Failed)
 *   8. On any pipeline-level failure: send email to ben@furnitureassist.com
 *   9. Return per-page results to browser for success screen
 *
 * No Google Drive dependency. No Apps Script dependency.
 * All work happens in this single request. Vercel function timeout applies —
 * see MAX_CONCURRENCY and BATCH_TIMEOUT_MS for tuning.
 */

import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import {
  createScanBatch,
  updateScanBatch,
  attachOriginalPdf,
  batchRecordUrl,
  type BatchStatus,
} from '@/lib/scan-batches'
import {
  processPage,
  CandidateCache,
  type ProcessPageResult,
} from '@/lib/gemini-ocr'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min — Vercel Pro plan max

// Cap parallelism to avoid Gemini rate limits / Airtable rate limits.
// Gemini 2.5-pro free tier: 2 RPM, 32K tokens/min. Paid: much higher.
// Airtable: 5 requests/sec per base.
// At concurrency 5, a 60-page batch takes ~60/5 = 12 sequential rounds.
// Each OCR call is ~5-15s → 60-180s for full batch. Well under maxDuration.
const MAX_CONCURRENCY = 5

const NOTIFY_EMAIL = 'ben@furnitureassist.com'


// ============================================================
// POST handler
// ============================================================

export async function POST(req: NextRequest) {
  // AuthN + AuthZ — requireDawsonAccess handles both
  const denied = await requireDawsonAccess()
  if (denied) return denied

  // Look up the uploader's email for the Scan Batches record
  const { userId } = await auth()
  let uploadedBy = 'unknown'
  if (userId) {
    try {
      const client = await clerkClient()
      const user = await client.users.getUser(userId)
      uploadedBy =
        user.primaryEmailAddress?.emailAddress ||
        user.emailAddresses[0]?.emailAddress ||
        userId
    } catch (e) {
      console.warn('Failed to look up uploader email, falling back to userId:', e)
      uploadedBy = userId
    }
  }

  // Parse multipart form data
  let file: File
  let notes: string | undefined
  try {
    const form = await req.formData()
    const raw = form.get('file')
    if (!(raw instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    file = raw
    const rawNotes = form.get('notes')
    if (typeof rawNotes === 'string' && rawNotes.trim()) notes = rawNotes.trim()
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to parse upload: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    )
  }

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
  }

  // Read PDF bytes
  const pdfBytes = Buffer.from(await file.arrayBuffer())
  const sizeMb = pdfBytes.length / (1024 * 1024)

  // Guard against absurdly large PDFs (Vercel memory limit)
  if (sizeMb > 100) {
    return NextResponse.json(
      { error: `PDF too large (${sizeMb.toFixed(1)} MB). Max 100 MB.` },
      { status: 413 },
    )
  }

  // ============================================================
  // 1. Create batch record
  // ============================================================
  let batch: Awaited<ReturnType<typeof createScanBatch>>
  try {
    batch = await createScanBatch({
      uploadedBy,
      originalFilename: file.name,
      originalSizeMb: sizeMb,
      notes,
    })
  } catch (e) {
    console.error('createScanBatch failed:', e)
    return NextResponse.json(
      { error: `Failed to create batch record: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  const batchUrl = batchRecordUrl(batch.id)

  // From here on, always update batch status on failure — never leave orphaned records
  try {
    // ============================================================
    // 2. Attach original PDF to batch record (audit trail)
    // ============================================================
    try {
      await attachOriginalPdf(batch.id, file.name, pdfBytes)
    } catch (e) {
      // Non-fatal — batch record exists, OCR can still proceed. Log to Error Log.
      console.warn('attachOriginalPdf failed (non-fatal):', e)
      await updateScanBatch(batch.id, {
        errorLog: `Warning: Original PDF attachment failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    }

    // ============================================================
    // 3. Split PDF into per-page PDFs
    // ============================================================
    await updateScanBatch(batch.id, { status: 'Splitting' })

    let sourcePdf: PDFDocument
    try {
      sourcePdf = await PDFDocument.load(pdfBytes)
    } catch (e) {
      const msg = `Failed to parse PDF: ${e instanceof Error ? e.message : String(e)}`
      await updateScanBatch(batch.id, { status: 'Failed', errorLog: msg })
      await sendFailureEmail(batch.batchId, file.name, msg)
      return NextResponse.json({ error: msg, batchId: batch.batchId }, { status: 400 })
    }

    const pageCount = sourcePdf.getPageCount()
    if (pageCount === 0) {
      const msg = 'PDF has no pages'
      await updateScanBatch(batch.id, { status: 'Failed', errorLog: msg })
      return NextResponse.json({ error: msg, batchId: batch.batchId }, { status: 400 })
    }

    // Split each page into its own PDF
    const splitResults: Array<{ pageNumber: number; bytes: Buffer | null; error: string | null }> = []
    for (let i = 0; i < pageCount; i++) {
      try {
        const singlePagePdf = await PDFDocument.create()
        const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [i])
        singlePagePdf.addPage(copiedPage)
        const bytes = await singlePagePdf.save()
        splitResults.push({ pageNumber: i + 1, bytes: Buffer.from(bytes), error: null })
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        console.error(`Split failed for page ${i + 1}:`, err)
        splitResults.push({ pageNumber: i + 1, bytes: null, error: err })
      }
    }

    const splitSuccessCount = splitResults.filter((r) => r.bytes !== null).length
    const splitFailureCount = splitResults.filter((r) => r.bytes === null).length

    await updateScanBatch(batch.id, {
      status: 'OCR Processing',
      pageCount,
      successCount: splitSuccessCount,
      failureCount: splitFailureCount,
    })

    // ============================================================
    // 4. OCR each page (concurrency-limited)
    // ============================================================
    const cache = new CandidateCache()
    const ocrResults: ProcessPageResult[] = []
    const splitFailurePages: string[] = splitResults
      .filter((r) => r.error !== null)
      .map((r) => `Page ${r.pageNumber}: split failed — ${r.error}`)

    const pagesToOcr = splitResults.filter((r) => r.bytes !== null)

    // Simple concurrency limiter
    let cursor = 0
    async function worker() {
      while (true) {
        const idx = cursor++
        if (idx >= pagesToOcr.length) return
        const page = pagesToOcr[idx]
        try {
          const result = await processPage({
            pdfBytes: page.bytes!,
            pageNumber: page.pageNumber,
            batchAirtableUrl: batchUrl,
            scanBatchRecordId: batch.id,
            cache,
          })
          ocrResults.push(result)
        } catch (e) {
          // processPage should never throw — it flags manual review internally.
          // But guard anyway.
          const err = e instanceof Error ? e.message : String(e)
          ocrResults.push({
            pageNumber: page.pageNumber,
            success: false,
            recordId: null,
            outcome: null,
            clientName: '',
            appointmentDate: '',
            errorMessage: `Unexpected processPage error: ${err}`,
            ocrDiagnostic: '',
          })
        }
      }
    }

    const workerCount = Math.min(MAX_CONCURRENCY, pagesToOcr.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    // Sort results by page number for stable output
    ocrResults.sort((a, b) => a.pageNumber - b.pageNumber)

    // ============================================================
    // 5. Aggregate + finalize batch record
    // ============================================================
    const ocrSuccessCount = ocrResults.filter((r) => r.success).length
    const ocrFailureCount = ocrResults.filter((r) => !r.success).length

    const ocrFailurePages = ocrResults
      .filter((r) => !r.success)
      .map((r) => {
        const name = r.clientName || '(no name)'
        const rec = r.recordId ? ` [${r.recordId}]` : ''
        return `Page ${r.pageNumber} — ${name}${rec}: ${r.errorMessage}`
      })

    const failedPagesLog = [...splitFailurePages, ...ocrFailurePages].join('\n')

    let finalStatus: BatchStatus
    if (splitFailureCount === 0 && ocrFailureCount === 0) {
      finalStatus = 'Complete'
    } else if (splitSuccessCount === 0 || (ocrFailureCount === pagesToOcr.length && pagesToOcr.length > 0)) {
      finalStatus = 'Failed'
    } else {
      finalStatus = 'Partial'
    }

    await updateScanBatch(batch.id, {
      status: finalStatus,
      ocrSuccessCount,
      ocrFailureCount,
      failedPages: failedPagesLog || undefined,
    })

    // ============================================================
    // 6. Notify on partial/failed
    // ============================================================
    if (finalStatus !== 'Complete') {
      const subject = `Scan Batch #${batch.batchId} — ${finalStatus}`
      const body =
        `Batch: #${batch.batchId} (${file.name})\n` +
        `Uploaded by: ${uploadedBy}\n` +
        `Status: ${finalStatus}\n` +
        `Pages: ${pageCount} | OCR success: ${ocrSuccessCount} | OCR failed: ${ocrFailureCount}\n` +
        `Split success: ${splitSuccessCount} | Split failed: ${splitFailureCount}\n\n` +
        `Failed pages:\n${failedPagesLog || '(none)'}\n\n` +
        `Batch record: ${batchUrl}`
      await sendFailureEmail(batch.batchId, file.name, body, subject)
    }

    // ============================================================
    // 7. Return per-page results to browser
    // ============================================================
    return NextResponse.json({
      success: true,
      batchId: batch.batchId,
      batchRecordId: batch.id,
      batchUrl,
      status: finalStatus,
      pageCount,
      splitSuccessCount,
      splitFailureCount,
      ocrSuccessCount,
      ocrFailureCount,
      results: ocrResults.map((r) => ({
        pageNumber: r.pageNumber,
        success: r.success,
        clientName: r.clientName,
        recordId: r.recordId,
        outcome: r.outcome,
        appointmentDate: r.appointmentDate,
        errorMessage: r.errorMessage,
      })),
      splitFailures: splitResults
        .filter((r) => r.error !== null)
        .map((r) => ({ pageNumber: r.pageNumber, error: r.error })),
    })
  } catch (e) {
    // Catch-all: any unexpected pipeline error
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Upload pipeline error:', e)
    try {
      await updateScanBatch(batch.id, {
        status: 'Failed',
        errorLog: `Pipeline error: ${msg}`,
      })
    } catch (updateErr) {
      console.error('Failed to update batch to Failed:', updateErr)
    }
    await sendFailureEmail(batch.batchId, file.name, `Pipeline crashed: ${msg}`)
    return NextResponse.json(
      { error: msg, batchId: batch.batchId },
      { status: 500 },
    )
  }
}


// ============================================================
// Notification (Zapier webhook or direct SMTP — TBD)
//
// For MVP: log + return. TODO: hook up to actual send mechanism.
// Options:
//   - Zapier webhook (existing pattern in this app)
//   - Resend / SendGrid API
//   - Nodemailer via SMTP
//
// User confirmed NOTIFY_EMAIL = ben@furnitureassist.com
// ============================================================

async function sendFailureEmail(
  batchId: number,
  filename: string,
  body: string,
  subject?: string,
): Promise<void> {
  const finalSubject = subject || `Scan Batch #${batchId} — Failed`
  console.log(`[NOTIFY ${NOTIFY_EMAIL}] ${finalSubject}\n${body}`)

  // If ZAPIER_SCAN_FAILURE_WEBHOOK env var is set, POST to it
  const webhook = process.env.ZAPIER_SCAN_FAILURE_WEBHOOK
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: NOTIFY_EMAIL,
          subject: finalSubject,
          body,
          batchId,
          filename,
        }),
      })
    } catch (e) {
      console.error('Zapier webhook failed:', e)
    }
  }
}
