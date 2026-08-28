'use client'

// app/(agency)/referrals/[id]/page.tsx
//
// Agency-facing referral detail. Brought up to parity with the internal
// Dawson detail page (app/dawson/referrals/[id]/page.tsx), whose card / edit /
// action patterns this follows deliberately rather than inventing a second
// set:
//
//   • Client info, Items Requested and Your Notes are inline-editable, using
//     the same read-mode-then-Edit-button shape as the internal cards.
//   • Reschedule / Cancel / Withdraw, using the agency portal's own dialogs
//     (shared with ReferralTable) — an agency proposes and Furniture Assist
//     confirms, which is why these are not the internal book-a-slot modals.
//   • Items Received on completed referrals: only what was actually handed
//     over, grouped by room.
//   • The client receipt PDF, which the cron generates into an Airtable
//     attachment; this page only links to it.
//
// Editing closes after the Monday before the appointment, and only while the
// referral is still open. That rule lives in lib/referrals/edit-window.ts
// because PATCH /api/referrals/[id] enforces the same thing server-side —
// hiding the button is presentation, not permission.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CATALOG } from '@/lib/catalog/items-disbursed'
import { AGENCY_CONTACT_EMAIL, ONLINE_SUBMISSION_COMING_SOON } from '@/lib/contact'
import { formatDob } from '@/lib/dates'
import { agencyEditWindow, agencyNotesEditable, getPortalStatus } from '@/lib/referrals/edit-window'
import { withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'
// Shared with components/agency/ReferralTable.tsx, which fills the same blank
// on the same referral from the same three Airtable fields.
import { requestedSlot } from '@/lib/referrals/requested-slot'
import {
  ConfirmModal,
  RescheduleModal,
  type AvailableDate,
  type ConfirmModalState,
  type RescheduleModalState,
} from '@/components/agency/ReferralActionModals'

type DisbursedLine = { name: string; qty: string | number }

type ItemsDisbursed = {
  livingRoom: DisbursedLine[]
  bedroom: DisbursedLine[]
  diningRoom: DisbursedLine[]
  kitchen: DisbursedLine[]
  linens: DisbursedLine[]
  misc: DisbursedLine[]
  otherItems: string | null
  distributionNotes: string | null
}

type Referral = {
  id: string
  clientId: string | null
  clientName: string
  firstName: string
  lastName: string
  dob: string | null
  phone: string | null
  language: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  hhSize: string | null
  children: string | null
  items: string | null
  externalNotes: string | null
  referralDate: string
  referralReview: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  // The slot the referral held before a cancel/withdraw released it — the only
  // date/time left once Appointment Date (a lookup) has gone empty.
  originalAppointmentDate: string | null
  originalAppointmentTime: string | null
  // Reschedule requests only — what the agency asked for.
  preferredDate: string | null
  preferredTime: string | null
  schedulingFlexibility: string | null
  appointmentSlipUrl: string | null
  clientReceiptUrl: string | null
  dataPageUrl: string | null
  referredBy: string | null
  referringAgency: string | null
  agencyEmail: string | null
  possibleDuplicate: boolean
  itemsDisbursed: ItemsDisbursed | null
}

// Mirrors the internal page's list and the agency New Referral form's.
const ITEM_CATEGORIES = [
  'Bedroom Furniture',
  'Living Room Furniture',
  'Dining Room Furniture',
  'Clothes',
  'Household Items (including kitchen & linens)',
  'Baby Items',
]

const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May', 'Cumberland',
  'Essex', 'Gloucester', 'Hudson', 'Hunterdon', 'Mercer', 'Middlesex',
  'Monmouth', 'Morris', 'Ocean', 'Passaic', 'Salem', 'Somerset',
  'Sussex', 'Union', 'Warren',
]

const LANGUAGES = ['English', 'Spanish', 'Haitian Creole', 'French', 'Arabic', 'Portuguese', 'Other']

const STATES = ['NJ', 'NY', 'PA', 'CT', 'DE']

// Card header accents. Every box on this page carries one, so the sections
// read as separate things rather than as one long white run — Ben's ask.
//
// The two values and their meaning are lifted from the internal detail page
// (app/dawson/referrals/[id]/page.tsx), which uses this same Card component:
// teal marks a card you can edit, muted grey a card that is read-only. Same
// pattern, second portal — not a new one.
//
// Strictly: teal only while the card actually accepts an edit. Once the edit
// window closes — past the Monday cutoff or a terminal status — the three
// editable cards go grey too, and status colour lives solely in the header
// pill. (Your Notes has no Monday cutoff, so it stays teal a little longer
// than the other two — see agencyNotesEditable.)
const EDIT_ACCENT = '#2A7F6F'  // teal — editable card
const READ_ACCENT = '#7A8899'  // muted grey — read-only card

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "Sep 26, 2026 at 10am", or just the date when there's no time, or null when
// there's no date at all. Used for the Appointment card's one combined row —
// RequestedRows keeps its own inline "·" format for the reschedule case.
function formatDateTime(dateStr: string | null, time: string | null) {
  if (!dateStr) return null
  const d = formatDate(dateStr)
  return time ? `${d} at ${time}` : d
}

