'use client'

// app/dawson/agencies/[id]/page.tsx
//
// Rebuilt agency-detail-rebuild. Fed entirely by GET /api/dawson/agencies/[id]
// (getAgencyWithDetails) — one Agencies record, one Agency Users query scoped
// by agency record id, one Client Referrals query scoped the same way. See
// lib/airtable/agencies.ts for the read.
//
// The one external caller: app/dawson/needs-action/page.tsx's "Agencies to
// review" card links here with ?from=needs-action for a Pending agency —
// that page's own comment names this rebuild as the reason Approve/Reject
// need to live somewhere real on this page. The URL is unchanged; nothing
// else links in.
//
// Weights: Lato (no fontFamily set, the inherited body face) ships 400/700
// only; Montserrat (fontFamily: var(--font-montserrat)) ships 400/600/700.
// The previous version of this page used Montserrat 800 throughout and Lato
// 600 in a few places — both unloaded, the same bug the agency portal was
// just swept for. Every declaration below is 400/600/700.

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { DAWSON_PAGE_BAR_HEIGHT } from '@/components/internal/DawsonPageBar'
import { cityStateZip } from '@/lib/address'
import { formatEasternTimestamp, formatDateOnly, easternTodayISO, differenceInDaysISO } from '@/lib/dates'
import { matchesSearch } from '@/lib/search'

// ---------------------------------------------------------------------------
// Types — optional Airtable fields are string | null, honestly (Airtable
// omits blank fields from the payload entirely; see the header of
// lib/airtable/agencies.ts for why that matters).
// ---------------------------------------------------------------------------

type AgencyUser = {
  id: string
  name: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: string
  status: string
  invitedDate: string | null
  needsReview: boolean
  isPrimaryAdmin: boolean
  // Membership axis (membership-confirmation) — an agency admin's own
  // assertion this person works there. null = unconfirmed, the default.
  membershipStatus: string | null
}

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  referralReview: string
  appointmentStatus: string
  referredBy: string | null
  effectiveAppointmentDate: string | null
  preferredDate: string | null
}

type Agency = {
  id: string
  name: string
  ein: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  officeName: string | null
  phone: string | null
  website: string | null
  email: string | null
  contactFirstName: string | null
  contactLastName: string | null
  contactPhone: string | null
  primaryAdminId: string | null
  reconciled: boolean
  // New per-agency gate — see the PR notes at the top of this branch for
  // exactly what does (and does not) read this yet.
  liveReferrals: boolean
  status: string
  registrationDate: string | null
  approvalDate: string | null
  invitedDate: string | null
  claimedDate: string | null
  rejectedDate: string | null
  source: string | null
  agencyNumber: string | null
  possibleDuplicate: boolean
  notes: string | null
  users: AgencyUser[]
  referralCount: number
  referrals: Referral[]
}

// ---------------------------------------------------------------------------
// Shared style tokens
// ---------------------------------------------------------------------------

const CARD: React.CSSProperties = {
  background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden',
}
const CARD_HEAD: React.CSSProperties = {
  padding: '16px 24px', borderBottom: '1px solid #EDE9E1',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
}
// Matches the SECTION_TITLE already established on Dawson's own Needs Action
// page (app/dawson/needs-action/page.tsx) — same family, size and tracking —
// so five stacked white cards read as sections rather than one flat surface.
// One correction: that page's SECTION_TITLE is fontWeight 800, which
// Montserrat doesn't ship (400/600/700 only, same bundle the agency portal
// was just swept for) — this uses 700, not 800. needs-action's copy still
// carries the bug; out of scope here, same as the AgencyReferralsPanel note.
const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
  letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B',
}
const MUTED_EMPTY: React.CSSProperties = { fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Unclaimed: { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' },
  Invited:   { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)', badgeText: '#5B8DB8' },
  Pending:   { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)', badgeText: '#C9A84C' },
  Approved:  { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)', badgeText: '#2A7F6F' },
  Rejected:  { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)', badgeText: '#C0392B' },
  Inactive:  { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' },
}

// Membership pill — teal Confirmed / grey Not yet confirmed, never gold. Gold
// means waiting on Furniture Assist; an unconfirmed staffer or admin is
// waiting on the AGENCY, and Dawson has no Confirm action to offer from this
// page (that would be a back door around the agency admin's own boundary).
// So it reads as a plain state, not a prompt.
function MembershipPill({ status }: { status: string | null }) {
  const confirmed = status === 'Confirmed'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '20px',
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      background: confirmed ? 'rgba(42,127,111,0.12)' : '#F0F0F0',
      color: confirmed ? '#2A7F6F' : '#7A8899',
    }}>
      {confirmed ? 'Confirmed' : 'Not yet confirmed'}
    </span>
  )
}

