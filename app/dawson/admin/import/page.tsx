'use client'


import { useState, useRef, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'

// sessionStorage key for the last import result. Kept short-lived so leaving
// the tab doesn't linger stale data, but survives a page-blank / accidental
// refresh so the audit trail never disappears mid-review.
const RESULTS_STORAGE_KEY = 'dawson.importReferrals.lastResults.v1'


// ============================================================================
// Types
// ============================================================================


type RawRow = Record<string, string | number | undefined>


type SkipReason =
  | 'not-client-row'
  | 'no-name'
  | 'no-appt-date'
  | 'non-saturday-appt'
  | 'no-ref-by-and-no-appt'
  | 'unparseable-appt'


type ParsedRow = {
  rowIndex: number          // 1-based, matches Excel row number
  raw: RawRow
  data: ReferralInput
  validationErrors: string[]
  warnings: string[]        // e.g., unmapped "Wants" entries
  apptDateISO: string | null // YYYY-MM-DD, used for date-picker grouping
  apptDow: number | null     // 0=Sun..6=Sat
  skipReason: SkipReason | null
}


type ReferralInput = {
  firstName: string
  lastName: string
  dob: string
  phone: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
  county: string
  preferredLanguage: string
  hhSize: number | null
  children: number | null
  agencyName: string
  staffFirstName: string
  staffLastName: string
  staffPhone: string
  staffEmail: string
  referralDate: string
  appointmentDate: string
  appointmentTime: string
  itemsRequested: string    // comma-separated list of canonical categories
  externalNotes: string
  internalNotes: string
  preferredDate: string
  schedulingFlexibility: string
}


type ImportResult = {
  rowIndex: number
  status: 'created' | 'skipped' | 'error'
  uniqueId?: string
  referralId?: string
  existingReferralId?: string
  reason?: string
  agencyCreated?: boolean
  staffCreated?: boolean
}


// ============================================================================
// Wants → Portal category mapping (Dawson's vocabulary)
// ============================================================================


// LOCKED to the post–June 2026 schema. Client Referrals.Items Requested
// is a multi-select with EXACTLY these six options (verified in Airtable
// 06/30/26). Any other string will be rejected by Airtable as an invalid
// option. Do not add/rename without updating the Airtable field choices
// at the same time.
const CATEGORIES = {
  BEDROOM: 'Bedroom Furniture',
  LIVING_ROOM: 'Living Room Furniture',
  DINING: 'Dining Room Furniture',
  CLOTHES: 'Clothes',
  HOUSEHOLD: 'Household Items (including kitchen & linens)',
  BABY: 'Baby Items',
} as const


const ALL_CATEGORIES = [
  CATEGORIES.BEDROOM,
  CATEGORIES.LIVING_ROOM,
  CATEGORIES.DINING,
  CATEGORIES.CLOTHES,
  CATEGORIES.HOUSEHOLD,
  CATEGORIES.BABY,
]


// Each key here is a lowercase, normalized Want token.
// Value is a category constant, an array of categories, or 'ALL'.
const WANTS_MAP: Record<string, string | string[] | 'ALL'> = {
  // ── Category abbreviations ──
  'lr': CATEGORIES.LIVING_ROOM,
  'br': CATEGORIES.BEDROOM,
  'dr': CATEGORIES.DINING,
  'small': CATEGORIES.HOUSEHOLD,
  'household items': CATEGORIES.HOUSEHOLD,
  'kitchen': CATEGORIES.HOUSEHOLD,
  'baby': CATEGORIES.BABY,
  'baby items': CATEGORIES.BABY,
  'clothes': CATEGORIES.CLOTHES,
  'more clothes': CATEGORIES.CLOTHES,
  'everything': 'ALL',


  // ── Bedroom items ──
  'bunk bed': CATEGORIES.BEDROOM,
  'q bed': CATEGORIES.BEDROOM,
  'queen bed': CATEGORIES.BEDROOM,
  'full bed': CATEGORIES.BEDROOM,
  'twin bed': CATEGORIES.BEDROOM,
  'bed': CATEGORIES.BEDROOM,
  'beds': CATEGORIES.BEDROOM,
  'sofa bed': CATEGORIES.BEDROOM,
  'toddler bed': CATEGORIES.BEDROOM,
  'mattress': CATEGORIES.BEDROOM,
  'dresser': CATEGORIES.BEDROOM,
  'wardrobe': CATEGORIES.BEDROOM,
  'nightstand': CATEGORIES.BEDROOM,
  'night stand': CATEGORIES.BEDROOM,


  // ── Baby ──
  'crib': CATEGORIES.BABY,


  // ── Living room items ──
  'sofa': CATEGORIES.LIVING_ROOM,
  'love seat': CATEGORIES.LIVING_ROOM,
  'loveseat': CATEGORIES.LIVING_ROOM,
  'couch': CATEGORIES.LIVING_ROOM,
  'couches': CATEGORIES.LIVING_ROOM,
  'arm chair': CATEGORIES.LIVING_ROOM,
  'armchair': CATEGORIES.LIVING_ROOM,
  'chair': CATEGORIES.LIVING_ROOM,
  'chairs': CATEGORIES.LIVING_ROOM,
  'recliner': CATEGORIES.LIVING_ROOM,
  'lamp': CATEGORIES.LIVING_ROOM,
  'tv': CATEGORIES.LIVING_ROOM,
  'coffee table': CATEGORIES.LIVING_ROOM,
  'end table': CATEGORIES.LIVING_ROOM,


  // ── Dining items ──
  'dine table': CATEGORIES.DINING,
  'dining table': CATEGORIES.DINING,
  'kit table': CATEGORIES.DINING,
  'kitchen table': CATEGORIES.DINING,
  'sm kit table & chairs': CATEGORIES.DINING,
  'kit set': CATEGORIES.DINING,
  'kitchen set': CATEGORIES.DINING,
  'table': CATEGORIES.DINING,


  // ── Household / appliances ──
  'refrigerator': CATEGORIES.HOUSEHOLD,
  'fridge': CATEGORIES.HOUSEHOLD,
  'microwave': CATEGORIES.HOUSEHOLD,
  'air fryer': CATEGORIES.HOUSEHOLD,
  'a/c': CATEGORIES.HOUSEHOLD,
  'ac': CATEGORIES.HOUSEHOLD,
  'air conditioner': CATEGORIES.HOUSEHOLD,
  'outdoor furn': CATEGORIES.HOUSEHOLD,
  'outdoor furniture': CATEGORIES.HOUSEHOLD,
}


function normalizeWantToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(\d+\)/g, '')           // strip "(2)", "(3)" markers
    .replace(/[.,;]+$/g, '')           // strip trailing punctuation ("DR," → "dr")
    .replace(/\s+/g, ' ')
    .trim()
}


