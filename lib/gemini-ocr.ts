/**
 * lib/gemini-ocr.ts
 *
 * Portal-native OCR pipeline. Ports the Apps Script `ocr-sheet-processor.js`
 * pipeline (extractWithGemini + resolveRecordId + writeToAirtable +
 * parseRescheduleDate + flagManualReview) to TypeScript, running from the
 * portal's Node.js runtime instead of Apps Script.
 *
 * Same Gemini prompt (verbatim), same resolution logic, same Airtable field
 * writes, same failure escalation path. Replaces the Apps Script pipeline
 * one-for-one.
 *
 * Public API:
 *   processPage({ pdfBytes, pageNumber, batchAirtableUrl })
 *     -> ProcessPageResult
 *
 * Call one processPage() per split page. It returns success/failure detail
 * for the caller to aggregate into batch-level counts.
 */


// ============================================================
// Constants (ported verbatim from Apps Script)
// ============================================================

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

const AIRTABLE_TABLE = 'Client Referrals'

const VALID_OUTCOMES = ['Completed', 'No Show', 'Cancelled', 'Reschedule'] as const
type Outcome = typeof VALID_OUTCOMES[number]

const ITEM_FIELDS = [
  // Living Room (LR)
  'LR Bookcase/Storage', 'LR Chair', 'LR Coffee Table', 'LR Couch/Loveseat/Futon',
  'LR End Table/TV Stand', 'LR Lamp', 'LR Picture/Other Decor', 'LR Rug',
  'LR Student Desk', 'LR TV/Electronics',
  // Bedroom (BR)
  'BR Bedframe', 'BR Dresser', 'BR Mattress/Boxspring', 'BR Nightstand',
  // Dining (DR)
  'DR Chair', 'DR Dining Table',
  // Kitchen/Household (KH)
  'KH Bathroom', 'KH Cookbook', 'KH Dishes', 'KH General Household',
  'KH Home Office', 'KH Linen', 'KH Pots/Pans/Utensils', 'KH Small Appliance',
  // Clothes (CL)
  'CL Clothes', 'CL Shoes',
  // Baby/Kids (BK)
  'BK Baby Clothes', 'BK Crib/Bassinet', 'BK General Baby', 'BK Toys/Books/School',
] as const


// ============================================================
// Types
// ============================================================

interface GeminiOcrResult {
  record_id: string
  outcome: string
  client_first_name: string
  client_last_name: string
  appointment_date: string
  volunteer_initials: string
  checkout_time: string
  notes: string
  reschedule_date: string
  items: Record<string, number>
}

interface Candidate {
  id: string
  firstName: string
  lastName: string
}

export interface ProcessPageResult {
  pageNumber: number
  success: boolean
  recordId: string | null      // resolved Airtable record ID (or null if unresolvable)
  outcome: Outcome | null
  clientName: string           // "First Last" from OCR (may be empty)
  appointmentDate: string      // ISO YYYY-MM-DD from OCR (may be empty)
  errorMessage: string | null
  ocrDiagnostic: string        // human-readable OCR summary
}


// ============================================================
// Per-batch cache — candidates by appointment date
//
// Ported from Apps Script `_candidateCache`. Prevents redundant Airtable
// queries when many pages in one batch share the same appointment date
// (typical: a Saturday scan is ~90% of the pages for that Saturday's date).
//
// The cache is instance-scoped and short-lived (one Airtable query per
// unique date per batch). Instantiate CandidateCache once per batch
// upload; do not share across batches (a new upload may show late-arriving
// records).
// ============================================================

export class CandidateCache {
  private cache = new Map<string, Candidate[]>()

  async get(isoDate: string): Promise<Candidate[]> {
    if (!isoDate) return []

    const cached = this.cache.get(isoDate)
    if (cached) return cached

    if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
      throw new Error('AIRTABLE_BASE_ID or AIRTABLE_API_KEY not set')
    }