// The Appointment card is a single row now, and what the stored date means
// depends on the referral's state. One colour / size / weight for the date in
// every state (navy, 16px, bold); Cancelled adds a strikethrough, which is what
// marks it void. Scheduled gets no row label — "Appointment" would just repeat
// the card title; the other labels carry something the title doesn't.
// Reschedule is handled separately (Currently / Requested via RequestedRows);
// Rejected and Withdrawn carry no appointment story worth a row, so none.
function appointmentSummary(
  status: string,
  referral: Referral,
): { label: string | null; value: string; struck?: boolean } | null {
  if (status === 'Rejected' || status === 'Withdrawn') return null

  const live = formatDateTime(referral.appointmentDate, referral.appointmentTime)
  const original = formatDateTime(referral.originalAppointmentDate, referral.originalAppointmentTime)

  switch (status) {
    case 'Scheduled':
      return { label: null, value: live ?? '—' }
    case 'Completed':
      return { label: 'Completed', value: live ?? '—' }
    case 'Missed Appointment':
      return { label: 'Missed', value: live ?? '—' }
    case 'Cancelled':
      // Appointment Date (a lookup through Saturday Schedule) is empty once the
      // slot was released; the Original * fields are what's left.
      return { label: 'Original', value: (live ?? original) ?? '—', struck: true }
    case 'Submitted':
    case 'Scheduling':
      return { label: 'Appointment', value: live ?? 'Not yet scheduled' }
    default:
      return { label: 'Appointment', value: live ?? '—' }
  }
}

// Foot of the Appointment card on terminal referrals — the page otherwise just
// stops without saying what to do next. Nothing for a no-show still inside the
// reschedule window: the Reschedule button is the next step there.
function resubmitGuidance(
  status: string,
  missedInRescheduleWindow: boolean,
): { prefix: string; suffix: string | null } | null {
  if (status === 'Cancelled' || status === 'Withdrawn') {
    return { prefix: 'To restart this request, email', suffix: ONLINE_SUBMISSION_COMING_SOON }
  }
  if (status === 'Rejected') {
    return { prefix: 'To discuss this referral or submit a new one, email', suffix: null }
  }
  if (status === 'Missed Appointment' && !missedInRescheduleWindow) {
    return {
      prefix: 'The reschedule window has closed. To restart this request, email',
      suffix: ONLINE_SUBMISSION_COMING_SOON,
    }
  }
  return null
}

// DOB is stored as MDY text on Clients; <input type="date"> wants ISO.
function dobToInputValue(dob: string | null): string {
  if (!dob) return ''
  const mdy = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(dob)
  if (isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function inputValueToMDY(input: string): string {
  if (!input) return ''
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return input
  const [, y, m, d] = iso
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function parseItemsToSet(items: unknown): Set<string> {
  if (Array.isArray(items)) return new Set(items.map(String))
  if (typeof items === 'string') {
    return new Set(items.split(',').map(s => s.trim()).filter(Boolean))
  }
  return new Set()
}

// The pill is a solid fill now (see the header render), so badgeBg is a real
// colour and badgeText is white throughout. `accent` — the 4px card top-border
// on the Client Information card — is unchanged; it is still a tint-friendly
// value used on white.
//
// The amber statuses fill with #8B7724, not the brand gold #C9A84C: white text
// on #C9A84C fails contrast, #8B7724 clears it.
const STATUS_COLORS: Record<string, { badgeBg: string; badgeText: string }> = {
  Submitted:  { badgeBg: '#8B7724', badgeText: '#FFFFFF' },
  Scheduling: { badgeBg: '#5B8DB8', badgeText: '#FFFFFF' },
  Scheduled:  { badgeBg: '#2A7F6F', badgeText: '#FFFFFF' },
  // Reached once an agency has asked for a new date and Furniture Assist has
  // not acted on it yet.
  Reschedule: { badgeBg: '#8B7724', badgeText: '#FFFFFF' },
  // Airtable's 'No Show', softened to "Missed Appointment" for the agency (see
  // the status remap in the page body) — a lapsed visit that may still be
  // picked back up inside the window, not a hard failure.
  'Missed Appointment': { badgeBg: '#8B7724', badgeText: '#FFFFFF' },
  Completed:  { badgeBg: '#1B2B4B', badgeText: '#FFFFFF' },
  Cancelled:  { badgeBg: '#C0392B', badgeText: '#FFFFFF' },
  Rejected:   { badgeBg: '#C0392B', badgeText: '#FFFFFF' },
}

// ---------------------------------------------------------------- UI atoms

// `fullWidth` makes a row span both columns of .fa-inforow-pairs. Only Address
// uses it — it is the one row whose value runs to two lines. Below 1280px the
// pairs grid collapses to a single column and the flag stops mattering.
function InfoRow({ label, value, fullWidth }: {
  label: string
  value: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1', gridColumn: fullWidth ? '1 / -1' : undefined }}>
      {/* Label width lives in globals.css (.fa-inforow-label) so it can narrow below 1280px. */}
      <div className="fa-inforow-label" style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1, minWidth: 0 }}>
        {value || '—'}
      </div>
    </div>
  )
}

function Card({ accent, title, headerRight, children }: {
  accent?: string
  title: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
      {accent && <div style={{ background: accent, height: '4px' }} />}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>{title}</h2>
        {headerRight}
      </div>
      <div style={{ padding: '16px 24px' }}>{children}</div>
    </div>
  )
}

function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>
      {label}
    </button>
  )
}

function LockedBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#9AA6B2', flexShrink: 0 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      Locked
    </span>
  )
}

// Header action buttons. Three tiers, all sharing one geometry — 7px 16px,
// radius 7px, Montserrat 700 at 11px, transparent fill — so the row reads as
// one outlined control group whatever mix of buttons a given status shows:
//
//   doc    — navy outline, for the "here is your paperwork" links
//            (Appointment Slip, Client Receipt). Opens in a new tab.
//   amber  — the reschedule request.
//   danger — cancel / withdraw.
//
// Hover is the one thing an inline style can't carry, so the tint rides on
// local state. #FDF8EC (amber) and #FDF2F0 (danger) are Ben's picks and are
// not otherwise in the codebase; #F7F5F1 is the brand cream.
//
// The amber border sits at 0.9 rather than the 0.55 the navy and red carry:
// gold reads lighter at equal opacity and needs the extra weight to hold the
// same visual level in the row.
const HEADER_BTN_TIERS = {
  doc:    { hoverBg: '#F7F5F1', border: 'rgba(27,43,75,0.55)',   color: '#1B2B4B' },
  amber:  { hoverBg: '#FDF8EC', border: 'rgba(201,168,76,0.9)',  color: '#7A6A28' },
  danger: { hoverBg: '#FDF2F0', border: 'rgba(192,57,43,0.55)',  color: '#C0392B' },
} as const

function HeaderButton({ tier, onClick, href, children }: {
  tier: keyof typeof HEADER_BTN_TIERS
  onClick?: () => void
  href?: string
  children: React.ReactNode
}) {
  const t = HEADER_BTN_TIERS[tier]
  const [hover, setHover] = useState(false)
  const style: React.CSSProperties = {
    padding: '7px 16px', borderRadius: '7px', border: `1px solid ${t.border}`,
    background: hover ? t.hoverBg : 'transparent', color: t.color,
    fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px',
    cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
    flexShrink: 0,
  }
  const hoverProps = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }
  return href
    ? <a href={href} target="_blank" rel="noreferrer" style={style} {...hoverProps}>{children}</a>
    : <button type="button" onClick={onClick} style={style} {...hoverProps}>{children}</button>
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EDE9E1',
  fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: 'white',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '8px 0', alignItems: 'center' }}>
      <div className="fa-inforow-label" style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function SaveBar({ onSave, onCancel, saving }: { onSave: () => void; onCancel: () => void; saving: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
      <button onClick={onCancel} disabled={saving}
        style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
        Cancel
      </button>
      <button onClick={onSave} disabled={saving}
        style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}

function SaveError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '10px 14px', marginTop: '12px', fontSize: '12.5px', color: '#C0392B', lineHeight: 1.5 }}>
      {message}
    </div>
  )
}

// ------------------------------------------------------------ Client Info

type ClientEditState = {
  firstName: string; lastName: string; dob: string; phone: string; language: string
  address: string; address2: string; city: string; state: string; zip: string; county: string
  hhSize: string; children: string
}

function toClientEditState(r: Referral): ClientEditState {
  return {
    firstName: r.firstName ?? '', lastName: r.lastName ?? '',
    dob: dobToInputValue(r.dob), phone: r.phone ?? '', language: r.language ?? '',
    address: r.address ?? '', address2: r.address2 ?? '', city: r.city ?? '',
    state: r.state ?? 'NJ', zip: r.zip ?? '', county: r.county ?? '',
    hhSize: r.hhSize ?? '', children: r.children ?? '',
  }
}

