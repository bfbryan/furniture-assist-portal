/**
 * app/dawson/scans/upload/page.tsx
 *
 * OPTION I: portal-native OCR upload page.
 *
 * Upload flow:
 *   1. Volunteer picks a consolidated PDF (~50-60 pages from Saturday scan)
 *   2. Uploads via multipart form to /api/dawson/scans/upload
 *   3. Server streams back per-page results
 *   4. Success screen shows batch summary + per-page result table
 *
 * All heavy lifting (split, OCR, Airtable write) happens server-side.
 * Progress display uses simple polling — for a 60-page batch expect ~2-3 min.
 */

'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

// Nexus design tokens (aligned with rest of Dawson portal)
const EDIT_ACCENT = '#2A7F6F'
const READ_ACCENT = '#7A8899'
const BG = '#F7F6F2'
const SURFACE = '#F9F8F5'
const BORDER = '#D4D1CA'
const TEXT = '#28251D'
const TEXT_MUTED = '#7A7974'
const ERROR = '#A12C7B'
const WARNING = '#964219'
const SUCCESS = '#437A22'


// ============================================================
// Types (matches server response)
// ============================================================

interface PageResult {
  pageNumber: number
  success: boolean
  clientName: string
  recordId: string | null
  outcome: 'Completed' | 'No Show' | 'Cancelled' | 'Reschedule' | null
  appointmentDate: string
  errorMessage: string | null
  // Set on a page that succeeded but still wants reading — e.g. a reschedule
  // booked into a slot that was already full.
  notice: string | null
}

interface SplitFailure {
  pageNumber: number
  error: string
}

interface UploadResponse {
  success: boolean
  batchId: number
  batchRecordId: string
  batchUrl: string
  status: 'Complete' | 'Partial' | 'Failed'
  pageCount: number
  splitSuccessCount: number
  splitFailureCount: number
  ocrSuccessCount: number
  ocrFailureCount: number
  results: PageResult[]
  splitFailures: SplitFailure[]
  error?: string
}