    // filterByFormula: match by date. Include ALL records for that date,
    // even already-processed ones — supports re-uploads (e.g. an initial
    // upload was Completed, a follow-up sheet marks it Reschedule).
    const formula = `DATETIME_FORMAT({Appointment Date}, 'YYYY-MM-DD') = '${isoDate}'`

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}` +
      `?filterByFormula=${encodeURIComponent(formula)}` +
      `&fields[]=${encodeURIComponent('First Name')}&fields[]=${encodeURIComponent('Last Name')}` +
      `&pageSize=100`

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Candidate lookup failed for ${isoDate}: ${res.status} ${body}`)
      this.cache.set(isoDate, [])
      return []
    }

    const data = await res.json() as {
      records?: Array<{
        id: string
        fields: {
          'First Name'?: string | string[]
          'Last Name'?: string | string[]
        }
      }>
    }

    // July 2026 CLIENTS FORK: First Name / Last Name are lookups from linked
    // Client record → always arrays. Unwrap defensively (handle pre-migration
    // string shape too).
    const unwrap = (v: string | string[] | undefined) =>
      Array.isArray(v) ? (v[0] || '') : (v || '')

    const candidates: Candidate[] = (data.records || []).map((r) => ({
      id: r.id,
      firstName: unwrap(r.fields['First Name']),
      lastName: unwrap(r.fields['Last Name']),
    }))

    console.log(`Loaded ${candidates.length} candidates for ${isoDate}`)
    this.cache.set(isoDate, candidates)
    return candidates
  }
}


// ============================================================
// Name normalizer + record ID resolver (ported verbatim from Apps Script)
// ============================================================

function normName(s: string | undefined): string {
  // Lowercase, then collapse 1/I/l, 0/O, 5/S, 8/B, 2/Z lookalikes
  // (Gemini can't distinguish these glyphs in the printed name banner).
  // Then strip anything that isn't a-z or a digit — keeps digits so a name
  // like "client1" survives normalization instead of collapsing to "client".
  return String(s || '')
    .toLowerCase()
    .replace(/[1il]/g, '1')
    .replace(/[0o]/g, '0')
    .replace(/[5s]/g, '5')
    .replace(/[8b]/g, '8')
    .replace(/[2z]/g, '2')
    .replace(/[^a-z0-9]/g, '')
}


async function resolveRecordId(
  result: GeminiOcrResult,
  cache: CandidateCache,
): Promise<string | null> {
  if (!result) return null

  const ocrId = result.record_id || ''
  const ocrDate = result.appointment_date || ''
  const ocrFirst = normName(result.client_first_name)
  const ocrLast = normName(result.client_last_name)

  const idLooksGood =
    /^rec[A-Za-z0-9]{14}$/.test(ocrId) &&
    !/^rec0{14}$/.test(ocrId) &&
    !/^rec(.)\1{13}$/.test(ocrId)

  // No date extracted → fall back to trusting the OCR ID if well-formed
  if (!ocrDate) {
    return idLooksGood ? ocrId : null
  }

  const candidates = await cache.get(ocrDate)
  if (candidates.length === 0) {
    console.warn(`No candidates found for date ${ocrDate}`)
    return idLooksGood ? ocrId : null
  }

  // 1. Fuzzy ID match. Gemini frequently confuses lookalike glyphs in
  //    printed record IDs — most notoriously 1/I/l (sans-serif digit one,
  //    uppercase i, lowercase L are visually indistinguishable), plus
  //    0/O, 5/S, 8/B, 2/Z. We normalize both the OCR id and each candidate
  //    to a canonical lookalike-free form before comparing, then case-fold.
  //    Airtable record IDs use base62 (a-z, A-Z, 0-9), so this normalization
  //    is safe within our own ID space.
  const normalizeId = (id: string): string =>
    id
      .toLowerCase()
      .replace(/[1il]/g, '1') // 1, I, l → 1
      .replace(/[0o]/g, '0')  // 0, O → 0
      .replace(/[5s]/g, '5')  // 5, S → 5
      .replace(/[8b]/g, '8')  // 8, B → 8
      .replace(/[2z]/g, '2')  // 2, Z → 2
  if (idLooksGood) {
    const ocrIdNorm = normalizeId(ocrId)
    const exact = candidates.find((c) => normalizeId(c.id) === ocrIdNorm)
    if (exact) {
      if (exact.id !== ocrId) {
        console.log(`OCR id ${ocrId} matched candidate ${exact.id} via lookalike normalization`)
      }
      return exact.id
    }
    console.warn(`OCR id ${ocrId} not in candidate set for ${ocrDate} — falling back to name match`)
  }

  // 2. Fuzzy last-name match (scoped to candidates for ocrDate)
  if (ocrLast) {
    const lastMatches = candidates.filter((c) => normName(c.lastName) === ocrLast)
    if (lastMatches.length === 1) {
      console.log(`Resolved ${lastMatches[0].id} via last-name match on ${ocrDate}`)
      return lastMatches[0].id
    }
    if (lastMatches.length > 1 && ocrFirst) {
      const both = lastMatches.filter((c) => normName(c.firstName) === ocrFirst)
      if (both.length === 1) {
        console.log(`Resolved ${both[0].id} via first+last name match on ${ocrDate}`)
        return both[0].id
      }
      console.warn(`Ambiguous last-name match for ${ocrLast} on ${ocrDate}: ${lastMatches.length} candidates`)
    }
  }

  // 3. Full name match (scoped to candidates for ocrDate)
  if (ocrFirst && ocrLast) {
    const both = candidates.filter(
      (c) => normName(c.firstName) === ocrFirst && normName(c.lastName) === ocrLast,
    )
    if (both.length === 1) {
      console.log(`Resolved ${both[0].id} via full-name match on ${ocrDate}`)
      return both[0].id
    }
    if (both.length > 1) {
      console.warn(`Ambiguous full-name match for ${ocrFirst} ${ocrLast} on ${ocrDate}: ${both.length} candidates`)
    }
  }

  // 4. Last-resort fallback: if the OCR ID looks well-formed but didn't
  //    match any candidate for this date, trust the ID. This handles cases
  //    where the record was already Sheet Processed (excluded from candidates)
  //    or where date/name variance kept it out of the candidate set. Airtable
  //    PATCH will reject the id if it truly doesn't exist, giving a clean
  //    downstream error instead of a silent "could not resolve".
  if (idLooksGood) {
    console.warn(`No candidate match for ${ocrId} on ${ocrDate}; trusting OCR id as last resort`)
    return ocrId
  }

  return null
}