function ClientInfoCard({ referral, locked, showLockedBadge, onSaved }: {
  referral: Referral
  locked: boolean
  showLockedBadge: boolean
  onSaved: (u: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ClientEditState>(() => toClientEditState(referral))

  const set = (k: keyof ClientEditState, v: string) => setForm(p => ({ ...p, [k]: v }))

  function startEdit() {
    setForm(toClientEditState(referral))
    setError(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: {
            firstName: form.firstName, lastName: form.lastName,
            dob: inputValueToMDY(form.dob), phone: form.phone, language: form.language,
            address: form.address, address2: form.address2, city: form.city,
            state: form.state, zip: form.zip, county: form.county,
          },
          hhSize: form.hhSize,
          children: form.children,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not save those changes.')
      }
      onSaved({
        firstName: form.firstName, lastName: form.lastName,
        clientName: `${form.firstName} ${form.lastName}`.trim(),
        // ISO here, not inputValueToMDY(form.dob): the PATCH body above writes
        // M/D/YYYY (Airtable's storage format) but the read lookup returns ISO,
        // so the in-memory copy has to be ISO to match a refetch.
        dob: form.dob || null, phone: form.phone || null,
        language: form.language || null, address: form.address || null,
        address2: form.address2 || null, city: form.city || null,
        state: form.state || null, zip: form.zip || null, county: form.county || null,
        hhSize: form.hhSize || null, children: form.children || null,
      })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <Card
        accent={locked ? READ_ACCENT : EDIT_ACCENT}
        title="Client Information"
        headerRight={locked ? (showLockedBadge ? <LockedBadge /> : null) : <EditButton onClick={startEdit} />}
      >
        {/* Two rows per line above 1280px, one below. Column count lives in
            globals.css (.fa-inforow-pairs). */}
        <div className="fa-inforow-pairs">
          <InfoRow label="Full Name" value={referral.clientName} />
          {/* formatDob (shared with the Dawson detail page) tolerates both the
              ISO the read lookup returns and the M/D/YYYY the edit round-trip
              writes back, so it stays "Mar 3, 1998" across a save. */}
          <InfoRow label="Date of Birth" value={formatDob(referral.dob)} />
          <InfoRow label="Phone" value={referral.phone} />
          <InfoRow label="Language" value={referral.language} />
          <InfoRow label="Address" fullWidth value={
            referral.address ? (
              <>{referral.address}{referral.address2 ? `, ${referral.address2}` : ''}<br />
              {referral.city}, {referral.state} {referral.zip}
              {referral.county ? ` · ${referral.county} County` : ''}</>
            ) : null
          } />
          <InfoRow label="Household Size" value={referral.hhSize} />
          <InfoRow label="Children" value={referral.children} />
        </div>
      </Card>
    )
  }

  return (
    <Card
      accent={EDIT_ACCENT}
      title="Client Information — Editing"
      headerRight={<SaveBar onSave={save} onCancel={() => setEditing(false)} saving={saving} />}
    >
      {/* A single stack of label-beside-control rows, matching the internal
          card. Multi-column grids were tried here and do not work: each row
          carries a fixed-width label, so two or three of them side by side
          leave the inputs a few pixels wide and push the whole page into
          horizontal scroll. Pairs that genuinely belong together (State/Zip,
          the two household counts) share one row via an inner flex instead,
          which is what the internal card does. */}
      <Field label="First Name">
        <input style={inputStyle} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
      </Field>
      <Field label="Last Name">
        <input style={inputStyle} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
      </Field>
      <Field label="Date of Birth">
        <input type="date" style={inputStyle} value={form.dob} onChange={e => set('dob', e.target.value)} />
      </Field>
      <Field label="Phone">
        <input style={inputStyle} value={form.phone}
          onChange={e => set('phone', e.target.value)}
          onBlur={e => set('phone', formatPhone(e.target.value))}
          placeholder="(555) 555-5555" />
      </Field>
      <Field label="Language">
        <select style={inputStyle} value={form.language} onChange={e => set('language', e.target.value)}>
          <option value="">—</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Address">
        <input style={inputStyle} value={form.address} onChange={e => set('address', e.target.value)} />
      </Field>
      <Field label="Address 2">
        <input style={inputStyle} value={form.address2} onChange={e => set('address2', e.target.value)} placeholder="Apt / Unit" />
      </Field>
      <Field label="City">
        <input style={inputStyle} value={form.city} onChange={e => set('city', e.target.value)} />
      </Field>
      {/* wrap + minWidth:0 on these paired rows: the control column is only
          about 150px on a phone once the label takes its share, which is
          narrower than a fixed select plus a second input. Without this the
          Zip clipped mid-value. Wrapping is width-independent, so it stays
          inline rather than going behind the media query. */}
      <Field label="State / Zip">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', rowGap: '8px' }}>
          <select style={{ ...inputStyle, width: '90px', flexShrink: 0 }} value={form.state} onChange={e => set('state', e.target.value)}>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={{ ...inputStyle, flex: 1, minWidth: '72px' }} value={form.zip}
            onChange={e => set('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric" maxLength={5} placeholder="07111" />
        </div>
      </Field>
      <Field label="County">
        <select style={inputStyle} value={form.county} onChange={e => set('county', e.target.value)}>
          <option value="">—</option>
          {NJ_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Household">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', rowGap: '8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input style={{ ...inputStyle, width: '70px', flexShrink: 0 }} inputMode="numeric" value={form.hhSize}
              onChange={e => set('hhSize', e.target.value)} placeholder="Total" />
            <span style={{ fontSize: '12px', color: '#7A8899', flexShrink: 0 }}>total,</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input style={{ ...inputStyle, width: '70px', flexShrink: 0 }} inputMode="numeric" value={form.children}
              onChange={e => set('children', e.target.value)} placeholder="Kids" />
            <span style={{ fontSize: '12px', color: '#7A8899', flexShrink: 0 }}>children</span>
          </span>
        </div>
      </Field>
      <SaveError message={error} />
    </Card>
  )
}

// -------------------------------------------------------- Items Requested

function ItemsRequestedCard({ referral, locked, showLockedBadge, onSaved }: {
  referral: Referral
  locked: boolean
  showLockedBadge: boolean
  onSaved: (u: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => parseItemsToSet(referral.items))

  function startEdit() {
    setSelected(parseItemsToSet(referral.items))
    setError(null)
    setEditing(true)
  }

  function toggle(item: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const items = ITEM_CATEGORIES.filter(i => selected.has(i))
      const res = await fetch(`/api/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not save those changes.')
      }
      onSaved({ items: items.join(', ') })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const list = [...parseItemsToSet(referral.items)]
    return (
      <Card
        accent={locked ? READ_ACCENT : EDIT_ACCENT}
        title="Items Requested"
        headerRight={locked ? (showLockedBadge ? <LockedBadge /> : null) : <EditButton onClick={startEdit} />}
      >
        {list.length > 0 ? (
          // Two bullets per line above 1280px, one below. Column count lives in
          // globals.css (.fa-items-requested-grid).
          <div className="fa-items-requested-grid">
            {list.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                <span style={{ color: '#2A7F6F', fontWeight: 700, flexShrink: 0 }}>•</span>
                <span style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.6 }}>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#7A8899' }}>No items specified</div>
        )}
      </Card>
    )
  }

  return (
    <Card
      accent={EDIT_ACCENT}
      title="Items Requested — Editing"
      headerRight={<SaveBar onSave={save} onCancel={() => setEditing(false)} saving={saving} />}
    >
      {/* Same checkbox rows as the New Referral form; column count lives in
          globals.css (.fa-form-items-grid). */}
      <div className="fa-form-items-grid" style={{ display: 'grid', gap: '10px' }}>
        {ITEM_CATEGORIES.map(item => {
          const on = selected.has(item)
          return (
            <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${on ? '#2A7F6F' : '#EDE9E1'}`, background: on ? '#EAF4F2' : 'white' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(item)} style={{ display: 'none' }} />
              <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${on ? '#2A7F6F' : '#EDE9E1'}`, background: on ? '#2A7F6F' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {on && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <span style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: on ? 600 : 400 }}>{item}</span>
            </label>
          )
        })}
      </div>
      <SaveError message={error} />
    </Card>
  )
}

// -------------------------------------------------------------- Your Notes

// Rendered only when editable, or when read-only with notes already on file
// (the caller gates that — see showNotesCard). `editable` follows
// agencyNotesEditable, which is laxer than the other cards' lock: no Monday
// cutoff, just a terminal-state one. Read-only means content but no Edit
// button and no lock badge — an empty read-only card says nothing, so it
// isn't shown at all.
function YourNotesCard({ referral, editable, onSaved }: {
  referral: Referral
  editable: boolean
  onSaved: (u: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState(referral.externalNotes ?? '')

  function startEdit() {
    setText(referral.externalNotes ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalNotes: text }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not save those changes.')
      }
      onSaved({ externalNotes: text.trim() || null })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <Card
        accent={editable ? EDIT_ACCENT : READ_ACCENT}
        title="Your Notes"
        headerRight={editable ? <EditButton onClick={startEdit} label={referral.externalNotes ? 'Edit' : '+ Add'} /> : undefined}
      >
        {referral.externalNotes ? (
          <div style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{referral.externalNotes}</div>
        ) : (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>No notes submitted.</div>
        )}
      </Card>
    )
  }

  return (
    <Card
      accent={EDIT_ACCENT}
      title="Your Notes — Editing"
      headerRight={<SaveBar onSave={save} onCancel={() => setEditing(false)} saving={saving} />}
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        placeholder="Anything Furniture Assist should know about this client or delivery."
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
      />
      <SaveError message={error} />
    </Card>
  )
}

// ----------------------------------------------------------- Items Received

// Completed referrals only. Shows what the client actually left with, from the
// per-item number fields on the referral, grouped by room. getReferralById
// already drops zero/blank quantities, so a client who took three things gets
// three lines rather than a grid of noughts.
function ItemsReceivedCard({ disbursed }: { disbursed: ItemsDisbursed | null }) {
  const groups = CATALOG
    .map(g => ({
      title: g.title,
      items: [...(((disbursed?.[g.key as keyof ItemsDisbursed] ?? []) as DisbursedLine[]))]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))
    .filter(g => g.items.length > 0)

  const lineCount = groups.reduce((s, g) => s + g.items.length, 0)
  const unitCount = groups.reduce(
    (s, g) => s + g.items.reduce((t, i) => t + (Number(i.qty) || 0), 0), 0,
  )

  return (
    <Card accent={READ_ACCENT} title="Items Received">
      {lineCount === 0 ? (
        <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>
          No items were recorded for this appointment.
        </div>
      ) : (
        <>
          {/* Column count lives in globals.css (.fa-disbursed-columns). */}
          <div className="fa-disbursed-columns">
            {groups.map(g => (
              <div key={g.title} style={{ breakInside: 'avoid', marginBottom: '14px' }}>
                <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: EDIT_ACCENT, marginBottom: '6px' }}>
                  {g.title}
                </div>
                {g.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '12.5px', color: '#2C3A4A', padding: '3px 0', borderBottom: '1px dotted #EDE9E1', gap: '8px' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    <span style={{ fontWeight: 700, color: '#1B2B4B', flexShrink: 0 }}>{it.qty}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {disbursed?.otherItems && (
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #EDE9E1' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: EDIT_ACCENT, marginBottom: '6px' }}>Other Items</div>
              <div style={{ fontSize: '13px', color: '#2C3A4A', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{disbursed.otherItems}</div>
            </div>
          )}

          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #EDE9E1', fontSize: '11.5px', color: '#7A8899' }}>
            <strong style={{ color: '#1B2B4B' }}>{unitCount}</strong> item{unitCount === 1 ? '' : 's'} across{' '}
            <strong style={{ color: '#1B2B4B' }}>{groups.length}</strong> categor{groups.length === 1 ? 'y' : 'ies'}
          </div>
        </>
      )}
    </Card>
  )
}

// The Appointment card's Date/Time rows while a reschedule request is open.
// `Currently` is the appointment the client still holds; `Requested` is what
// the agency asked for. Same helper the Reschedule Requested cards on the
// referral list use, so the two surfaces cannot drift.
function RequestedRows({ referral }: { referral: Referral }) {
  const slot = requestedSlot(referral)

  const requested =
    slot.kind === 'date' ? (
      <>
        {formatDate(slot.date)}
        {slot.time ? ` · ${slot.time}` : ''}
        {!slot.time && <span style={{ color: '#7A8899' }}> · any time</span>}
      </>
    ) : slot.kind === 'flexible' ? (
      <span style={{ color: '#7A8899' }}>Any Saturday</span>
    ) : (
      // Nothing recorded — a scanned reschedule whose date could not be read
      // lands here. Says so rather than inventing a preference.
      <span style={{ color: '#7A8899' }}>No date requested</span>
    )

  return (
    <>
      <InfoRow
        label="Currently"
        value={
          referral.appointmentDate ? (
            <>
              {formatDate(referral.appointmentDate)}
              {referral.appointmentTime ? ` · ${referral.appointmentTime}` : ''}
            </>
          ) : null
        }
      />
      <InfoRow label="Requested" value={<span style={{ fontWeight: 700 }}>{requested}</span>} />
    </>
  )
}

function DocLink({ href, label, color }: { href: string; label: string; color: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color, textDecoration: 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      {label}
    </a>
  )
}

// ------------------------------------------------------------------- page

export default function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [referral, setReferral] = useState<Referral | null>(null)
  const [referralId, setReferralId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ open: false, type: null, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleModalState>({ open: false, id: '', name: '' })
  const [actionLoading, setActionLoading] = useState(false)
  // A cancel / withdraw / reschedule that did not go through. Cleared when a
  // modal opens; while it is set the modal stays open and shows it.
  const [actionError, setActionError] = useState<string | null>(null)
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])

  useEffect(() => {
    params.then(({ id }) => {
      setReferralId(id)
      fetch(`/api/referrals/${id}`, { cache: 'no-store' })
        .then(async r => {
          if (!r.ok) {
            const data = await r.json().catch(() => ({}))
            setError(data.error ?? 'Failed to load referral')
            setLoading(false)
            return
          }
          return r.json()
        })
        .then(data => { if (data) { setReferral(data); setLoading(false) } })
        // Without this a dropped connection leaves "Loading referral..." on
        // screen forever — the !r.ok branch above only covers a response that
        // actually arrived.
        .catch(() => { setError('Could not load this referral. Check your connection and try again.'); setLoading(false) })
    })
    // Saturdays for the reschedule picker. leadDays=14 matches ReferralTable —
    // agencies need more notice than Dawson does.
    //
    // Must be the AGENCY endpoint. /api/dawson/schedule/available is behind
    // the staff allowlist and answers an agency session with 403, which is
    // what left this picker empty. The agency route also enforces the 50-per-
    // Saturday limit, which the Dawson one deliberately does not.
    fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [params])

  function refetch() {
    if (!referralId) return
    fetch(`/api/referrals/${referralId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setReferral(data))
      .catch(() => {})
  }

  // The response used to be discarded, so a 403, a failed Airtable write or a
  // dropped connection closed the dialog exactly as success does and the
  // agency believed the appointment was cancelled. Same fix as
  // components/agency/ReferralTable.tsx, which offers the same three actions.
  async function handleConfirmAction() {
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/referrals/${confirmModal.id}/${confirmModal.type}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || 'That did not go through. Please try again.')
        return
      }
      setConfirmModal({ open: false, type: null, id: '', name: '' })
      refetch()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRescheduleConfirm(
    preferredDate: string | null,
    flexible: boolean,
    preferredTime: string | null,
  ) {
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, preferredTime, flexible }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || 'That did not go through. Please try again.')
        return
      }
      setRescheduleModal({ open: false, id: '', name: '' })
      refetch()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  function applyUpdate(u: Partial<Referral>) {
    setReferral(prev => prev ? { ...prev, ...u } : prev)
  }

  if (loading) return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center text-[#7A8899]">
      Loading referral...
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center text-[#C0392B]">
      {error}
    </div>
  )

  if (!referral) return null

  const rawStatus = getPortalStatus(referral.referralReview, referral.appointmentStatus)
  // Airtable calls a lapsed appointment 'No Show'; the agency portal shows the
  // softer "Missed Appointment". getPortalStatus() passes 'No Show' straight
  // through (it is already the Airtable value), so the relabelling happens
  // here, at the portal boundary — the same place 'Pending Schedule' becomes
  // 'Scheduling'. Everything below keys off `status`.
  const status = rawStatus === 'No Show' ? 'Missed Appointment' : rawStatus
  const colors = STATUS_COLORS[status] ?? { badgeBg: '#F0F0F0', badgeText: '#7A8899' }

  // The Appointment card's single combined row. Null for Reschedule (which uses
  // RequestedRows instead) and for Rejected / Withdrawn (no row at all).
  const appointment = status === 'Reschedule' ? null : appointmentSummary(status, referral)

  // Review Status row (Referral Details card): whether Furniture Assist has
  // approved the referral is a live question while it's in flight, but a
  // terminal outcome supersedes it — Rejected excepted, since there the review
  // IS the outcome. Submitted / Referred By still render in every state.
  const showReviewStatus =
    status === 'Submitted' || status === 'Scheduling' || status === 'Scheduled' ||
    status === 'Reschedule' || status === 'Rejected'

  // Your Notes: editable on its own laxer rule (agencyNotesEditable — no Monday
  // cutoff, just terminal states). On a terminal referral the card is read-only
  // if notes exist and hidden entirely if they don't — an empty read-only card
  // is just wasted rail space.
  const notesEditable = agencyNotesEditable(referral.referralReview, referral.appointmentStatus)
  const showNotesCard = notesEditable || !!referral.externalNotes

  const editWindow = agencyEditWindow({
    portalStatus: status,
    appointmentDate: referral.appointmentDate,
  })
  const locked = !editWindow.editable
  // The Locked badge is only worth showing when editing was actively cut off
  // while the referral was still live — a Scheduled referral past the Monday
  // deadline, which also gets the explanatory banner below. On a Completed or
  // Cancelled referral there is nothing to "lock": the record is closed, the
  // status pill already says so, and the badge was just noise.
  const showLockedBadge = locked && status !== 'Completed' && status !== 'Cancelled'

  // Header actions, by portal status:
  //
  //   Scheduled          Appointment Slip · Reschedule · Cancel
  //   Scheduling         Reschedule · Cancel
  //   Submitted          Withdraw Referral
  //   Reschedule         Cancel
  //   Completed          Client Receipt
  //   Missed Appointment Reschedule, only within the 25-day window
  //   Cancelled/Rejected —
  //
  // Reschedule and Cancel still line up with what ReferralTable offers for the
  // same referral. The two document buttons render only when the underlying
  // attachment URL is present.
  const missedInRescheduleWindow =
    status === 'Missed Appointment' && withinNoShowRescheduleWindow(referral.appointmentDate)

  const guidance = resubmitGuidance(status, missedInRescheduleWindow)

  const isReschedulable =
    status === 'Scheduling' || status === 'Scheduled' || missedInRescheduleWindow
  const isCancellable =
    status === 'Scheduling' || status === 'Scheduled' || status === 'Reschedule'
  const isWithdrawable = status === 'Submitted'

  const showApptSlipButton = status === 'Scheduled' && !!referral.appointmentSlipUrl
  const showClientReceiptButton = status === 'Completed' && !!referral.clientReceiptUrl

  const showItemsReceived = status === 'Completed'

  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      <ConfirmModal
        modal={confirmModal}
        onConfirm={handleConfirmAction}
        onClose={() => { setActionError(null); setConfirmModal({ open: false, type: null, id: '', name: '' }) }}
        loading={actionLoading}
        error={actionError}
      />
      <RescheduleModal
        modal={rescheduleModal}
        availableDates={availableDates}
        onConfirm={handleRescheduleConfirm}
        onClose={() => { setActionError(null); setRescheduleModal({ open: false, id: '', name: '' }) }}
        loading={actionLoading}
        submitError={actionError}
      />

      {/* ------------------------------------------------------------------
          Page header.

          Status and the action buttons used to sit at the top of the LEFT
          column, i.e. inside the scrolling body and competing with the cards
          for attention. They live up here now, the way the internal detail
          page does it, so "what state is this in and what can I do about it"
          is answered before anything else on the page.

          Sticky at 1280 and up only — see .fa-detail-header in globals.css.
          Below that the shell's own navy top bar is the sticky one, and this
          header scrolls with the page.

          The flex layout lives in globals.css, not here, so the media query can
          reshape it. Desktop is one row — name at the left, actions + pill
          clustered right (.fa-detail-header-actions carries margin-left: auto),
          pill last with a 20px gap. Below 1280 it becomes three stacked rows:
          [Back + name] / status pill / action buttons — the pill is ordered
          above the buttons there.

          The three children are siblings for that reason: the pill can't stay
          inside the actions group or it couldn't take its own row.
      ------------------------------------------------------------------- */}
      <header className="fa-detail-header" style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '18px 32px' }}>
        <div className="fa-detail-header-left" style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/referrals/active')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.7)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <div className="fa-detail-header-name" style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, color: '#1B2B4B', minWidth: 0 }}>{referral.clientName}</div>
        </div>

        <div className="fa-detail-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {showApptSlipButton && (
            <HeaderButton tier="doc" href={referral.appointmentSlipUrl!}>Appointment Slip</HeaderButton>
          )}
          {isReschedulable && (
            <HeaderButton tier="amber" onClick={() => setRescheduleModal({ open: true, id: referral.id, name: referral.clientName })}>
              Reschedule
            </HeaderButton>
          )}
          {isCancellable && (
            <HeaderButton tier="danger" onClick={() => setConfirmModal({ open: true, type: 'cancel', id: referral.id, name: referral.clientName })}>
              Cancel
            </HeaderButton>
          )}
          {isWithdrawable && (
            <HeaderButton tier="danger" onClick={() => setConfirmModal({ open: true, type: 'withdraw', id: referral.id, name: referral.clientName })}>
              Withdraw Referral
            </HeaderButton>
          )}
          {showClientReceiptButton && (
            <HeaderButton tier="doc" href={referral.clientReceiptUrl!}>Client Receipt</HeaderButton>
          )}
        </div>

        <span className="fa-detail-status-pill" style={{ padding: '6px 16px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
          {status}
        </span>
      </header>

      {/* Column tracks and the width cap live in globals.css
          (.fa-referral-detail-grid) so they can stack below 1280px. */}
      <div className="fa-referral-detail-grid" style={{ padding: '28px 32px', margin: '0 auto', display: 'grid', gap: '20px', alignItems: 'start' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Why the Edit buttons are gone. Said once here rather than on each
              card, and only when a cutoff actually caused it. */}
          {locked && editWindow.reason === 'past-cutoff' && (
            <div style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: '10px', padding: '12px 16px', fontSize: '12.5px', color: '#7A6A28', lineHeight: 1.6 }}>
              Editing closed on {formatDate(editWindow.cutoffDate)}, the Monday before this appointment.
              Contact Furniture Assist if something needs to change.
            </div>
          )}

          <ClientInfoCard referral={referral} locked={locked} showLockedBadge={showLockedBadge} onSaved={applyUpdate} />
          <ItemsRequestedCard referral={referral} locked={locked} showLockedBadge={showLockedBadge} onSaved={applyUpdate} />
          {showItemsReceived && <ItemsReceivedCard disbursed={referral.itemsDisbursed} />}
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <Card accent={READ_ACCENT} title="Referral Details">
            <InfoRow label="Submitted" value={formatDate(referral.referralDate)} />
            <InfoRow label="Referred By" value={referral.referredBy} />
            {showReviewStatus && (
              <InfoRow label="Review Status" value={
                <span style={{ fontWeight: 700, color: referral.referralReview === 'Approved' ? '#2A7F6F' : referral.referralReview === 'Rejected' ? '#C0392B' : '#C9A84C' }}>
                  {referral.referralReview}
                </span>
              } />
            )}
          </Card>

          <Card accent={READ_ACCENT} title="Appointment">
            {/* No Status row — the header pill already carries status, and the
                raw Airtable value ("No Show", "Pending Schedule") only diverged
                from it and read as a second, contradictory status.

                Date and Time are one row now, weighted up (navy, 16px, bold in
                every state) — for most states it's the only row in the card and
                the single most important fact for an agency user. The label
                says what the date means (Completed / Missed / Original); the
                Scheduled state drops it because "Appointment" would only repeat
                the card title. See appointmentSummary().

                Reschedule keeps its own two-row Currently / Requested treatment
                via RequestedRows: a request changes nothing until Dawson acts,
                and an agency reading only "Requested Oct 3" could tell a client
                not to come on the Sep 26 they still hold. */}
            {status === 'Reschedule' ? (
              <RequestedRows referral={referral} />
            ) : appointment && (
              <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
                {appointment.label && (
                  <div className="fa-inforow-label" style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '3px' }}>
                    {appointment.label}
                  </div>
                )}
                <div style={{
                  fontSize: '16px', fontWeight: 700, flex: 1, minWidth: 0, color: '#1B2B4B',
                  textDecoration: appointment.struck && appointment.value !== '—' ? 'line-through' : undefined,
                }}>
                  {appointment.value}
                </div>
              </div>
            )}

            {/* The appointment slip and the client receipt used to link from
                here. Both are header buttons now (Scheduled → Appointment Slip,
                Completed → Client Receipt), so the card would only have shown
                the same link twice. The completed data-page link below has no
                header equivalent and stays. Nothing is deleted on the record —
                the attachments are untouched and the internal page still links
                to them. */}
            {referral.dataPageUrl && status === 'Completed' && (
              <div style={{ paddingTop: '8px' }}>
                <DocLink href={referral.dataPageUrl} label="View Completed Form" color="#5B8DB8" />
              </div>
            )}

            {/* Terminal-state guidance. A footnote, not a data row — hence the
                rule above it (only when there's a row to separate from; on
                Rejected / Withdrawn the card has no date row and this is the
                only line). */}
            {guidance && (
              <div style={{
                ...(appointment ? { borderTop: '1px solid #EDE9E1', marginTop: '12px', paddingTop: '12px' } : {}),
                fontSize: '12.5px', color: '#7A8899', lineHeight: 1.6,
              }}>
                {guidance.prefix}{' '}
                <a href={`mailto:${AGENCY_CONTACT_EMAIL}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>
                  {AGENCY_CONTACT_EMAIL}
                </a>.{guidance.suffix ? ` ${guidance.suffix}` : ''}
              </div>
            )}
          </Card>

          {/* Notes sit here, under Appointment, rather than at the foot of the
              left column. Ben: "notes on far right under the appt I think makes
              better use of space."

              The left column carries Client Information, Items Requested and —
              on a completed referral — Items Received, which is the tallest
              card on the page. The right column held two short cards and then
              stopped, so notes ran off the bottom of a screen that had a column
              of empty space beside it. Below 1280px the two columns stack into
              one, so on a phone this only moves notes further down the page. */}
          {showNotesCard && (
            <YourNotesCard referral={referral} editable={notesEditable} onSaved={applyUpdate} />
          )}

          {referral.possibleDuplicate && (
            <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#C0392B', marginBottom: '6px' }}>⚠ Possible Duplicate</div>
              <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6 }}>Our team has flagged this as a possible duplicate and will review before processing.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
