'use client'

// app/dawson/staff/[id]/page.tsx
//
// detail-pages-rebuild, reshaped (staff-detail-reshape) to match
// app/dawson/agencies/[id]/page.tsx's structure — header pills, compact
// lifecycle timeline, filterable/grouped referrals card, right-rail cards
// instead of one long info list. Fed entirely by GET /api/dawson/staff/[id]
// (getStaffWithDetails) — one Agency Users record, one Agencies record (for
// Status and Primary Admin — Name comes off a lookup already on the Agency
// Users row), and this person's referrals via the Client Referrals reverse
// link. See lib/airtable/agency-users.ts for the read.
//
// Read-only, same as before this rebuild and before this reshape — no
// status changes, no editing. Every caller (Referral Details card,
// agencies/[id] staff rows, staff/wrong-agency, universal search) wants
// "view the record"; none expects an action here.
//
// Weights: Lato (no fontFamily set, the inherited body face) ships 400/700
// only; Montserrat (fontFamily: var(--font-montserrat)) ships 400/600/700.
// The previous version of this page used Montserrat 800 throughout and Lato
// 600 in a few places — both unloaded, the same bug the agency portal was
// swept for. Every declaration below is 400/600/700.

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { DAWSON_PAGE_BAR_HEIGHT } from '@/components/internal/DawsonPageBar'
import { formatEasternTimestamp, formatDateOnly, formatRelativeTime, easternTodayISO, differenceInDaysISO } from '@/lib/dates'
import { fileDateOf } from '@/lib/referrals/effective-date'
import { matchesSearch } from '@/lib/search'
import CompactTimeline, { type TimelineSegment } from '@/components/internal/CompactTimeline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Referral = {
  id: string
  clientName: string
  referralReview: string
  appointmentStatus: string
  effectiveAppointmentDate: string | null
  preferredDate: string | null
}

type Staff = {
  id: string
  firstName: string
  lastName: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  status: string | null
  invitedDate: string | null
  invitedBy: string | null
  recordCreationDate: string | null
  needsReview: boolean
  clerkUserId: string | null
  // Membership is a SEPARATE axis from Status / Portal Invite Status — an
  // agency admin's own assertion that this person works there. Blank
  // (unconfirmed, the default) is what this whole rebuild exists to stop
  // hiding — see the header pill and the Portal access card below.
  membershipStatus: string | null
  membershipDecidedBy: string | null
  membershipDecidedAt: string | null
  // The portal claim, stamped once by stampFirstLogin on first Clerk
  // sign-in. NOT the same fact as the older agency-data-reconciliation
  // claim-token flow (served by app/agency/claim/[token]) — that flow is
  // about agency profile data, not portal access, and doesn't belong here.
  claimedDate: string | null
  lastLogin: string | null
  portalInviteStatus: string | null
  // Ben's own hand-ticked check on a bounced send, not an automated flag.
  emailBounce: boolean
  agencyId: string | null
  agencyName: string | null
  agencyStatus: string | null
  // staff-detail-reshape — whether this person is their agency's linked
  // Primary Admin. See lib/airtable/agency-users.ts.
  isPrimaryAdmin: boolean
  referrals: Referral[]
  referralCount: number
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// Record Creation Date is a date-only value ('YYYY-MM-DD') despite its
// Airtable field type — checked live, not assumed from the type name.
// Invited Date / Claimed Date / Last Login are real instants (full
// timestamps) and go through formatEasternTimestamp instead.
//
// Both drop the year when the date falls in the CURRENT calendar year, and
// show it otherwise — a rule, not a copy of the agency page's unconditional
// year-less formatting. That page can drop the year unconditionally because
// Reconciled / Live Referrals work is all this year; a staff record carries
// no such guarantee (Record Creation Date can be years old), and a
// year-less "Jan 4" on a 2024 record would misread as recent.
function formatDateShortMaybeYear(dateStr: string | null, currentYear: number): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T12:00:00')
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === currentYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return d.toLocaleDateString('en-US', opts)
}
function formatInstantShortMaybeYear(dateStr: string | null, currentYear: number): string | null {
  if (!dateStr) return null
  const year = new Date(dateStr).getFullYear()
  const opts: Intl.DateTimeFormatOptions = year === currentYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return formatEasternTimestamp(dateStr, opts)
}