// ============================================================
// Gemini OCR call
//
// Prompt is byte-for-byte identical to Apps Script's extractWithGemini().
// Do NOT re-tune here without confirming with the Apps Script prompt first
// — behavior differences produce hard-to-diagnose OCR regressions.
// ============================================================

async function extractWithGemini(pdfBytes: Buffer): Promise<GeminiOcrResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`

  const currentYear = new Date().getFullYear()

  const prompt = `You are reading a filled-out Furniture Assist Client Pickup Sheet.

Extract the following and return ONLY valid JSON (no markdown, no commentary):

1. record_id: the value printed after the label "ID:" on the sheet.
   LOCATION: TOP-RIGHT of the client info box — the large colored panel
   near the top of the sheet that contains the client name, appointment
   time, address, phone, language, and household details. The "ID:" label
   sits on the first line of that box's right column, directly above the
   "Agency:" line. Look ONLY here — the ID is NOT anywhere else on the sheet.
   FORMAT: exactly 17 characters total — the literal prefix "rec" followed
   by exactly 14 alphanumeric characters (letters + digits, mixed case).
   The text is in a monospace font; each character occupies equal width, so
   you can count width to verify the length.
   COUNTING CHECK: after you read the ID, verify you have exactly 14
   characters after "rec". If you have 13, you missed one — re-read. If you
   have 15, you added one — re-read.
   IGNORE THESE (they are NOT the record ID):
     - The "CLIENT / CAR #" box in the top-right header (separate labeled
       box, blank on printing, filled in at the warehouse).
     - Any check-out time, initials, or notes at the bottom.
     - The address, phone, or household numbers in the client info box.
   If you cannot clearly read an ID matching the "rec" + 14 char format,
   return empty string "" — do NOT guess or fabricate a value.

