// components/internal/modals/DuplicateClientModal.tsx
//
// Despite the filename (kept as-is so the file path in the project doesn't
// change), this is an INLINE banner, not a popup dialog. Rendered by
// app/dawson/referrals/new/page.tsx directly in the page flow -- right
// after the Client Information section (First/Last/DOB/Phone/Language) and
// before Address -- as soon as those identity fields are filled in. No
// backdrop, nothing blocked underneath; Dawson can keep filling in the
// rest of the form (Address, Household, Items) while this stays visible,
// which also lets it show a live "on file" vs. "you're entering" compare
// as those later fields get typed.
//
// Three visually distinct branches per match, picked by priority (see
// `primary` in MatchCard below):
//   1. 'reschedule' -- a No Show within the reschedule window, same
//      agency, nothing already active. Amber/actionable: booking this
//      reschedules the existing record in place.
//   2. 'active'      -- a Scheduled / Pending Schedule / Unscheduled
//      appointment already exists. Red/urgent, and takes priority over
//      #1 (nothing to reschedule if they're already back on the books).
//      Booking a new one anyway requires an explicit acknowledgment
//      checkbox first -- a soft block, not a hard one.
//   3. 'history'     -- Completed / Cancelled / an older or
//      different-agency No Show within 12 months. Plain informational
//      styling, nothing urgent.
//
// Nothing has been written to Airtable while this is showing --
// check-duplicate is read-only -- so any resolution here is reversible
// right up until Submit.
//
// Action semantics per match, consumed by the page:
//   - onResolve('reschedule', match) -> only offered for a No Show within
//     25 days from the SAME agency currently submitting, AND only when
//     there's no currently active appointment already on file. Reopens
//     that exact Client Referrals record (new date, status back to
//     Unscheduled) instead of creating a new one.
//   - onResolve('book-new', match)   -> creates a new Client Referrals
//     record linked to this existing Client. The page prefills DOB,
//     phone, and address/city/state/zip/language from the matched
//     Client's record (editable -- if what's actually submitted diverges
//     from what's on file, the submit route forks off a fresh Client
//     instead of linking to this one). Items Requested, Household size,
//     Children, and Internal Notes are deliberately left blank -- this is
//     a new appointment, not a copy of the old one.
//   - onDecline()                    -> "same person, do not book" --
//     no-op today (just hides), kept as its own handler in case a
//     backend hook (e.g. logging, emailing) gets added later.
//   - onDismiss()                    -> "none of these are the same
//     person" -- proceeds as a genuinely new Client.

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
  }
  history: ReferralHistoryItem[]
  scenarios: MatchScenario[]
}

// What's been typed into the form so far, for the live "on file" vs.
// "you're entering" compare. Everything's optional in practice -- most of
// this fires before Address/City/State/Zip are even reached.
export type FormSnapshot = {
  dob: string
  phone: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
}

const STATUS_COLOR: Record<string, string> = {
  Completed: '#2A7F6F',
  'No Show': '#C0392B',
  Cancelled: '#7A8899',
  Scheduled: '#1B2B4B',
  Unscheduled: '#C9A84C',
  'Pending Schedule': '#C9A84C',
}

function statusColor(status: string): string {
  return STATUS_COLOR[status] || '#7A8899'
}

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

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const datePart = dateStr.split('T')[0]
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatAgo(dateStr: string): string {
  if (!dateStr) return ''
  const datePart = dateStr.split('T')[0]
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y) return ''
  const days = Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 0) return ''
  if (days < 31) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

// Unscheduled records usually have no Appointment Date yet -- fall back to
// Preferred Date so the active-appointment warning isn't just blank.
function displayDate(h: ReferralHistoryItem): string {
  return h.appointmentDate || h.preferredDate
}

