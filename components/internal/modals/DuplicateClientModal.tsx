// components/internal/modals/DuplicateClientModal.tsx
//
// Despite the filename (kept as-is so the file path in the project doesn't
// change), this is an INLINE banner, not a popup dialog. Rendered by
// app/dawson/referrals/new/page.tsx directly in the page flow -- right
// after the Client Information section (First/Last/DOB/Phone/Language) and
// before Address -- as soon as those identity fields are filled in. No
// backdrop, nothing blocked underneath; Dawson can keep filling in the
// rest of the form (Address, Household, Items) while this stays visible,
// which also lets the "matches what you typed" panel fill in live as those
// later fields get typed.
//
// ONE CARD PER MATCH, three stacked parts (Sep 2026 rework):
//
//   1. Header strip   — #FDF0EE, 2px #C0392B bottom border, red alert icon,
//                       "This client is already in the system".
//   2. Client on file — who is on file, beside a teal panel listing which of
//                       the fields Dawson has typed actually match.
//   3. History        — every referral on file for that client, each row a
//                       link to the referral, opening in a new tab.
//
// Then three equal actions. For a completed / cancelled / aged no-show match
// the red is on the HEADER ONLY and the buttons stay neutral: a repeat client
// is not an error, and the card exists to make Dawson stop and read the
// history, not to tell him he did something wrong.
//
// The ACTIVE case is the documented exception. Booking on top of an
// appointment that already exists is the one path on this card that creates a
// real duplicate booking, so it keeps the gold override outline it has always
// had, and the header names the situation instead of using the generic line.
// (Built neutral first, on a reading of "red header only, neutral buttons"
// that Ben corrected: that rule was written for the completed case and was
// never meant to reach this one.)
//
// Scenario drives the header wording and which single booking action is
// offered (see MatchCard):
//   1. 'reschedule' -- a No Show within the reschedule window, same
//      agency, nothing already active. The teal button reschedules the
//      existing record in place rather than creating a new one, so its
//      label says exactly that — "Book another appointment" would
//      misdescribe reopening a record that already exists.
//   2. 'active'      -- a Scheduled / Pending Schedule appointment already
//      exists. Takes priority over #1: if they are already back on the
//      books there is nothing left to reopen. Gold-outlined "Book a second
//      appointment", and a header that says which of the two active states
//      it is — a Pending Schedule referral has no Saturday yet, so calling
//      it "scheduled" would be wrong.
//   3. 'history'     -- Completed / Cancelled / an older or
//      different-agency No Show. Teal, neutral, generic header.
//
// DNS (Clients.Status === 'DNS') still replaces all of the above: the header
// says so and there is NO booking action at all, only "Different person" and
// "Don't book". Do not add a bypass — see lib/clients/do-not-serve.ts, which
// is the authority and describes this as a hard block with no override.
//
// Nothing has been written to Airtable while this is showing --
// check-duplicate is read-only -- so any resolution here is reversible
// right up until Submit.
//
// Action semantics per match, consumed by the page (unchanged by the
// rework — only the labels and layout moved):
//   - onResolve('reschedule', match) -> only offered for a No Show within
//     25 days from the SAME agency currently submitting, AND only when
//     there's no currently active appointment already on file. Reopens
//     that exact Client Referrals record (new date, status back to
//     Pending Schedule) instead of creating a new one.
//   - onResolve('book-new', match)   -> creates a new Client Referrals
//     record linked to this existing Client. The page prefills DOB,
//     phone, and address/city/state/zip/language from the matched
//     Client's record (editable -- if what's actually submitted diverges
//     from what's on file, the submit route forks off a fresh Client
//     instead of linking to this one). Items Requested, Household size,
//     Children, and Internal Notes are deliberately left blank -- this is
//     a new appointment, not a copy of the old one.
//   - onCancel()                     -> "Don't book". Resets the form on this
//     page to blank, ready for the next one. Its second line says what it
//     touches: the old "Cancel this referral" read as though it might cancel
//     the client's EXISTING appointment, which it has never done.
//   - onDismiss()                    -> "Different person" (per card), or
//     "None of these are the same person" (the bottom button, shown only for
//     2+ cards). Proceeds as a genuinely new Client.