2. outcome: the appointment outcome, determined by the sheet contents.
   The sheet has ONE outcome box in the header — a small SQUARE CHECKBOX
   inside a red-bordered labeled panel that reads "RESCHEDULE".

   IMPORTANT: The red border of the outer panel is PRINTED, not handwriting.
   Do NOT confuse the printed border with a mark. Do NOT confuse the printed
   inner checkbox border with a mark. A mark must be INSIDE the small inner
   square — not on it, not near it, INSIDE it. Faint marks, shadows, print
   artifacts, JPEG noise, or ambiguous pixels do NOT count.

   COMPLETION SIGNALS (evidence the client was actually here):
     - Any QTY cell in the items table contains a handwritten digit, OR
     - Both the INITIALS box AND the CHECK-OUT TIME box at the bottom are
       filled with handwriting.
   (Reviewers may sign off with initials + checkout time even when the
    client took no items — a valid "client came, took nothing" scenario
    that is still Completed.)

   DECISION LOGIC (apply in order):
     1. If the RESCHEDULE inner checkbox contains a clear, unambiguous
        handwritten mark (bold check, X, heavy fill, or deliberate slash)
        → outcome is "Reschedule". In this case, IGNORE all QTY cells and
        return 0 for every item — rescheduled appointments never disburse
        items. Any QTY marks on a reschedule sheet are stale or mistaken
        and must NOT be extracted.
     2. Else if any completion signal above is present
        → outcome is "Completed".
     3. Else (sheet is essentially blank — no QTY digits, no initials,
        no checkout time, no reschedule mark)
        → outcome is "No Show".

   Return ONE of these EXACT strings:
     - "Reschedule"
     - "Completed"
     - "No Show"
   The value "Cancelled" is NEVER returned by OCR — cancellations are
   handled in Airtable directly by an admin, not on the sheet.

3. client_first_name: the client's first name printed in large text in the
   upper-left of the client info box. The format on the sheet is "Last, First"
   — return only the first-name portion. Example: for "Debone, Jenane"
   return "Jenane".

4. client_last_name: the client's last name (the part BEFORE the comma in
   the "Last, First" header). Example: for "Debone, Jenane" return "Debone".

5. appointment_date: the date printed directly below the client name in the
   client info box, in a format like "10am · July 11, 2026". Extract ONLY the
   date, ignoring the time. Return as ISO date "YYYY-MM-DD".
   Example: "11am · July 11, 2026" → "2026-07-11".
   If you cannot confidently parse a date, return empty string "".

6. volunteer_initials: handwritten initials in the "INITIALS" box at the bottom-left
   (string). Only capture if outcome is "Completed", otherwise return empty string.

7. checkout_time: handwritten check-out time in the "CHECK-OUT TIME" box at the bottom
   (string, as written). Only capture if outcome is "Completed", otherwise return empty string.

8. notes: any handwritten text in the "ADDITIONAL NOTES" box at the bottom (string).
   Always capture this — the volunteer may write a reschedule date here.

9. reschedule_date: ONLY populate if outcome is "Reschedule". Parse the date the
   volunteer wrote inside (or above/below) the "ADDITIONAL NOTES" box. Return as
   ISO date "YYYY-MM-DD". The current year is ${currentYear} — if the
   year is omitted assume current year. If outcome is not "Reschedule", or you
   cannot confidently parse a date, return empty string "".

10. items: object with the 30 EXACT keys below (integers, use 0 if blank).
    ONLY fill in real quantities if outcome is "Completed". If outcome is
    "No Show", "Cancelled", or "Reschedule", set every item to 0.


The sheet has sections. Map each row to a key using these section prefixes:
- "LIVING ROOM FURNITURE" section → "LR <Item>"
- "BEDROOM FURNITURE" section → "BR <Item>"
- "DINING ROOM FURNITURE" section → "DR <Item>"
- "KITCHEN/HOUSEHOLD" section → "KH <Item>"
- "CLOTHES" section → "CL <Item>"
- "BABY/KIDS" section → "BK <Item>"


Required item keys (all 30 must appear, integers, 0 if blank):
${ITEM_FIELDS.map((f) => `   - "${f}"`).join('\n')}


Sheet → key mapping:
- LR Chair (from "Chair" row under LIVING ROOM FURNITURE)
- DR Chair (from "Chair" row under DINING ROOM FURNITURE)
- KH Cookbook (from "Cookbook (# boxes)")
- KH Dishes (from "Dishes (# boxes)")
- KH Linen (from "Linen (# bags)")
- CL Clothes (from "Clothes (# bags)")
- CL Shoes (from "Shoes (# bags)")
- BK Baby Clothes (from "Baby Clothes (# bags)")