// Full-date variants for the InfoRow-style Contact/Portal access cards —
// unrelated to the compact timeline's space constraint, always carry the
// year.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatInstant(dateStr: string | null): string {
  if (!dateStr) return '—'
  return formatEasternTimestamp(dateStr, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Lifecycle timeline — four segments, this person's own: Created, Invited
// (with who sent it), Claimed, Last login. Rendered by the shared
// CompactTimeline (components/internal/CompactTimeline.tsx) — the agency
// page's timeline moved there in the same branch so both pages draw from
// one implementation. Segment content stays here: what counts as "reached"
// and which date is specific to a staff record, not something the shared
// renderer should know about.
// ---------------------------------------------------------------------------

function buildStaffTimeline(staff: Staff, currentYear: number): TimelineSegment[] {
  return [
    {
      label: 'Created', reached: true,
      date: formatDateShortMaybeYear(staff.recordCreationDate, currentYear),
      tone: 'teal',
    },
    {
      label: 'Invited', reached: !!staff.invitedDate,
      date: staff.invitedDate
        ? `${formatInstantShortMaybeYear(staff.invitedDate, currentYear)}${staff.invitedBy ? ` · by ${staff.invitedBy}` : ''}`
        : null,
      tone: 'teal',
    },
    {
      label: 'Claimed', reached: !!staff.claimedDate,
      date: formatInstantShortMaybeYear(staff.claimedDate, currentYear),
      tone: 'teal',
    },
    {
      label: 'Last login', reached: !!staff.lastLogin,
      date: formatInstantShortMaybeYear(staff.lastLogin, currentYear),
      tone: 'teal',
    },
  ]
}

// ---------------------------------------------------------------------------
// Styling — same tokens as the agency detail page
// ---------------------------------------------------------------------------

const CARD: React.CSSProperties = {
  background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden',
}
const CARD_HEAD: React.CSSProperties = {
  padding: '16px 24px', borderBottom: '1px solid #EDE9E1',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
}
const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
  letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B',
}
const MUTED_EMPTY: React.CSSProperties = { fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }

// Staff statuses come from Agency Users.Status: Active | Invited | Unclaimed
// | Pending | Inactive — confirmed live, all 5 covered.
const STATUS_COLORS: Record<string, { badgeBg: string; badgeText: string }> = {
  Active:    { badgeBg: 'rgba(42,127,111,0.12)', badgeText: '#2A7F6F' },
  Invited:   { badgeBg: 'rgba(91,141,184,0.12)', badgeText: '#5B8DB8' },
  Unclaimed: { badgeBg: '#F0F0F0',               badgeText: '#7A8899' },
  // #7A6111, not the brand gold #C9A84C: on this pill's own 15% gold tint
  // #C9A84C measures 2.04:1. Same darkened gold used by the gold pills on
  // the referrals list, referral detail and agency detail pages.
  Pending:   { badgeBg: 'rgba(201,168,76,0.15)', badgeText: '#7A6111' },
  Inactive:  { badgeBg: '#F0F0F0',               badgeText: '#7A8899' },
}

// Portal state — a second, different axis from Status above (Active says
// the account works; this says whether they've actually signed in) and from
// Membership below (does this person work at the agency at all). Same three
// values as Portal Invite Status, reusing the same colour tokens the
// account-status pill's Invited/Unclaimed states already use — this is a
// compact 3-state badge, not the fuller "Invited {date}" / "Last login
// {relative}" detail the Portal access card gives the same fact below.
const PORTAL_STATE_STYLE: Record<string, { badgeBg: string; badgeText: string; label: string }> = {
  'Not Invited': { badgeBg: '#F0F0F0', badgeText: '#7A8899', label: 'Not invited' },
  'Invite Sent': { badgeBg: 'rgba(91,141,184,0.12)', badgeText: '#5B8DB8', label: 'Invited' },
  Claimed:       { badgeBg: 'rgba(42,127,111,0.12)', badgeText: '#2A7F6F', label: 'Claimed' },
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '140px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || '—'}
      </div>
    </div>
  )
}

