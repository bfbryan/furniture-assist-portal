'use client'

// app/dawson/referrals/page.tsx
//
// The one internal Referrals page. Replaces /dawson/referrals/scheduled and
// /dawson/referrals/history (both retired, both 307-redirected here in
// next.config.ts). The referral detail page /dawson/referrals/[id] is
// unchanged.
//
// This is a LOOKUP page, not a browse list. Dawson's day-to-day entry point is
// the dashboard, whose right rail links here pre-filtered to one Saturday
// (?date=YYYY-MM-DD). So the page has to be good at exactly two things:
// finding one referral by search, and showing one filtered week. "What's
// coming up" is the dashboard's job.
//
// Every filter — search, date range, status pill, which groups are open —
// lives in the URL via useListUrlState, so clicking into a referral and
// pressing Back restores the list exactly. That is the OCR reconciliation
// pass: open a Saturday, click each client to check the scan read, Back, next
// — fifty times.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addDaysISO, easternTodayISO, formatDateOnly } from '@/lib/dates'
import { isAwaitingOutcome, withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'
import { formatSlot } from '@/lib/referrals/slot-display'
import { matchesSearch } from '@/lib/search'
import { useListUrlState } from '@/components/internal/useListUrlState'
import CancelModal from '@/components/internal/modals/CancelModal'
import RescheduleModal, { type AvailableDate } from '@/components/internal/modals/RescheduleModal'
import {
  OverflowMenu,
  type MenuItem,
  RESCHEDULE_ICON,
  CANCEL_ICON,
  DOC_ICON,
} from '@/components/agency/referral-list-ui'

// ---------------------------------------------------------------- shape

// A subset of the getAllReferrals list shape — only the fields this page reads.
type Referral = {
  id: string
  clientName: string
  appointmentDate: string | null
  appointmentTime: string | null
  effectiveAppointmentDate: string | null
  preferredDate: string | null
  preferredTime: string | null
  referralReview: string
  appointmentStatus: string
  referredBy: string | null
  referringAgency: string | null
  city: string | null
  state: string | null
  clientReceiptUrl: string | null
}

// ---------------------------------------------------------------- constants

// Statuses whose grouping/label date IS the effective appointment date — these
// come back from a server date-bounded query.
const DATED_STATUSES = ['Scheduled', 'Completed', 'No Show', 'Cancelled', 'Withdrawn']

// Statuses that hold no confirmed slot, so Effective Appointment Date is blank
// and a date-bounded query never returns them. Fetched unbounded (a small,
// fast-draining set) and windowed here by Preferred Date instead. 'Unscheduled'
// is the legacy synonym for 'Pending Schedule' — no live rows today, kept so
// the pill can't silently miss one. See the consolidation plan.
const REQUEST_STATUSES = ['Pending Schedule', 'Unscheduled', 'Reschedule']

function isRequestStatus(s: string): boolean {
  return s === 'Reschedule' || s === 'Pending Schedule' || s === 'Unscheduled'
}

const RANGES = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '180d', label: 'Last 6 months' },
  { key: 'all', label: 'All time' },
] as const
const RANGE_DAYS: Record<string, number> = { '30d': 30, '90d': 90, '180d': 180, all: 0 }

// Resting state. A key at its default is dropped from the URL (useListUrlState),
// so /dawson/referrals with no query string is the clean default view.
const DEFAULTS = { q: '', range: '90d', date: '', pill: 'all', open: '' }

type DerivedStatus =
  | 'pending' | 'reschedule' | 'scheduled' | 'awaiting'
  | 'completed' | 'missed' | 'cancelled' | 'withdrawn'
type PillKey = 'all' | DerivedStatus

// Sentence case, shortened where the nine would wrap badly ("Reschedule
// requested" / "Awaiting outcome" are the long ones). They wrap to a second
// row on a narrow window; that's fine.
const PILLS: { key: PillKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'reschedule', label: 'Reschedule' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed', label: 'No Show' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'withdrawn', label: 'Withdrawn' },
]
const PILL_KEYS = PILLS.map(p => p.key) as PillKey[]