CRITICAL — item quantity extraction (READ CAREFULLY):

QTY-ONLY POLICY (July 2026):
  Each row on the sheet has two cells: HASH (middle, working tally) and QTY
  (rightmost, final count). The QTY column is the source of truth. IGNORE
  the HASH column entirely for quantity extraction.

  A dedicated reviewer transcribes each row's final count into the QTY cell
  as an arabic digit before the sheet is scanned. Your job is to read that
  digit — nothing else.

THE ONLY TWO RULES:

  Rule 1 — If the QTY cell contains any handwritten digit (0-9), use
           that digit as the quantity. Multi-digit numbers (10, 12, etc.) are
           allowed; return the full number.

           HOUSE CONVENTION — THE 1-VS-2 TEST (READ THIS FIRST):
           This warehouse handles almost exclusively low quantities:
           1, 2, 3, 4, 5. The values 3, 4, 5 have distinctive digit
           shapes and are easy to read. The ONLY visually ambiguous
           pair is 1 vs 2. To eliminate ambiguity, reviewers follow
           this strict convention:

             1 = a SINGLE VERTICAL STROKE, like a pipe "|" or a lowercase
                 L. NO curves. NO top serif. NO base line. Just one
                 straight down-stroke.

             2 = a CURVED shape with a base, like normal handwritten 2.
                 ALWAYS has a visible curve at the top and a horizontal
                 base stroke.

           THE BINARY TEST: for any single-character QTY mark, ask
           ONE question: "is there a visible curve in the ink?"
             - NO curve (just a straight vertical stroke) → 1
             - YES curve (any curved top or base loop) → 2

           A 1 with a serif or hook that got written by mistake still
           counts as 1, BUT the default and expected form is a plain
           vertical stroke. When in doubt about a single-character
           mark that has ANY vertical component and ambiguous curves,
           choose 1. Only choose 2 when the curve is unmistakable.

           This convention exists specifically to reduce OCR errors
           on the two most common values. Trust the convention.

           BE GENEROUS in digit recognition. Handwritten digits are messy
           because reviewers fill QTY at end-of-day after a fast-paced
           warehouse shift:
           - A "1" is a plain vertical stroke by house convention. May
             occasionally have a small serif or hook if the reviewer
             wrote it that way — still a 1.
           - A "2" is always curved with a base loop — stylized Z or
             S-shape with a base. No curve = not a 2.
           - A "3" may look like a stylized E or a rounded double-hump.
           - A "7" may have a horizontal slash through the middle
             (European convention) — still a 7.
           - A digit written with a slight cross-out or correction still
             counts as the visible digit — read the corrected version.
           - When torn between two digits (e.g. 1 vs 2), pick the one the
             ink shape most resembles by the curve test above. Do NOT
             use the HASH column to disambiguate. HASH is chaotic
             scratchpad data (may include marks from volunteers writing
             on the wrong sheet, scratched corrections, etc.) and cannot
             override QTY.

  Rule 2 — Return 0 if the QTY cell is empty or near-empty (no clear
           handwritten digit visible), OR if the QTY cell contains something
           that is definitely NOT a digit (a checkmark, an X, a slash mark
           with no digit shape).

           IMPORTANT: many rows will be legitimately empty because the
           client did not receive that item. An empty QTY cell is the
           NORMAL, EXPECTED state for most rows. Do NOT invent a digit
           from faint marks, printed grid lines, scanner artifacts, paper
           texture, shadows, or ambiguous smudges. If you cannot clearly
           identify a specific handwritten digit (0-9) shape drawn by a
           human pen, return 0. When in doubt between "empty" and "has a
           digit", choose empty (0).

           A CLEAR digit shape means: continuous ink strokes forming a
           recognizable numeral, distinct from the printed grid and from
           any faint scanner noise. Don't force a digit interpretation on
           ambiguous ink.

Do NOT interpret tally marks in the HASH column as a QTY value — QTY is
the SOLE source of truth. HASH is working-memory scratchpad from a chaotic
Saturday warehouse floor and often contains inaccurate marks (wrong sheet,
scratched items, double-writes). HASH marks NEVER justify inventing a QTY
digit that isn't actually written in the QTY cell.
Do NOT infer quantity from context, from adjacent rows, or from anywhere else.
If QTY has a clearly identifiable handwritten digit, return that digit.
If QTY has no clear digit, return 0.