'use client'

import { useState } from 'react'

export type ReferralHistoryItem = {
  id: string
  appointmentStatus: string
  appointmentDate: string
  preferredDate: string
  referringAgency: string
  referringStaff: string
  itemsRequested: string[]
  hhSize: string
  children: string
  internalNotes: string
}

export type MatchScenario = {
  type: 'completed' | 'no-show' | 'cancelled' | 'active'
  referral: ReferralHistoryItem
  eligibleForReschedule?: boolean
}

export type ClientMatch = {
  client: {
    id: string
    firstName: string
    lastName: string
    dob: string
    phone: string
    address: string
    address2: string
    city: string
    state: string
    zip: string
    language: string
    referralIds: string[]
    // Clients.Status. Only 'DNS' changes anything here.
    status?: string | null
  }
  history: ReferralHistoryItem[]
  scenarios: MatchScenario[]
}

// Mirrors isDoNotServeStatus in lib/clients/do-not-serve.ts, which is the
// server-side authority. Duplicated rather than imported because that module
// reads env vars at load and this is a client component; kept to the same
// trim/case-insensitive rule so the banner and the block agree about what
// counts as flagged.
function isDoNotServe(status: string | null | undefined): boolean {
  return typeof status === 'string' && status.trim().toUpperCase() === 'DNS'
}

// What's been typed into the form so far, for the live "matches what you
// typed" panel. Everything's optional in practice -- most of this fires
// before Address/City/State/Zip are even reached.
export type FormSnapshot = {
  firstName: string
  lastName: string
  dob: string
  phone: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
}

// ---------------------------------------------------------------- palette
//
// Portal palette only — every value here already exists elsewhere in
// /dawson. No new colours, sizes or radii.
const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const ERROR = '#C0392B'
const ERROR_BG = '#FDF0EE'
const SAND = '#EDE9E1'
const CREAM = '#F7F5F1'
// Teal tint for the "matches what you typed" panel — the same fill the
// resolved-confirmation strip below already uses.
const TEAL_TINT = '#EAF4F2'
// Muted body grey. #5A6878, not the #7A8899 used for muted text elsewhere on
// this page: at these sizes #7A8899 lands at 3.61:1 on white, under 4.5, and
// every grey line this card adds is real instruction rather than decoration.
// #5A6878 is already in the codebase (the Pending pill on the referrals list)
// and clears 4.5:1 on white, on the cream hover fill, and on the teal tint.
const MUTED = '#5A6878'
const MONT = 'var(--font-montserrat)'

// Status pills, matched to the Dawson referrals list (STATUS_UI in
// app/dawson/referrals/page.tsx) so the same referral reads the same in both
// places — Ben's explicit ask. Keyed on the RAW Airtable Appointment Status,
// since that is what the history rows carry.
//
// The No Show pill's text is #8A6D14, NOT the brand gold #C9A84C, and the
// referrals list was changed to match in the same commit — Ben's call, since
// #C9A84C on its own 15% tint measures 2.04:1 and is genuinely unreadable.
// #8A6D14 is already the Reschedule pill's colour, so this introduces no new
// value. It measures 4.39:1 at rest and 4.06:1 on a hovered row: a large
// improvement, still marginally under 4.5. Keep the two files in step — the
// whole point of matching the list is that the same referral reads the same
// in both places.
const STATUS_UI: Record<string, { label: string; bg: string; color: string }> = {
  'Scheduled': { label: 'Scheduled', bg: 'rgba(42,127,111,0.12)', color: TEAL },
  'Pending Schedule': { label: 'Pending', bg: 'rgba(122,136,153,0.14)', color: MUTED },
  'Reschedule': { label: 'Reschedule requested', bg: 'rgba(201,168,76,0.18)', color: '#8A6D14' },
  'Completed': { label: 'Completed', bg: 'rgba(27,43,75,0.08)', color: NAVY },
  'No Show': { label: 'No Show', bg: 'rgba(201,168,76,0.15)', color: '#8A6D14' },
  'Cancelled': { label: 'Cancelled', bg: 'rgba(192,57,43,0.10)', color: ERROR },
}

function statusUi(status: string) {
  return STATUS_UI[status] ?? { label: status || 'Unknown', bg: 'rgba(122,136,153,0.14)', color: MUTED }
}