// Row status pill. All colours are already in the codebase — teal/navy/gold/red
// from the brand palette, the greys from globals.css. 'Awaiting outcome' reuses
// the exact treatment the agency side uses (DashboardLastSaturday, referral
// detail). The `missed` derived status is labelled 'No Show' here — the
// internal term, matching the Airtable value. The agency portal deliberately
// shows the same status as "Missed Appointment"; different audience.
const STATUS_UI: Record<DerivedStatus, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pending', bg: 'rgba(122,136,153,0.14)', color: '#5A6878' },
  reschedule: { label: 'Reschedule requested', bg: 'rgba(201,168,76,0.18)', color: '#8A6D14' },
  scheduled: { label: 'Scheduled', bg: 'rgba(42,127,111,0.12)', color: '#2A7F6F' },
  awaiting: { label: 'Awaiting outcome', bg: '#EDEBE7', color: '#7A8899' },
  completed: { label: 'Completed', bg: 'rgba(27,43,75,0.08)', color: '#1B2B4B' },
  missed: { label: 'No Show', bg: 'rgba(201,168,76,0.15)', color: '#C9A84C' },
  cancelled: { label: 'Cancelled', bg: 'rgba(192,57,43,0.10)', color: '#C0392B' },
  withdrawn: { label: 'Withdrawn', bg: 'rgba(192,57,43,0.10)', color: '#C0392B' },
}

// Client · Agency · Town · Appointment · Status · ⋯
//
// Staff (the agency person who sent the referral) is NOT a column: at the
// 1100px content cap, a sixth data column forces Client and Agency to truncate
// past readability given how long agency names run in this base. Staff stays
// searchable and is one row-click away on the detail page.
const GRID = 'minmax(0, 1.6fr) minmax(0, 1.3fr) 120px minmax(140px, 0.9fr) 150px 40px'
const COLS = ['Client', 'Agency', 'Town', 'Appointment', 'Status', '']

// ---------------------------------------------------------------- helpers

const MONT = 'var(--font-montserrat)'

const fmtDate = (iso: string) =>
  formatDateOnly(iso, { month: 'short', day: 'numeric', year: 'numeric' })