This is intentional: the reviewer has already decided what the client received
and written the number in QTY. Any ink outside the QTY column is working
notes, not data. Working notes that were not transcribed into QTY reflect a
reviewer decision to not disburse the item.

- Section row counts (validate your output against these — every section must
  return exactly this many item keys):
    * LIVING ROOM FURNITURE: 10 rows
    * BEDROOM FURNITURE: 4 rows
    * DINING ROOM FURNITURE: 2 rows
    * KITCHEN/HOUSEHOLD: 8 rows
    * CLOTHES: 2 rows
    * BABY/KIDS: 4 rows
  Total: 30 items. If your output does not have 30 keys, you missed a row —
  re-read the sheet.
- Return integers, not strings.
- All 30 item keys must be present in the output.
- The "Client/Car #" value in the top-right of the header is NOT captured — ignore it.


MANDATORY SELF-CHECK BEFORE RETURNING (do this silently, do not include in output):
  1. Verify all 30 item keys are present in the items object.
  2. For every row where you returned a non-zero digit: look one more time
     at the QTY cell. Verify a clear handwritten digit is actually drawn
     there — not a printed grid line, not a scanner artifact, not a mark
     bleeding through from HASH, not a shadow. If you cannot confirm a
     clear pen-drawn digit shape, change the value to 0.
  3. Verify no value is a string — all quantities must be integers.


Example output (completed):
{
  "record_id": "recABC123XYZ4567",
  "outcome": "Completed",
  "client_first_name": "Jenane",
  "client_last_name": "Debone",
  "appointment_date": "2026-07-11",
  "volunteer_initials": "JD",
  "checkout_time": "10:45",
  "notes": "",
  "reschedule_date": "",
  "items": {
    "LR Bookcase/Storage": 0,
    "LR Chair": 2,
    "LR Coffee Table": 1,
    "LR Couch/Loveseat/Futon": 1,
    "LR End Table/TV Stand": 0,
    "LR Lamp": 0,
    "LR Picture/Other Decor": 0,
    "LR Rug": 0,
    "LR Student Desk": 0,
    "LR TV/Electronics": 0,
    "BR Bedframe": 0,
    "BR Dresser": 1,
    "BR Mattress/Boxspring": 0,
    "BR Nightstand": 0,
    "DR Chair": 0,
    "DR Dining Table": 0,
    "KH Bathroom": 0,
    "KH Cookbook": 0,
    "KH Dishes": 0,
    "KH General Household": 0,
    "KH Home Office": 0,
    "KH Linen": 0,
    "KH Pots/Pans/Utensils": 0,
    "KH Small Appliance": 0,
    "CL Clothes": 0,
    "CL Shoes": 0,
    "BK Baby Clothes": 0,
    "BK Crib/Bassinet": 0,
    "BK General Baby": 0,
    "BK Toys/Books/School": 0
  }
}

Example output (reschedule):
{
  "record_id": "recABC123XYZ4567",
  "outcome": "Reschedule",
  "client_first_name": "Mahie",
  "client_last_name": "Past",
  "appointment_date": "2026-07-11",
  "volunteer_initials": "",
  "checkout_time": "",
  "notes": "Resched to 7/12",
  "reschedule_date": "2026-07-12",
  "items": { "LR Bookcase/Storage": 0, "LR Chair": 0, ... all 30 keys, all 0 ... }
}`

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: pdfBytes.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini API ${res.status}: ${body}`)
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }
  const text = data.candidates[0].content.parts[0].text
  return JSON.parse(text) as GeminiOcrResult
}


// ============================================================
// Reschedule date parser (ported verbatim from Apps Script)
// ============================================================

function parseRescheduleDate(raw: string): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // Native Date parser (handles "July 12 2026", "7/12/2026", etc.)
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear()
    // Reject obviously wrong years (e.g. 1970 from a bare "7/12")
    if (yyyy >= 2025 && yyyy <= 2030) {
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }
  }

  // M/D or MM/DD with no year — assume current year
  const md = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (md) {
    const y = new Date().getFullYear()
    const m = String(parseInt(md[1], 10)).padStart(2, '0')
    const day = String(parseInt(md[2], 10)).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  return null
}