function Pill({ label, tone }: { label: string; tone: 'teal' | 'gold' | 'grey' | 'red' }) {
  const styles = {
    teal: { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F' },
    gold: { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
    grey: { bg: '#F0F0F0', fg: '#7A8899' },
    red:  { bg: 'rgba(192,57,43,0.1)', fg: '#C0392B' },
  }[tone]
  return (
    <span style={{
      padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
      letterSpacing: '0.04em', textTransform: 'uppercase', background: styles.bg, color: styles.fg,
    }}>
      {label}
    </span>
  )
}

function InfoRow({ label, value, emptyText = '—' }: { label: string; value: React.ReactNode; emptyText?: string }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '140px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || <span style={{ color: '#B8C1CC' }}>{emptyText}</span>}
      </div>
    </div>
  )
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Year-less variants for the compact lifecycle timeline only — measured
// (Playwright, real fonts) at 566px natural width vs. 652px with the year
// included; the year adds nothing a Dawson reader needs when every segment
// is necessarily within the last couple of years, and dropping it is what
// gets five segments onto one line beside the controls.
function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatInstantShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  return formatEasternTimestamp(dateStr, { month: 'short', day: 'numeric' })
}

// Airtable formats phone number fields for display in its own UI, but that
// formatting is a display property of the field, not the stored value — the
// API can and does return bare digits ("2019519465"). Used on all three phone
// displays this page has (Agency card Main Phone, Primary Admin card Phone,
// Staff card rows), so the same number doesn't format three different ways
// on one page.
//
// Two `formatPhone` helpers already exist in the codebase
// (components/internal/modals/AddAgencyStaffModal.tsx,
// app/dawson/referrals/[id]/page.tsx), but both are built for MASKING LIVE
// INPUT as someone types (one also handles extensions), have already
// diverged from each other, and neither is exported — importing either would
// mean moving it to lib/ first and reconciling the extension handling, which
// is real cleanup but a separate task (alongside DawsonPageContainer and
// resolveSaturdaySlot), not folded into this page's read-only display need.
// This is the simpler of the two shapes, kept local: format a complete
// 10-digit number, otherwise show it exactly as stored.
function formatPhoneDisplay(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// "8 days ago" / "yesterday" / "today" — same voice as the age phrasing on
// Needs Action (app/dawson/needs-action/page.tsx), not reinvented here.
function agePhrase(iso: string | null, todayISO: string): string | null {
  if (!iso) return null
  const days = differenceInDaysISO(iso.slice(0, 10), todayISO)
  if (days === null) return null
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

// ---------------------------------------------------------------------------
// Lifecycle timeline
// ---------------------------------------------------------------------------
// Five segments. "Reached" is driven by each segment's OWN field being
// present, not inferred purely from the current Status — the Pending →
// Approved manual path can reach Approved without Invited/Claimed dates ever
// being set (no invite was needed), so keying Invited/Claimed on Status would
// lie about what actually happened. Rejected replaces the Approved slot
// entirely when the agency was rejected; Inactive does NOT replace it — an
// Inactive agency was still approved once, so that segment stays reached with
// its real date.
type TimelineSegment = { label: string; reached: boolean; date: string | null; tone: 'teal' | 'red' }

function buildTimeline(agency: Agency): TimelineSegment[] {
  const rejected = agency.status === 'Rejected'
  return [
    { label: 'Created', reached: true, date: formatDateShort(agency.registrationDate), tone: 'teal' },
    { label: 'Invited', reached: !!agency.invitedDate, date: agency.invitedDate ? formatInstantShort(agency.invitedDate) : null, tone: 'teal' },
    { label: 'Claimed', reached: !!agency.claimedDate, date: agency.claimedDate ? formatInstantShort(agency.claimedDate) : null, tone: 'teal' },
    rejected
      ? { label: 'Rejected', reached: true, date: agency.rejectedDate ? formatInstantShort(agency.rejectedDate) : null, tone: 'red' }
      : {
          label: 'Approved',
          reached: agency.status === 'Approved' || agency.status === 'Inactive',
          date: agency.approvalDate ? formatDateShort(agency.approvalDate) : null,
          tone: 'teal',
        },
    { label: 'Referrals live', reached: agency.liveReferrals, date: null, tone: 'teal' },
  ]
}

// Compact inline timeline: dot + label + short date per segment, joined by
// small arrows to show progression. The earlier version drew a stepper —
// dots linked by full-width connecting rules, ~90px per segment, one wide
// row on its own line — which read fine but was wider than it needed to be
// and forced the timeline onto a line of its own below the controls. Rules
// carried no information a reader needs (adjacent-reached is implied by the
// dots themselves being filled), so those were dropped; arrows are a
// different, much cheaper mark that shows the same direction of travel
// without a full rule's width.
//
// Measured (Playwright, real fonts, real stylesheet, against this exact
// markup): five chips with short "Mon DD" dates and no arrows run 612px
// natural width; adding an arrow glyph in each of the four gaps between them
// pushes that to 660px — close to what the original full-date, no-arrow
// version needed (652px), same tradeoff the arrows were warned to risk.
// Below ~660px the row wraps via `flexWrap: wrap`; tested with arrows at
// 550/480/420/360px, each wraps cleanly to two lines (34px height, no
// scrollWidth overflow) with every chip and arrow staying intact — the same
// clean wrap the no-arrow version had, so the arrows were kept rather than
// dropped.
function CompactTimeline({ agency }: { agency: Agency }) {
  const segments = buildTimeline(agency)
  const nodes: React.ReactNode[] = []
  segments.forEach((s, i) => {
    if (i > 0) {
      nodes.push(<span key={`arrow-${i}`} style={{ fontSize: '10px', color: '#D8DEE6' }}>→</span>)
    }
    nodes.push(
      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
          background: s.reached ? (s.tone === 'red' ? '#C0392B' : '#2A7F6F') : 'white',
          border: `1.5px solid ${s.reached ? (s.tone === 'red' ? '#C0392B' : '#2A7F6F') : '#D8DEE6'}`,
        }} />
        <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11.5px', color: s.reached ? '#1B2B4B' : '#B8C1CC' }}>
          {s.label}
        </span>
        <span style={{ fontSize: '11px', color: s.reached ? '#7A8899' : '#C7CFD7' }}>
          {s.reached ? (s.date ?? 'Reached') : 'Not yet'}
        </span>
      </div>
    )
  })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
      {nodes}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Referrals card — built fresh for this page. NOT AgencyReferralsPanel: that
// component is shared with app/dawson/staff/[id]/page.tsx, is styled in
// Tailwind's default classes (font-medium/font-semibold on the site's Lato
// body font — the same unloaded-weight bug the agency portal was just swept
// for), and doesn't support date-range filtering or month grouping. Editing
// it to fit this page's needs would change the staff page too. Left
// untouched; see the PR notes.
// ---------------------------------------------------------------------------

// 'Reschedule' was missing from this map — confirmed against Airtable's full
// Appointment Status option list (Pending Schedule, Scheduled, Cancelled,
// Reschedule, Completed, No Show — six values, this now has all six), so it
// was the only gap, not one of several. It reuses Needs Action's own label
// ("Reschedule requested") rather than a locally-invented one, so this card
// and the dashboard's reschedule count read the same referral the same way.
// See lib/dawson/needs-action-counts.ts and lib/referrals/reschedule-request.ts
// for why Appointment Status, not Referral Review, is the field that moves.
type ReferralStatusKey = 'Pending Schedule' | 'Scheduled' | 'Cancelled' | 'Reschedule' | 'Completed' | 'No Show'
const REFERRAL_STATUS_ORDER: ReferralStatusKey[] = ['Pending Schedule', 'Scheduled', 'Reschedule', 'Cancelled', 'Completed', 'No Show']
// Colours: teal booked-and-coming, grey past/settled, red the genuine
// cancellation, gold for No Show (reusing the agency History page's own
// no-show gold) and for Reschedule (an open ask waiting on Furniture Assist —
// the same meaning gold carries everywhere else in the portal; sharing the
// tone with No Show is fine, the label text is what distinguishes them).
const REFERRAL_STATUS_STYLE: Record<ReferralStatusKey, { bg: string; fg: string }> = {
  'Pending Schedule': { bg: '#F0F0F0', fg: '#7A8899' },
  Scheduled:          { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F' },
  Reschedule:         { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
  Cancelled:          { bg: 'rgba(192,57,43,0.1)', fg: '#C0392B' },
  Completed:          { bg: '#F0F0F0', fg: '#7A8899' },
  'No Show':          { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
}
// Anything not in REFERRAL_STATUS_STYLE (an Airtable option this map hasn't
// caught up with) falls back to this — red, "genuine exception" per the
// portal's own colour convention, and visually unlike every real status so it
// can't be mistaken for one.
const UNKNOWN_STATUS_STYLE = { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B' }
const REFERRAL_STATUS_LABEL: Record<ReferralStatusKey, string> = {
  'Pending Schedule': 'Pending Schedule',
  Scheduled: 'Scheduled',
  Reschedule: 'Reschedule requested',
  Cancelled: 'Cancelled',
  Completed: 'Completed',
  'No Show': 'No Show',
}

// Returns the real Appointment Status value when this map doesn't recognise
// it, rather than guessing "Pending Schedule" — the bug this replaces. An
// unmapped value used to render as a confident, plausible, WRONG status; now
// it renders as itself (or "Unknown" if genuinely blank), which cannot be
// mistaken for a real one once paired with UNKNOWN_STATUS_STYLE below. This
// is the same failure shape as the "Dear ," greeting, the Send Day
// comparison, and the invite link rendering href="" — a fallback that
// produces something that looks like an answer instead of surfacing that it
// isn't one.
function referralStatusKey(r: Referral): string {
  if (r.referralReview === 'Rejected' || r.referralReview === 'Withdrawn') return 'Cancelled'
  const map: Record<string, ReferralStatusKey> = {
    'Pending Schedule': 'Pending Schedule',
    Scheduled: 'Scheduled',
    Reschedule: 'Reschedule',
    Cancelled: 'Cancelled',
    Completed: 'Completed',
    'No Show': 'No Show',
  }
  return map[r.appointmentStatus] ?? (r.appointmentStatus || 'Unknown')
}

function isKnownReferralStatus(key: string): key is ReferralStatusKey {
  return key in REFERRAL_STATUS_STYLE
}
function referralStatusLabel(key: string): string {
  return isKnownReferralStatus(key) ? REFERRAL_STATUS_LABEL[key] : key
}
function referralStatusStyle(key: string): { bg: string; fg: string } {
  return isKnownReferralStatus(key) ? REFERRAL_STATUS_STYLE[key] : UNKNOWN_STATUS_STYLE
}

type RangeKey = '90' | '365' | 'all'
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
  { key: 'all', label: 'All time' },
]

function monthLabel(yearMonthKey: string): string {
  return formatDateOnly(`${yearMonthKey}-01`, { month: 'long', year: 'numeric' })
}

// The date a referral is FILED and GROUPED under — not invented here, the
// same convention Dawson's referrals list already uses (fileDateOf /
// isRequestStatus in app/dawson/referrals/page.tsx). A request-status row
// (no booked slot) files under what the agency asked for; everything else
// files under the live appointment date, coalesced with the snapshot taken
// when a slot was released, so a cancelled referral still groups into the
// month it was booked for rather than the month it was cancelled.
//
// Deliberately NOT Referral Date (submission): grouping and the displayed
// date used to read Referral Date while the row's own text showed the
// appointment date, so a referral submitted in August for a September
// appointment appeared under "August 2026" with "Sep 12" printed on it — the
// header and the row it contained disagreed. This card answers "when is a
// family being served," which is the appointment side, not the paperwork side.
function isRequestStatus(appointmentStatus: string): boolean {
  return appointmentStatus === 'Reschedule' || appointmentStatus === 'Pending Schedule'
}
function fileDateOf(r: Referral): string | null {
  if (isRequestStatus(r.appointmentStatus)) {
    return r.preferredDate || r.effectiveAppointmentDate || null
  }
  return r.effectiveAppointmentDate || null
}

function ReferralsCard({ referrals }: { referrals: Referral[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReferralStatusKey | 'All'>('All')
  // 90 days by default: most visits to this page are "what has this agency
  // sent lately," not a full-history audit, and a new agency's whole history
  // fits inside 90 days anyway. 12 months / all time are one click away.
  const [range, setRange] = useState<RangeKey>('90')

  const todayISO = easternTodayISO()

  const withinRange = (r: Referral): boolean => {
    if (range === 'all') return true
    const days = differenceInDaysISO(r.referralDate, todayISO)
    if (days === null) return true
    const limit = range === '90' ? 90 : 365
    return days <= limit
  }

  const counts = useMemo(() => {
    const inRange = referrals.filter(withinRange)
    const map: Partial<Record<ReferralStatusKey | 'All', number>> = { All: inRange.length }
    for (const k of REFERRAL_STATUS_ORDER) map[k] = inRange.filter(r => referralStatusKey(r) === k).length
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrals, range])

  const filtered = useMemo(() => {
    return referrals
      .filter(withinRange)
      .filter(r => statusFilter === 'All' || referralStatusKey(r) === statusFilter)
      .filter(r => matchesSearch(search, r.clientName))
      // Sorted by the same file date it's grouped and displayed by — sorting
      // on one field while grouping on another is exactly the bug this pass
      // fixed for the group header itself; undated rows (fileDateOf null,
      // '' sorts last) fall to the end here and are peeled into their own
      // group below.
      .sort((a, z) => (fileDateOf(z) ?? '').localeCompare(fileDateOf(a) ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrals, search, statusFilter, range])

  const months = useMemo(() => {
    const groups: { key: string; rows: Referral[] }[] = []
    const noDate: Referral[] = []
    for (const r of filtered) {
      const fd = fileDateOf(r)
      if (!fd) { noDate.push(r); continue }
      const key = fd.slice(0, 7)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.rows.push(r)
      else groups.push({ key, rows: [r] })
    }
    // Same answer Dawson's referrals list gives a referral with no file date
    // at all (a Pending Schedule row with no preferred date either): its own
    // group, pinned last, sorted by name rather than a date that doesn't
    // exist — not folded into whichever month happens to be open.
    noDate.sort((a, z) => a.clientName.localeCompare(z.clientName))
    return { groups, noDate }
  }, [filtered])

  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <div style={CARD_TITLE}>Referrals</div>
        <div style={{ fontSize: '11px', color: '#7A8899' }}>{referrals.length} total</div>
      </div>

      <div style={{ padding: '14px 24px', borderBottom: '1px solid #EDE9E1', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name…"
            style={{ flex: '1 1 200px', padding: '8px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', outline: 'none' }}
          />
          <select
            value={range}
            onChange={e => setRange(e.target.value as RangeKey)}
            style={{ padding: '8px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', background: 'white', cursor: 'pointer' }}
          >
            {RANGE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {(['All', ...REFERRAL_STATUS_ORDER] as const).map(k => {
            const active = statusFilter === k
            const count = counts[k] ?? 0
            return (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                style={{
                  padding: '5px 12px', borderRadius: '20px', border: `1px solid ${active ? '#1B2B4B' : '#EDE9E1'}`,
                  background: active ? '#1B2B4B' : 'white', color: active ? 'white' : '#7A8899',
                  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer',
                }}
              >
                {k === 'All' ? 'All' : referralStatusLabel(k)}{' '}
                <span style={{ color: active ? '#C9A84C' : count === 0 ? '#B8C1CC' : '#7A8899' }}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {months.groups.length === 0 && months.noDate.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', ...MUTED_EMPTY }}>No referrals match this filter.</div>
      ) : (
        <>
          {months.groups.map(group => (
            <div key={group.key}>
              <div style={{ padding: '8px 24px', background: '#FAF8F4', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B8C1CC' }}>
                {monthLabel(group.key)}
              </div>
              {group.rows.map(r => <ReferralRow key={r.id} r={r} />)}
            </div>
          ))}
          {months.noDate.length > 0 && (
            <div>
              <div style={{ padding: '8px 24px', background: '#FAF8F4', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B8C1CC' }}>
                No date yet
              </div>
              {months.noDate.map(r => <ReferralRow key={r.id} r={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Client · Staff · Date · Status. No column headers: three of the four are
// self-evident from their own content and the fourth is a coloured pill,
// which doesn't need a label either — that earns its keep on Dawson's own
// referrals list because that table IS the page; here it's one card among
// five.
const REFERRAL_ROW_GRID = 'minmax(0, 1.8fr) minmax(0, 1fr) 110px 150px'

function ReferralRow({ r }: { r: Referral }) {
  const key = referralStatusKey(r)
  const style = referralStatusStyle(key)
  const fd = fileDateOf(r)
  return (
    <a
      href={`/dawson/referrals/${r.id}`}
      style={{ display: 'grid', gridTemplateColumns: REFERRAL_ROW_GRID, gap: '12px', alignItems: 'center', padding: '10px 24px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none' }}
    >
      <span style={{ fontSize: '13px', fontWeight: 700, color: '#2A7F6F', overflowWrap: 'anywhere' }}>{r.clientName}</span>
      <span style={{ fontSize: '12px', color: '#7A8899', overflowWrap: 'anywhere' }}>{r.referredBy ?? 'Unknown staff'}</span>
      <span style={{ fontSize: '12px', color: '#7A8899' }}>{fd ? formatDate(fd) : '—'}</span>
      <span style={{
        justifySelf: 'start', padding: '3px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase', background: style.bg, color: style.fg,
      }}>
        {referralStatusLabel(key)}
      </span>
    </a>
  )
}

// ---------------------------------------------------------------------------
// Notes card — collapsed by default, a 0/1 count badge, unchanged edit modal.
// ---------------------------------------------------------------------------

function NotesModal({ currentNotes, onSave, onCancel, saving }: {
  currentNotes: string; onSave: (notes: string) => void; onCancel: () => void; saving: boolean
}) {
  const [value, setValue] = useState(currentNotes)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '32px', width: '500px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>Edit Notes</div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '16px' }}>These notes are saved to the agency record.</div>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={6}
          placeholder="Add notes about this agency..."
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'white' }}
        />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => onSave(value)} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Always expanded — no collapse toggle. The pre-rebuild page never collapsed
// its notes; this rebuild briefly did (to save space), which put a note
// Dawson staff need behind a disclosure triangle they have no reason to
// reach for. Dawson's own conventions keep actions and content visible
// rather than hidden behind a control, so this reverses that.
function NotesCard({ notes, onEdit }: { notes: string | null; onEdit: () => void }) {
  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={CARD_TITLE}>Notes</span>
          {notes && <span style={{ fontSize: '11px', fontWeight: 700, color: '#7A8899' }}>1</span>}
        </div>
      </div>
      <div style={{ padding: '16px 24px' }}>
        {notes ? (
          <div style={{ fontSize: '13px', color: '#1B2B4B', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{notes}</div>
        ) : (
          <div style={MUTED_EMPTY}>No notes added yet.</div>
        )}
      </div>
      <div style={{ padding: '0 24px 16px' }}>
        <button onClick={onEdit}
          style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
          {notes ? 'Edit' : '+ Add Note'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgencyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [agency, setAgency] = useState<Agency | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteNote, setInviteNote] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [agencyId, setAgencyId] = useState<string>('')
  const [notesModal, setNotesModal] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [back, setBack] = useState<{ href: string; label: string }>({
    href: '/dawson/agencies/active',
    label: 'Agencies',
  })

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const from = p.get('from')
    switch (from) {
      case 'scheduled':
        setBack({ href: '/dawson/admin/scheduled', label: 'Scheduled' })
        break
      case 'pending':
        setBack({ href: '/dawson/agencies/pending', label: 'Pending Agencies' })
        break
      case 'inactive':
        setBack({ href: '/dawson/agencies/inactive', label: 'Inactive Agencies' })
        break
      case 'unclaimed':
        setBack({ href: '/dawson/agencies/unclaimed', label: 'Unclaimed Agencies' })
        break
      // Needs Action's "Agencies to review" card is the one external caller
      // this page exists to serve (see the file header) — it was missing
      // here, so Back silently returned to the general Agencies list instead
      // of the page Dawson actually came from.
      case 'needs-action':
        setBack({ href: '/dawson/needs-action', label: 'Needs Action' })
        break
      case 'active':
      default:
        setBack({ href: '/dawson/agencies/active', label: 'Agencies' })
    }
  }, [])

  async function handleStatusChange(newStatus: string) {
    if (!agency) return
    if (confirm !== newStatus) { setConfirm(newStatus); return }
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, previousStatus: agency.status }),
      })
      if (res.ok) {
        setAgency({ ...agency, status: newStatus })
        setConfirm(null)
      }
    } finally { setStatusLoading(false) }
  }

  async function handleInvite() {
    if (!agency) return
    if (confirm !== 'invite') { setConfirm('invite'); setInviteNote(null); return }
    setInviteLoading(true)
    setInviteNote(null)
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/invite`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteNote({ kind: 'error', text: body?.error || `Invite failed (${res.status})` })
        return
      }
      setAgency({ ...agency, status: 'Invited', invitedDate: new Date().toISOString() })
      setConfirm(null)

      const email = body?.email
      if (email && email.skipped === false && email.sent === false) {
        setInviteNote({
          kind: 'warn',
          text: `${agency.name} is marked Invited, but the email did not send: ${email.error ?? 'unknown error'}. Use Resend Invite once that is fixed.`,
        })
      } else {
        setInviteNote({ kind: 'ok', text: 'Invite sent.' })
      }
    } catch {
      setInviteNote({ kind: 'error', text: 'Network error. Please try again.' })
    } finally {
      setInviteLoading(false)
    }
  }

  // Reconciled / Live Referral Access — optimistic, no confirm step (these
  // are toggles, not destructive actions; Mark Inactive / Approve / Reject
  // keep the confirm step below because those have real consequences).
  async function handleFlagChange(key: 'reconciled' | 'liveReferrals', value: boolean) {
    if (!agency) return
    const previous = agency[key]
    setAgency({ ...agency, [key]: value })
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/flags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      if (!res.ok) setAgency(a => a ? { ...a, [key]: previous } : a)
    } catch {
      setAgency(a => a ? { ...a, [key]: previous } : a)
    }
  }

  async function handleSaveNotes(notes: string) {
    setNotesSaving(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (res.ok && agency) {
        setAgency({ ...agency, notes })
        setNotesModal(false)
      }
    } finally { setNotesSaving(false) }
  }

  useEffect(() => {
    params.then(({ id }) => {
      setAgencyId(id)
      fetch(`/api/dawson/agencies/${id}`)
        .then(r => r.json())
        .then(data => { setAgency(data); setLoading(false) })
    })
  }, [params])

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading agency...
    </div>
  )

  if (!agency) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Agency not found.
    </div>
  )

  const statusColors = STATUS_COLORS[agency.status] ?? STATUS_COLORS.Inactive
  const locality = cityStateZip(agency.city, agency.state, agency.zip)
  const todayISO = easternTodayISO()

  // Staff card / header count both exclude the primary admin — they have
  // their own card with their own status, and on any not-yet-invited agency
  // they are unconfirmed by construction (the auto-confirm fires inside the
  // invite route). Counting them here would make "N unconfirmed" disagree
  // with what the Staff card actually lists below it.
  const staff = agency.users.filter(u => u.id !== agency.primaryAdminId)
  const unconfirmedStaff = staff.filter(u => u.membershipStatus !== 'Confirmed').length
  const primaryAdmin = agency.users.find(u => u.id === agency.primaryAdminId) ?? null

  // Invite gating — checked in the SAME order the route enforces
  // (reconciled → primary admin → admin email), not the order that happens
  // to be easiest to read. An agency missing two of the three used to be
  // told to fix the wrong one first.
  const canInviteAgency = agency.status === 'Unclaimed' || agency.status === 'Invited'
  const inviteBlockReason = !agency.reconciled
    ? 'Tick Reconciled first.'
    : !agency.primaryAdminId
    ? 'No primary admin linked.'
    : !agency.email
    ? 'No admin email on file.'
    : null
  const inviteReady = !inviteBlockReason
  const isResendInvite = agency.status === 'Invited'
  const inviteRecipient =
    [agency.contactFirstName, agency.contactLastName].filter(Boolean).join(' ') || 'the Primary Admin'
  const invitedAge = isResendInvite ? agePhrase(agency.invitedDate, todayISO) : null

  // Mark Inactive is persistent across exactly the three states you can
  // reach it from today (Unclaimed / Invited / Approved) — Pending and
  // Rejected have their own decision (Approve/Reject, Reconsider) instead,
  // and Inactive is already inactive.
  const canMarkInactive = ['Unclaimed', 'Invited', 'Approved'].includes(agency.status)

  // Gold accent on the state card — spent once, deliberately, because it
  // changes what the card means rather than decorating it. Every condition
  // here is a real "waiting on Furniture Assist" fact, the same meaning gold
  // carries everywhere else in the portal:
  //   - Pending: an approve/reject decision is waiting on Dawson.
  //   - stale invite: sent a week or more ago and still unclaimed — usually
  //     a bad address, not a slow admin, and worth a second look.
  //   - no admin email / no admin linked: the invite is stuck until Dawson
  //     fixes one of these in Airtable.
  // NOT included: unreconciled. True of roughly half the base (58/108 at
  // last count) — an accent that fires on half of everything stops being a
  // signal and starts being background noise, which would blunt the other
  // four conditions above too. Reconciled is "not yet triaged", not "stuck
  // or waiting on a decision" — a queue backlog, not an exception.
  const daysSinceInvited = agency.status === 'Invited'
    ? differenceInDaysISO(agency.invitedDate?.slice(0, 10) ?? null, todayISO)
    : null
  const staleInvite = daysSinceInvited !== null && daysSinceInvited > 7
  const noAdminEmail = !!agency.primaryAdminId && !agency.email
  const needsAttention =
    agency.status === 'Pending' || staleInvite || noAdminEmail || !agency.primaryAdminId

  const confirmBtn = (key: string, label: string, confirmLabel: string, tone: 'teal' | 'red' | 'grey' | 'gold', onClick: () => void) => {
    const toneColors = {
      teal: { bg: 'rgba(42,127,111,0.1)', fg: '#2A7F6F', activeBg: '#2A7F6F' },
      red:  { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B', activeBg: '#C0392B' },
      grey: { bg: '#F0F0F0', fg: '#7A8899', activeBg: '#7A8899' },
      gold: { bg: 'rgba(201,168,76,0.12)', fg: '#8B7724', activeBg: '#C9A84C' },
    }[tone]
    const active = confirm === key
    return (
      <button key={key} onClick={onClick} disabled={statusLoading}
        style={{
          padding: '9px 18px', borderRadius: '7px', border: 'none',
          background: active ? toneColors.activeBg : toneColors.bg,
          color: active ? 'white' : toneColors.fg,
          fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
        }}>
        {statusLoading && active ? '…' : active ? confirmLabel : label}
      </button>
    )
  }

  // Renders only while `key` is the one pending confirmation, right next to
  // the button that armed it — never a fixed, separately-placed control.
  // `confirm` is a single shared string, so only one of these is ever
  // showing anywhere on the page at a time.
  const cancelBtn = (key: string) => confirm === key && (
    <button key={`cancel-${key}`} onClick={() => { setConfirm(null); setInviteNote(null) }}
      style={{ padding: '9px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
      Cancel
    </button>
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      {notesModal && (
        <NotesModal
          currentNotes={agency.notes ?? ''}
          onSave={handleSaveNotes}
          onCancel={() => setNotesModal(false)}
          saving={notesSaving}
        />
      )}

      {/* ============ HEADER — identity + status pills only, no actions ============ */}
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', minHeight: '64px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
        position: 'sticky', top: DAWSON_PAGE_BAR_HEIGHT, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push(back.href)
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            {back.label}
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '17px', color: '#1B2B4B' }}>{agency.name}</div>
              {agency.possibleDuplicate && (
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
                  ⚠ Possible Duplicate
                </span>
              )}
            </div>
            {agency.officeName && (
              <div style={{ fontSize: '12.5px', color: '#7A8899', marginTop: '2px' }}>Office: {agency.officeName}</div>
            )}
          </div>
        </div>

        {/* Least to most significant, left to right, ending on Status — the
            primary fact about the agency. Reconciled qualifies that fact;
            "N unconfirmed", when present, qualifies the agency's staff
            underneath both. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
          {/* Exception pill: absent at zero, not muted — the normal case
              (everyone confirmed) needs no badge at all, same reasoning as
              hiding an empty group. */}
          {unconfirmedStaff > 0 && (
            <span style={{
              padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', background: '#F0F0F0', color: '#7A8899',
            }}>
              {unconfirmedStaff} unconfirmed
            </span>
          )}
          <Pill label={agency.reconciled ? 'Reconciled' : 'Not Reconciled'} tone={agency.reconciled ? 'teal' : 'gold'} />
          <span style={{
            padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            background: statusColors.badgeBg, color: statusColors.badgeText,
          }}>
            {agency.status}
          </span>
        </div>
      </header>

      {/* ============ STATE OF THIS AGENCY — timeline, controls, and Mark Inactive in one row ============
          Left to right: timeline (the narrative, reads first) — Reconciled /
          Live Referrals checkboxes — the primary action for this agency's
          status (Approve/Reject, Reconsider, Reinstate, or Send/Resend
          Invite, whichever applies) — Mark Inactive. The primary action and
          Mark Inactive sit adjacent and are kept visually distinct by tone
          alone: the primary action keeps confirmBtn's teal/red/gold, Mark
          Inactive stays grey/muted — the same distinction that already told
          them apart before they were neighbors. Mark Inactive is the one
          destructive action on this page and stays rightmost, at the true
          edge of the row, so it isn't reached for casually.

          Cancel is not a fixed control anywhere on this row — it renders
          only beside whichever action currently has a confirm pending (see
          cancelBtn above), Mark Inactive included. It's never a permanent
          second control at the far edge: it appears with the pending
          action, the choice gets made, both disappear together. Elsewhere
          in this portal a destructive action's confirm and cancel always
          sit together; a single Cancel fixed in the middle broke that here.

          The only card in this page with an accent, and only conditionally —
          see needsAttention above for exactly what earns it. The other four
          cards stay plain on purpose. */}
      <div style={{ padding: '20px 32px 0' }}>
        <div style={{ ...CARD, borderLeft: `3px solid ${needsAttention ? '#C9A84C' : 'transparent'}` }}>
          <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px 28px' }}>
          <CompactTimeline agency={agency} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#1B2B4B', cursor: 'pointer' }}>
              <input type="checkbox" checked={agency.reconciled} onChange={e => handleFlagChange('reconciled', e.target.checked)} />
              Reconciled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#1B2B4B', cursor: 'pointer' }}>
              <input type="checkbox" checked={agency.liveReferrals} onChange={e => handleFlagChange('liveReferrals', e.target.checked)} />
              Live Referrals
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {agency.status === 'Pending' && (
              <>
                {confirmBtn('Approved', 'Approve', 'Confirm Approve', 'teal', () => handleStatusChange('Approved'))}
                {cancelBtn('Approved')}
                {confirmBtn('Rejected', 'Reject', 'Confirm Reject', 'red', () => handleStatusChange('Rejected'))}
                {cancelBtn('Rejected')}
              </>
            )}
            {agency.status === 'Rejected' && (
              <>
                {confirmBtn('Pending', 'Reconsider', 'Confirm', 'gold', () => handleStatusChange('Pending'))}
                {cancelBtn('Pending')}
              </>
            )}
            {agency.status === 'Inactive' && (
              <>
                {confirmBtn('Approved', 'Reinstate', 'Confirm', 'teal', () => handleStatusChange('Approved'))}
                {cancelBtn('Approved')}
              </>
            )}

            {canInviteAgency && (
              <>
                <button onClick={handleInvite} disabled={!inviteReady || inviteLoading}
                  style={{
                    padding: '9px 18px', borderRadius: '7px', border: 'none',
                    background: confirm === 'invite' ? '#2A7F6F' : 'rgba(42,127,111,0.1)',
                    color: confirm === 'invite' ? 'white' : '#2A7F6F',
                    fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
                    cursor: inviteReady ? 'pointer' : 'not-allowed', opacity: inviteReady ? 1 : 0.45,
                  }}>
                  {inviteLoading ? '…' : confirm === 'invite' ? (isResendInvite ? 'Confirm Resend' : 'Confirm Send Invite') : (isResendInvite ? 'Resend Invite' : 'Send Invite')}
                </button>
                {cancelBtn('invite')}
                {inviteBlockReason && (
                  <span style={{ fontSize: '12px', color: '#7A8899', maxWidth: '220px', lineHeight: 1.35 }}>{inviteBlockReason}</span>
                )}
                {!inviteBlockReason && invitedAge && (
                  <span style={{ fontSize: '12px', color: '#7A8899' }}>
                    Invited {invitedAge}
                    {/* A week-old unclaimed invite usually means a bad address, not
                        a slow admin — worth a second look, not an alarm. */}
                    {invitedAge !== 'today' && invitedAge !== 'yesterday' && ' — worth checking the address if still unclaimed'}
                  </span>
                )}
              </>
            )}
          </div>

          {canMarkInactive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {confirmBtn('Inactive', 'Mark Inactive', 'Confirm Inactive', 'grey', () => handleStatusChange('Inactive'))}
              {cancelBtn('Inactive')}
            </div>
          )}
          </div>
          </div>

          {(confirm === 'invite' || inviteNote) && (
            <div style={{
              margin: '0 24px 16px', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', color: '#2C3A4A',
              background: inviteNote?.kind === 'warn' ? 'rgba(201,168,76,0.12)' : inviteNote?.kind === 'error' ? 'rgba(192,57,43,0.08)' : inviteNote?.kind === 'ok' ? 'rgba(42,127,111,0.08)' : '#F7F5F1',
            }}>
              {confirm === 'invite' && !inviteNote && (
                <>
                  {isResendInvite ? 'Re-send the portal sign-in link to ' : 'Send a portal sign-in link to '}
                  <strong style={{ color: '#1B2B4B' }}>{inviteRecipient}</strong>
                  {' — '}
                  <strong style={{ color: '#1B2B4B', fontSize: '14px' }}>{agency.email}</strong>?
                </>
              )}
              {inviteNote && (
                <span style={{ fontWeight: inviteNote.kind === 'ok' ? 400 : 700, color: inviteNote.kind === 'warn' ? '#8A6D1F' : inviteNote.kind === 'error' ? '#C0392B' : '#2A7F6F' }}>
                  {inviteNote.text}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ============ TWO RAILS ============ */}
      <div style={{ padding: '20px 32px 28px', display: 'grid', gridTemplateColumns: '1.75fr 1fr', gap: '20px', alignItems: 'start' }}>

        {/* LEFT — Staff, Referrals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={CARD}>
            <div style={CARD_HEAD}>
              <div style={CARD_TITLE}>Staff</div>
              <div style={{ fontSize: '11px', color: '#7A8899' }}>
                {staff.length} staff — not counting the primary admin
              </div>
            </div>
            {staff.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', ...MUTED_EMPTY }}>No other staff yet.</div>
            ) : (
              staff.map(u => {
                const displayName = u.name || `${u.firstName} ${u.lastName}`.trim() || '—'
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', borderBottom: '1px solid #F7F5F1' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <a href={`/dawson/staff/${u.id}`} style={{ color: '#2A7F6F', textDecoration: 'none', overflowWrap: 'anywhere' }}>
                          {displayName}
                        </a>
                        <span style={{ fontSize: '10px', color: '#9AA6B2', fontWeight: 400 }}>{u.role}</span>
                        {u.needsReview && (
                          <span title="Created from Excel import without an email - needs admin review" style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'rgba(201,168,76,0.18)', color: '#8B7724', letterSpacing: '0.06em' }}>
                            REVIEW
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#7A8899', marginTop: '2px', overflowWrap: 'anywhere' }}>
                        {formatPhoneDisplay(u.phone) ?? 'no phone on file'} · {u.email ?? <em>no email on file</em>}
                      </div>
                    </div>
                    <MembershipPill status={u.membershipStatus} />
                  </div>
                )
              })
            )}
          </div>

          <ReferralsCard referrals={agency.referrals} />
        </div>

        {/* RIGHT — Agency, Primary Admin, Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={CARD}>
            <div style={CARD_HEAD}><div style={CARD_TITLE}>Agency</div></div>
            <div style={{ padding: '4px 24px 8px' }}>
              {/* Office and the agency name are both already in the page
                  header — not repeated here. */}
              <InfoRow
                label="Address"
                value={agency.address || locality ? (
                  <>
                    {agency.address}{agency.address2 ? `, ${agency.address2}` : ''}
                    {agency.address && locality ? <br /> : null}
                    {locality}
                  </>
                ) : null}
                emptyText="Not on file"
              />
              <InfoRow label="County" value={agency.county ? `${agency.county} County` : null} emptyText="Not on file" />
              <InfoRow label="Main Phone" value={formatPhoneDisplay(agency.phone)} emptyText="Not on file" />
              <InfoRow label="EIN" value={agency.ein} emptyText="Not on file" />
              <InfoRow
                label="Website"
                value={agency.website ? <a href={agency.website} target="_blank" rel="noreferrer" style={{ color: '#2A7F6F', textDecoration: 'none' }}>{agency.website}</a> : null}
                emptyText="Not on file"
              />
              <InfoRow label="Source" value={agency.source} emptyText="Not on file" />
            </div>
          </div>

          <div style={CARD}>
            <div style={CARD_HEAD}>
              <div style={CARD_TITLE}>Primary Admin</div>
              {/* Confirmed is the normal case and gets no badge — only the
                  unconfirmed state (expected on any not-yet-invited agency,
                  see the MembershipPill note) is worth a pill here. */}
              {agency.primaryAdminId && primaryAdmin?.membershipStatus !== 'Confirmed' && (
                <MembershipPill status={primaryAdmin?.membershipStatus ?? null} />
              )}
            </div>
            <div style={{ padding: '4px 24px 8px' }}>
              {agency.primaryAdminId ? (
                <>
                  <InfoRow label="Name" value={`${agency.contactFirstName ?? ''} ${agency.contactLastName ?? ''}`.trim() || null} />
                  <InfoRow label="Email" value={agency.email ? <a href={`mailto:${agency.email}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{agency.email}</a> : null} />
                  <InfoRow label="Phone" value={formatPhoneDisplay(agency.contactPhone)} />
                </>
              ) : (
                <div style={{ padding: '12px 0', ...MUTED_EMPTY }}>
                  No primary admin assigned yet. Set one from the Portal Staff list when the agency claims.
                </div>
              )}
            </div>
          </div>

          <NotesCard notes={agency.notes} onEdit={() => setNotesModal(true)} />
        </div>
      </div>
    </div>
  )
}
