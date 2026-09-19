'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import CancelModal from '@/components/internal/modals/CancelModal'
import PickSlotModal from '@/components/internal/modals/PickSlotModal'
import { DAWSON_PAGE_BAR_HEIGHT } from '@/components/internal/DawsonPageBar'
import CompactTimeline, { type TimelineSegment } from '@/components/internal/CompactTimeline'
import { CATALOG } from '@/lib/catalog/items-disbursed'
import { easternTodayISO, formatDob, differenceInDaysISO } from '@/lib/dates'
import {
  NO_SHOW_RESCHEDULE_WINDOW_DAYS, withinNoShowRescheduleWindow, isAwaitingOutcome,
} from '@/lib/referrals/no-show-window'
import { agencyReferralActions } from '@/lib/referrals/agency-actions'
import { getPortalStatus, dawsonEditWindow, type EditWindow } from '@/lib/referrals/edit-window'
import { TIME_CAPS, VALID_TIMES, type TimeSlot } from '@/lib/schedule/capacity'
import type { AvailableDate } from '@/lib/schedule/available'


type ItemsDisbursed = {
  livingRoom: { name: string; qty: string | number }[]
  bedroom: { name: string; qty: string | number }[]
  diningRoom: { name: string; qty: string | number }[]
  kitchen: { name: string; qty: string | number }[]
  linens: { name: string; qty: string | number }[]
  misc: { name: string; qty: string | number }[]
  volunteerInitials: string | null   // legacy — removed from sheet redesign July 2026
  checkInTime: string | null
  checkoutTime: string | null
  otherItems: string | null
  distributionNotes: string | null
}


type Referral = {
  id: string
  clientId: string | null                    // NEW: rec ID of the linked Client — needed for PATCH
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
  internalNotes: string | null
  referralDate: string
  referralReview: string
  appointmentStatus: string
  // Raw, live Appointment Date/Time — "is there a live booking right now."
  // Empties on cancel/withdraw. Used for apptDatePassed / daysSinceNoShow,
  // NOT for the meta strip's Appointment cell — see effectiveAppointmentDate.
  appointmentDate: string | null
  appointmentTime: string | null
  // The live Appointment Date coalesced with the Original snapshot —
  // "what slot is or was this referral for," the display question. Reads
  // the same {Effective Appointment Date} formula the agency page and
  // referrals list use, so a cancelled referral shows the slot it was
  // booked for here instead of a blank cell.
  effectiveAppointmentDate: string | null
  // The slot this referral last held before a cancel/reschedule released
  // it. Single-value, overwritten every time — see the "Previously"
  // sub-line, which is the only honest way to show it.
  originalAppointmentDate: string | null
  originalAppointmentTime: string | null
  // What the agency ASKED for, as opposed to what is currently booked.
  // Only meaningful while Appointment Status is 'Reschedule'.
  preferredDate: string | null
  preferredTime: string | null
  schedulingFlexibility: string | null
  // Stamped when Appointment Status is set to 'Reschedule'. Single-value,
  // overwritten on every new request — no history of past requests, only
  // the current one if there is one.
  rescheduleRequestedAt: string | null
  appointmentSlipUrl: string | null
  // The post-visit receipt PDF. getReferralById() has always returned this —
  // the field was simply missing from this type, so the page dropped it on the
  // floor. No API change was needed to start using it, only this line.
  clientReceiptUrl: string | null
  dataPageUrl: string | null
  // June 2026: these four are LOOKUPS through Referring Staff Link.
  // All four will be null when the referral was imported without a usable
  // staff identity (Excel Branch c — no email, no name).
  referredBy: string | null
  referringAgency: string | null
  referringAgencyId: string | null           // for link to Agency detail page
  staffPhone: string | null
  agencyEmail: string | null
  referringStaffId: string | null            // link to Agency User — for Staff ID deep-link
  possibleDuplicate: boolean
  // Aug 2026: back these with two Airtable checkbox fields on Client
  // Referrals — "Ready for Post-Appt Email" (Dawson flips this after
  // auditing the pickup sheet against the portal) and "Post-Appt Email Sent"
  // (set by the future Tuesday batch send, not built yet). The GET route for
  // this page needs to map both through; see bottom-of-file note.
  readyForPostApptEmail: boolean
  postApptEmailSent: boolean
  // Aug 2026: the five milestone stamps behind the Email History card.
  // `cancellation` is null on every referral cancelled before 2026-08-14 —
  // the Airtable field was misspelled until then and never written to.
  emailSentAt: {
    confirmation: string | null
    reschedule: string | null
    reminder: string | null
    completed: string | null
    cancellation: string | null
  } | null
  itemsDisbursed: ItemsDisbursed | null
}


// One row of the Email Log table, as /api/dawson/referrals/[id]/emails
// returns it. Mirrors EmailLogEntry in lib/airtable/email-log.ts.
type EmailLogEntry = {
  id: string
  type: string | null
  status: string | null
  sentAt: string | null
  recipient: string | null
  bounceReason: string | null
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


// The 6 canonical Items Requested categories. MUST stay in sync with
// dawson-import-referrals-page.tsx CATEGORIES constant AND the agency
// submission form. Any change here needs to be mirrored there.
const ITEM_CATEGORIES = [
  'Bedroom Furniture',
  'Living Room Furniture',
  'Dining Room Furniture',
  'Clothes',
  'Household Items (including kitchen & linens)',
  'Baby Items',
]


// NJ counties. Dawson works exclusively in NJ; if the org expands out-of-
// state, add "Other" or convert this to a free-text field.
const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May', 'Cumberland',
  'Essex', 'Gloucester', 'Hudson', 'Hunterdon', 'Mercer', 'Middlesex',
  'Monmouth', 'Morris', 'Ocean', 'Passaic', 'Salem', 'Somerset',
  'Sussex', 'Union', 'Warren',
]


const LANGUAGES = ['English', 'Spanish', 'Haitian Creole', 'French', 'Arabic', 'Portuguese', 'Other']


const STATES = ['NJ', 'NY', 'PA', 'CT', 'DE']


// The gate for whether a No Show is still fresh enough to act on / edit here
// is the shared no-show reschedule window — NO_SHOW_RESCHEDULE_WINDOW_DAYS,
// imported above. Same window the Add Referral flow and the History page use,
// so a No Show that's aged out of "reschedule in place" there doesn't still
// show live Reschedule/Cancel actions -- or editable fields -- here.


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "requested 6 days ago" / "requested today" — mirrors Needs Action's own
// local daysAgo/agePhrase (app/dawson/needs-action/page.tsx) rather than a
// shared helper, since neither is exported there; same voice, not a new
// convention. rescheduleRequestedAt is a real instant (dateTime), not a
// date-only value, so this slices to the date portion the same way
// Needs Action's own daysAgo does before diffing.
function requestAge(iso: string | null, todayISO: string): string | null {
  if (!iso) return null
  const days = differenceInDaysISO(iso.slice(0, 10), todayISO)
  if (days === null) return null
  if (days <= 0) return 'requested today'
  if (days === 1) return 'requested yesterday'
  return `requested ${days} days ago`
}


// DOB comes from AT in "M/D/YYYY" format (created by our toMDY helper).
// The native <input type="date"> needs YYYY-MM-DD. These two convert both ways.
function dobToInputValue(dob: string | null): string {
  if (!dob) return ''
  // Try MDY first (our storage format), then fall back to native Date parse
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


// Format phone as (XXX) XXX-XXXX on blur. Strips non-digits.
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw // leave as-typed if not exactly 10
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}


// "4 · 2 children" — collapses two rows into one. Both values are optional and
// arrive as strings from Airtable, so every combination has to degrade
// cleanly: total only, children only, or neither.
function householdSummary(r: { hhSize: string | null; children: string | null }): React.ReactNode {
  const size = (r.hhSize ?? '').trim()
  const kids = (r.children ?? '').trim()
  const kidsNum = parseInt(kids, 10)
  const hasKids = kids !== '' && !Number.isNaN(kidsNum)

  if (size === '' && !hasKids) return null

  const parts: string[] = []
  if (size !== '') parts.push(`${size} in household`)
  // "0 children" is worth stating explicitly — it's the difference between
  // "no kids" and "nobody filled this in".
  if (hasKids) parts.push(`${kidsNum} child${kidsNum === 1 ? '' : 'ren'}`)

  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: '#C9CFD6', margin: '0 7px' }}>·</span>}
          {p}
        </span>
      ))}
    </span>
  )
}


// Two-column layout for Items Requested. The category list is capped at 6, so
// a single column wasted half the card's width and made the block taller than
// the Client Information card beside it.
//
// gridAutoFlow: 'column' fills top-to-bottom then wraps, so 6 items read 1-2-3
// down the left and 4-5-6 down the right — not the 1-2 / 3-4 zigzag that row
// flow gives you. Row count is ceil(n/2) so the two columns stay balanced at
// any length: 4 items split 2/2, 5 split 3/2, 6 split 3/3.
function twoColumn(count: number): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: `repeat(${Math.max(1, Math.ceil(count / 2))}, auto)`,
    gridAutoFlow: 'column',
    columnGap: '20px',
    rowGap: '9px',
    padding: '4px 0',
  }
}


// getPortalStatus itself is imported from lib/referrals/edit-window.ts (the
// agency portal's own copy) rather than kept as a local duplicate — the two
// had drifted: the shared one checks Appointment Status === 'Reschedule'
// before Referral Review === 'Pending', so a referral in that combination
// resolves to 'Reschedule'; this page's old local copy checked review first
// and would have resolved to 'Submitted' instead. Every case reachable
// today produces the same output either way (checked live: zero referrals
// currently hold that combination), but nothing prevented it recurring, and
// importing removes the drift instead of documenting around it.