export default function ScansUploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResponse | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(selected: File | null | undefined) {
    if (!selected) return
    if (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.')
      return
    }
    setError(null)
    setFile(selected)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!isUploading) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (isUploading) return
    const dropped = e.dataTransfer.files?.[0]
    handleFileSelect(dropped)
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setIsUploading(true)
    setError(null)
    setResult(null)

    try {
      // ============================================================
      // Step 1: Upload the PDF directly to Vercel Blob.
      //
      // This bypasses Vercel's 4.5 MB serverless function payload limit.
      // The @vercel/blob/client SDK calls /api/dawson/scans/blob-upload-url
      // under the hood to obtain a scoped upload token, then PUTs the file
      // straight to Blob storage. The API route below only receives the
      // resulting blob URL (a few hundred bytes).
      // ============================================================
      const { upload } = await import('@vercel/blob/client')
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/dawson/scans/blob-upload-url',
        contentType: 'application/pdf',
      })

      // ============================================================
      // Step 2: Trigger OCR pipeline with the blob URL
      // ============================================================
      const res = await fetch('/api/dawson/scans/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: blob.url,
          filename: file.name,
          notes: notes.trim() || undefined,
        }),
      })
      const data = (await res.json()) as UploadResponse
      if (!res.ok || !data.success) {
        setError(data.error || `Upload failed: HTTP ${res.status}`)
        // Show partial results if we got a batchId back
        if (data.batchId) setResult(data)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsUploading(false)
    }
  }

  function reset() {
    setFile(null)
    setNotes('')
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT, padding: '32px 24px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>
                Upload Saturday Scan
              </h1>
              <p style={{ color: TEXT_MUTED, fontSize: 14 }}>
                Upload the consolidated scan of completed pickup sheets. The portal will split,
                OCR, and update each client&apos;s record automatically.
              </p>
            </div>
            {/* Scan history link removed — page not built yet */}
          </div>
        </div>

        {/* Upload form (hidden when result shown) */}
        {!result && (
          <form onSubmit={handleUpload}>
            <div
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                  Consolidated PDF
                </div>
                <div
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '32px 20px',
                    border: `2px ${file ? 'solid' : 'dashed'} ${
                      isDragging ? EDIT_ACCENT : file ? SUCCESS : BORDER
                    }`,
                    borderRadius: 8,
                    background: isDragging
                      ? '#E8F1EF'
                      : file
                        ? '#EEF7E7'
                        : BG,
                    textAlign: 'center',
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease',
                    opacity: isUploading ? 0.6 : 1,
                  }}
                >
                  {file ? (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: SUCCESS,
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 700,
                            lineHeight: 1,
                          }}
                        >
                          ✓
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: SUCCESS }}>
                          File ready to upload
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, marginBottom: 4 }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: 13, color: TEXT_MUTED }}>
                        {(file.size / (1024 * 1024)).toFixed(1)} MB &middot; click or drop to replace
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: TEXT, marginBottom: 4 }}>
                        Drag &amp; drop the scan PDF here
                      </div>
                      <div style={{ fontSize: 13, color: TEXT_MUTED }}>
                        or click to browse
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={isUploading}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>

              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                  Notes (optional)
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isUploading}
                  placeholder="Any context about this batch"
                  rows={2}
                  style={{
                    width: '100%',
                    padding: 10,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    background: BG,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </label>
            </div>

            {error && (
              <div
                style={{
                  padding: 12,
                  marginBottom: 16,
                  border: `1px solid ${ERROR}`,
                  borderRadius: 6,
                  background: '#FCF0F7',
                  color: ERROR,
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!file || isUploading}
              style={{
                background: EDIT_ACCENT,
                color: 'white',
                border: 'none',
                padding: '14px 28px',
                borderRadius: 6,
                fontSize: 15,
                fontWeight: 600,
                cursor: isUploading || !file ? 'not-allowed' : 'pointer',
                opacity: isUploading || !file ? 0.6 : 1,
                boxShadow: file && !isUploading ? '0 2px 6px rgba(42, 127, 111, 0.25)' : 'none',
                transition: 'box-shadow 120ms ease, transform 120ms ease',
              }}
            >
              {isUploading ? 'Processing… this can take 2-3 min for 60 pages' : 'Upload & Process'}
            </button>

            {isUploading && (
              <p style={{ marginTop: 12, fontSize: 13, color: TEXT_MUTED }}>
                Do not close this tab. The portal is splitting the PDF, running OCR on each page,
                and updating client records. You&apos;ll see per-page results when it finishes.
              </p>
            )}
          </form>
        )}

        {/* Result screen */}
        {result && (
          <ResultScreen
            result={result}
            error={error}
            onReset={reset}
          />
        )}
      </div>
    </div>
  )
}


// ============================================================
// Result screen
// ============================================================

function ResultScreen({
  result,
  error,
  onReset,
}: {
  result: UploadResponse
  error: string | null
  onReset: () => void
}) {
  const statusColor =
    result.status === 'Complete' ? SUCCESS :
    result.status === 'Partial' ? WARNING :
    ERROR

  return (
    <div>
      {/* Summary card */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 24,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600 }}>Batch #{result.batchId}</h2>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '3px 10px',
              borderRadius: 12,
              background: statusColor,
              color: 'white',
            }}
          >
            {result.status}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 16 }}>
          <Stat label="Pages" value={result.pageCount} />
          <Stat label="OCR success" value={result.ocrSuccessCount} accent={SUCCESS} />
          <Stat label="OCR failed" value={result.ocrFailureCount} accent={result.ocrFailureCount > 0 ? ERROR : TEXT_MUTED} />
          {result.splitFailureCount > 0 && (
            <Stat label="Split failed" value={result.splitFailureCount} accent={ERROR} />
          )}
        </div>

        {result.batchUrl && (
          <div style={{ marginTop: 16, fontSize: 13 }}>
            <a
              href={result.batchUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: READ_ACCENT, textDecoration: 'none' }}
            >
              Open batch in Airtable →
            </a>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: `1px solid ${ERROR}`,
              borderRadius: 6,
              background: '#FCF0F7',
              color: ERROR,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Per-page table */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${BORDER}`,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Per-page results
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: BG }}>
              <tr>
                <th style={thStyle}>Page</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Outcome</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.pageNumber} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={tdStyle}>{r.pageNumber}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: r.success ? SUCCESS : ERROR,
                        color: 'white',
                      }}
                    >
                      {r.success ? 'OK' : 'FAIL'}
                    </span>
                  </td>
                  <td style={tdStyle}>{r.clientName || '—'}</td>
                  <td style={tdStyle}>{r.appointmentDate || '—'}</td>
                  <td style={tdStyle}>{r.outcome || '—'}</td>
                  <td style={{ ...tdStyle, color: r.success ? TEXT_MUTED : ERROR, maxWidth: 320 }}>
                    {r.success ? (r.notice || '') : (r.errorMessage || '')}
                  </td>
                </tr>
              ))}
              {result.splitFailures.map((r) => (
                <tr key={`split-${r.pageNumber}`} style={{ borderTop: `1px solid ${BORDER}`, background: '#FDF6F0' }}>
                  <td style={tdStyle}>{r.pageNumber}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: ERROR, color: 'white' }}>
                      SPLIT FAIL
                    </span>
                  </td>
                  <td style={tdStyle} colSpan={4}>{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={onReset}
        style={{
          background: EDIT_ACCENT,
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Upload another batch
      </button>
    </div>
  )
}


function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: accent || TEXT, marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}


const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 500,
  color: TEXT_MUTED,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'top',
}