function formatSatHeader(iso: string): string {
  return formatDateOnly(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function monthLabel(key: string): string {
  // key is 'YYYY-MM'
  return formatDateOnly(`${key}-01`, { month: 'long', year: 'numeric' })
}

function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

function displayLastFirst(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
}

// The date a row is filed under and printed against. For a request-status row
// that's the PREFERRED date (it holds no booked slot); otherwise the effective
// appointment date. Falls back to the effective date for the rare reschedule
// asked for with no specific Saturday.
function fileDateOf(r: Referral): string | null {
  if (isRequestStatus(r.appointmentStatus)) {
    return r.preferredDate || r.effectiveAppointmentDate || null
  }
  return r.effectiveAppointmentDate || null
}

// Derived status — the single source for both the pill counts and the row
// pill, so the two can't disagree. 'awaiting' is a Scheduled referral whose
// Saturday has passed with no outcome recorded (isAwaitingOutcome, the same
// helper and the same raw-status key the agency side uses).
function deriveStatus(r: Referral, todayISO: string): DerivedStatus {
  const s = r.appointmentStatus
  if (s === 'Scheduled') {
    return isAwaitingOutcome(s, r.appointmentDate, todayISO) ? 'awaiting' : 'scheduled'
  }
  if (s === 'Reschedule') return 'reschedule'
  if (s === 'Completed') return 'completed'
  if (s === 'No Show') return 'missed'
  if (s === 'Cancelled') return 'cancelled'
  if (s === 'Withdrawn') return 'withdrawn'
  return 'pending' // Pending Schedule / Unscheduled / anything unbooked
}

// ---------------------------------------------------------------- small UI

function FilterPill({
  label, count, active, disabled, onClick,
}: {
  label: string; count: number; active: boolean; disabled: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: '5px 12px', borderRadius: '20px', border: '1px solid',
        borderColor: active ? '#2A7F6F' : '#EDE9E1',
        background: active ? '#2A7F6F' : 'white',
        color: active ? 'white' : disabled ? '#B8C1CC' : '#7A8899',
        fontSize: '12px', fontWeight: 700, fontFamily: MONT, letterSpacing: '0.01em',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

type RowItem = { r: Referral; st: DerivedStatus }

function ReferralRow({
  item, menuItems, menuOpen, onMenuOpen, onMenuClose, isLast,
}: {
  item: RowItem
  menuItems: MenuItem[]
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
  isLast: boolean
}) {
  const router = useRouter()
  const { r, st } = item
  const ui = STATUS_UI[st]
  const req = isRequestStatus(r.appointmentStatus)
  const apptText = req
    ? formatSlot(r.preferredDate, r.preferredTime, fmtDate)
    : formatSlot(r.effectiveAppointmentDate, r.appointmentTime, fmtDate)
  const town = r.city ? [r.city, r.state].filter(Boolean).join(', ') : '—'
  const href = `/dawson/referrals/${r.id}`

  return (
    <div
      onClick={() => router.push(href)}
      onMouseEnter={e => (e.currentTarget.style.background = '#FAFAF8')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'grid', gridTemplateColumns: GRID, gap: '16px', alignItems: 'center',
        // Single-line rows — no client phone sub-line (Dawson never calls
        // clients, that's the agency's job; the number is on the detail page).
        // Block padding tightened 13px -> 9px to suit.
        padding: '9px 24px', borderTop: '1px solid #F3F0EA', cursor: 'pointer',
        // Round the last row so its hover fill follows the card's bottom
        // corners — the group body no longer clips (see Group).
        ...(isLast ? { borderBottomLeftRadius: '10px', borderBottomRightRadius: '10px' } : {}),
      }}
    >
      {/* Client — the one link in the row (stops propagation so cmd-click on
          the name opens a tab without the row's onClick also firing) */}
      <div style={{ minWidth: 0 }}>
        <a
          href={href}
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block', textDecoration: 'none', fontFamily: MONT, fontWeight: 500,
            fontSize: '14px', color: '#2A7F6F',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {displayLastFirst(r.clientName)}
        </a>
      </div>

      {/* Agency — muted, not a link */}
      <div style={{ fontSize: '13px', color: '#7A8899', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {r.referringAgency ?? '—'}
      </div>

      {/* Town */}
      <div style={{ fontSize: '13px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {town}
      </div>

      {/* Appointment — gold + bold for a request (preferred date, not a
          booking); navy for a confirmed slot. Readable without the pill. */}
      <div style={{
        fontSize: '13px', fontWeight: req ? 700 : 500,
        color: req ? '#C9A84C' : '#1B2B4B',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {apptText}
      </div>

      {/* Status */}
      <div>
        <span style={{
          display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '3px 10px',
          borderRadius: '20px', background: ui.bg, color: ui.color, whiteSpace: 'nowrap',
        }}>
          {ui.label}
        </span>
      </div>

      {/* ⋯ — stopPropagation so opening the menu / clicking an item never
          navigates the row. Deliberate exception to "no hidden menus on
          Dawson's side": the aim is that he rarely acts from this page at all. */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {menuItems.length > 0 && (
          <OverflowMenu
            open={menuOpen}
            onOpen={onMenuOpen}
            onClose={onMenuClose}
            items={menuItems}
            label={`Actions for ${r.clientName}`}
          />
        )}
      </div>
    </div>
  )
}

function Group({
  title, count, summary, open, onToggle, children,
}: {
  title: string
  count: number
  summary: string[]
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px', borderRadius: '10px', background: 'white',
          border: '1px solid #EDE9E1', cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(27,43,75,0.04)', marginBottom: open ? '6px' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Chevron open={open} />
          <span style={{ fontFamily: MONT, fontWeight: 700, fontSize: '15px', color: '#1B2B4B' }}>
            {title}
          </span>
          <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 500 }}>({count})</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {summary.map(s => (
            <span key={s} style={{
              fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
              background: '#F0EDE8', color: '#7A8899',
            }}>
              {s}
            </span>
          ))}
        </div>
      </button>

      {open && (
        // No `overflow: hidden` here. It was clipping the row ⋯ dropdown on the
        // last row of a group — on a single-row group there's nothing below it,
        // so the menu rendered half outside the card. The rounded corners are
        // kept instead by rounding the header (top) and the last row (bottom)
        // directly. The shared OverflowMenu opens downward; with the clip gone
        // it now overlaps the gap / next group, which is fine.
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #EDE9E1' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: '16px', alignItems: 'center',
            padding: '10px 24px', borderBottom: '1px solid #E5DECF', background: '#F7F5F1',
            borderRadius: '10px 10px 0 0',
          }}>
            {COLS.map((c, i) => (
              <div key={i} style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.01em', color: '#9AA6B2' }}>
                {c}
              </div>
            ))}
          </div>
          {children}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- page

function ReferralsView() {
  const todayISO = easternTodayISO()

  const [urlState, setUrlState] = useListUrlState(DEFAULTS)
  const search = urlState.q
  const pill: PillKey = PILL_KEYS.includes(urlState.pill as PillKey)
    ? (urlState.pill as PillKey)
    : 'all'
  const singleDate = /^\d{4}-\d{2}-\d{2}$/.test(urlState.date) ? urlState.date : ''
  const rangeKey = RANGE_DAYS[urlState.range] !== undefined ? urlState.range : '90d'
  const rangeDays = singleDate ? 0 : RANGE_DAYS[rangeKey]

  const [dated, setDated] = useState<Referral[]>([])
  const [requests, setRequests] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)

  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [cancelModal, setCancelModal] = useState({ open: false, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState({ open: false, id: '', name: '' })
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Two fetches. The dated statuses are bounded server-side on Effective
  // Appointment Date; the request statuses have no such date, so they come
  // back unbounded (a small set — Dawson books them within a week or two) and
  // are windowed by Preferred Date in the merge below.
  const lowerBound = rangeDays > 0 ? addDaysISO(todayISO, -rangeDays) : ''
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const datedParams = new URLSearchParams()
    DATED_STATUSES.forEach(s => datedParams.append('status', s))
    if (singleDate) {
      datedParams.set('appointmentDateFrom', singleDate)
      datedParams.set('appointmentDateTo', singleDate)
    } else if (lowerBound) {
      datedParams.set('appointmentDateFrom', lowerBound)
    }

    const reqParams = new URLSearchParams()
    REQUEST_STATUSES.forEach(s => reqParams.append('status', s))

    Promise.all([
      fetch(`/api/dawson/referrals?${datedParams.toString()}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`/api/dawson/referrals?${reqParams.toString()}`, { cache: 'no-store' }).then(r => r.json()),
    ])
      .then(([a, b]) => {
        if (cancelled) return
        setDated(Array.isArray(a) ? a : [])
        setRequests(Array.isArray(b) ? b : [])
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [singleDate, lowerBound, reloadTick])

  // Availability for the Reschedule modal, plus the refocus refetch.
  //
  // LOAD-BEARING: the OCR reconciliation pass is this tab losing and regaining
  // focus — open a referral, check the scan, come back. Without the refetch,
  // every row Dawson just touched still shows its pre-edit status. Do not
  // remove this as an unused listener.
  useEffect(() => {
    fetch('/api/dawson/schedule/available?weeks=8&leadDays=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAvailableDates(Array.isArray(d) ? d : []))
      .catch(() => {})

    const refresh = () => setReloadTick(t => t + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Merge: dated rows as-is, request rows windowed by Preferred Date. A
  // request row with no preferred date can't be placed in a bounded window, so
  // it only appears under "All time" (in the undated group). Deliberate — the
  // dashboard owns the open pending queue.
  const rows = useMemo(() => {
    const map = new Map<string, Referral>()
    for (const r of dated) map.set(r.id, r)
    for (const r of requests) {
      const d = r.preferredDate
      if (singleDate) {
        if (d === singleDate) map.set(r.id, r)
      } else if (rangeDays > 0) {
        if (d && d >= addDaysISO(todayISO, -rangeDays)) map.set(r.id, r)
      } else {
        map.set(r.id, r)
      }
    }
    return [...map.values()]
  }, [dated, requests, singleDate, rangeDays, todayISO])

  const withStatus = useMemo<RowItem[]>(
    () => rows.map(r => ({ r, st: deriveStatus(r, todayISO) })),
    [rows, todayISO],
  )

  // Pill counts describe the date window, NOT the search or the active pill —
  // they show where things stand and must not shrink as Dawson types (same
  // rule as the Agencies page).
  const pillCounts = useMemo(() => {
    const c: Record<PillKey, number> = {
      all: withStatus.length, pending: 0, reschedule: 0, scheduled: 0, awaiting: 0,
      completed: 0, missed: 0, cancelled: 0, withdrawn: 0,
    }
    for (const { st } of withStatus) c[st] += 1
    return c
  }, [withStatus])

  const visible = useMemo(
    () => withStatus.filter(({ r, st }) => {
      if (pill !== 'all' && st !== pill) return false
      return matchesSearch(search, r.clientName, r.referringAgency, r.referredBy)
    }),
    [withStatus, pill, search],
  )

  // Group. Single Saturday → one group keyed by that date. Otherwise → month
  // buckets ('YYYY-MM'), newest first. Undated rows pinned last.
  const groups = useMemo(() => {
    const byKey = new Map<string, RowItem[]>()
    const noDate: RowItem[] = []
    for (const item of visible) {
      const fd = fileDateOf(item.r)
      if (!fd) { noDate.push(item); continue }
      const bucket = singleDate ? fd : fd.slice(0, 7)
      if (!byKey.has(bucket)) byKey.set(bucket, [])
      byKey.get(bucket)!.push(item)
    }
    const keys = [...byKey.keys()].sort((a, b) => b.localeCompare(a))
    for (const k of keys) {
      byKey.get(k)!.sort((a, b) => {
        const da = fileDateOf(a.r) ?? ''
        const db = fileDateOf(b.r) ?? ''
        if (da !== db) return db.localeCompare(da)
        return lastNameOf(a.r.clientName).localeCompare(lastNameOf(b.r.clientName))
      })
    }
    noDate.sort((a, b) => lastNameOf(a.r.clientName).localeCompare(lastNameOf(b.r.clientName)))
    return { keys, byKey, noDate }
  }, [visible, singleDate])

  // Open state. An empty `open` param means "no explicit choice — use the
  // computed default"; '-' means "explicitly all collapsed"; anything else is
  // the literal set.
  const explicitOpen = useMemo(() => {
    if (urlState.open === '') return null
    if (urlState.open === '-') return new Set<string>()
    return new Set(urlState.open.split(',').filter(Boolean))
  }, [urlState.open])

  // Default open set: the one group in single-Saturday mode, else the two most
  // recent months. Descending month order means a future/current month sorts
  // first, so late in a month both the current and the next are open with no
  // special case.
  const defaultOpen = useMemo(() => {
    if (singleDate) return new Set(groups.keys)
    return new Set(groups.keys.slice(0, 2))
  }, [singleDate, groups])

  const openSet = explicitOpen ?? defaultOpen
  const toggleGroup = (key: string) => {
    const next = new Set(openSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setUrlState({ open: next.size === 0 ? '-' : [...next].join(',') })
  }

  // --------- actions

  const startReschedule = (id: string, name: string) => {
    setOpenMenuId(null)
    setRescheduleModal({ open: true, id, name })
  }
  const startCancel = (id: string, name: string) => {
    setOpenMenuId(null)
    setCancelModal({ open: true, id, name })
  }

  const menuItemsFor = (item: RowItem): MenuItem[] => {
    const { r, st } = item
    const canManage =
      st === 'scheduled' || st === 'reschedule' ||
      (st === 'missed' && withinNoShowRescheduleWindow(r.effectiveAppointmentDate, todayISO))
    if (canManage) {
      return [
        { label: 'Reschedule', color: '#1B2B4B', icon: RESCHEDULE_ICON, onClick: () => startReschedule(r.id, r.clientName) },
        { label: 'Cancel', color: '#C0392B', icon: CANCEL_ICON, onClick: () => startCancel(r.id, r.clientName) },
      ]
    }
    if (st === 'completed' && r.clientReceiptUrl) {
      return [{ label: 'Client receipt', color: '#2A7F6F', icon: DOC_ICON, href: r.clientReceiptUrl }]
    }
    return []
  }

  const handleCancelConfirm = async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${cancelModal.id}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setActionError(`Couldn't cancel: ${err.error || res.statusText}`)
        return
      }
      setCancelModal({ open: false, id: '', name: '' })
      setActionError(null)
      setReloadTick(t => t + 1)
    } catch {
      setActionError("Couldn't cancel: the request didn't go through. Try again.")
    } finally {
      setActionLoading(false)
    }
  }

  const handleRescheduleConfirm = async (preferredDate: string, appointmentTime: string | null) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, appointmentTime }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setActionError(`Couldn't reschedule: ${err.error || res.statusText}`)
        return
      }
      setRescheduleModal({ open: false, id: '', name: '' })
      setActionError(null)
      setReloadTick(t => t + 1)
    } catch {
      setActionError("Couldn't reschedule: the request didn't go through. Try again.")
    } finally {
      setActionLoading(false)
    }
  }

  // --------- group header summary (tense-dependent, over shown rows)

  const summaryFor = (items: RowItem[], bucketKey: string): string[] => {
    const future = singleDate
      ? bucketKey >= todayISO
      : bucketKey >= todayISO.slice(0, 7)
    const n = (fn: (i: RowItem) => boolean) => items.filter(fn).length
    if (future) {
      const scheduled = n(i => i.st === 'scheduled')
      const pending = n(i => i.st === 'pending' || i.st === 'reschedule')
      return [
        scheduled ? `${scheduled} scheduled` : '',
        pending ? `${pending} pending` : '',
      ].filter(Boolean)
    }
    // Counts only — no show rate. It's derived from what's shown, so a status
    // filter makes it 100% (Completed) or 0% (No Show) by construction; it's
    // only meaningful when a group holds both outcomes. Show rate is an
    // analytics number and lives on the dashboard's past-four-Saturdays card,
    // where every outcome is always present. Not in two places with two
    // definitions.
    const completed = n(i => i.st === 'completed')
    const missed = n(i => i.st === 'missed')
    return [
      completed ? `${completed} completed` : '',
      missed ? `${missed} missed` : '',
    ].filter(Boolean)
  }

  // --------- render

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <div style={{ padding: '28px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        {/* Search + date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search by client, agency or staff"
            value={search}
            onChange={e => setUrlState({ q: e.target.value })}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1',
              fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', background: 'white',
            }}
          />
          {singleDate ? (
            <button
              onClick={() => setUrlState({ date: '' })}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px', borderRadius: '20px', border: '1px solid #2A7F6F',
                background: 'rgba(42,127,111,0.10)', color: '#2A7F6F',
                fontFamily: MONT, fontWeight: 700, fontSize: '12px', cursor: 'pointer',
              }}
            >
              {formatSatHeader(singleDate)}
              <span aria-hidden style={{ fontSize: '14px', lineHeight: 1 }}>×</span>
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '6px' }}>
              {RANGES.map(r => (
                <button
                  key={r.key}
                  onClick={() => setUrlState({ range: r.key })}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: 'none',
                    fontSize: '12px', fontWeight: 700, fontFamily: MONT, cursor: 'pointer',
                    background: rangeKey === r.key ? '#1B2B4B' : '#EDE9E1',
                    color: rangeKey === r.key ? 'white' : '#7A8899',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {PILLS.map(p => (
            <FilterPill
              key={p.key}
              label={p.label}
              count={pillCounts[p.key]}
              active={pill === p.key}
              disabled={p.key !== 'all' && pillCounts[p.key] === 0}
              onClick={() => setUrlState({ pill: p.key })}
            />
          ))}
        </div>

        {actionError && (
          <div style={{
            background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px',
            padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#C0392B',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
          }}>
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              style={{ border: 'none', background: 'none', color: '#C0392B', fontFamily: MONT, fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>
            No referrals match.
          </div>
        ) : (
          <>
            {groups.keys.map(key => {
              const items = groups.byKey.get(key)!
              return (
                <Group
                  key={key}
                  title={singleDate ? formatSatHeader(key) : monthLabel(key)}
                  count={items.length}
                  summary={summaryFor(items, key)}
                  open={openSet.has(key)}
                  onToggle={() => toggleGroup(key)}
                >
                  {items.map((it, i) => (
                    <ReferralRow
                      key={it.r.id}
                      item={it}
                      isLast={i === items.length - 1}
                      menuItems={menuItemsFor(it)}
                      menuOpen={openMenuId === it.r.id}
                      onMenuOpen={() => setOpenMenuId(it.r.id)}
                      onMenuClose={() => setOpenMenuId(null)}
                    />
                  ))}
                </Group>
              )
            })}

            {groups.noDate.length > 0 && (
              <Group
                title="No date yet"
                count={groups.noDate.length}
                summary={[]}
                open={openSet.has('__nodate')}
                onToggle={() => toggleGroup('__nodate')}
              >
                {groups.noDate.map((it, i) => (
                  <ReferralRow
                    key={it.r.id}
                    item={it}
                    isLast={i === groups.noDate.length - 1}
                    menuItems={menuItemsFor(it)}
                    menuOpen={openMenuId === it.r.id}
                    onMenuOpen={() => setOpenMenuId(it.r.id)}
                    onMenuClose={() => setOpenMenuId(null)}
                  />
                ))}
              </Group>
            )}
          </>
        )}
      </div>

      <CancelModal
        open={cancelModal.open}
        name={cancelModal.name}
        loading={actionLoading}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelModal({ open: false, id: '', name: '' })}
      />
      <RescheduleModal
        open={rescheduleModal.open}
        name={rescheduleModal.name}
        availableDates={availableDates}
        loading={actionLoading}
        onConfirm={handleRescheduleConfirm}
        onClose={() => setRescheduleModal({ open: false, id: '', name: '' })}
      />
    </div>
  )
}

export default function DawsonReferralsPage() {
  // useListUrlState reads useSearchParams — needs a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading…</div>
        </div>
      }
    >
      <ReferralsView />
    </Suspense>
  )
}