// Header pills. Two separate maps now, not one keyed on the collapsed portal
// status — the header shows the RAW Appointment Status (always) and the raw
// Referral Review (exception-only, hidden at 'Approved'), so each needs its
// own palette on its own vocabulary rather than getPortalStatus's merged one.
const APPOINTMENT_STATUS_COLORS: Record<string, { badgeBg: string; badgeText: string }> = {
  'Pending Schedule': { badgeBg: 'rgba(91,141,184,0.12)', badgeText: '#5B8DB8' },
  Scheduled:          { badgeBg: 'rgba(42,127,111,0.12)', badgeText: '#2A7F6F' },
  Reschedule:         { badgeBg: 'rgba(201,168,76,0.15)', badgeText: '#C9A84C' },
  Completed:          { badgeBg: 'rgba(27,43,75,0.08)',   badgeText: '#1B2B4B' },
  Cancelled:          { badgeBg: 'rgba(192,57,43,0.1)',   badgeText: '#C0392B' },
  'No Show':          { badgeBg: 'rgba(192,57,43,0.1)',   badgeText: '#C0392B' },
}
const REVIEW_STATUS_COLORS: Record<string, { badgeBg: string; badgeText: string }> = {
  Pending:   { badgeBg: 'rgba(201,168,76,0.15)', badgeText: '#C9A84C' },
  Rejected:  { badgeBg: 'rgba(192,57,43,0.1)',   badgeText: '#C0392B' },
  Withdrawn: { badgeBg: 'rgba(192,57,43,0.1)',   badgeText: '#C0392B' },
}


// Card accent colors. Teal = editable surfaces (guides Dawson's eye to
// "safe to touch" zones). Muted grey = read-only. See mockup for rationale.
const EDIT_ACCENT = '#2A7F6F'  // teal — editable card
const READ_ACCENT = '#7A8899'  // muted grey — read-only card


// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------


function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '130px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || '—'}
      </div>
    </div>
  )
}


function Card({
  accent,
  title,
  headerRight,
  children,
}: {
  accent: string
  title: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
      <div style={{ background: accent, height: '4px' }} />
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>{title}</h2>
        {headerRight}
      </div>
      <div style={{ padding: '12px 20px' }}>
        {children}
      </div>
    </div>
  )
}


function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
      {label}
    </button>
  )
}


// A closed card's edit window shows nothing in place of the Edit button —
// no icon, no reason line. Ben's call: he's the only one who edits these,
// he knows the rules, and the space is worth more than the signal. (An
// earlier round built a LockedBadge + reason line here; both are gone.)


// Reusable input style — keeps all inputs visually consistent
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EDE9E1',
  fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: 'white',
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '8px 0', alignItems: 'center' }}>
      <div style={{ width: '130px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Items Disbursed — display + inline edit
//
// This is the audit surface. Dawson reads the scanned pickup sheet next to the
// screen and corrects what OCR got wrong, instead of switching to Airtable.
//
// Display mode shows only what was actually given (non-zero). Edit mode shows
// the FULL 30-item catalog with steppers — because the catalog is fixed and
// small, an "add item" picker would be pure friction. Every item is one click
// away from 1. Both modes list items alphabetically within each category —
// display mode always did; edit mode is sorted here rather than in CATALOG
// itself so the catalog's own (unrelated) ordering doesn't have to change.
//
// No new Airtable fields: changed-row highlighting and the pending-changes
// summary are client-side session state that dies on save.
// ---------------------------------------------------------------------------

type Quantities = Record<string, number>   // Airtable field name -> qty

// Seed the edit form from the read shape. getReferralById() only returns
// non-zero items, so anything absent from the payload starts at 0.
function seedQuantities(d: ItemsDisbursed | null): Quantities {
  const byLabel = new Map<string, number>()
  if (d) {
    for (const g of CATALOG) {
      const rows = (d[g.key] ?? []) as { name: string; qty: string | number }[]
      for (const r of rows) {
        const n = typeof r.qty === 'number' ? r.qty : parseInt(String(r.qty), 10)
        byLabel.set(`${g.key}::${r.name}`, Number.isNaN(n) ? 0 : n)
      }
    }
  }
  const out: Quantities = {}
  for (const g of CATALOG) {
    for (const i of g.items) {
      out[i.field] = byLabel.get(`${g.key}::${i.label}`) ?? 0
    }
  }
  return out
}

function Stepper({ value, onChange, changed }: {
  value: number
  onChange: (n: number) => void
  changed: boolean
}) {
  const btn: React.CSSProperties = {
    width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #EDE9E1',
    background: 'white', color: '#7A8899', fontSize: '13px', lineHeight: 1,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, flexShrink: 0,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
      <button type="button" aria-label="Decrease" style={btn}
        onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) || n < 0 ? 0 : n)
        }}
        style={{
          width: '36px', textAlign: 'center', padding: '3px 0', borderRadius: '5px',
          border: `1px solid ${changed ? EDIT_ACCENT : '#EDE9E1'}`,
          fontSize: '12.5px', fontWeight: 700,
          color: value === 0 ? '#B9C2CC' : changed ? EDIT_ACCENT : '#1B2B4B',
          fontFamily: 'inherit', outline: 'none',
          MozAppearance: 'textfield' as React.CSSProperties['MozAppearance'],
        }}
      />
      <button type="button" aria-label="Increase" style={btn}
        onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

