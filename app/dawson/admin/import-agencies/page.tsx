// app/dawson/admin/import-agencies/page.tsx
//
// Dawson's CSV import for agency + agency-user data from scanned referral slips.
// Mirrors the Excel referral import page (file upload -> preview -> submit -> report).
//
// Expected CSV headers (case-insensitive, order doesn't matter):
//   Agency Name, First Name, Last Name, Email, Phone Number, Office Name
//
// All imported records are written as 'Unclaimed' (Agency + Agency User).
// Dedup is by Agency Name + Email — re-uploading the same file is safe.

'use client'

import { useState } from 'react'

interface ParsedRow {
  agencyName: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  officeName?: string
  __rowNum: number  // 1-based, including header
  __issues: string[]
}

interface RowResult {
  rowIndex: number
  agencyName: string
  email: string
  status: 'created' | 'agency_existed_user_created' | 'both_existed' | 'error'
  agencyId?: string
  userId?: string | null
  warnings?: string[]
  reason?: string
}

interface ImportResponse {
  summary: {
    total: number
    bothCreated: number
    agencyExisted: number
    bothExisted: number
    errors: number
  }
  results: RowResult[]
}

// ---------- CSV parsing ----------

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields with embedded commas
 * and escaped double-quotes ("""). Good enough for Dawson's CSV; if we ever
 * need more robust parsing we'll swap in papaparse.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { cur.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue }
    field += c; i++
  }
  // Trailing field/row
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur) }
  return rows.filter(r => r.some(c => c.trim().length > 0))
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Map normalized header -> our internal field name
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  agencyname:   'agencyName',
  firstname:    'firstName',
  lastname:     'lastName',
  email:        'email',
  phonenumber:  'phone',
  phone:        'phone',
  officename:   'officeName',
}

function buildRows(grid: string[][]): { rows: ParsedRow[]; headerError: string | null } {
  if (grid.length < 2) {
    return { rows: [], headerError: 'CSV needs a header row plus at least one data row' }
  }
  const header = grid[0].map(normalizeHeader)
  const missing: string[] = []
  for (const required of ['agencyname', 'firstname', 'lastname', 'email']) {
    if (!header.includes(required)) missing.push(required)
  }
  if (missing.length > 0) {
    return { rows: [], headerError: `Missing required column(s): ${missing.join(', ')}` }
  }

  const rows: ParsedRow[] = []
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r]
    const row: Partial<ParsedRow> = { __rowNum: r + 1, __issues: [] }
    for (let c = 0; c < header.length; c++) {
      const key = HEADER_MAP[header[c]]
      if (!key) continue
      const value = (raw[c] ?? '').trim()
      ;(row as Record<string, unknown>)[key] = value
    }
    // Validation policy (per user): pass everything through.
    // Blanks are allowed; invalid emails are cleared (so they don't poison
    // the dedup key) but the row still gets imported.
    const issues: string[] = []
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      issues.push(`Email "${row.email}" invalid — cleared`)
      row.email = ''
    }

    row.__issues = issues
    rows.push(row as ParsedRow)
  }
  return { rows, headerError: null }
}

// ---------- Component ----------

export default function ImportAgenciesPage() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [response, setResponse] = useState<ImportResponse | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setResponse(null)
    setRows([])

    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      try {
        const grid = parseCSV(text)
        const { rows: parsed, headerError } = buildRows(grid)
        if (headerError) {
          setParseError(headerError)
          return
        }
        setRows(parsed)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV')
      }
    }
    reader.readAsText(file)
  }

  async function onSubmit() {
    // Send ALL rows — issues are non-blocking now
    if (rows.length === 0) return
    setSubmitting(true)
    setResponse(null)
    try {
      const payload = rows.map(r => ({
        agencyName: r.agencyName,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        officeName: r.officeName,
      }))
      const res = await fetch('/api/dawson/admin/import-agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error || 'Import failed')
      } else {
        setResponse(data as ImportResponse)
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const issueCount = rows.filter(r => r.__issues.length > 0).length

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Import Agencies (CSV)</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        Upload OCR'd referral-slip data. Every row creates (or finds) an Agency
        plus an Agency User, both with status <strong>Unclaimed</strong>. Re-uploading
        the same file is safe — dedup is by Agency Name and Email.
      </p>

      <div style={{ border: '1px dashed #aaa', borderRadius: 8, padding: 24, background: '#fafafa', marginBottom: 24 }}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          style={{ display: 'block' }}
        />
        {fileName && (
          <p style={{ marginTop: 12, color: '#444' }}>
            File: <strong>{fileName}</strong>
            {rows.length > 0 && (
              <>
                {' — '}
                <span style={{ color: '#0a7' }}>{rows.length} row{rows.length === 1 ? '' : 's'} ready</span>
                {issueCount > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: '#c80' }}>{issueCount} with soft warnings</span>
                  </>
                )}
              </>
            )}
          </p>
        )}
        <p style={{ fontSize: 13, color: '#777', marginTop: 8 }}>
          Expected columns: Agency Name, First Name, Last Name, Email, Phone Number, Office Name. Blank cells are allowed.
        </p>
      </div>

      {parseError && (
        <div style={{ background: '#fee', border: '1px solid #c33', borderRadius: 6, padding: 12, marginBottom: 16, color: '#900' }}>
          {parseError}
        </div>
      )}

      {rows.length > 0 && !response && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 12 }}>Preview ({rows.length} rows)</h2>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f4f4f4' }}>
                  <th style={th}>Row</th>
                  <th style={th}>Agency Name</th>
                  <th style={th}>First Name</th>
                  <th style={th}>Last Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Office</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} style={{ background: r.__issues.length > 0 ? '#fffaf0' : 'white' }}>
                    <td style={td}>{r.__rowNum}</td>
                    <td style={td}>{r.agencyName}</td>
                    <td style={td}>{r.firstName}</td>
                    <td style={td}>{r.lastName}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>{r.phone || ''}</td>
                    <td style={td}>{r.officeName || ''}</td>
                    <td style={td}>
                      {r.__issues.length === 0
                        ? <span style={{ color: '#0a7' }}>Ready</span>
                        : <span style={{ color: '#c80' }}>{r.__issues.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24 }}>
            <button
              onClick={onSubmit}
              disabled={submitting || rows.length === 0}
              style={{
                background: rows.length === 0 ? '#aaa' : '#0a7',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 6,
                fontSize: 16,
                cursor: rows.length === 0 || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Importing…' : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </button>
            {issueCount > 0 && (
              <span style={{ marginLeft: 12, color: '#888', fontSize: 13 }}>
                ({issueCount} row{issueCount === 1 ? '' : 's'} had soft warnings — still imported)
              </span>
            )}
          </div>
        </>
      )}

      {response && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 12 }}>Results</h2>
          <div style={{ background: '#f0f8f0', border: '1px solid #cdc', borderRadius: 6, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: 0 }}>
              <strong>{response.summary.total}</strong> rows processed —
              {' '}<span style={{ color: '#0a7' }}>{response.summary.bothCreated} new agency+user</span>,
              {' '}<span style={{ color: '#067' }}>{response.summary.agencyExisted} new user on existing agency</span>,
              {' '}<span style={{ color: '#777' }}>{response.summary.bothExisted} already existed</span>
              {response.summary.errors > 0 && (
                <>{' '}, <span style={{ color: '#c33' }}>{response.summary.errors} errors</span></>
              )}
            </p>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f4f4f4' }}>
                  <th style={th}>Row</th>
                  <th style={th}>Agency</th>
                  <th style={th}>Email</th>
                  <th style={th}>Result</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {response.results.map((r, idx) => (
                  <tr key={idx}>
                    <td style={td}>{r.rowIndex + 2 /* +1 for 1-based, +1 for header */}</td>
                    <td style={td}>{r.agencyName}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>
                      {r.status === 'created' && <span style={{ color: '#0a7' }}>Agency + user created</span>}
                      {r.status === 'agency_existed_user_created' && <span style={{ color: '#067' }}>User created (agency existed)</span>}
                      {r.status === 'both_existed' && <span style={{ color: '#777' }}>Already existed</span>}
                      {r.status === 'error' && <span style={{ color: '#c33' }}>Error</span>}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: '#666' }}>
                      {r.reason || (r.warnings && r.warnings.join('; ')) || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #ddd', fontWeight: 600 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee' }