// Header pill. Hides entirely at 'Confirmed' — the normal, healthy value —
// so a fully-confirmed staff member shows no membership pill at all rather
// than a reassuring one. 'Not At This Office' reads the same muted grey as
// plain-unconfirmed (matching the Team page's own convention: that state is
// a recoverable parked state, not an alarm, once it's already been flagged
// — the destructive weight lives in the confirm dialog that gets a person
// there, not in every later display of it), with distinct label text.
function MembershipPill({ status }: { status: string | null }) {
  if (status === 'Confirmed') return null
  const label = status === 'Not At This Office' ? 'Not at this office' : 'Not yet confirmed'
  return (
    <span style={{
      padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
      letterSpacing: '0.04em', textTransform: 'uppercase', background: '#F0F0F0', color: '#7A8899',
    }}>
      {label}
    </span>
  )
}

// Portal access card's own read of the same fact the header's portal-state
// pill compresses — "Not invited" / "Invited {date}" / "Last login
// {relative}" / "Never signed in". Same copy and logic as AccountState on
// the agency detail page (app/dawson/agencies/[id]/page.tsx); not shared
// from there in this branch — flagged in the PR as a small duplication
// worth consolidating alongside the ReferralsCard one, not fixed here.
function InviteState({ portalInviteStatus, invitedDate, lastLogin }: {
  portalInviteStatus: string | null
  invitedDate: string | null
  lastLogin: string | null
}) {
  const status = portalInviteStatus ?? 'Not Invited'
  if (status === 'Not Invited') return <span>Not invited</span>
  if (status === 'Invite Sent') {
    return <span>Invited {formatEasternTimestamp(invitedDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
  }
  // Claimed
  return <span>{lastLogin ? `Last login ${formatRelativeTime(lastLogin)}` : 'Never signed in'}</span>
}

// ---------------------------------------------------------------------------
// Referrals — rebuilt to match agencies/[id]'s ReferralsCard (search, status
// pills with counts, date-range select, month grouping, columns) rather
// than the plain stacked list this page had before. Not shared from that
// page in this branch (only fileDateOf is, per instruction) — the two cards
// are now near-identical, which is worth knowing; flagged in the PR as a
// follow-up candidate, same shape as the fileDateOf situation before its
// own consolidation branch. This card keeps 3 columns (no Staff column) —
// every row here is already this one person's referral.
// ---------------------------------------------------------------------------

// 'Reschedule' confirmed against Airtable's full Appointment Status option
// list (Pending Schedule, Scheduled, Cancelled, Reschedule, Completed, No
// Show — six values, this has all six).
type ReferralStatusKey = 'Pending Schedule' | 'Scheduled' | 'Cancelled' | 'Reschedule' | 'Completed' | 'No Show'
const REFERRAL_STATUS_ORDER: ReferralStatusKey[] = ['Pending Schedule', 'Scheduled', 'Reschedule', 'Cancelled', 'Completed', 'No Show']
const REFERRAL_STATUS_STYLE: Record<ReferralStatusKey, { bg: string; fg: string }> = {
  'Pending Schedule': { bg: '#F0F0F0', fg: '#7A8899' },
  Scheduled:          { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F' },
  Reschedule:         { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
  Cancelled:          { bg: 'rgba(192,57,43,0.1)', fg: '#C0392B' },
  Completed:          { bg: '#F0F0F0', fg: '#7A8899' },
  'No Show':          { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
}
// Anything not in REFERRAL_STATUS_STYLE (an Airtable option this map hasn't
// caught up with) falls back to this — red, visually unlike every real
// status so it can't be mistaken for one — same convention as the agency
// page's fix for the identical shape of bug.
const UNKNOWN_STATUS_STYLE = { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B' }
const REFERRAL_STATUS_LABEL: Record<ReferralStatusKey, string> = {
  'Pending Schedule': 'Pending Schedule',
  Scheduled: 'Scheduled',
  Reschedule: 'Reschedule requested',
  Cancelled: 'Cancelled',
  Completed: 'Completed',
  'No Show': 'No Show',
}

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

function ReferralsCard({ referrals }: { referrals: Referral[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReferralStatusKey | 'All'>('All')
  // 90 days by default, matching the agency page.
  const [range, setRange] = useState<RangeKey>('90')

  const todayISO = easternTodayISO()

  // Same withinRange as the agency page: bounds on fileDateOf, exempts a
  // null file date from every range (including 90 days) rather than
  // dropping it — a referral with no date yet has nothing to measure
  // against a range, and filtering it out under the default range is
  // exactly the silently-missing-row failure that rule exists to close.
  const withinRange = (r: Referral): boolean => {
    if (range === 'all') return true
    const fd = fileDateOf(r)
    if (fd === null) return true
    const days = differenceInDaysISO(fd, todayISO)
    if (days === null) return true
    const limit = range === '90' ? 90 : 365
    return Math.abs(days) <= limit
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

// Client · Date · Status. No Staff column — every row on this card is
// already this one person's referral, so repeating their name would be
// noise. No column headers — same reasoning as agencies/[id]: self-evident
// content, and the coloured pill needs no label either.
const REFERRAL_ROW_GRID = 'minmax(0, 1fr) 110px 150px'

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
// Page
// ---------------------------------------------------------------------------

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    params.then(({ id }) => {
      fetch(`/api/dawson/staff/${id}`)
        .then(async r => {
          if (r.status === 404) { setNotFound(true); setLoading(false); return null }
          if (!r.ok) throw new Error('load failed')
          return r.json()
        })
        .then(data => {
          if (data) setStaff(data)
          setLoading(false)
        })
        .catch(() => { setNotFound(true); setLoading(false) })
    })
  }, [params])

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading staff...
    </div>
  )

  if (notFound || !staff) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Staff not found.
    </div>
  )

  const statusColors = STATUS_COLORS[staff.status ?? ''] ?? STATUS_COLORS.Inactive
  const portalState = PORTAL_STATE_STYLE[staff.portalInviteStatus ?? 'Not Invited'] ?? PORTAL_STATE_STYLE['Not Invited']
  const todayISO = easternTodayISO()
  const currentYear = Number(todayISO.slice(0, 4))
  const timeline = buildStaffTimeline(staff, currentYear)

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      {/* ============ HEADER ============ */}
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', minHeight: '64px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
        position: 'sticky', top: DAWSON_PAGE_BAR_HEIGHT, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
          {/* Fallback to /dawson/agencies when opened in a fresh tab — staff
              pages are always reached from an agency or referral page.
              /dawson/agencies/active was the pre-consolidation name; it only
              worked because next.config.ts still redirects it. */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/dawson/agencies')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '17px', color: '#1B2B4B' }}>
              {staff.name || '—'}
            </div>
            <div style={{ fontSize: '12.5px', color: '#7A8899', marginTop: '2px' }}>
              {staff.role ?? '—'}
              {' · '}
              {staff.agencyId && staff.agencyName ? (
                <a href={`/dawson/agencies/${staff.agencyId}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>
                  {staff.agencyName}
                </a>
              ) : (
                <span style={{ fontStyle: 'italic' }}>no agency linked</span>
              )}
            </div>
          </div>
        </div>

        {/* Account status and Portal state: different axes, always both
            shown. Active says the account works; Claimed says they've
            actually signed in — neither implies the other. Everything after
            is a conditional exception pill, hidden at its normal value, so
            a healthy record shows exactly two. Primary Admin sits first
            among those — solid navy, unlike every other pill on this page
            (all light-bg/dark-text) — because it isn't an exception like
            the ones beside it, it's the single most significant fact this
            page can carry about this person: what the invite route gates
            on, true of exactly one person per agency. A muted note under
            Role would have understated it. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
          {staff.isPrimaryAdmin && (
            <span style={{
              padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', background: '#1B2B4B', color: 'white',
            }}>
              Primary Admin
            </span>
          )}
          <MembershipPill status={staff.membershipStatus} />
          {staff.emailBounce && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
              ⚠ Email Bounced
            </span>
          )}
          {staff.needsReview && (
            <span
              title="Created from Excel import without an email — needs admin review"
              style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(201,168,76,0.18)', color: '#C9A84C' }}
            >
              ⚠ Review
            </span>
          )}
          <span style={{
            padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', background: portalState.badgeBg, color: portalState.badgeText,
          }}>
            {portalState.label}
          </span>
          {staff.status && (
            <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: statusColors.badgeBg, color: statusColors.badgeText }}>
              {staff.status}
            </span>
          )}
        </div>
      </header>

      {/* ============ LIFECYCLE ============ */}
      <div style={{ padding: '20px 32px 0' }}>
        <div style={CARD}>
          <div style={{ padding: '16px 24px' }}>
            <CompactTimeline segments={timeline} />
          </div>
        </div>
      </div>

      {/* ============ TWO RAILS ============ */}
      <div style={{ padding: '20px 32px 28px', display: 'grid', gridTemplateColumns: '1.75fr 1fr', gap: '20px', alignItems: 'start' }}>

        {/* LEFT — Referrals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ReferralsCard referrals={staff.referrals} />
        </div>

        {/* RIGHT — Contact, Portal access */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={CARD}>
            <div style={CARD_HEAD}><div style={CARD_TITLE}>Contact</div></div>
            <div style={{ padding: '4px 24px 8px' }}>
              <InfoRow
                label="Email"
                value={staff.email
                  ? <a href={`mailto:${staff.email}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{staff.email}</a>
                  : <em style={{ color: '#C9A84C' }}>no email on file</em>}
              />
              <InfoRow label="Phone" value={staff.phone} />
              <InfoRow
                label="Agency"
                value={
                  staff.agencyId && staff.agencyName ? (
                    <a href={`/dawson/agencies/${staff.agencyId}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>
                      {staff.agencyName}
                      {staff.agencyStatus && (
                        <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, padding: '1px 8px', borderRadius: '20px', background: '#F0F0F0', color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {staff.agencyStatus}
                        </span>
                      )}
                    </a>
                  ) : (
                    <span style={{ color: '#7A8899', fontStyle: 'italic' }}>No agency linked</span>
                  )
                }
              />
            </div>
          </div>

          <div style={CARD}>
            <div style={CARD_HEAD}><div style={CARD_TITLE}>Portal access</div></div>
            <div style={{ padding: '4px 24px 8px' }}>
              <InfoRow label="Role" value={staff.role} />
              <InfoRow
                label="Membership"
                value={
                  staff.membershipStatus === 'Confirmed'
                    ? <><span style={{ color: '#2A7F6F' }}>Confirmed</span>{staff.membershipDecidedBy && ` by ${staff.membershipDecidedBy}`}{staff.membershipDecidedAt && ` · ${formatInstant(staff.membershipDecidedAt)}`}</>
                    : staff.membershipStatus === 'Not At This Office'
                      ? <><span style={{ color: '#7A8899' }}>Not at this office</span>{staff.membershipDecidedBy && ` by ${staff.membershipDecidedBy}`}{staff.membershipDecidedAt && ` · ${formatInstant(staff.membershipDecidedAt)}`}</>
                      : <span style={{ color: '#9AA6B2' }}>Not yet confirmed</span>
                }
              />
              <InfoRow
                label="Invite"
                value={
                  <InviteState
                    portalInviteStatus={staff.portalInviteStatus}
                    invitedDate={staff.invitedDate}
                    lastLogin={staff.lastLogin}
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