function fullAddress(parts: { address: string; address2?: string; city: string; state: string; zip: string }): string {
  const line1 = parts.address2 ? `${parts.address}, ${parts.address2}` : parts.address
  const cityStateZip = [parts.city, [parts.state, parts.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [line1, cityStateZip].filter(Boolean).join(', ').trim()
}

function CompareRow({ label, onFile, typed }: { label: string; onFile: string; typed: string }) {
  const bothPresent = !!onFile.trim() && !!typed.trim()
  const differs = bothPresent && normalizeForCompare(onFile) !== normalizeForCompare(typed)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 1fr', gap: '10px', padding: '5px 0', fontSize: '12px' }}>
      <span style={{ color: '#7A8899', fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#2C3A4A' }}>{onFile || '—'}</span>
      <span style={{ color: differs ? '#C0392B' : '#2C3A4A', fontWeight: differs ? 700 : 400 }}>
        {typed || '—'}
        {differs ? ' ⚠' : ''}
      </span>
    </div>
  )
}

function CompareBlock({ match, form }: { match: ClientMatch; form: FormSnapshot }) {
  return (
    <div style={{ background: '#FCFBF9', border: '1px solid #EDE9E1', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 1fr', gap: '10px', marginBottom: '2px' }}>
        <span />
        <span style={{ fontSize: '10px', fontWeight: 800, color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.06em' }}>On File</span>
        <span style={{ fontSize: '10px', fontWeight: 800, color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.06em' }}>You're Entering</span>
      </div>
      <CompareRow label="DOB" onFile={match.client.dob} typed={form.dob} />
      <CompareRow label="Phone" onFile={match.client.phone} typed={form.phone} />
      <CompareRow
        label="Address"
        onFile={fullAddress(match.client)}
        typed={fullAddress(form)}
      />
    </div>
  )
}

function MatchCard({
  match,
  currentAgencyName,
  form,
  onResolve,
  onDecline,
}: {
  match: ClientMatch
  currentAgencyName: string
  form: FormSnapshot
  onResolve: (action: 'reschedule' | 'book-new', match: ClientMatch) => void
  onDecline: () => void
}) {
  const [ackActive, setAckActive] = useState(false)

  const noShowScenario = match.scenarios.find(s => s.type === 'no-show')
  const activeScenario = match.scenarios.find(s => s.type === 'active')
  // Active always takes priority over the reschedule offer -- if they're
  // already back on the books (Scheduled / Pending Schedule /
  // Unscheduled), there's nothing left to reschedule. In practice this is
  // the expected case where a no-show within the window got manually
  // rebooked through a fresh appointment rather than the reschedule flow.
  const canReschedule =
    !activeScenario &&
    !!noShowScenario &&
    !!noShowScenario.eligibleForReschedule &&
    !!noShowScenario.referral.referringAgency &&
    normalizeAgencyName(noShowScenario.referral.referringAgency) === normalizeAgencyName(currentAgencyName)

  const primary: 'active' | 'reschedule' | 'history' = activeScenario
    ? 'active'
    : canReschedule
      ? 'reschedule'
      : 'history'

  const historyCount = match.scenarios.filter(s => s.type !== 'active').length

  const EYEBROW: Record<typeof primary, { text: string; color: string }> = {
    active: { text: 'ACTIVE APPOINTMENT', color: '#C0392B' },
    reschedule: { text: 'RECENT NO-SHOW', color: '#8A6A00' },
    history: { text: 'POSSIBLE EXISTING CLIENT', color: '#7A8899' },
  }

  return (
    <div style={{ border: '1px solid #EDE9E1', borderRadius: '10px', padding: '18px', marginBottom: '14px' }}>
      <div style={{ fontSize: '10px', fontWeight: 800, color: EYEBROW[primary].color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
        {EYEBROW[primary].text}
      </div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: '#2C3A4A', marginBottom: '2px' }}>
        {match.client.firstName} {match.client.lastName}
      </div>
      <div style={{ fontSize: '12px', color: '#7A8899', marginBottom: '14px' }}>
        DOB {match.client.dob || '—'}{match.client.phone ? ` · ${match.client.phone}` : ''}
      </div>

      {primary === 'active' && (
        <div
          style={{
            background: '#FDEDEC', border: '1px solid #F0C4BE', borderRadius: '8px',
            padding: '12px 14px', marginBottom: '14px', fontSize: '12.5px', color: '#C0392B', fontWeight: 700,
          }}
        >
          ⚠ Already has a {activeScenario!.referral.appointmentStatus} appointment
          {displayDate(activeScenario!.referral) ? ` — ${formatDate(displayDate(activeScenario!.referral))}` : ''}. Booking another may create a duplicate.
        </div>
      )}

      {primary === 'reschedule' && (
        <div
          style={{
            background: '#FEF9EC', border: '1px solid #C9A84C', borderRadius: '8px',
            padding: '12px 14px', marginBottom: '14px', color: '#8A6A00',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '4px' }}>
            No-show on {formatDate(displayDate(noShowScenario!.referral))}
            {noShowScenario!.referral.referringAgency ? ` via ${noShowScenario!.referral.referringAgency}` : ''}
          </div>
          <div style={{ fontSize: '12.5px', lineHeight: 1.5 }}>
            Booking this appointment will reschedule the existing no-show instead of creating a new record — everything else on file (items, household, notes) stays as it was.
          </div>
        </div>
      )}

      {primary === 'history' && historyCount > 0 && (
        <div
          style={{
            background: '#F7F5F1', border: '1px solid #EDE9E1', borderRadius: '8px',
            padding: '10px 14px', marginBottom: '14px', fontSize: '12.5px', color: '#2C3A4A', fontWeight: 600,
          }}
        >
          {historyCount} appointment{historyCount === 1 ? '' : 's'} on file in the last 12 months.
        </div>
      )}

      <CompareBlock match={match} form={form} />

      <div style={{ fontSize: '10px', fontWeight: 800, color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
        Full Appointment History
      </div>
      {match.history.length === 0 && (
        <div style={{ fontSize: '12.5px', color: '#7A8899', marginBottom: '14px' }}>No past appointments on file.</div>
      )}
      {match.history.map(h => (
        <div
          key={h.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 0', borderBottom: '1px solid #F7F5F1', fontSize: '12.5px',
          }}
        >
          <span style={{ color: '#2C3A4A' }}>{formatDate(displayDate(h))}</span>
          <span
            style={{
              fontSize: '10.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px',
              background: `${statusColor(h.appointmentStatus)}1A`, color: statusColor(h.appointmentStatus),
            }}
          >
            {h.appointmentStatus || 'Unknown'} · {formatAgo(h.appointmentDate)}
          </span>
          <span style={{ color: '#7A8899', textAlign: 'right', maxWidth: '160px' }}>
            {h.referringAgency || '—'}
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
        {primary === 'reschedule' && (
          <button
            onClick={() => onResolve('reschedule', match)}
            style={{
              padding: '11px', borderRadius: '8px', border: 'none', background: '#2A7F6F',
              color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
            }}
          >
            Reschedule this appointment — no new record
          </button>
        )}

        {/* Active is a soft block -- booking anyway requires an explicit
            acknowledgment first rather than a plain one-click button, so
            it's not an easy accidental click past a warning that says
            "this may create a duplicate." */}
        {primary === 'active' && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#2C3A4A', cursor: 'pointer', padding: '2px 2px 4px' }}>
            <input
              type="checkbox"
              checked={ackActive}
              onChange={e => setAckActive(e.target.checked)}
              style={{ marginTop: '2px' }}
            />
            I understand this client already has an active appointment, and booking another may create a duplicate.
          </label>
        )}

        <button
          onClick={() => onResolve('book-new', match)}
          disabled={primary === 'active' && !ackActive}
          style={{
            padding: '11px', borderRadius: '8px',
            border: primary === 'history' ? 'none' : '1px solid #EDE9E1',
            background: primary === 'active' ? (ackActive ? '#C0392B' : '#EDE9E1') : primary === 'reschedule' ? 'white' : '#2A7F6F',
            color: primary === 'active' ? (ackActive ? 'white' : '#A9ADB4') : primary === 'reschedule' ? '#2C3A4A' : 'white',
            fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
            cursor: primary === 'active' && !ackActive ? 'not-allowed' : 'pointer',
          }}
        >
          {primary === 'reschedule'
            ? 'Same person — book a new appointment anyway'
            : primary === 'active'
              ? 'Same person — book anyway'
              : 'Same person — book a new appointment'}
        </button>
        <button
          onClick={onDecline}
          style={{
            padding: '9px', borderRadius: '8px', border: 'none', background: 'transparent',
            color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: '12.5px', cursor: 'pointer',
          }}
        >
          Same person — do not book
        </button>
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
        background: '#EAF4F2', border: '1px solid #B9DDD5', borderRadius: '8px',
        padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#2A7F6F',
      }}
    >
      <span>✓ Linked to <strong>{clientName}</strong>'s existing record on file.</span>
      <button
        onClick={onReopen}
        style={{ background: 'transparent', border: 'none', color: '#2A7F6F', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer', textDecoration: 'underline' }}
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
  onDecline,
  onDismiss,
  onReopen,
}: {
  matches: ClientMatch[]
  currentAgencyName: string
  form: FormSnapshot
  // Set once staff pick "book new appointment" against a match -- collapses
  // the full card list down to a one-line confirmation strip instead.
  resolved: { clientId: string; clientName: string } | null
  onResolve: (action: 'reschedule' | 'book-new', match: ClientMatch) => void
  onDecline: () => void
  onDismiss: () => void
  onReopen: () => void
}) {
  const shown = matches.slice(0, 5)

  if (resolved) {
    return <ResolvedStrip clientName={resolved.clientName} onReopen={onReopen} />
  }

  return (
    <div style={{ background: '#FAF8F4', border: '1px solid #EDE9E1', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', marginBottom: '4px' }}>
        Possible existing client
      </div>
      <div style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.5, marginBottom: '16px' }}>
        {shown.length === 1
          ? 'We found a similar record already in the system. Review below, then keep filling out the form.'
          : `We found ${shown.length} similar records already in the system. Review below, then keep filling out the form.`}
      </div>

      {shown.map(m => (
        <MatchCard
          key={m.client.id}
          match={m}
          currentAgencyName={currentAgencyName}
          form={form}
          onResolve={onResolve}
          onDecline={onDecline}
        />
      ))}

      <button
        onClick={onDismiss}
        style={{
          width: '100%', padding: '11px', borderRadius: '8px', border: '1px solid #EDE9E1',
          background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)',
          fontWeight: 700, fontSize: '13px', cursor: 'pointer',
        }}
      >
        None of these — this is a new client
      </button>
    </div>
  )
}