/**
 * Splits mashed tokens like "Beds (3)Dresser" → ["Beds", "Dresser"]
 * Heuristic: insert a separator before an uppercase letter that follows
 * a lowercase letter or a closing paren.
 */
function explodeMashedToken(token: string): string[] {
  // Insert a delimiter between e.g. "...3)Dresser" or "...edsDresser"
  const exploded = token
    .replace(/\)([A-Z])/g, ') | $1')
    .replace(/([a-z])([A-Z])/g, '$1 | $2')
  return exploded.split('|').map(t => t.trim()).filter(Boolean)
}


function mapWantsToCategories(wantsRaw: string): { categories: string[]; warnings: string[] } {
  if (!wantsRaw?.trim()) return { categories: [], warnings: [] }


  // Split on newlines or commas first; then explode any mashed token.
  const rawTokens = wantsRaw.split(/[\n,]+/).map(t => t.trim()).filter(Boolean)
  const tokens: string[] = []
  for (const rt of rawTokens) {
    explodeMashedToken(rt).forEach(t => tokens.push(normalizeWantToken(t)))
  }


  const found = new Set<string>()
  const warnings: string[] = []


  for (const token of tokens) {
    if (!token) continue
    const mapped = WANTS_MAP[token]
    if (mapped === undefined) {
      // Defaults to Household so the row still imports cleanly. Dawson
      // can correct it in Airtable later; the warning surfaces in the
      // preview so it's not silent.
      warnings.push(`Unmapped Want: "${token}" — defaulted to Household Items`)
      found.add(CATEGORIES.HOUSEHOLD)
    } else if (mapped === 'ALL') {
      ALL_CATEGORIES.forEach(c => found.add(c))
    } else if (Array.isArray(mapped)) {
      mapped.forEach(c => found.add(c))
    } else {
      found.add(mapped)
    }
  }


  return { categories: Array.from(found), warnings }
}


// ============================================================================
// Referred-by parsing — dirty derivation (Rule B)
// ============================================================================


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/


function humanizeDomain(domain: string): string {
  if (!domain) return ''
  const stem = domain.split('.')[0] || domain
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}


/**
 * Three outcomes:
 *   • Empty input → all blank (caller may default agency to "Unknown")
 *   • Looks like an email → derive agency from domain + first name from local part
 *   • Anything else (free text, partial email, "ipane @ lacasadedon") →
 *     agency name = whole string (cleaned), email/firstName blank
 */