function ItemsDisbursedCard({
  referral,
  locked,
  onSaved,
}: {
  referral: Referral
  locked: boolean
  onSaved: (updated: Partial<Referral>) => void
}) {
  const d = referral.itemsDisbursed
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [qty, setQty] = useState<Quantities>(() => seedQuantities(d))
  const [baseline, setBaseline] = useState<Quantities>(() => seedQuantities(d))
  const [checkInTime, setCheckInTime] = useState(d?.checkInTime ?? '')
  const [checkoutTime, setCheckoutTime] = useState(d?.checkoutTime ?? '')
  const [otherItems, setOtherItems] = useState(d?.otherItems ?? '')
  const [distributionNotes, setDistributionNotes] = useState(d?.distributionNotes ?? '')

  function startEdit() {
    const seed = seedQuantities(d)
    setQty(seed)
    setBaseline(seed)
    setCheckInTime(d?.checkInTime ?? '')
    setCheckoutTime(d?.checkoutTime ?? '')
    setOtherItems(d?.otherItems ?? '')
    setDistributionNotes(d?.distributionNotes ?? '')
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }

  // Only fields that actually moved get sent. Keeps the PATCH small and keeps
  // Airtable's revision history meaningful.
  const changedFields = Object.keys(qty).filter(f => qty[f] !== baseline[f])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const quantities: Quantities = {}
      for (const f of changedFields) quantities[f] = qty[f]

      const res = await fetch(`/api/dawson/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsDisbursed: {
            quantities,
            checkInTime,
            checkoutTime,
            otherItems,
            distributionNotes,
          },
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        const msg = typeof j?.error === 'string' ? j.error : `Save failed (${res.status})`
        throw new Error(msg)
      }

      // Rebuild the read shape locally so the card updates without a refetch.
      const next: ItemsDisbursed = {
        livingRoom: [], bedroom: [], diningRoom: [], kitchen: [], linens: [], misc: [],
        volunteerInitials: d?.volunteerInitials ?? null,
        checkInTime: checkInTime || null,
        checkoutTime: checkoutTime || null,
        otherItems: otherItems || null,
        distributionNotes: distributionNotes || null,
      }
      for (const g of CATALOG) {
        next[g.key] = g.items
          .filter(i => (qty[i.field] ?? 0) > 0)
          .map(i => ({ name: i.label, qty: qty[i.field] }))
      }
      onSaved({ itemsDisbursed: next })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------- display
  if (!editing) {
    const groups = CATALOG
      .map(g => ({
        title: g.title,
        items: [...((d?.[g.key] ?? []) as { name: string; qty: string | number }[])]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      }))
      .filter(g => g.items.length > 0)

    const lineCount = groups.reduce((s, g) => s + g.items.length, 0)
    const unitCount = groups.reduce(
      (s, g) => s + g.items.reduce((t, i) => t + (Number(i.qty) || 0), 0), 0,
    )

    return (
      <Card
        accent={EDIT_ACCENT}
        title="Items Disbursed"
        headerRight={
          locked ? null : (
            <button onClick={startEdit}
              style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
              Edit Items
            </button>
          )
        }
      >
        {lineCount === 0 ? (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '10px 0' }}>
            Nothing recorded yet — add from the pickup sheet.
          </div>
        ) : (
          <div style={{ columnCount: 3, columnGap: '28px', padding: '6px 0' }}>
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
        )}

        {d?.otherItems && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #EDE9E1' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: EDIT_ACCENT, marginBottom: '6px' }}>Other Items</div>
            <div style={{ fontSize: '13px', color: '#2C3A4A', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{d.otherItems}</div>
          </div>
        )}

        {/* Renamed from "Internal Notes" — that label collided with the
            separate Internal Notes card in the left column and made it look
            like the same field was showing two different values. */}
        {d?.distributionNotes && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #EDE9E1' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7A8899', marginBottom: '6px' }}>Distribution Notes</div>
            <div style={{ fontSize: '13px', color: '#2C3A4A', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{d.distributionNotes}</div>
          </div>
        )}

        {lineCount > 0 && (
          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #EDE9E1', fontSize: '11.5px', color: '#7A8899' }}>
            <strong style={{ color: '#1B2B4B' }}>{unitCount}</strong> item{unitCount === 1 ? '' : 's'} across{' '}
            <strong style={{ color: '#1B2B4B' }}>{groups.length}</strong> categor{groups.length === 1 ? 'y' : 'ies'}
          </div>
        )}
      </Card>
    )
  }

  // ----------------------------------------------------------------- edit
  const timeInput: React.CSSProperties = {
    width: '78px', padding: '4px 6px', borderRadius: '5px', border: '1px solid #EDE9E1',
    fontSize: '12px', color: '#1B2B4B', fontFamily: 'inherit', outline: 'none',
  }

  return (
    <Card
      accent={EDIT_ACCENT}
      title="Items Disbursed — Editing"
      headerRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899' }}>In</span>
            <input value={checkInTime} onChange={e => setCheckInTime(e.target.value)} placeholder="9:11 AM" style={timeInput} />
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginLeft: '4px' }}>Out</span>
            <input value={checkoutTime} onChange={e => setCheckoutTime(e.target.value)} placeholder="10:00 AM" style={timeInput} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={cancelEdit} disabled={saving}
              style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 28px', padding: '4px 0' }}>
        {CATALOG.map(g => {
          // Sorted alphabetically per Dawson's request — the catalog's own
          // (category-internal) order isn't meaningful to the audit workflow.
          const sortedItems = [...g.items].sort((a, b) =>
            a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
          return (
            <div key={g.key} style={{ breakInside: 'avoid', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: EDIT_ACCENT, marginBottom: '6px' }}>
                {g.title}
              </div>
              {sortedItems.map(i => {
                const changed = qty[i.field] !== baseline[i.field]
                return (
                  <div key={i.field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '3px 0' }}>
                    <span style={{
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontSize: '12.5px',
                      color: changed ? EDIT_ACCENT : qty[i.field] > 0 ? '#2C3A4A' : '#9AA6B2',
                      fontWeight: changed ? 700 : 400,
                    }}>
                      {i.label}
                      {changed && (
                        <span style={{ fontSize: '10.5px', color: '#B9C2CC', marginLeft: '6px' }}>
                          was {baseline[i.field]}
                        </span>
                      )}
                    </span>
                    <Stepper value={qty[i.field]} changed={changed}
                      onChange={n => setQty(prev => ({ ...prev, [i.field]: n }))} />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '6px', paddingTop: '14px', borderTop: '1px solid #EDE9E1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: EDIT_ACCENT, marginBottom: '6px' }}>Other Items</div>
          <textarea value={otherItems} onChange={e => setOtherItems(e.target.value)} rows={3}
            placeholder="Anything not in the list above…"
            style={{ ...inputStyle, resize: 'vertical', fontSize: '13px', lineHeight: 1.5, padding: '8px 10px' }} />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7A8899', marginBottom: '6px' }}>Distribution Notes</div>
          <textarea value={distributionNotes} onChange={e => setDistributionNotes(e.target.value)} rows={3}
            placeholder="Notes from the pickup itself…"
            style={{ ...inputStyle, resize: 'vertical', fontSize: '13px', lineHeight: 1.5, padding: '8px 10px' }} />
        </div>
      </div>

      {changedFields.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #EDE9E1', fontSize: '11.5px', color: '#7A8899' }}>
          <strong style={{ color: EDIT_ACCENT }}>{changedFields.length}</strong> change{changedFields.length === 1 ? '' : 's'} pending
          {' · '}
          {changedFields.slice(0, 3).map(f => {
            const label = CATALOG.flatMap(g => g.items).find(i => i.field === f)?.label ?? f
            return `${label} ${baseline[f]} → ${qty[f]}`
          }).join(', ')}
          {changedFields.length > 3 && ` +${changedFields.length - 3} more`}
        </div>
      )}

      {error && (
        <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}



// ---------------------------------------------------------------------------
// Client Info — display + inline edit
// ---------------------------------------------------------------------------


type ClientEditState = {
  firstName: string
  lastName: string
  dob: string       // stored as YYYY-MM-DD for the <input>; converted to MDY on save
  phone: string
  language: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
  county: string
  hhSize: string
  children: string
}


function referralToClientEditState(r: Referral): ClientEditState {
  return {
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    dob: dobToInputValue(r.dob),
    phone: r.phone ?? '',
    language: r.language ?? '',
    address: r.address ?? '',
    address2: r.address2 ?? '',
    city: r.city ?? '',
    state: r.state ?? 'NJ',
    zip: r.zip ?? '',
    county: r.county ?? '',
    hhSize: r.hhSize ?? '',
    children: r.children ?? '',
  }
}


function ClientInfoCard({
  referral,
  locked,
  onSaved,
}: {
  referral: Referral
  locked: boolean
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ClientEditState>(referralToClientEditState(referral))


  function startEdit() {
    setForm(referralToClientEditState(referral))
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }


  async function save() {
    if (!referral.clientId) {
      setError('Cannot save — no linked Client record. Contact Ben.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Identity fields land on the Clients table.
      // Convert DOB back to MDY (our AT storage format).
      // Phone is formatted on blur but we normalize once more here just in case.
      const clientPayload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dob: form.dob ? inputValueToMDY(form.dob) : '',
        phone: form.phone ? formatPhone(form.phone) : '',
        language: form.language,
        address: form.address.trim(),
        address2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state,
        zip: form.zip.replace(/\D/g, '').slice(0, 5),
        county: form.county,
      }
      // # in HH and # Children are per-visit — they live on the Client
      // Referrals row, not on the Client. Send them separately.
      const referralPayload: Record<string, string> = {}
      if (form.hhSize !== (referral.hhSize ?? '')) referralPayload.hhSize = form.hhSize
      if (form.children !== (referral.children ?? '')) referralPayload.children = form.children


      // Fire both PATCHes in parallel. If either fails we surface the error.
      const requests: Promise<Response>[] = [
        fetch(`/api/dawson/clients/${referral.clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clientPayload),
        }),
      ]
      if (Object.keys(referralPayload).length > 0) {
        requests.push(
          fetch(`/api/dawson/referrals/${referral.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(referralPayload),
          }),
        )
      }
      const results = await Promise.all(requests)
      for (const res of results) {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          const msg = typeof j?.error === 'string'
            ? j.error
            : j?.error?.message ?? `Save failed (${res.status})`
          throw new Error(msg)
        }
      }
      // Reflect the change locally without a full refetch. Referral fields on
      // Client Referrals are lookups, so the display values come from Client —
      // updating them here keeps the UI in sync until the next fetch.
      onSaved({
        firstName: clientPayload.firstName,
        lastName: clientPayload.lastName,
        clientName: `${clientPayload.firstName} ${clientPayload.lastName}`.trim(),
        // ISO, not clientPayload.dob: the PATCH body writes M/D/YYYY (Airtable
        // storage) but the read lookup returns ISO, so the in-memory copy must
        // be ISO to match a refetch.
        dob: form.dob || null,
        phone: clientPayload.phone || null,
        language: clientPayload.language || null,
        address: clientPayload.address || null,
        address2: clientPayload.address2 || null,
        city: clientPayload.city || null,
        state: clientPayload.state || null,
        zip: clientPayload.zip || null,
        county: clientPayload.county || null,
        hhSize: form.hhSize || null,
        children: form.children || null,
      })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Client Information"
        headerRight={locked ? null : <EditButton onClick={startEdit} />}
      >
        {/* Order follows how Dawson actually uses the record: who and where
            first (that's what he's confirming against the pickup sheet), then
            how to reach them, then the demographics.

            County is deliberately NOT displayed — it's derivable from the zip
            and only matters for reporting, so it costs a row for nothing. It
            is still editable below; dropping it from the form would strand
            the existing data. */}
        <InfoRow label="Full Name" value={referral.clientName} />
        <InfoRow label="Address" value={
          referral.address ? (
            <>{referral.address}{referral.address2 ? `, ${referral.address2}` : ''}<br />
            {referral.city}, {referral.state} {referral.zip}</>
          ) : null
        } />
        <InfoRow label="Phone" value={referral.phone} />
        {/* formatDob tolerates both ISO (read lookup) and M/D/YYYY (edit
            round-trip), so DOB stays formatted across a save. */}
        <InfoRow label="Date of Birth" value={formatDob(referral.dob)} />
        <InfoRow label="Language" value={referral.language} />
        {/* Household size and children collapsed onto one row. Children is
            almost meaningless without the household total next to it, so the
            pair reads better combined than as two separate lines. */}
        <InfoRow label="Household" value={householdSummary(referral)} />
      </Card>
    )
  }


  // Edit mode
  return (
    <Card
      accent={EDIT_ACCENT}
      title="Client Information — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {/* Field order mirrors the display order above so the card doesn't
          reshuffle itself the moment you click Edit. */}
      <Field label="First Name">
        <input style={inputStyle} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
      </Field>
      <Field label="Last Name">
        <input style={inputStyle} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
      </Field>
      <Field label="Address">
        <input style={inputStyle} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Address 2">
        <input style={inputStyle} value={form.address2} onChange={e => setForm({ ...form, address2: e.target.value })} placeholder="Apt / Unit" />
      </Field>
      <Field label="City">
        <input style={inputStyle} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
      </Field>
      {/* State and Zip share a row — State is a 2-char select and Zip is 5
          digits, so a full-width input for either is wasted space. */}
      <Field label="State / Zip">
        <div style={{ display: 'flex', gap: '8px' }}>
          <select style={{ ...inputStyle, width: '90px', flexShrink: 0 }} value={form.state} onChange={e => setForm({ ...form, state: e.target.value })}>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={inputStyle} value={form.zip}
            onChange={e => setForm({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            inputMode="numeric" maxLength={5} placeholder="07111" />
        </div>
      </Field>
      <Field label="Phone">
        <input style={inputStyle} value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
          onBlur={e => setForm({ ...form, phone: formatPhone(e.target.value) })}
          placeholder="(555) 555-5555" />
      </Field>
      <Field label="Date of Birth">
        <input type="date" style={inputStyle} value={form.dob} onChange={e => setForm({ ...form, dob: e.target.value })} />
      </Field>
      <Field label="Language">
        <select style={inputStyle} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
          <option value="">—</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      {/* Hidden from the read view but still editable — county drives
          reporting and the existing data shouldn't be orphaned. */}
      <Field label="County">
        <select style={inputStyle} value={form.county} onChange={e => setForm({ ...form, county: e.target.value })}>
          <option value="">—</option>
          {NJ_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Household">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input style={{ ...inputStyle, width: '60px', flexShrink: 0, textAlign: 'center' }} value={form.hhSize}
            onChange={e => setForm({ ...form, hhSize: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            inputMode="numeric" aria-label="Household size" />
          <span style={{ fontSize: '12px', color: '#7A8899', whiteSpace: 'nowrap' }}>total</span>
          <input style={{ ...inputStyle, width: '60px', flexShrink: 0, textAlign: 'center', marginLeft: '6px' }} value={form.children}
            onChange={e => setForm({ ...form, children: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            inputMode="numeric" aria-label="Number of children" />
          <span style={{ fontSize: '12px', color: '#7A8899', whiteSpace: 'nowrap' }}>children</span>
        </div>
      </Field>
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Items Requested — display + inline edit (6-category checkbox multi-select)
// ---------------------------------------------------------------------------


function parseItemsToSet(items: unknown): Set<string> {
  // Defensive: `items` should be string | null, but if the Airtable field
  // ever comes back as an array (e.g. schema drift to a lookup) we don't
  // want the whole page to crash. Coerce to a string first.
  const str = typeof items === 'string'
    ? items
    : Array.isArray(items)
      ? items.filter(x => typeof x === 'string').join(',')
      : ''
  if (!str) return new Set()
  return new Set(str.split(',').map(s => s.trim()).filter(Boolean))
}


function ItemsRequestedCard({
  referral,
  locked,
  onSaved,
}: {
  referral: Referral
  locked: boolean
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(parseItemsToSet(referral.items))


  function startEdit() {
    setSelected(parseItemsToSet(referral.items))
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }
  function toggle(cat: string) {
    const next = new Set(selected)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setSelected(next)
  }
  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Preserve the canonical order of the 6 categories rather than the
      // click order Dawson happened to use. Matches how imports write them.
      // Send as string[] because Items Requested is a multi-select in AT.
      const ordered = ITEM_CATEGORIES.filter(c => selected.has(c))
      const res = await fetch(`/api/dawson/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: ordered }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        const msg = typeof j?.error === 'string'
          ? j.error
          : j?.error?.message ?? `Save failed (${res.status})`
        throw new Error(msg)
      }
      // Reflect back as a comma-string (same shape getReferralById returns).
      onSaved({ items: ordered.join(', ') })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    const current = Array.from(parseItemsToSet(referral.items))
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Items Requested"
        headerRight={locked ? null : <EditButton onClick={startEdit} />}
      >
        {current.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No items specified.</div>
        ) : (
          <div style={twoColumn(current.length)}>
            {current.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ color: '#2A7F6F', fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>•</span>
                <span style={{ fontSize: '13.5px', color: '#2C3A4A', lineHeight: 1.5 }}>{item}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }


  return (
    <Card
      accent={EDIT_ACCENT}
      title="Items Requested — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div style={twoColumn(ITEM_CATEGORIES.length)}>
        {ITEM_CATEGORIES.map(cat => (
          <label key={cat} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13.5px', color: '#2C3A4A', lineHeight: 1.5 }}>
            <input type="checkbox" checked={selected.has(cat)} onChange={() => toggle(cat)}
              style={{ width: '16px', height: '16px', accentColor: EDIT_ACCENT, cursor: 'pointer', flexShrink: 0, marginTop: '2px' }} />
            <span>{cat}</span>
          </label>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Internal Notes — display + inline edit (replaces the old modal)
// ---------------------------------------------------------------------------


// Always editable — no cutoff, no lock, no badge. Unlike Client Information
// and Items Requested, nothing downstream reads this field on a schedule
// (the warehouse never pulls a pick list off it), and unlike the terminal-
// state lock on Items Disbursed, a note is exactly the kind of thing that
// gets added AFTER something happens — a problem at pickup, a call from the
// agency days later. Ben's own — not client-facing — so there is no version
// of this record where annotating it late is a mistake to guard against.
function InternalNotesCard({
  referral,
  onSaved,
}: {
  referral: Referral
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState(referral.internalNotes ?? '')


  function startEdit() {
    setValue(referral.internalNotes ?? '')
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/dawson/referrals/${referral.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: value }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Save failed (${res.status})`)
      }
      onSaved({ internalNotes: value })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Internal Notes"
        headerRight={<EditButton onClick={startEdit} label={referral.internalNotes ? 'Edit' : '+ Add'} />}
      >
        {/* The notes-left / outbound-emails-right split Ben asked for is built:
            this card is now half-width, with EmailHistoryCard beside it. See
            the two-column wrapper in the page body. */}
        {referral.internalNotes ? (
          <div style={{ fontSize: '13px', color: '#1B2B4B', whiteSpace: 'pre-wrap', lineHeight: 1.6, padding: '4px 0' }}>{referral.internalNotes}</div>
        ) : (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No internal notes added yet.</div>
        )}
      </Card>
    )
  }


  return (
    <Card
      accent={EDIT_ACCENT}
      title="Internal Notes — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <textarea value={value} onChange={e => setValue(e.target.value)} rows={6}
        placeholder="Add internal notes about this referral..."
        style={{ ...inputStyle, resize: 'vertical', fontSize: '13px', lineHeight: 1.5, padding: '10px' }} />
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Email History
// ---------------------------------------------------------------------------


// Sits beside Internal Notes and answers "has this client been told?".
//
// MILESTONES come off the referral row itself — the five "…Sent At" stamps the
// notification modules write as each email fires. They are the checklist: all
// five are always listed, including the ones that have not happened, so a
// missing confirmation is visible rather than absent.
//
// DELIVERY LOG is the Email Log table, one row per send attempt, carrying what
// Resend said afterwards — but only the rows that are NOT a clean delivery.
//
// How it got here, in two steps, because the middle position is the point:
//
//   Ben asked for the log to go. On a normal referral it restated the
//   milestones directly above it, one row for one row, and it was the tallest
//   thing in the right column. It was dropped in full.
//
//   Dropping it in full also dropped the only place in the portal that showed
//   whether an email ACTUALLY ARRIVED. A milestone stamp records that we tried
//   to send, nothing more. Ben's answer was to keep the log and show only the
//   rows a milestone cannot already tell you:
//
//     a Delivered row next to "Appointment Confirmation — 3:14 PM" says the
//     same thing twice; a Bounced one says something new.
//
// So a referral whose email all went out normally renders NO log rows and no
// heading either — the vertical space is genuinely returned, which was the
// original ask. Anything that did not cleanly arrive stays visible with its
// reason attached.
//
// This is not Ben's only view of delivery. He is watching Resend directly for
// now, and /dawson/reports/email-log is still an empty placeholder for the
// across-all-clients rollup. This is the per-referral view.
const EMAIL_MILESTONES = [
  { key: 'confirmation', label: 'Appointment Confirmation' },
  { key: 'reschedule',   label: 'Reschedule Notice' },
  { key: 'reminder',     label: 'Appointment Reminder' },
  { key: 'completed',    label: 'Post-Appointment' },
  { key: 'cancellation', label: 'Cancellation Notice' },
] as const


// Airtable datetimes are full ISO timestamps, unlike the date-only appointment
// fields formatDate() handles, so this one keeps the time of day.
function formatSentAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}


const EMAIL_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Sent:       { bg: 'rgba(42,127,111,0.10)',  fg: '#2A7F6F' },
  Delivered:  { bg: 'rgba(42,127,111,0.10)',  fg: '#2A7F6F' },
  Bounced:    { bg: 'rgba(192,57,43,0.08)',   fg: '#C0392B' },
  Complained: { bg: 'rgba(192,57,43,0.08)',   fg: '#C0392B' },
  Failed:     { bg: 'rgba(192,57,43,0.08)',   fg: '#C0392B' },
  // Gold, not red. A withheld notice is a decision the portal made on purpose,
  // not a delivery that went wrong, and it should not read as an incident.
  Withheld:   { bg: 'rgba(201,168,76,0.15)',  fg: '#8B7724' },
}

// Statuses whose Bounce Reason is an explanation rather than a fault. Rendered
// in the same gold as the pill so the row reads as one thought.
const EXPLANATORY_STATUSES = new Set(['Withheld'])

/**
 * The statuses that mean "this went out fine" — the ONLY ones hidden from the
 * delivery log.
 *
 * DENY-LIST, NOT AN ALLOW-LIST, and deliberately so. logEmailSend() writes
 * Status with `typecast: true`, which auto-creates a new single-select option
 * in Airtable rather than rejecting it — so a status this file has never heard
 * of can start appearing in the base without any code change here. An
 * allow-list would silently swallow it; a deny-list surfaces it, which is the
 * safe direction to fail for a card whose whole job is telling Dawson that
 * something did not arrive.
 *
 * Both entries earn their place. 'Delivered' is the duplicate Ben objected to.
 * 'Sent' has to go too: it means we handed the message to Resend and heard
 * nothing further, which is exactly what the milestone stamp beside it already
 * says. Leaving it in would put a row on every normal referral and give back
 * none of the space.
 */
const CLEAN_DELIVERY_STATUSES = new Set(['Sent', 'Delivered'])

/**
 * Does this row say something the milestone list above it cannot?
 *
 * A null or unrecognised status counts as noteworthy: we do not know that it
 * arrived, and "unknown" is a thing Dawson should see rather than a thing to
 * hide.
 */
function isNoteworthy(entry: EmailLogEntry): boolean {
  return !entry.status || !CLEAN_DELIVERY_STATUSES.has(entry.status)
}

function EmailStatusPill({ status }: { status: string | null }) {
  // A row with no status at all is shown precisely BECAUSE it is not a known
  // clean delivery, so it needs to say so. Returning null here — which is what
  // this did when the log listed everything — would leave it sitting in the
  // list with nothing explaining why.
  if (!status) {
    return (
      <span style={{
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
        padding: '2px 8px', borderRadius: '12px',
        background: 'rgba(122,136,153,0.12)', color: '#7A8899', flexShrink: 0,
      }}>
        Unknown
      </span>
    )
  }
  const c = EMAIL_STATUS_COLORS[status] ?? { bg: 'rgba(122,136,153,0.12)', fg: '#7A8899' }
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
      padding: '2px 8px', borderRadius: '12px',
      background: c.bg, color: c.fg, flexShrink: 0,
    }}>
      {status}
    </span>
  )
}


function EmailHistoryCard({ referral, entries }: {
  referral: Referral
  entries: EmailLogEntry[]
}) {
  const stamps = referral.emailSentAt
  const noteworthy = entries.filter(isNoteworthy)

  return (
    <Card accent={READ_ACCENT} title="Email History">
      <div style={{ padding: '4px 0' }}>
        {EMAIL_MILESTONES.map(m => {
          const when = formatSentAt(stamps?.[m.key] ?? null)
          return (
            <div key={m.key} style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid #F7F5F1' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em' }}>{m.label}</span>
              <span style={{
                fontSize: '13px', textAlign: 'right',
                color: when ? '#1B2B4B' : '#C9CFD6',
                fontStyle: when ? 'normal' : 'italic',
              }}>
                {when ?? 'Not sent'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Nothing renders at all on a referral whose email went out cleanly —
          no heading, no divider, no "none to show" line. An empty-state
          message would hand back none of the height Ben asked for, and the
          milestone list above already answers "was anything sent".

          There is deliberately no loading state either. `entries` starts empty
          while the fetch is in flight, which renders the same nothing as the
          common case, so the card does not flash a spinner on every referral
          to tell Dawson about a problem that almost never exists. */}
      {noteworthy.length > 0 && (
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #EDE9E1' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: READ_ACCENT, marginBottom: '4px' }}>
            Delivery Log
          </div>
          {/* Says why the list is short, so a filtered log cannot be misread as
              "only one email was ever sent". Costs a line only on the referrals
              that already have something worth reading. */}
          <div style={{ fontSize: '11px', color: '#9AA6B2', marginBottom: '8px', lineHeight: 1.45 }}>
            Only emails that did not arrive cleanly are listed here.
          </div>

          {noteworthy.map(e => (
            <div key={e.id} style={{ padding: '7px 0', borderBottom: '1px solid #F7F5F1' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1B2B4B', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.type ?? 'Unknown email'}
                </span>
                <EmailStatusPill status={e.status} />
              </div>
              <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[formatSentAt(e.sentAt), e.recipient].filter(Boolean).join(' · ') || '—'}
              </div>
              {e.bounceReason && (
                <div style={{
                  fontSize: '11px', marginTop: '3px', lineHeight: 1.5,
                  color: EXPLANATORY_STATUSES.has(e.status ?? '') ? '#8B7724' : '#C0392B',
                }}>
                  {e.bounceReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Lifecycle strip
// ---------------------------------------------------------------------------

// Fixed five steps: Submitted, Approved, Scheduled, Pickup, Receipt. A
// reschedule updates the Scheduled step's reached-state in place rather than
// adding one — Original Appointment Date is single-value, so there is no
// history of past reschedules to show even if the strip wanted to (same
// reasoning as the meta strip's old "Previously X" line).
//
// Rejected replaces the Approved slot, same convention CompactTimeline's
// first consumer (the agency page's own 5-segment timeline) already uses for
// exactly this shape of problem — showing "Approved: Not yet" on a referral
// that was actually turned down would read as still-pending, not closed.
//
// No date text on the Scheduled segment on purpose: the action card below
// already shows the appointment date/time in large type in every state that
// has one, so repeating it here would say the same thing twice — the
// instruction that also drops it from the meta strip that used to hold it.
function buildReferralTimeline(referral: Referral): TimelineSegment[] {
  const rejected = referral.referralReview === 'Rejected'
  const completed = referral.appointmentStatus === 'Completed'
  return [
    { label: 'Submitted', reached: true, date: formatDate(referral.referralDate), tone: 'teal' },
    rejected
      ? { label: 'Rejected', reached: true, date: null, tone: 'red' }
      : { label: 'Approved', reached: referral.referralReview === 'Approved', date: null, tone: 'teal' },
    { label: 'Scheduled', reached: !!referral.effectiveAppointmentDate, date: null, tone: 'teal' },
    {
      label: 'Pickup', reached: completed,
      date: completed ? formatDate(referral.effectiveAppointmentDate) : null,
      tone: 'teal',
    },
    {
      label: 'Receipt', reached: !!referral.emailSentAt?.completed,
      date: referral.emailSentAt?.completed ? formatSentAt(referral.emailSentAt.completed) : null,
      tone: 'teal',
    },
  ]
}

// ---------------------------------------------------------------------------
// Action card
// ---------------------------------------------------------------------------

// Which of the eight rows in Ben's table this referral is in. Computed once
// from the shared portal status plus the two date-based gates
// (isAwaitingOutcome, the No Show window) rather than re-decided inline in
// the render — the state IS the row, and every branch below just renders it.
type ActionCardState =
  | 'awaiting-review' | 'approved-no-date' | 'scheduled' | 'reschedule-requested'
  | 'awaiting-outcome' | 'completed-not-sent' | 'completed-sent'
  | 'no-show-in-window' | 'closed'

// Mirrors app/dawson/needs-action/page.tsx's own bookedForSlot/
// requestedSlotLoad exactly — not imported from there because neither is
// exported, and this is the second copy, not yet worth a shared module for
// ~15 lines. Worth consolidating (into lib/schedule/capacity.ts, most
// naturally) if a third caller shows up; flagged rather than done here to
// keep this branch to what was asked.
function bookedForSlot(d: AvailableDate | undefined, slot: TimeSlot): number {
  if (!d) return 0
  switch (slot) {
    case '9am':  return d.slots9am  ?? 0
    case '10am': return d.slots10am ?? 0
    case '11am': return d.slots11am ?? 0
    case '12pm': return d.slots12pm ?? 0
    case '1pm':  return d.slots1pm  ?? 0
  }
}
function requestedSlotLoad(referral: Referral, availableDates: AvailableDate[]) {
  if (!referral.preferredDate || !referral.preferredTime || !VALID_TIMES.has(referral.preferredTime)) return null
  const day = availableDates.find(d => d.date === referral.preferredDate)
  if (!day) return null
  const slot = referral.preferredTime as TimeSlot
  const booked = bookedForSlot(day, slot)
  const cap = TIME_CAPS[slot]
  return { booked, cap, full: booked >= cap }
}

const ACCENT_GOLD = '#C9A84C'

function ActionBtn({ label, tone, onClick, disabled, title }: {
  label: string
  tone: 'accept' | 'gold' | 'red' | 'cancel'
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  const c =
    disabled ? { bg: '#EDEBE7', fg: '#B8C1CC' }
    : tone === 'accept' ? { bg: '#2A7F6F', fg: 'white' }
    : tone === 'red' ? { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B' }
    : tone === 'cancel' ? { bg: '#F0F0F0', fg: '#7A8899' }
    : { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title}
      style={{
        padding: '9px 18px', borderRadius: '7px', border: 'none',
        background: c.bg, color: c.fg, fontFamily: 'var(--font-montserrat)', fontWeight: 700,
        fontSize: '13px', cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      {label}
    </button>
  )
}

// The appointment date/time lead, in every state — including the states with
// no date at all, which show a placeholder rather than skipping the block.
// Ben's instruction: they sit in the same place whatever is happening, so the
// card never reflows its top line between states.
function ActionCardDateTime({ referral }: { referral: Referral }) {
  const d = referral.itemsDisbursed
  const checkedIn = d?.checkInTime
  const checkedOut = d?.checkoutTime
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#7A8899' }}>
        Appointment
      </div>
      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '22px', color: '#1B2B4B', lineHeight: 1.2, marginTop: '2px' }}>
        {referral.effectiveAppointmentDate ? formatDate(referral.effectiveAppointmentDate) : 'No date set'}
      </div>
      {referral.appointmentTime && (
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#7A8899', marginTop: '2px' }}>{referral.appointmentTime}</div>
      )}
      {referral.originalAppointmentDate && referral.originalAppointmentDate !== referral.effectiveAppointmentDate && (
        <div style={{ fontSize: '11px', color: '#9AA6B2', marginTop: '4px' }}>
          Previously {formatDate(referral.originalAppointmentDate)}
        </div>
      )}
      {/* The only record of when a client actually arrived and left —
          written by the OCR pass from the sheet's bottom strip. Same fact
          as the appointment date/time above, just after the event, so it
          lives in the same block. Absent, not em-dashed, until a pickup has
          actually happened and the scan has written something — matches how
          every other not-yet-applicable value on this page behaves. */}
      {(checkedIn || checkedOut) && (
        <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '6px' }}>
          {checkedIn && <>Checked in {checkedIn}</>}
          {checkedIn && checkedOut && ' · '}
          {checkedOut && <>Checked out {checkedOut}</>}
        </div>
      )}
    </div>
  )
}

// Appt Slip before the visit, Client Receipt after — one slot, never both.
// Lifted verbatim out of the old header (same geometry, same three branches,
// same reasoning) into the action card, since only one document ever applies
// at a time and a permanent header button for each would show one greyed out
// on every referral.
function ActionCardDocument({ referral, showReceiptSlot, readyForPostApptEmail }: {
  referral: Referral
  showReceiptSlot: boolean
  readyForPostApptEmail: boolean
}) {
  const btn: React.CSSProperties = {
    padding: '8px 16px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white',
    color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12.5px',
    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px',
  }
  const docIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  )
  if (showReceiptSlot) {
    return referral.clientReceiptUrl ? (
      <a href={referral.clientReceiptUrl} target="_blank" rel="noreferrer" style={btn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Client Receipt
      </a>
    ) : (
      <span
        title={
          readyForPostApptEmail
            ? 'No receipt yet. The client receipt is generated and emailed by the Tuesday 8am job, so an appointment from this weekend gets one on Tuesday morning. Nothing is wrong and nothing needs doing.'
            : 'No receipt yet, and this one will be skipped: the Tuesday 8am job only picks up appointments ticked "Ready for Post-Appt Email" below.'
        }
        style={{ ...btn, color: '#9AA6B2', cursor: 'default' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Receipt pending
      </span>
    )
  }
  return referral.appointmentSlipUrl ? (
    <a href={referral.appointmentSlipUrl} target="_blank" rel="noreferrer" style={btn}>{docIcon}Appt Slip</a>
  ) : null
}

function ActionCard({
  referral, state, todayISO, daysSinceNoShow, isReschedulable, isCancellable, availableDates,
  readyForPostApptEmail, emailToggleSaving, onToggleReady,
  confirm, setConfirm, actionLoading, onApprove, onReject, onPickSlot, onCancel,
  acceptArmed, setAcceptArmed, onAccept, acceptError,
}: {
  referral: Referral
  state: ActionCardState
  todayISO: string
  daysSinceNoShow: number | null
  isReschedulable: boolean
  isCancellable: boolean
  availableDates: AvailableDate[]
  readyForPostApptEmail: boolean
  emailToggleSaving: boolean
  onToggleReady: (e: React.ChangeEvent<HTMLInputElement>) => void
  confirm: string | null
  setConfirm: (v: string | null) => void
  actionLoading: boolean
  onApprove: () => void
  onReject: () => void
  onPickSlot: () => void
  onCancel: () => void
  acceptArmed: boolean
  setAcceptArmed: (v: boolean) => void
  onAccept: () => void
  acceptError: string | null
}) {
  // Gold left border ONLY when something needs deciding — same rule, same
  // "spent once, deliberately" reasoning as the agency page's own action
  // card. A plain Scheduled referral, Awaiting outcome, or a closed record
  // gets no accent and no urgency.
  const needsDecision =
    state === 'awaiting-review' || state === 'approved-no-date' ||
    state === 'reschedule-requested' || state === 'no-show-in-window'

  return (
    <div style={{
      background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)',
      borderLeft: `3px solid ${needsDecision ? ACCENT_GOLD : 'transparent'}`,
      padding: '18px 22px',
    }}>
      {/* Document slot (Appt Slip / Client Receipt) moved to the header —
          it competed with these buttons for the same row, and only one
          document ever applies at a time regardless of state, so the
          header is the more natural constant home for it. */}
      <ActionCardDateTime referral={referral} />

      {state === 'awaiting-review' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <ActionBtn label={confirm === 'Approved' ? (actionLoading ? '…' : 'Confirm Approve') : 'Approve'}
            tone="accept" onClick={onApprove} disabled={actionLoading && confirm !== 'Approved'} />
          <ActionBtn label={confirm === 'Rejected' ? (actionLoading ? '…' : 'Confirm Reject') : 'Reject'}
            tone="red" onClick={onReject} disabled={actionLoading && confirm !== 'Rejected'} />
          {confirm && (
            <ActionBtn label="Cancel" tone="cancel" onClick={() => setConfirm(null)} disabled={actionLoading} />
          )}
        </div>
      )}

      {state === 'approved-no-date' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          {isReschedulable && <ActionBtn label="Pick a date" tone="gold" onClick={onPickSlot} disabled={actionLoading} />}
          {isCancellable && <ActionBtn label="Cancel" tone="cancel" onClick={onCancel} disabled={actionLoading} />}
        </div>
      )}

      {state === 'scheduled' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          {isReschedulable && <ActionBtn label="Reschedule" tone="cancel" onClick={onPickSlot} disabled={actionLoading} />}
          {isCancellable && <ActionBtn label="Cancel" tone="cancel" onClick={onCancel} disabled={actionLoading} />}
        </div>
      )}

      {state === 'reschedule-requested' && (() => {
        const load = requestedSlotLoad(referral, availableDates)
        const acceptLabel = referral.preferredDate
          ? `Accept ${formatDate(referral.preferredDate)}${referral.preferredTime ? ` · ${referral.preferredTime}` : ''}`
          : 'Accept'
        return (
          <>
            <div style={{
              margin: '14px 0 0', padding: '10px 14px', borderRadius: '8px',
              background: 'rgba(201,168,76,0.12)', fontSize: '13px', color: '#2C3A4A',
            }}>
              <strong style={{ color: '#8B7724' }}>Requested:</strong>{' '}
              {referral.preferredDate
                ? <>{formatDate(referral.preferredDate)}{referral.preferredTime ? ` · ${referral.preferredTime}` : ''}</>
                : 'Flexible — no date given'}
              {load && (
                <span style={{ color: load.full ? '#C0392B' : '#7A8899', fontWeight: load.full ? 700 : 400 }}>
                  {' · '}{load.booked} / {load.cap} booked{load.full ? ' · full' : ''}
                </span>
              )}
              {referral.rescheduleRequestedAt && (
                <span style={{ color: '#7A8899' }}> · {requestAge(referral.rescheduleRequestedAt, todayISO)}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              {acceptArmed ? (
                <ActionBtn label="Cancel" tone="cancel" onClick={() => setAcceptArmed(false)} disabled={actionLoading} />
              ) : (
                <ActionBtn label="Pick another date" tone="gold" onClick={onPickSlot} disabled={actionLoading} />
              )}
              {isCancellable && !acceptArmed && (
                <ActionBtn label="Cancel appointment" tone="cancel" onClick={onCancel} disabled={actionLoading} />
              )}
              <ActionBtn
                label={actionLoading && acceptArmed ? '…' : acceptArmed ? 'Confirm accept' : acceptLabel}
                tone="accept" onClick={onAccept} disabled={!referral.preferredDate || (actionLoading && !acceptArmed)}
                title={referral.preferredDate ? undefined : 'The agency did not name a date'}
              />
            </div>
            {acceptError && (
              <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#C0392B' }}>{acceptError}</div>
            )}
          </>
        )
      })()}

      {state === 'awaiting-outcome' && (
        <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#7A8899', fontStyle: 'italic', lineHeight: 1.5 }}>
          The appointment date has passed. Run the OCR scan to record what happened.
        </div>
      )}

      {state === 'completed-not-sent' && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px',
          cursor: emailToggleSaving ? 'default' : 'pointer',
          fontSize: '13px', fontWeight: 700, color: readyForPostApptEmail ? ACCENT_GOLD : '#7A8899',
        }}>
          <input type="checkbox" checked={readyForPostApptEmail} disabled={emailToggleSaving} onChange={onToggleReady}
            style={{ width: '16px', height: '16px', accentColor: '#2A7F6F', cursor: 'inherit', flexShrink: 0 }} />
          Ready to send the client receipt
        </label>
      )}

      {/* completed-sent renders nothing below the date/time block — the
          lifecycle strip's Receipt segment and the Email History card both
          already carry the sent timestamp. Date, label, nothing else: that's
          correct, not an omission. */}

      {state === 'no-show-in-window' && (
        <div style={{ marginTop: '16px' }}>
          {daysSinceNoShow !== null && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: ACCENT_GOLD, marginBottom: '8px' }}>
              {daysSinceNoShow === 0 ? 'No-show today' : `${daysSinceNoShow} day${daysSinceNoShow === 1 ? '' : 's'} since`}
              {' · reschedulable for '}
              {NO_SHOW_RESCHEDULE_WINDOW_DAYS - daysSinceNoShow} more day{NO_SHOW_RESCHEDULE_WINDOW_DAYS - daysSinceNoShow === 1 ? '' : 's'}
            </div>
          )}
          {isReschedulable && <ActionBtn label="Reschedule" tone="gold" onClick={onPickSlot} disabled={actionLoading} />}
        </div>
      )}

      {state === 'closed' && (
        <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#9AA6B2' }}>
          {referral.appointmentStatus === 'No Show' && daysSinceNoShow !== null
            ? `No-show, ${daysSinceNoShow} days ago — past the ${NO_SHOW_RESCHEDULE_WINDOW_DAYS}-day reschedule window.`
            : `This referral is ${referral.referralReview === 'Rejected' ? 'rejected' : referral.referralReview === 'Withdrawn' ? 'withdrawn' : 'cancelled'}.`}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------


export default function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [referral, setReferral] = useState<Referral | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [referralId, setReferralId] = useState<string>('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  // Accept's own arm-then-confirm, separate from `confirm` (Approve/Reject
  // use that one) — the two can't collide since only one of the two action
  // rows is ever rendered for a given referral.
  const [acceptArmed, setAcceptArmed] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  // "Ready for Post-Appt Email" checkbox — Dawson flips this once he's
  // audited the pickup sheet against the portal for a Completed record. A
  // future Tuesday batch job reads this flag, sends the post-appt email, and
  // sets referral.emailSentAt.completed (which is what actually locks the
  // Items Disbursed card — see itemsDisbursedLocked below).
  const [readyForPostApptEmail, setReadyForPostApptEmail] = useState(false)
  const [emailToggleSaving, setEmailToggleSaving] = useState(false)
  // Outbound email history. Loaded alongside the referral rather than as part
  // of it — see the note on /api/dawson/referrals/[id]/emails. Every row is
  // fetched; EmailHistoryCard decides which are worth showing, so the filter
  // stays next to the reasoning for it rather than being split across a route
  // and a component.
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([])
  // Only needed by the action card's Reschedule-requested state (the booked
  // count next to the agency's requested slot) — fetched once that state is
  // actually reached, not on every load. Every other state never pays for
  // this call at all.
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])


  useEffect(() => {
    params.then(({ id }) => {
      setReferralId(id)

      fetch(`/api/dawson/referrals/${id}/emails`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : []))
        .then(data => setEmailLog(Array.isArray(data) ? data : []))
        .catch(() => {})

      fetch(`/api/dawson/referrals/${id}`, { cache: 'no-store' })
        .then(async r => {
          if (!r.ok) {
            const body = await r.text().catch(() => '')
            throw new Error(`${r.status} ${r.statusText}${body ? ` - ${body.slice(0, 300)}` : ''}`)
          }
          return r.json()
        })
        .then(data => setReferral(data))
        // Without this catch a failed GET left loading=true forever and the
        // page just spun - no error, nothing in the console. Always clear the
        // loading flag in finally, never inside the success path.
        .catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false))
    })
  }, [params])


  // Sync the checkbox from the fetched record once per referral load. Keyed
  // on id (not the whole referral object) so a local optimistic toggle isn't
  // clobbered by an unrelated refetch/applyUpdate elsewhere on the page.
  useEffect(() => {
    if (referral) setReadyForPostApptEmail(!!referral.readyForPostApptEmail)
  }, [referral?.id])


  // The scoped availableDates fetch — only while the referral is actually in
  // the Reschedule-requested state. Reads referral.appointmentStatus as a
  // primitive (not the referral object itself) so the effect's own
  // dependency list can name exactly what it uses, and re-fires if a refetch
  // flips the status without this effect having unmounted (e.g. Accept
  // succeeds and the status moves off 'Reschedule' — nothing left to fetch
  // for, and the array is simply never read again since ActionCard only
  // consults it in that one state).
  const referralAppointmentStatus = referral?.appointmentStatus
  useEffect(() => {
    if (referralAppointmentStatus !== 'Reschedule') return
    fetch('/api/dawson/schedule/available?weeks=8&leadDays=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAvailableDates(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [referralAppointmentStatus])


  // Refetch the referral after a successful mutation (cancel/reschedule) so
  // the header status badge, appointment date/time, and action buttons all
  // reflect the new state without a full page reload.
  //
  // The email history is refetched with it, and this is the case that matters
  // most for it: a reschedule or a cancel is exactly the moment a new Email Log
  // row appears — including a Withheld row when the confirmation guard
  // suppresses a reschedule notice. Loaded once on mount, the card would go on
  // showing the state from before the action Dawson just took, and a withheld
  // notice would not appear until he reloaded the page.
  const refetchReferral = () => {
    if (!referralId) return
    fetch(`/api/dawson/referrals/${referralId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setReferral(data))
      .catch(() => {})
    fetch(`/api/dawson/referrals/${referralId}/emails`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => setEmailLog(Array.isArray(data) ? data : []))
      .catch(() => {})
  }


  async function handleCancelConfirm() {
    setActionLoading(true)
    try {
      await fetch(`/api/dawson/referrals/${cancelModal.id}/cancel`, { method: 'POST' })
      setCancelModal({ open: false, id: '', name: '' })
      refetchReferral()
    } finally {
      setActionLoading(false)
    }
  }


  async function handleRescheduleConfirm(
    preferredDate: string,
    appointmentTime: string,
  ) {
    setActionLoading(true)
    setRescheduleError(null)
    try {
      const res = await fetch(`/api/dawson/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, appointmentTime }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setRescheduleError(err.error || 'Reschedule failed. Try again.')
        return
      }
      setRescheduleModal({ open: false, id: '', name: '' })
      refetchReferral()
    } catch {
      setRescheduleError("That didn't go through. Try again.")
    } finally {
      setActionLoading(false)
    }
  }


  async function handleReview(review: string) {
    if (confirm !== review) { setConfirm(review); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}/review`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review }),
      })
      if (res.ok && referral) { setReferral({ ...referral, referralReview: review }); setConfirm(null) }
    } finally { setActionLoading(false) }
  }


  // Accept — the deferred follow-up, and small: it's the exact same POST
  // Needs Action's own "Accept" already calls, with the referral's own
  // preferredDate/preferredTime read straight off the record. No modal (the
  // slot is already known), no new endpoint. Same arm-then-confirm shape as
  // Approve/Reject above, using its own `acceptArmed` flag rather than the
  // shared `confirm` string — the two action rows never render together, but
  // keeping them separate avoids a stray 'Approved' from one referral
  // bleeding into "armed" on the next without an extra reset effect.
  async function handleAccept() {
    if (!referral?.preferredDate) return
    if (!acceptArmed) { setAcceptArmed(true); setAcceptError(null); return }
    setActionLoading(true)
    setAcceptError(null)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate: referral.preferredDate, appointmentTime: referral.preferredTime }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAcceptError(err.error || 'Accept failed. Try again.')
        setAcceptArmed(false)
        return
      }
      setAcceptArmed(false)
      refetchReferral()
    } catch {
      setAcceptError("That didn't go through. Try again.")
      setAcceptArmed(false)
    } finally {
      setActionLoading(false)
    }
  }


  // Optimistic toggle for "Ready for Post-Appt Email." Reverts on failure so
  // the checkbox never silently drifts from what's saved in Airtable.
  async function handleToggleReady(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked
    setReadyForPostApptEmail(next)
    setEmailToggleSaving(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readyForPostApptEmail: next }),
      })
      if (!res.ok) throw new Error('Save failed')
    } catch {
      setReadyForPostApptEmail(!next)
    } finally {
      setEmailToggleSaving(false)
    }
  }


  // Local mutator — components pass partial updates back up so the UI stays
  // in sync without a full refetch.
  function applyUpdate(u: Partial<Referral>) {
    setReferral(prev => prev ? { ...prev, ...u } : prev)
  }


  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>Loading referral...</div>
  )
  // Surface the actual failure rather than the generic "not found" — a 500
  // from Airtable and a genuinely missing record need different responses.
  if (loadError) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
      <div style={{ maxWidth: '620px', background: 'white', border: '1px solid #EDE9E1', borderRadius: '10px', padding: '24px 28px' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#C0392B', marginBottom: '10px' }}>
          Couldn&apos;t load this referral
        </div>
        <div style={{ fontSize: '13px', color: '#2C3A4A', lineHeight: 1.6, marginBottom: '16px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-word' }}>
          {loadError}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => window.location.reload()}
            style={{ padding: '7px 16px', borderRadius: '6px', border: 'none', background: '#1B2B4B', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Retry
          </button>
          {/* /dawson/referrals/scheduled was the pre-consolidation name — it
              only works because next.config.ts still redirects it. */}
          <button onClick={() => router.push('/dawson/referrals')}
            style={{ padding: '7px 16px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Back to referrals
          </button>
        </div>
      </div>
    </div>
  )
  if (!referral) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>Referral not found.</div>
  )


  const todayISO = easternTodayISO()
  const status = getPortalStatus(referral.referralReview, referral.appointmentStatus)
  // Items Disbursed card is Completed-only. Cancelled + No Show mean
  // nothing was ever handed out, so the empty card was just visual noise.
  const showItemsDisbursed = status === 'Completed'


  // Days-since counter for No Show, and part of the gate for whether this
  // record is still "fresh" enough to act on. Uses appointmentDate as the
  // anchor (that's the date the client didn't show up on). Falls back to
  // null silently if the date is missing/malformed.
  //
  // Deliberately raw appointmentDate, not effectiveAppointmentDate: this is
  // "is there a live booking" logic (a No Show only exists relative to a
  // date that actually happened), not the "what slot is this for" display
  // question effectiveAppointmentDate answers.
  const daysSinceNoShow = (() => {
    if (referral.appointmentStatus !== 'No Show' || !referral.appointmentDate) return null
    const appt = new Date(referral.appointmentDate + 'T12:00:00')
    if (isNaN(appt.getTime())) return null
    const diffMs = Date.now() - appt.getTime()
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
  })()


  // A No Show older than the window is a closed record everywhere else in the
  // app (Add Referral duplicate-check, History page) — same rule applies here.
  const noShowAged = status === 'No Show' && daysSinceNoShow !== null && daysSinceNoShow > NO_SHOW_RESCHEDULE_WINDOW_DAYS


  // Reschedule / Cancel eligibility — read from the SAME shared gating the
  // agency side already uses, not a second, stricter Dawson rule. A
  // Saturday-morning cancellation needs somewhere to go; if Dawson's page
  // can't record it, it becomes a no-show instead, which is exactly the
  // measurement problem the rest of this project has been fixing.
  //
  // missedInRescheduleWindow feeds isReschedulable's no-show branch;
  // awaitingOutcome is a separate, additional gate applied on top — a
  // Scheduled referral whose date has passed but hasn't been marked
  // Completed/No Show yet must not be reschedulable or cancellable (the
  // agency-side referral detail page applies this exact same additional
  // check, `!awaitingOutcome`, the same way).
  const missedInRescheduleWindow =
    status === 'No Show' && withinNoShowRescheduleWindow(referral.appointmentDate, todayISO)
  const { isReschedulable: canReschedule, isCancellable: canCancel } =
    agencyReferralActions(status, missedInRescheduleWindow)
  const awaitingOutcome =
    status === 'Scheduled' && isAwaitingOutcome(referral.appointmentStatus, referral.appointmentDate, todayISO)
  const isReschedulable = canReschedule && !awaitingOutcome
  const isCancellable = canCancel && !awaitingOutcome


  // ---------------------------------------------------------------------
  // Which document the action card's one document slot is showing.
  //
  // Ben: "show the appt slip icon on Dawson till appt time, then flip to
  // receipt for completed post appt date."
  //
  // One slot, whichever document is the useful one now. Before the visit that
  // is the slip, which tells the client when to turn up. Afterwards it is the
  // receipt, which records what they actually went home with.
  //
  // WHY THE DATE IS CHECKED AS WELL AS THE STATUS. Completed on its own would
  // be enough in the normal run of things — a referral only reaches it after
  // the visit. The date guard is there for the mis-click: mark a future
  // appointment Completed by accident and the slip, which is still the useful
  // document for an appointment that has not happened yet, stays put.
  //
  // "today or earlier", not "strictly earlier" — same reasoning as before:
  // Dawson marks a referral Completed on the Saturday itself, and the slip
  // shouldn't keep describing a visit that already happened for the rest of
  // that day.
  //
  // Deliberately raw appointmentDate, not effectiveAppointmentDate — same
  // "is there a live booking" reasoning as daysSinceNoShow above.
  const apptDatePassed = !!referral.appointmentDate && referral.appointmentDate.slice(0, 10) <= todayISO
  const showReceiptSlot = status === 'Completed' && apptDatePassed


  // Items Disbursed's own lock — editable from the appointment Saturday
  // (in practice: from the moment the card even renders, since it's
  // Completed-only) until the post-appointment email has actually sent.
  // Keyed on the timestamp, not the boolean "Post Appt Email Sent" checkbox
  // or the "Ready" checkbox — a record that is Ready but unsent stays
  // editable, since that is the window where a mistake gets caught.
  const emailSent = !!referral.emailSentAt?.completed
  const itemsDisbursedLocked = status === 'Completed' && emailSent


  // Client Information / Items Requested — 5pm Friday before the Saturday
  // appointment, then the Edit button is gone. A DIFFERENT window from
  // Items Disbursed above, and from Reschedule/Cancel eligibility: this one
  // is field-edit-only, per Ben's correction. dawsonEditWindow (lib/referrals/
  // edit-window.ts) carries the full reasoning, including what happens with
  // no appointment date yet (editable — there's no Friday to have passed).
  const clientEditWindow: EditWindow = dawsonEditWindow({
    portalStatus: status,
    appointmentDate: referral.appointmentDate,
  })
  const clientLocked = !clientEditWindow.editable


  // Which row of Ben's action-card table this referral is in. Computed once
  // from the shared portal status plus the two gates above, then just
  // rendered by ActionCard — see the type's own comment.
  const actionCardState: ActionCardState = (() => {
    if (status === 'Cancelled' || status === 'Rejected' || status === 'Withdrawn') return 'closed'
    if (status === 'Completed') return emailSent ? 'completed-sent' : 'completed-not-sent'
    if (status === 'No Show') return noShowAged ? 'closed' : 'no-show-in-window'
    if (awaitingOutcome) return 'awaiting-outcome'
    if (status === 'Reschedule') return 'reschedule-requested'
    if (status === 'Scheduled') return 'scheduled'
    if (status === 'Scheduling') return 'approved-no-date'
    return 'awaiting-review'
  })()


  // Agency link: only render as link if we have an ID; otherwise plain text.
  // Staff link: only render as link if we have a link ID; otherwise plain
  // text — the "No staff linked" callout is now its own line below rather
  // than embedded mid-sentence (see noStaffLinked), since "Referred [date] by
  // No staff linked — fix at agency claim at [Agency]" didn't parse as a
  // sentence once the header grew a "by X at Y" line.
  const agencyDisplay = referral.referringAgency
    ? (referral.referringAgencyId
        ? <a href={`/dawson/agencies/${referral.referringAgencyId}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{referral.referringAgency}</a>
        : referral.referringAgency)
    : null

  const staffDisplay = referral.referredBy
    ? (referral.referringStaffId
        ? <a href={`/dawson/staff/${referral.referringStaffId}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{referral.referredBy}</a>
        : referral.referredBy)
    : null
  const noStaffLinked = !referral.referredBy && !referral.referringStaffId


  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>


      {/* Top bar. Sticks below the shell page bar (DawsonPageBar), which
          stays pinned on this route too — top offset by its height, z-index
          below it.

          Client name only, no sub-line — agency/staff/date are all in the
          Referral Details card and the lifecycle's Submitted segment now,
          so a sub-line here would just repeat them. With the sub-line gone
          the name carries more weight on its own: 20px, one size up from
          the agency/staff pages' 17px (those keep a sub-line, so they don't
          need it to carry as much), but still under the action card's 22px
          appointment date so the two don't compete for "biggest thing on
          the page." Document slot and status pills sit on the right —
          Approve/Reject and Reschedule/Cancel stay in the action card,
          since neither applies in every state. */}
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '12px 32px', minHeight: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', position: 'sticky', top: DAWSON_PAGE_BAR_HEIGHT, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => {
              // /dawson/referrals/review was the pre-consolidation name — it
              // only worked because next.config.ts still redirects it.
              if (window.history.length > 1) router.back()
              else router.push('/dawson/referrals')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '20px', color: '#1B2B4B' }}>
            {referral.clientName}
          </div>
        </div>

        {/* Document slot first, then pills — exception convention:
            Appointment Status always (it's the primary fact, not an
            exception); Review Status only when it isn't 'Approved' — the
            normal case needs no badge, same "absent, not muted" rule the
            agency/staff pages use; possible-duplicate only when true.
            Nothing else unless something's wrong. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ActionCardDocument referral={referral} showReceiptSlot={showReceiptSlot} readyForPostApptEmail={readyForPostApptEmail} />
          {referral.possibleDuplicate && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>⚠ Possible Duplicate</span>
          )}
          {referral.referralReview !== 'Approved' && (
            <span style={{
              padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: (REVIEW_STATUS_COLORS[referral.referralReview] ?? REVIEW_STATUS_COLORS.Pending).badgeBg,
              color: (REVIEW_STATUS_COLORS[referral.referralReview] ?? REVIEW_STATUS_COLORS.Pending).badgeText,
            }}>
              {referral.referralReview}
            </span>
          )}
          <span style={{
            padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: (APPOINTMENT_STATUS_COLORS[referral.appointmentStatus] ?? { badgeBg: '#F0F0F0', badgeText: '#7A8899' }).badgeBg,
            color: (APPOINTMENT_STATUS_COLORS[referral.appointmentStatus] ?? { badgeBg: '#F0F0F0', badgeText: '#7A8899' }).badgeText,
          }}>
            {referral.appointmentStatus || '—'}
          </span>
          {referral.dataPageUrl && (
            <a href={referral.dataPageUrl} target="_blank" rel="noreferrer"
              style={{ padding: '8px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#5B8DB8', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>
              Data Page
            </a>
          )}
        </div>
      </header>


      {/* Lifecycle strip — full width, above the two-rail body. Same card
          shell the agency/staff pages use for CompactTimeline, no accent —
          the action card below carries the only accent on this page. */}
      <div style={{ padding: '20px 32px 0' }}>
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '16px 22px' }}>
          <CompactTimeline segments={buildReferralTimeline(referral)} />
        </div>
      </div>


      {/* ------------------------------------------------------------------
          Two-rail body. 1.75fr / 1fr — the same proportion the agency and
          staff detail pages use.

          LEFT (wide) is the working surface: the action card leads it (so
          Client Information alongside it, in the right rail, rises to the
          same height instead of starting a row below), then what was
          requested and what was disbursed — Items Requested sits directly
          on top of Items Disbursed because comparing them IS the audit,
          separating them would make Dawson scroll between the two halves
          of one question.

          RIGHT (narrow) is reference material: who the client is, Dawson's
          own read on them, who sent them, what has already been sent to
          them. Read once, rarely touched.
      ------------------------------------------------------------------- */}
      <div style={{ padding: '20px 32px 32px', display: 'grid', gridTemplateColumns: '1.75fr 1fr', gap: '20px', alignItems: 'start' }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ActionCard
            referral={referral}
            state={actionCardState}
            todayISO={todayISO}
            daysSinceNoShow={daysSinceNoShow}
            isReschedulable={isReschedulable}
            isCancellable={isCancellable}
            availableDates={availableDates}
            readyForPostApptEmail={readyForPostApptEmail}
            emailToggleSaving={emailToggleSaving}
            onToggleReady={handleToggleReady}
            confirm={confirm}
            setConfirm={setConfirm}
            actionLoading={actionLoading}
            onApprove={() => handleReview('Approved')}
            onReject={() => handleReview('Rejected')}
            onPickSlot={() => { setRescheduleError(null); setRescheduleModal({ open: true, id: referral.id, name: referral.clientName }) }}
            onCancel={() => setCancelModal({ open: true, id: referral.id, name: referral.clientName })}
            acceptArmed={acceptArmed}
            setAcceptArmed={setAcceptArmed}
            onAccept={handleAccept}
            acceptError={acceptError}
          />
          <ItemsRequestedCard referral={referral} locked={clientLocked} onSaved={applyUpdate} />
          {/* Completed only. Cancelled / No Show / Scheduled mean nothing was
              handed out, so the card would be an empty box asking to be
              filled in for an appointment that hasn't happened. */}
          {showItemsDisbursed && (
            <ItemsDisbursedCard referral={referral} locked={itemsDisbursedLocked} onSaved={applyUpdate} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ClientInfoCard referral={referral} locked={clientLocked} onSaved={applyUpdate} />

          <InternalNotesCard referral={referral} onSaved={applyUpdate} />

          <Card accent={READ_ACCENT} title="Referral Details">
            <InfoRow label="Submitted" value={formatDate(referral.referralDate)} />
            <InfoRow label="Agency" value={agencyDisplay} />
            <InfoRow label="Staff" value={staffDisplay} />
            <InfoRow label="Staff Phone" value={referral.staffPhone} />
            <InfoRow label="Agency Email" value={referral.agencyEmail ? <a href={`mailto:${referral.agencyEmail}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{referral.agencyEmail}</a> : null} />
          </Card>

          {noStaffLinked && (
            <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '12px', padding: '12px 16px', fontSize: '12px', color: '#8B7724', fontStyle: 'italic' }}>
              No staff linked — fix at agency claim
            </div>
          )}

          <Card accent={READ_ACCENT} title="Agency Notes">
            {referral.externalNotes ? (
              <div style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '4px 0' }}>{referral.externalNotes}</div>
            ) : (
              <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No notes submitted by agency.</div>
            )}
          </Card>

          <EmailHistoryCard referral={referral} entries={emailLog} />

          {referral.possibleDuplicate && (
            <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', color: '#C0392B', marginBottom: '6px' }}>⚠ Possible Duplicate</div>
              <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6 }}>This client may already be in the system. Review before approving.</div>
            </div>
          )}
        </div>
      </div>
      <CancelModal
        open={cancelModal.open}
        name={cancelModal.name}
        loading={actionLoading}
        onClose={() => setCancelModal({ open: false, id: '', name: '' })}
        onConfirm={handleCancelConfirm}
      />
      <PickSlotModal
        key={rescheduleModal.id || 'none'}
        open={rescheduleModal.open}
        name={rescheduleModal.name}
        referralId={rescheduleModal.id}
        intent="reschedule"
        loading={actionLoading}
        error={rescheduleError}
        onClose={() => setRescheduleModal({ open: false, id: '', name: '' })}
        onConfirm={handleRescheduleConfirm}
      />


    </div>
  )
}