// ---------------------------------------------------------------- helpers

function normalizeAgencyName(s: string): string {
  return s.trim().toLowerCase()
}

// Loose, display-only normalization for the live compare -- just enough to
// ignore case/punctuation/whitespace differences that aren't meaningful.
// The real, authoritative divergence check happens server-side at submit
// (clientDataDiverges in lib/referrals/match.ts); this is purely a visual hint
// so Dawson isn't surprised by it later.
function normalizeForCompare(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '')
}

function normalizePhoneDigits(s: string): string {
  return String(s || '').replace(/\D/g, '')
}

// Both sides of the DOB compare reduced to ISO before comparing, mirroring
// normalizeDob() in lib/referrals/match.ts. The form holds 'YYYY-MM-DD' and
// Clients.DOB is a real Airtable date (so it reads back ISO), but a Client
// row written as M/D/YYYY by an older path would otherwise read as a
// mismatch against an identical date.
function normalizeDob(s: string | undefined | null): string {
  const str = String(s || '').trim()
  if (!str) return ''
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return ''
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const datePart = dateStr.split('T')[0]
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Pending Schedule records usually have no Appointment Date yet -- fall back
// to Preferred Date so the row isn't just blank.
function displayDate(h: ReferralHistoryItem): string {
  return h.appointmentDate || h.preferredDate
}

function fullAddress(parts: { address: string; address2?: string; city: string; state: string; zip: string }): string {
  const line1 = parts.address2 ? `${parts.address}, ${parts.address2}` : parts.address
  const cityStateZip = [parts.city, [parts.state, parts.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [line1, cityStateZip].filter(Boolean).join(', ').trim()
}

// "Phone and address" / "Phone, address and date of birth". Field labels are
// lowercased by the caller so they read as running prose mid-sentence, then
// the first letter goes back up — this is the start of its own sentence.
function joinList(items: string[]): string {
  if (items.length === 0) return ''
  const joined =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

// Which of the identity fields Dawson has actually typed, and whether each
// agrees with the client on file. A field he has NOT typed produces no row at
// all — the old compare table rendered those as "—", which read as missing
// data on the client's record rather than as "you haven't got there yet".
type FieldCompare = { key: string; label: string; typed: boolean; matches: boolean }

function compareFields(match: ClientMatch, form: FormSnapshot): FieldCompare[] {
  const c = match.client

  const typedName = !!form.firstName.trim() && !!form.lastName.trim()
  const nameMatches =
    typedName &&
    normalizeForCompare(form.firstName) === normalizeForCompare(c.firstName) &&
    normalizeForCompare(form.lastName) === normalizeForCompare(c.lastName)

  const typedDob = !!normalizeDob(form.dob)
  const dobMatches = typedDob && !!normalizeDob(c.dob) && normalizeDob(form.dob) === normalizeDob(c.dob)

  const typedPhone = !!normalizePhoneDigits(form.phone)
  const phoneMatches =
    typedPhone && !!normalizePhoneDigits(c.phone) &&
    normalizePhoneDigits(form.phone) === normalizePhoneDigits(c.phone)

  // Only once a street address has actually been typed: `state` is prefilled
  // 'NJ', so fullAddress(form) is never genuinely empty.
  const typedAddress = !!form.address.trim()
  const addressMatches =
    typedAddress && !!fullAddress(c).trim() &&
    normalizeForCompare(fullAddress(form)) === normalizeForCompare(fullAddress(c))

  return [
    { key: 'name', label: 'Name', typed: typedName, matches: nameMatches },
    { key: 'dob', label: 'Date of birth', typed: typedDob, matches: dobMatches },
    { key: 'phone', label: 'Phone', typed: typedPhone, matches: phoneMatches },
    { key: 'address', label: 'Address', typed: typedAddress, matches: addressMatches },
  ]
}

// ---------------------------------------------------------------- UI atoms

function AlertIcon() {
  // Decorative: the heading beside it carries the meaning, so it is hidden
  // from assistive tech rather than given a redundant label.
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%',
        background: ERROR, color: 'white', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: MONT, fontWeight: 800, fontSize: '17px', lineHeight: 1,
      }}
    >
      !
    </span>
  )
}

// The header says the most specific true thing about this match, because the
// three cases are not equally serious:
//
//   dns     — a decision already taken; there is no booking action at all.
//   active  — the client is ALREADY on the books. This is the one path on
//             this card that creates a genuine duplicate booking, so the
//             header names it rather than using the generic line, and the
//             booking button keeps its gold override outline (see
//             ActionButton 'override'). Ben's correction: "red header only,
//             neutral buttons" was written for the completed-appointment
//             case and was never meant to cover this one.
//   default — completed / cancelled / an aged or other-agency no-show.
//
// 'Scheduled' and 'Pending Schedule' are both "active", but only one of them
// is actually scheduled: a Pending Schedule referral has no Saturday yet.
// Saying "scheduled" there would be the generic-line problem again, one level
// down, so the two get their own wording.
function HeaderStrip({
  doNotServe,
  activeStatus,
}: {
  doNotServe: boolean
  /** Raw Airtable status of the active referral, when there is one. */
  activeStatus: string | null
}) {
  const heading = doNotServe
    ? 'This client is marked do not serve'
    : activeStatus === 'Pending Schedule'
      ? 'This client already has an appointment awaiting a date'
      : activeStatus
        ? 'This client already has an appointment scheduled'
        : 'This client is already in the system'

  const sub = doNotServe
    ? "They can't be referred. Check the appointment history below to confirm it's the right person."
    : activeStatus
      ? 'Booking here adds a second one. Check the appointment history below, then choose what to do.'
      : 'Check the appointment history below, then choose what to do.'

  return (
    <div style={{
      background: ERROR_BG, borderBottom: `2px solid ${ERROR}`,
      padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: '12px',
    }}>
      <AlertIcon />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: MONT, fontWeight: 800, fontSize: '20px', color: NAVY, lineHeight: 1.25 }}>
          {heading}
        </div>
        <div style={{ fontSize: '13px', color: MUTED, lineHeight: 1.5, marginTop: '3px' }}>
          {sub}
        </div>
      </div>
    </div>
  )
}

function BoxLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: MONT, fontSize: '10px', fontWeight: 800, color: MUTED,
      textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px',
    }}>
      {children}
    </div>
  )
}

function ClientOnFileBox({ match, form }: { match: ClientMatch; form: FormSnapshot }) {
  const c = match.client
  const fields = compareFields(match, form)
  const matched = fields.filter(f => f.typed && f.matches)
  const differing = fields.filter(f => f.typed && !f.matches)
  const notEntered = fields.filter(f => !f.typed)

  const address = fullAddress(c)

  return (
    <div style={{ border: `1px solid ${SAND}`, borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' }}>
      {/* Two columns above 900px, stacked below — see .fa-dupe-client-grid in
          globals.css. The teal panel is a sidebar on a wide screen and a block
          underneath the client's details on a narrow one. */}
      <div className="fa-dupe-client-grid">
        <div style={{ minWidth: 0 }}>
          <BoxLabel>Client on file</BoxLabel>
          <div style={{ fontFamily: MONT, fontWeight: 700, fontSize: '21px', color: NAVY, lineHeight: 1.25, marginBottom: '8px' }}>
            {c.firstName} {c.lastName}
          </div>
          <div style={{ fontSize: '13px', color: MUTED, lineHeight: 1.7 }}>
            <div>DOB {c.dob ? formatDate(c.dob) : '—'}</div>
            <div>{c.phone || 'No phone on file'}</div>
            <div>{address || 'No address on file'}</div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ background: TEAL_TINT, borderRadius: '8px', padding: '12px 14px' }}>
            <BoxLabel>Matches what you typed</BoxLabel>
            {matched.length === 0 && differing.length === 0 && (
              <div style={{ fontSize: '12.5px', color: MUTED, lineHeight: 1.5 }}>
                Nothing to compare yet.
              </div>
            )}
            {matched.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: NAVY, padding: '2px 0' }}>
                {/* Teal tick as a graphic beside navy text: the label carries
                    the meaning, so the glyph is hidden from assistive tech. */}
                <span aria-hidden="true" style={{ color: TEAL, fontWeight: 700, flexShrink: 0 }}>✓</span>
                {f.label}
              </div>
            ))}
            {/* A field he HAS typed that does not agree is the one thing this
                panel must not swallow — it is what makes the submit route fork
                a fresh Client instead of linking to this one
                (clientDataDiverges). Marked, not ticked. */}
            {differing.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#8E3227', padding: '2px 0' }}>
                <span aria-hidden="true" style={{ fontWeight: 700, flexShrink: 0 }}>✗</span>
                {f.label} differs
              </div>
            ))}
          </div>
          {notEntered.length > 0 && (
            <div style={{ fontSize: '12px', color: MUTED, lineHeight: 1.5, marginTop: '8px' }}>
              {joinList(notEntered.map(f => f.label.toLowerCase()))} not entered yet
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const HISTORY_GRID = 'minmax(0, 1.1fr) minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 130px)'

function HistoryRow({ h }: { h: ReferralHistoryItem }) {
  const [hover, setHover] = useState(false)
  const ui = statusUi(h.appointmentStatus)

  // A real <a>, not a div with onClick: the whole row is the link, so it has
  // to be focusable and activatable from the keyboard like any other. Opens
  // in a new tab so nothing Dawson has typed into the form behind it is lost.
  return (
    <a
      href={`/dawson/referrals/${h.id}`}
      target="_blank"
      rel="noopener"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: HISTORY_GRID, gap: '12px',
        alignItems: 'center', padding: '9px 10px', borderTop: `1px solid ${CREAM}`,
        textDecoration: 'none', background: hover ? CREAM : 'transparent',
        borderRadius: '6px',
      }}
    >
      <span style={{ fontSize: '13px', color: TEAL, textDecoration: 'underline', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {formatDate(displayDate(h))}
      </span>
      <span style={{ fontSize: '13px', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {h.referringAgency || '—'}
      </span>
      <span style={{ fontSize: '13px', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {h.referringStaff || '—'}
      </span>
      <span>
        <span style={{
          display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '3px 10px',
          borderRadius: '20px', background: ui.bg, color: ui.color, whiteSpace: 'nowrap',
        }}>
          {ui.label}
        </span>
      </span>
    </a>
  )
}

function AppointmentHistoryBox({ history }: { history: ReferralHistoryItem[] }) {
  // N is history.length and nothing else. The old card counted the WINDOWED
  // scenarios (12 months, active appointments excluded) in its sentence while
  // listing the full unwindowed history underneath, so the two disagreed —
  // measured against the live base, on 84 of 491 clients with any referral.
  const n = history.length

  return (
    <div style={{ border: `1px solid ${SAND}`, borderRadius: '10px', padding: '16px 18px', marginBottom: '16px' }}>
      <BoxLabel>
        Appointment history — {n} on file
      </BoxLabel>

      {n === 0 ? (
        <div style={{ fontSize: '13px', color: MUTED }}>No appointments on file.</div>
      ) : (
        <>
          {/* Column headers. No client name column — the box above says who
              this is, and repeating it on every row would push the four
              columns that differ into less space. */}
          <div style={{
            display: 'grid', gridTemplateColumns: HISTORY_GRID, gap: '12px',
            padding: '0 10px 6px', fontFamily: MONT, fontSize: '10px', fontWeight: 800,
            color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <span>Date</span>
            <span>Agency</span>
            <span>Referred by</span>
            <span>Status</span>
          </div>
          {history.map(h => <HistoryRow key={h.id} h={h} />)}
          <div style={{ fontSize: '12px', color: MUTED, marginTop: '9px' }}>
            Dates open the referral in a new tab.
          </div>
        </>
      )}
    </div>
  )
}

// Three equal actions. Every one names the record it affects: the old
// "Cancel this referral" read as though it might cancel the client's
// EXISTING appointment, which no action here has ever done.
//
// Contrast, measured (second line against its own fill):
//   white on teal #2A7F6F .......... 4.81:1
//   #5A6878 on white ............... 5.70:1
//   #8E3227 on #FDF0EE ............. 7.16:1
//   #8A6A00 on white (override) .... 5.07:1
// The teal button's second line is FULL white, deliberately — the usual
// trick of dropping it to ~85% opacity lands at 4.06:1 and fails.
//
// 'override' is the gold-outlined booking button used ONLY when the client
// already has an active appointment — the one action on this card that
// creates a real duplicate booking. Gold marks it; it is not made louder
// than the others. The #C9A84C border measures 2.29:1 against white as a
// graphic; the label and second line both sit at #8A6A00 (5.07:1), so the
// button's meaning never rests on the border colour alone.
function ActionButton({
  onClick, label, sub, variant,
}: {
  onClick: () => void
  label: string
  sub: string
  variant: 'primary' | 'override' | 'neutral' | 'quiet'
}) {
  const skin =
    variant === 'primary'
      ? { background: TEAL, border: `2px solid ${TEAL}`, color: 'white', subColor: 'white' }
      : variant === 'override'
        ? { background: 'white', border: '2px solid #C9A84C', color: '#8A6A00', subColor: '#8A6A00' }
        : variant === 'neutral'
          ? { background: 'white', border: '2px solid #C3BFB6', color: NAVY, subColor: MUTED }
          : { background: ERROR_BG, border: '2px solid #E0B4AD', color: '#8E3227', subColor: '#8E3227' }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'center', cursor: 'pointer',
        padding: '11px 12px', borderRadius: '8px',
        background: skin.background, border: skin.border,
      }}
    >
      <span style={{ display: 'block', fontFamily: MONT, fontWeight: 700, fontSize: '13px', color: skin.color, lineHeight: 1.3 }}>
        {label}
      </span>
      <span style={{ display: 'block', fontSize: '11.5px', color: skin.subColor, lineHeight: 1.35, marginTop: '3px' }}>
        {sub}
      </span>
    </button>
  )
}

function MatchCard({
  match,
  currentAgencyName,
  form,
  onResolve,
  onCancel,
  onNotSamePerson,
}: {
  match: ClientMatch
  currentAgencyName: string
  form: FormSnapshot
  onResolve: (action: 'reschedule' | 'book-new', match: ClientMatch) => void
  /** "Don't book" — resets the form on this page to blank, ready for the
      next referral. Touches nothing on file. */
  onCancel: () => void
  /** "Different person" — this candidate isn't who's being entered. Drops
      this card; when the last card goes, the banner proceeds as a new
      client. See the DNS CAUTION below. */
  onNotSamePerson: (match: ClientMatch) => void
}) {
  const noShowScenario = match.scenarios.find(s => s.type === 'no-show')
  const activeScenario = match.scenarios.find(s => s.type === 'active')
  // Active always takes priority over the reschedule offer -- if they're
  // already back on the books (Scheduled / Pending Schedule), there's
  // nothing left to reschedule.
  const canReschedule =
    !activeScenario &&
    !!noShowScenario &&
    !!noShowScenario.eligibleForReschedule &&
    !!noShowScenario.referral.referringAgency &&
    normalizeAgencyName(noShowScenario.referral.referringAgency) === normalizeAgencyName(currentAgencyName)

  // Do-not-serve outranks everything else on this card. It is not another
  // scenario competing on priority — it is a decision already taken about this
  // person, so it removes the booking action rather than colouring it.
  const doNotServe = isDoNotServe(match.client.status)

  return (
    <div style={{
      border: `2px solid ${ERROR}`, borderRadius: '10px',
      overflow: 'hidden', background: 'white', marginBottom: '14px',
    }}>
      <HeaderStrip
        doNotServe={doNotServe}
        activeStatus={activeScenario?.referral.appointmentStatus ?? null}
      />

      <div style={{ padding: '18px' }}>
        <ClientOnFileBox match={match} form={form} />
        <AppointmentHistoryBox history={match.history} />

        {/* DNS CAUTION — dismissing a genuine DNS match here would fork a fresh
            unflagged Clients row that the submit route's record-id assert can't
            catch (it reads the record we just made). Both submit routes guard
            against this by running findDoNotServeClientByIdentity (name + DOB)
            BEFORE any Client is created: two people who really share a name have
            different DOBs and pass it; the same person dismissed here does not.
            Keep both checks, in that order. */}
        <div className="fa-dupe-actions">
          {/* One booking action, three wordings. `activeScenario` wins over
              `canReschedule` — that priority is set above, and if they are
              already back on the books there is nothing left to reopen. */}
          {!doNotServe && activeScenario && (
            <ActionButton
              variant="override"
              onClick={() => onResolve('book-new', match)}
              label="Book a second appointment"
              sub="Adds a second one alongside the appointment already on file."
            />
          )}
          {!doNotServe && !activeScenario && (
            <ActionButton
              variant="primary"
              onClick={() => onResolve(canReschedule ? 'reschedule' : 'book-new', match)}
              label={canReschedule ? 'Reschedule the existing appointment' : 'Book another appointment'}
              sub={canReschedule ? 'Reopens the No Show already on file. No new referral.' : 'Same client, new referral'}
            />
          )}
          <ActionButton
            variant="neutral"
            onClick={() => onNotSamePerson(match)}
            label="Different person"
            sub="Creates a second client record with the same name and DOB"
          />
          <ActionButton
            variant="quiet"
            onClick={onCancel}
            label="Don't book"
            sub="Discards what you're entering. Nothing on file changes."
          />
        </div>
      </div>
    </div>
  )
}

// Collapsed confirmation strip shown once a match has been resolved to
// "book new appointment" -- keeps a lightweight reminder that this
// referral is linked to an existing Client without taking up the full
// card's worth of space while Dawson finishes the rest of the form.
function ResolvedStrip({ clientName, onReopen }: { clientName: string; onReopen: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: TEAL_TINT, border: '1px solid #B9DDD5', borderRadius: '8px',
        padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: TEAL,
      }}
    >
      <span>✓ Linked to <strong>{clientName}</strong>&rsquo;s existing record on file.</span>
      <button
        type="button"
        onClick={onReopen}
        style={{ background: 'transparent', border: 'none', color: TEAL, fontWeight: 700, fontSize: '12.5px', cursor: 'pointer', textDecoration: 'underline' }}
      >
        Change
      </button>
    </div>
  )
}

export default function DuplicateClientBanner({
  matches,
  currentAgencyName,
  form,
  resolved,
  onResolve,
  onCancel,
  onDismiss,
  onReopen,
}: {
  matches: ClientMatch[]
  currentAgencyName: string
  form: FormSnapshot
  // Set once staff pick "book another appointment" against a match --
  // collapses the card list down to a one-line confirmation strip instead.
  resolved: { clientId: string; clientName: string } | null
  onResolve: (action: 'reschedule' | 'book-new', match: ClientMatch) => void
  /** "Don't book" — reset the form on this page to blank. */
  onCancel: () => void
  /** "None of these are the same person" — proceed as a genuinely new client. */
  onDismiss: () => void
  onReopen: () => void
}) {
  const all = matches.slice(0, 5)
  // "Different person" on a card drops that card. When the last one goes,
  // there is nothing left to disambiguate, so it becomes onDismiss (new
  // client). The bottom "None of these" button is the same thing in one click,
  // shown only when there are 2+ cards to clear.
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const shown = all.filter(m => !dismissedIds.includes(m.client.id))

  const notSamePerson = (m: ClientMatch) => {
    const next = [...dismissedIds, m.client.id]
    setDismissedIds(next)
    if (all.every(x => next.includes(x.client.id))) onDismiss()
  }

  if (resolved) {
    return <ResolvedStrip clientName={resolved.clientName} onReopen={onReopen} />
  }
  if (shown.length === 0) return null

  // No wrapper heading any more: each card carries its own header strip, and a
  // second heading above it only repeated the same sentence in a smaller font.
  return (
    <div style={{ marginBottom: '20px' }}>
      {shown.map(m => (
        <MatchCard
          key={m.client.id}
          match={m}
          currentAgencyName={currentAgencyName}
          form={form}
          onResolve={onResolve}
          onCancel={onCancel}
          onNotSamePerson={notSamePerson}
        />
      ))}

      {shown.length > 1 && (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            width: '100%', padding: '11px', borderRadius: '8px', border: `2px solid #C3BFB6`,
            background: 'white', color: NAVY, fontFamily: MONT,
            fontWeight: 700, fontSize: '13px', cursor: 'pointer',
          }}
        >
          None of these are the same person
        </button>
      )}
    </div>
  )
}