function parseReferredBy(
  raw: string
): { email: string; agencyName: string; firstName: string; lastName: string } {
  const input = (raw || '').trim()
  if (!input) return { email: '', agencyName: '', firstName: '', lastName: '' }


  // Case 1: Full staff label — "First Last — Agency Name (email@here.com)"
  //         or "T. Cooper — Weequahic FSC (tcooper@nesfnj.org)"
  // Pull the email out of the parens, the agency from between the dash
  // and the parens, and the name from before the dash.
  const labelMatch = input.match(/^(.*?)\s*[—\-]\s*(.+?)\s*\((\S+?@\S+?)\)\s*$/)
  if (labelMatch) {
    const namePart = labelMatch[1].trim()
    const agencyName = labelMatch[2].trim().replace(/\s+/g, ' ')
    const email = labelMatch[3].trim().toLowerCase()
    // Name is usually "F. Last" or "First Last" — split on whitespace.
    const nameTokens = namePart.split(/\s+/).filter(Boolean)
    const firstName = nameTokens[0] || ''
    const lastName = nameTokens.slice(1).join(' ')
    return { email, agencyName, firstName, lastName }
  }


  // Case 2: Bare email — Dawson sometimes just types/pastes the email.
  // Aggressive cleaning for the email-check (he sometimes types "x @ y").
  const compact = input.replace(/\s+/g, '').toLowerCase()
  if (EMAIL_RE.test(compact)) {
    const [localPart, domain] = compact.split('@')
    const firstName = localPart
      ? localPart.charAt(0).toUpperCase() + localPart.slice(1)
      : ''
    return { email: compact, agencyName: humanizeDomain(domain || ''), firstName, lastName: '' }
  }


  // Case 3: Plain agency name — no email anywhere. Store it as the agency.
  const agencyName = input.replace(/\s+/g, ' ').trim()
  return { email: '', agencyName, firstName: '', lastName: '' }
}


// ============================================================================
// Cell-level normalizers
// ============================================================================


function s(v: string | number | undefined): string {
  if (v === undefined || v === null) return ''
  const out = String(v).trim()
  return out === '' ? '' : out
}


/**
 * Robust numeric coercion that quietly drops "??" and other non-numeric strings.
 * Used for Kids (# Children) and House (# in HH).
 */
function n(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const trimmed = String(v).trim()
  if (!trimmed || trimmed === '??' || /^\?+$/.test(trimmed)) return null
  const num = Number(trimmed)
  return isNaN(num) ? null : num
}


/**
 * Returns BOTH an ISO date (YYYY-MM-DD) and a US-friendly mm/dd/yyyy string.
 * Accepts Date objects, Excel serial numbers, and free-form mm/dd/yy(yy) strings.
 * Returns nulls if it can't parse.
 */
function parseFlexibleDate(
  v: string | number | Date | undefined
): { iso: string | null; us: string | null; dow: number | null } {
  if (v === undefined || v === null || v === '') return { iso: null, us: null, dow: null }


  // Date object
  if (v instanceof Date && !isNaN(v.getTime())) {
    return formatDate(v)
  }


  // Excel serial number
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v)
    if (parsed) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d)
      return formatDate(d)
    }
    return { iso: null, us: null, dow: null }
  }


  // String — try a few patterns
  const str = String(v).trim()
  if (!str || str === ' ') return { iso: null, us: null, dow: null }


  // mm/dd/yy or mm/dd/yyyy
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m1) {
    let yr = parseInt(m1[3], 10)
    // 2-digit year pivot: 00-30 -> 2000s, 31-99 -> 1900s (client DOBs are historical)
    if (yr < 100) yr += (yr <= 30 ? 2000 : 1900)
    const d = new Date(yr, parseInt(m1[1], 10) - 1, parseInt(m1[2], 10))
    if (!isNaN(d.getTime())) return formatDate(d)
  }


  // yyyy-mm-dd
  const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m2) {
    const d = new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10))
    if (!isNaN(d.getTime())) return formatDate(d)
  }


  return { iso: null, us: null, dow: null }
}


function formatDate(d: Date): { iso: string; us: string; dow: number } {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  return {
    iso: `${yyyy}-${mm}-${dd}`,
    us: `${mm}/${dd}/${yyyy}`,
    dow: d.getDay(),
  }
}


function padZip(v: string | number | undefined): string {
  if (v === undefined || v === null || v === '') return ''
  const digits = String(v).replace(/\D/g, '')
  if (!digits) return ''
  return digits.length < 5 ? digits.padStart(5, '0') : digits
}