// ============================================================
// Airtable write (ported from Apps Script writeToAirtable)
//
// Writes the OCR result to the resolved Client Referrals record.
// Outcome-conditional logic is byte-for-byte identical to Apps Script.
// ============================================================

async function writeToAirtable(
  result: GeminiOcrResult,
  batchAirtableUrl: string,
  scanBatchRecordId: string | null,
): Promise<void> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_BASE_ID or AIRTABLE_API_KEY not set')
  }

  const recordId = result.record_id

  // Normalize outcome — default to Completed if Gemini returned anything weird
  const outcome: Outcome = (VALID_OUTCOMES as readonly string[]).includes(result.outcome)
    ? (result.outcome as Outcome)
    : 'Completed'

  const fields: Record<string, unknown> = {
    'Sheet Processed': true,
    'OCR Processed At': new Date().toISOString(),
    'OCR Confidence': 'High',
    // Point Sheet Drive Link at the Airtable Scan Batches record for audit
    // (portal doesn't upload to Drive anymore — batch record is the source of truth)
    'Sheet Drive Link': batchAirtableUrl,
    'Appointment Status': outcome,
  }

  // Link back to the Scan Batches record for audit traceability
  if (scanBatchRecordId) {
    fields['Source Scan Batch'] = [scanBatchRecordId]
  }

  // Always capture notes if present (may contain reschedule context on any outcome)
  if (result.notes) fields['Distribution Notes'] = result.notes

  if (outcome === 'Completed') {
    if (result.volunteer_initials) fields['Volunteer Initials'] = result.volunteer_initials
    if (result.checkout_time) fields['Check-out Time'] = result.checkout_time

    // Always write every item field. Missing/zero quantities are set to null
    // to CLEAR any prior values from an earlier scan of this record.
    // Without this, PATCH is additive and stale items from prior runs persist.
    if (result.items) {
      for (const fieldName of ITEM_FIELDS) {
        const qty = result.items[fieldName]
        const num = typeof qty === 'number' ? qty : parseInt(String(qty), 10)
        fields[fieldName] = num && num > 0 ? num : null
      }
    } else {
      // No items in OCR result — clear all item fields defensively.
      for (const fieldName of ITEM_FIELDS) {
        fields[fieldName] = null
      }
    }
  } else if (outcome === 'Reschedule') {
    // Hand off to the existing Airtable "Reschedule" automation.
    // Reschedule means no items were disbursed — clear all item fields
    // and any stale initials/checkout data from prior scans.
    for (const fieldName of ITEM_FIELDS) {
      fields[fieldName] = null
    }
    fields['Volunteer Initials'] = null
    fields['Check-out Time'] = null

    const newDate = parseRescheduleDate(result.reschedule_date)
    if (newDate) {
      fields['Scheduling Flexibility'] = 'Specific Date'
      fields['Preferred Date'] = newDate
      fields['Manual Review Needed'] = false
    } else {
      fields['Scheduling Flexibility'] = 'Flexible'
      fields['Preferred Date'] = null
      fields['Manual Review Needed'] = false
      fields['OCR Notes'] = 'Reschedule marked — no date in notes, using next available'
    }
  } else {
    // No Show: status-only update, but clear items/initials/checkout defensively
    // so a stale prior scan does not leave phantom data behind.
    for (const fieldName of ITEM_FIELDS) {
      fields[fieldName] = null
    }
    fields['Volunteer Initials'] = null
    fields['Check-out Time'] = null
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    },
    body: JSON.stringify({ fields, typecast: true }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[OCR PATCH FAIL] recordId=${recordId} status=${res.status}`)
    console.error(`[OCR PATCH FAIL] fields=${JSON.stringify(fields)}`)
    console.error(`[OCR PATCH FAIL] response=${body}`)
    throw new Error(`Airtable PATCH ${res.status}: ${body}`)
  }
}


// ============================================================
// Manual review flag (ported from Apps Script flagManualReview)
// ============================================================

export async function flagManualReview(
  recordId: string | null,
  errorMessage: string,
  batchAirtableUrl: string,
  scanBatchRecordId: string | null,
): Promise<void> {
  if (!recordId) {
    console.warn(`flagManualReview: no record ID resolved. Notes: ${errorMessage}`)
    return
  }
  if (!/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
    console.warn(`flagManualReview: malformed record ID "${recordId}". Notes: ${errorMessage}`)
    return
  }

  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_BASE_ID or AIRTABLE_API_KEY not set')
  }

  const fields: Record<string, unknown> = {
    'Manual Review Needed': true,
    'OCR Confidence': 'Failed',
    'OCR Notes': errorMessage.slice(0, 500),
    'OCR Processed At': new Date().toISOString(),
    'Sheet Drive Link': batchAirtableUrl,
  }

  if (scanBatchRecordId) {
    fields['Source Scan Batch'] = [scanBatchRecordId]
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
      body: JSON.stringify({ fields, typecast: true }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`flagManualReview PATCH ${res.status} for ${recordId}: ${body}`)
    }
  } catch (e) {
    console.error('flagManualReview failed:', e)
  }
}


// ============================================================
// Main orchestrator — process one split page
//
// Called by the upload route once per split page. Encapsulates the whole
// Apps Script processFile() flow: OCR → resolve → write → flag on failure.
// Includes retry logic (up to MAX_RETRIES attempts) inline within the
// request instead of the Apps Script's cross-run FAILED folder pattern.
// ============================================================

const MAX_RETRIES = 3

export async function processPage({
  pdfBytes,
  pageNumber,
  batchAirtableUrl,
  scanBatchRecordId,
  cache,
}: {
  pdfBytes: Buffer
  pageNumber: number
  batchAirtableUrl: string
  scanBatchRecordId: string | null
  cache: CandidateCache
}): Promise<ProcessPageResult> {
  let extractedRecordId: string | null = null
  let ocrDiagnostic = ''
  let lastError = ''
  let lastResult: GeminiOcrResult | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await extractWithGemini(pdfBytes)
      lastResult = result
      extractedRecordId = result.record_id || null

      ocrDiagnostic =
        `OCR read: id="${result.record_id || ''}" ` +
        `name="${result.client_first_name || ''} ${result.client_last_name || ''}" ` +
        `date="${result.appointment_date || ''}" ` +
        `outcome="${result.outcome || ''}"`

      const resolvedId = await resolveRecordId(result, cache)
      if (!resolvedId) {
        throw new Error(`Could not resolve record from OCR. ${ocrDiagnostic}`)
      }
      if (resolvedId !== result.record_id) {
        console.log(`Page ${pageNumber}: Corrected record ID: ${result.record_id} → ${resolvedId}`)
        result.record_id = resolvedId
        extractedRecordId = resolvedId
      }

      await writeToAirtable(result, batchAirtableUrl, scanBatchRecordId)

      return {
        pageNumber,
        success: true,
        recordId: resolvedId,
        outcome: (VALID_OUTCOMES as readonly string[]).includes(result.outcome)
          ? (result.outcome as Outcome)
          : 'Completed',
        clientName: `${result.client_first_name || ''} ${result.client_last_name || ''}`.trim(),
        appointmentDate: result.appointment_date || '',
        errorMessage: null,
        ocrDiagnostic,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error(`Page ${pageNumber} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`)
      // No backoff between attempts — Gemini failures are usually not rate-limit related
      // at our volume; retry is for transient JSON parse or network hiccups
    }
  }

  // All retries exhausted — flag manual review
  const fullMsg = ocrDiagnostic ? `${lastError} | ${ocrDiagnostic}` : lastError
  await flagManualReview(extractedRecordId, fullMsg, batchAirtableUrl, scanBatchRecordId)

  return {
    pageNumber,
    success: false,
    recordId: extractedRecordId,
    outcome: lastResult && (VALID_OUTCOMES as readonly string[]).includes(lastResult.outcome)
      ? (lastResult.outcome as Outcome)
      : null,
    clientName: lastResult
      ? `${lastResult.client_first_name || ''} ${lastResult.client_last_name || ''}`.trim()
      : '',
    appointmentDate: lastResult ? (lastResult.appointment_date || '') : '',
    errorMessage: fullMsg,
    ocrDiagnostic,
  }
}