/**
 * Cleans Dawson's street text:
 *  - strips stray backticks and ">" characters
 *  - collapses repeated newlines
 *  - splits "Num + Street1" into address line 1 + (apt info) on line 2.
 *  - When Street1 has multiple lines (e.g., "South Orange\nAvenue\n260>2"),
 *    treats the FIRST non-empty line as the street name and the rest as apt info.
 */
function splitAddress(num: string | number | undefined, street1: string | number | undefined): { address: string; address2: string } {
  const numStr = s(num)
  const street = s(street1).replace(/[`>]+/g, '').replace(/\n+/g, '\n')
  if (!street) return { address: numStr, address2: '' }
  const parts = street.split(/\r?\n/).map(p => p.trim()).filter(Boolean)
  const firstLine = parts[0] || ''
  const restLines = parts.slice(1).join(', ')
  const address = numStr ? `${numStr} ${firstLine}` : firstLine
  return { address, address2: restLines }
}


/**
 * Normalizes Ptime: "HOLD" → blank + warning; "10:00 AN" → "10:00 AM".
 * Returns { time, warning? }
 */
function normalizePtime(v: string | number | undefined): { time: string; warning: string | null } {
  const raw = s(v)
  if (!raw) return { time: '', warning: null }
  if (/^hold$/i.test(raw)) return { time: '', warning: 'Ptime "HOLD" — left blank' }
  // Fix common AN typo → AM
  const fixed = raw.replace(/\bAN\b/g, 'AM')
  return { time: fixed, warning: fixed !== raw ? `Ptime typo normalized: "${raw}" → "${fixed}"` : null }
}


// ============================================================================
// Row classification & parsing
// ============================================================================


function isClientDataRow(row: RawRow): boolean {
  // Dawson's sheet uses A="Client" for client rows AND for divider rows
  // ("Father's Day", "July 4th"). Real client rows always have First + Last.
  const client = s(row['Client'])
  const first = s(row['First'])
  const last = s(row['Last'])
  if (client !== 'Client') return false
  if (!first || !last) return false
  // Filter out the numeric M1..M7 row where First is a bare number like "12"
  if (/^\d+$/.test(first)) return false
  return true
}


function validateRow(d: ReferralInput): string[] {
  const errors: string[] = []
  if (!d.firstName) errors.push('First name required')
  if (!d.lastName) errors.push('Last name required')
  // DOB no longer required — Dawson is missing 40% of them
  // Agency no longer required — defaults to "Unknown" when blank
  // Referral Date no longer required — falls back to appt date
  if (!d.appointmentDate) errors.push('Appt date missing')
  return errors
}


function parseRow(row: RawRow, rowIndex: number): ParsedRow {
  // --- Skip-reason gating happens here so the preview can group rows ---
  if (!isClientDataRow(row)) {
    const skipReason: SkipReason = s(row['First']) || s(row['Last']) ? 'no-name' : 'not-client-row'
    return {
      rowIndex,
      raw: row,
      data: emptyReferral(),
      validationErrors: [],
      warnings: [],
      apptDateISO: null,
      apptDow: null,
      skipReason,
    }
  }


  // ---- Parse fields ----
  const referredByRaw = s(row['Referred by'])
  const refBy = parseReferredBy(referredByRaw)


  const { address, address2 } = splitAddress(row['Num'], row['Street1'])
  const wantsResult = mapWantsToCategories(s(row['Wants']))


  const apptParsed = parseFlexibleDate(row['Pdate'] as string | number | Date | undefined)
  const referralParsed = parseFlexibleDate(row['Date'] as string | number | Date | undefined)


  // If intake Date (D) is missing or pre-2020 garbage, fall back to appt date
  const referralDateUS =
    referralParsed.us && referralParsed.iso && referralParsed.iso >= '2020-01-01'
      ? referralParsed.us
      : apptParsed.us || ''


  const dobParsed = parseFlexibleDate(row['DOB'] as string | number | Date | undefined)
  const { time: apptTime, warning: timeWarn } = normalizePtime(row['Ptime'])


  // ---- Skip-reason: enforce Saturday-only, blank-G + blank-RefBy gating ----
  let skipReason: SkipReason | null = null
  if (!apptParsed.iso) {
    skipReason = !referredByRaw ? 'no-ref-by-and-no-appt' : 'no-appt-date'
  } else if (apptParsed.dow !== 6) {
    skipReason = 'non-saturday-appt'
  }


  // Agency defaults to "Unknown" when blank but appt is valid (Rule B)
  const agencyName = refBy.agencyName || (apptParsed.iso ? 'Unknown' : '')


  const data: ReferralInput = {
    firstName: s(row['First']),
    lastName: s(row['Last']),
    dob: dobParsed.us || '',
    phone: s(row['Phone']),
    address,
    address2,
    city: s(row['City']),
    state: s(row['ST']),
    zip: padZip(row['Zip']),
    county: '',
    preferredLanguage: 'English',
    hhSize: n(row['House']),       // Airtable: # in HH
    children: n(row['Kids']),      // Airtable: # Children


    // Staff data: prefer the spreadsheet's VLOOKUP chain (AM = parsed email,
    // AN/AO/AP/AQ = First/Last/Phone/Agency Name pulled from _Staff). Those
    // are populated when W is either a full label or a bare email that
    // matches a _Staff row. Only fall back to parseReferredBy when ALL
    // lookups missed (W has garbage, an unknown email, or an agency-only string).
    agencyName: s(row['→ Agency Name']) || agencyName,
    staffFirstName: s(row['→ First']) || refBy.firstName,
    staffLastName: s(row['→ Last']) || refBy.lastName,
    staffPhone: s(row['→ Phone']),
    staffEmail: s(row['Staff Email']) || refBy.email,


    referralDate: referralDateUS,
    appointmentDate: apptParsed.us || '',
    appointmentTime: apptTime,
    itemsRequested: wantsResult.categories.join(', '),
    // Dawson's sheet "Notes" column is HIS notes (internal scheduling/context),
    // NOT notes submitted by the agency. Route to Internal Notes.
    // External Notes is reserved for agency-portal submissions (future).
    externalNotes: '',
    internalNotes: s(row['Notes']),
    preferredDate: '',
    schedulingFlexibility: '',
  }


  const warnings = [...wantsResult.warnings]
  if (timeWarn) warnings.push(timeWarn)
  if (agencyName === 'Unknown') warnings.push('Referred-by blank — agency set to "Unknown"')


  return {
    rowIndex,
    raw: row,
    data,
    validationErrors: validateRow(data),
    warnings,
    apptDateISO: apptParsed.iso,
    apptDow: apptParsed.dow,
    skipReason,
  }
}


function emptyReferral(): ReferralInput {
  return {
    firstName: '', lastName: '', dob: '', phone: '',
    address: '', address2: '', city: '', state: '', zip: '',
    county: '', preferredLanguage: '', hhSize: null, children: null,
    agencyName: '', staffFirstName: '', staffLastName: '', staffPhone: '', staffEmail: '',
    referralDate: '', appointmentDate: '', appointmentTime: '',
    itemsRequested: '', externalNotes: '', internalNotes: '',
    preferredDate: '', schedulingFlexibility: '',
  }
}


// ============================================================================
// Component
// ============================================================================


export default function ImportReferralsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [allRows, setAllRows] = useState<ParsedRow[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('') // ISO yyyy-mm-dd of chosen Saturday
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importLogId, setImportLogId] = useState<string | null>(null)
  const [lastImportFilename, setLastImportFilename] = useState<string | null>(null)
  const [lastImportAt, setLastImportAt] = useState<string | null>(null)


  // On mount, restore the most recent import result (if any) from sessionStorage.
  // This means a page-blank / refresh / navigation-and-back doesn't lose the
  // audit view. Cleared explicitly via the "Clear results" button.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(RESULTS_STORAGE_KEY) : null
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.results)) {
        setResults(parsed.results)
        setImportLogId(parsed.importLogId || null)
        setLastImportFilename(parsed.fileName || null)
        setLastImportAt(parsed.completedAt || null)
      }
    } catch {
      // ignore restore failures — audit trail is nice-to-have on refresh
    }
  }, [])


  // Whenever results are set (or cleared), mirror to sessionStorage.
  useEffect(() => {
    try {
      if (!results) {
        window.sessionStorage.removeItem(RESULTS_STORAGE_KEY)
        return
      }
      window.sessionStorage.setItem(
        RESULTS_STORAGE_KEY,
        JSON.stringify({
          results,
          importLogId,
          fileName: lastImportFilename,
          completedAt: lastImportAt,
        }),
      )
    } catch {
      // sessionStorage quota exceeded or unavailable — non-fatal
    }
  }, [results, importLogId, lastImportFilename, lastImportAt])


  function handleFile(file: File) {
    setParseError(null)
    setResults(null)
    setSelectedDate('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', cellDates: true })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: false })
        if (raw.length === 0) {
          setParseError('No data rows found in the first sheet.')
          setAllRows([])
          return
        }
        // sheet_to_json starts at row 2 of Excel (after the header). Add +2 so
        // rowIndex aligns with what Dawson sees in Excel.
        const parsed = raw.map((row, i) => parseRow(row, i + 2))
        setAllRows(parsed)


        // Auto-select the Saturday with the most rows
        const counts = countByDate(parsed)
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
        if (top) setSelectedDate(top[0])
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse file')
        setAllRows([])
      }
    }
    reader.readAsBinaryString(file)
  }


  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }


  // Only Saturday dates show in the picker
  const saturdayOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of allRows) {
      if (r.skipReason) continue
      if (r.apptDow !== 6) continue
      if (!r.apptDateISO) continue
      counts[r.apptDateISO] = (counts[r.apptDateISO] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, count]) => ({ iso, count }))
  }, [allRows])


  // Rows that survive every filter AND match the picked Saturday
  const selectedRows = useMemo(() => {
    if (!selectedDate) return []
    return allRows.filter(r => !r.skipReason && r.apptDateISO === selectedDate)
  }, [allRows, selectedDate])


  // Skip diagnostics for the UI
  const skipCounts = useMemo(() => {
    const c: Record<SkipReason, number> = {
      'not-client-row': 0,
      'no-name': 0,
      'no-appt-date': 0,
      'non-saturday-appt': 0,
      'no-ref-by-and-no-appt': 0,
      'unparseable-appt': 0,
    }
    for (const r of allRows) if (r.skipReason) c[r.skipReason]++
    return c
  }, [allRows])


  async function runImport() {
    const validRows = selectedRows.filter(r => r.validationErrors.length === 0)
    if (validRows.length === 0) return
    setImporting(true)
    setResults(null)
    setImportLogId(null)
    try {
      const res = await fetch('/api/dawson/admin/import-referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: validRows.map(r => r.data),
          // Pass the source filename so the Import Log record shows what was uploaded.
          sourceFilename: fileName,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setParseError(json.error || 'Import failed')
        return
      }
      const remapped: ImportResult[] = json.results.map((r: ImportResult, i: number) => ({
        ...r,
        rowIndex: validRows[i].rowIndex,
      }))
      setResults(remapped)
      setImportLogId(json.importLogId || null)
      setLastImportFilename(fileName)
      setLastImportAt(new Date().toISOString())
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setImporting(false)
    }
  }


  function copyResultsJson() {
    if (!results) return
    const payload = {
      completedAt: lastImportAt,
      fileName: lastImportFilename,
      importLogId,
      summary,
      results,
    }
    const text = JSON.stringify(payload, null, 2)
    try {
      navigator.clipboard.writeText(text)
    } catch {
      // fallback: put into a textarea and select for manual copy
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }


  function clearResults() {
    setResults(null)
    setImportLogId(null)
    setLastImportFilename(null)
    setLastImportAt(null)
  }


  function downloadResultsCsv() {
    if (!results) return
    const rows = [
      ['Row', 'Status', 'Unique ID', 'Referral ID', 'Reason / Notes'],
      ...results.map(r => [
        String(r.rowIndex),
        r.status,
        r.uniqueId || '',
        r.referralId || r.existingReferralId || '',
        r.reason || (r.agencyCreated || r.staffCreated
          ? [r.agencyCreated && 'new agency', r.staffCreated && 'new staff'].filter(Boolean).join('; ')
          : ''),
      ]),
    ]
    const csv = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import-results-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }


  // Derived counts for the preview/header
  const validCount = selectedRows.filter(r => r.validationErrors.length === 0).length
  const invalidCount = selectedRows.length - validCount
  const warningRowCount = selectedRows.filter(r => r.warnings.length > 0).length
  const summary = results ? {
    created: results.filter(r => r.status === 'created').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
  } : null


  // ---------------- Styles ----------------
  const card: React.CSSProperties = {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(27,43,75,0.06)',
    overflow: 'hidden',
  }
  const cardHeader: React.CSSProperties = {
    padding: '16px 24px',
    borderBottom: '1px solid #EDE9E1',
  }
  const h2: React.CSSProperties = {
    fontFamily: 'var(--font-montserrat)',
    fontWeight: 800,
    fontSize: '13px',
    color: '#1B2B4B',
    margin: 0,
  }


  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', padding: '28px 32px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {/* Intro. The page title is in the shell bar (DawsonPageBar). */}
        <div style={{ marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: '#7A8899', margin: 0, lineHeight: 1.6 }}>
            Reads Dawson&apos;s native Excel format. Pick a Saturday and import just that
            week&apos;s referrals. Re-runs are safe — already-imported referrals
            (matched by Last-First-DOB) are skipped.
          </p>
        </div>


        {/* Upload */}
        <div style={{ ...card, marginBottom: '20px' }}>
          <div style={cardHeader}>
            <h2 style={h2}>Upload</h2>
          </div>
          <div style={{ padding: '24px' }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #D8DFE8',
                borderRadius: '10px',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#FAFBFC',
              }}
            >
              <div style={{ fontSize: '14px', color: '#1B2B4B', fontWeight: 700, marginBottom: '6px' }}>
                {fileName ? `📄 ${fileName}` : 'Drop Dawson\'s .xlsx/.xlsm file here, or click to select'}
              </div>
              <div style={{ fontSize: '12px', color: '#7A8899' }}>
                Expected columns: First, Last, DOB, Phone, Num, Street1, City, ST, Zip, Wants, Notes, Referred by, Date, Pdate, Ptime, Kids, House
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm"
                style={{ display: 'none' }}
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
            {parseError && (
              <div style={{
                marginTop: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(192,57,43,0.08)',
                color: '#C0392B',
                fontSize: '13px',
              }}>
                ⚠ {parseError}
              </div>
            )}
          </div>
        </div>


        {/* Saturday picker + skip diagnostics */}
        {allRows.length > 0 && !results && (
          <div style={{ ...card, marginBottom: '20px' }}>
            <div style={cardHeader}>
              <h2 style={h2}>Select Saturday to import</h2>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {saturdayOptions.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#C0392B' }}>
                  No Saturday appointments found in this file.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {saturdayOptions.map(opt => {
                    const selected = opt.iso === selectedDate
                    return (
                      <button
                        key={opt.iso}
                        onClick={() => setSelectedDate(opt.iso)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '8px',
                          border: selected ? '2px solid #2A7F6F' : '1px solid #D8DFE8',
                          background: selected ? 'rgba(42,127,111,0.08)' : 'white',
                          color: '#1B2B4B',
                          fontFamily: 'var(--font-montserrat)',
                          fontWeight: selected ? 700 : 500,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        {formatIsoLabel(opt.iso)} · {opt.count}
                      </button>
                    )
                  })}
                </div>
              )}


              {/* Skip diagnostics */}
              <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '12px', color: '#7A8899' }}>
                {skipCounts['non-saturday-appt'] > 0 && (
                  <span>↪ {skipCounts['non-saturday-appt']} non-Saturday appt</span>
                )}
                {skipCounts['no-appt-date'] > 0 && (
                  <span>↪ {skipCounts['no-appt-date']} no appt date</span>
                )}
                {skipCounts['no-ref-by-and-no-appt'] > 0 && (
                  <span>↪ {skipCounts['no-ref-by-and-no-appt']} no ref-by and no appt</span>
                )}
                {skipCounts['no-name'] > 0 && (
                  <span>↪ {skipCounts['no-name']} divider / blank</span>
                )}
              </div>
            </div>
          </div>
        )}


        {/* Preview */}
        {selectedRows.length > 0 && !results && (
          <div style={{ ...card, marginBottom: '20px' }}>
            <div style={{ ...cardHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={h2}>
                Preview — {formatIsoLabel(selectedDate)} ({selectedRows.length} row{selectedRows.length === 1 ? '' : 's'})
              </h2>
              <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
                <span style={{ color: '#2A7F6F', fontWeight: 700 }}>✓ {validCount} valid</span>
                {invalidCount > 0 && (
                  <span style={{ color: '#C0392B', fontWeight: 700 }}>⚠ {invalidCount} errors</span>
                )}
                {warningRowCount > 0 && (
                  <span style={{ color: '#C9A84C', fontWeight: 700 }}>⚠ {warningRowCount} warnings</span>
                )}
              </div>
            </div>
            <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ background: '#F7F5F1', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={th}>Row</th>
                    <th style={th}>Client</th>
                    <th style={th}>DOB</th>
                    <th style={th}>Agency</th>
                    <th style={th}>Staff Email</th>
                    <th style={th}>Appt</th>
                    <th style={th}>HH / Kids</th>
                    <th style={th}>Items</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map(row => {
                    const hasErrors = row.validationErrors.length > 0
                    const hasWarnings = row.warnings.length > 0
                    return (
                      <tr key={row.rowIndex} style={{
                        borderBottom: '1px solid #F0F0F0',
                        background: hasErrors ? 'rgba(192,57,43,0.04)' : hasWarnings ? 'rgba(201,168,76,0.05)' : 'white',
                      }}>
                        <td style={td}>{row.rowIndex}</td>
                        <td style={td}>{row.data.firstName} {row.data.lastName}</td>
                        <td style={td}>{row.data.dob || '—'}</td>
                        <td style={td}>{row.data.agencyName || '—'}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px' }}>{row.data.staffEmail || '—'}</td>
                        <td style={td}>{row.data.appointmentDate ? `${row.data.appointmentDate} ${row.data.appointmentTime}` : '—'}</td>
                        <td style={td}>
                          {row.data.hhSize ?? '—'} / {row.data.children ?? '—'}
                        </td>
                        <td style={{ ...td, fontSize: '11px' }}>
                          {row.data.itemsRequested || <span style={{ color: '#7A8899' }}>—</span>}
                          {row.warnings.length > 0 && (
                            <div style={{ color: '#C9A84C', marginTop: '4px', fontStyle: 'italic' }}>
                              {row.warnings.join('; ')}
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          {hasErrors ? (
                            <span style={{ color: '#C0392B', fontWeight: 700 }}>
                              {row.validationErrors.join('; ')}
                            </span>
                          ) : (
                            <span style={{ color: '#2A7F6F', fontWeight: 700 }}>Ready</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #EDE9E1',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
            }}>
              <button
                onClick={runImport}
                disabled={importing || validCount === 0}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: validCount === 0 ? '#D8DFE8' : '#2A7F6F',
                  color: 'white',
                  fontFamily: 'var(--font-montserrat)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: validCount === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {importing
                  ? 'Importing…'
                  : `Import ${validCount} row${validCount === 1 ? '' : 's'} for ${formatIsoLabel(selectedDate)}`}
              </button>
            </div>
          </div>
        )}


        {/* Results */}
        {results && summary && (
          <div style={card}>
            <div style={{ ...cardHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h2 style={h2}>Results</h2>
                {(lastImportFilename || lastImportAt || importLogId) && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#7A8899' }}>
                    {lastImportFilename && <span>{lastImportFilename}</span>}
                    {lastImportAt && <span>{lastImportFilename ? ' · ' : ''}{new Date(lastImportAt).toLocaleString()}</span>}
                    {importLogId && <span> · Import Log: <span style={{ fontFamily: 'monospace' }}>{importLogId}</span></span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={copyResultsJson} style={resultsBtn}>Copy JSON</button>
                <button onClick={downloadResultsCsv} style={resultsBtn}>Download CSV ↓</button>
                <button onClick={clearResults} style={{ ...resultsBtn, color: '#7A8899' }}>Clear</button>
              </div>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', gap: '24px', fontSize: '14px', flexWrap: 'wrap' }}>
              <div><strong style={{ color: '#2A7F6F' }}>✓ {summary.created}</strong> created</div>
              <div><strong style={{ color: '#C9A84C' }}>↻ {summary.skipped}</strong> skipped (already exist)</div>
              <div><strong style={{ color: '#C0392B' }}>⚠ {summary.errors}</strong> errors</div>
              <div style={{ marginLeft: 'auto', color: '#7A8899' }}>
                {summary.created} / {results.length} imported
              </div>
            </div>
            <div style={{ maxHeight: '420px', overflowY: 'auto', borderTop: '1px solid #EDE9E1' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ background: '#F7F5F1', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={th}>Row</th>
                    <th style={th}>Status</th>
                    <th style={th}>Unique ID</th>
                    <th style={th}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.rowIndex} style={{ borderBottom: '1px solid #F0F0F0' }}>
                      <td style={td}>{r.rowIndex}</td>
                      <td style={td}>
                        <span style={{
                          fontWeight: 700,
                          color: r.status === 'created' ? '#2A7F6F'
                            : r.status === 'skipped' ? '#C9A84C'
                            : '#C0392B',
                        }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px' }}>
                        {r.uniqueId || '—'}
                      </td>
                      <td style={td}>
                        {r.reason || [
                          r.agencyCreated && 'new agency',
                          r.staffCreated && 'new staff',
                        ].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// Helpers
// ============================================================================


function countByDate(rows: ParsedRow[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const r of rows) {
    if (r.skipReason) continue
    if (r.apptDow !== 6) continue
    if (!r.apptDateISO) continue
    c[r.apptDateISO] = (c[r.apptDateISO] || 0) + 1
  }
  return c
}


function formatIsoLabel(iso: string): string {
  if (!iso) return ''
  // iso = "2026-06-27" → "Sat 06/27/2026"
  const [y, m, d] = iso.split('-')
  const dt = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]
  return `${dow} ${m}/${d}/${y}`
}


const th: React.CSSProperties = {
  padding: '8px 14px',
  textAlign: 'left',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '11px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#7A8899',
}


const td: React.CSSProperties = {
  padding: '8px 14px',
  color: '#2C3A4A',
  verticalAlign: 'top',
}


const resultsBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '7px',
  border: '1px solid #EDE9E1',
  background: 'white',
  color: '#2A7F6F',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '12px',
  cursor: 'pointer',
}
