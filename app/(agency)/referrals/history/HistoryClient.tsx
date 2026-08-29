// app/(agency)/referrals/history/HistoryClient.tsx
//
// Agency history — a sibling of the Active page (components/agency/
// ReferralTable.tsx): one grouped list, one header row per section, the same
// ⋯ overflow menu. Grouped by month, newest first; History is uniformly past,
// so there is no per-group accent colour the way Active has.
//
// The staff filter lives in the StaffFilterProvider the Active page also uses
// (components/agency/ActiveReferralsFilter.tsx); this component reads the
// staff-scoped set from it and layers search, a date-range dropdown and the
// outcome pills on top — none of which move client-side filtering off the
// server-side role scoping the page already applied.

'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { addDaysISO, easternTodayISO, formatDateOnly } from '@/lib/dates'
import { matchesSearch } from '@/lib/search'
import { clientAddressLine } from '@/lib/address'
import { effectiveAppointmentDate } from '@/lib/referrals/effective-date'
import { withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'
import { agencyReferralActions } from '@/lib/referrals/agency-actions'
import { useStaffFilter } from '@/components/agency/ActiveReferralsFilter'
import {
  RescheduleModal,
  type AvailableDate,
  type RescheduleModalState,
} from '@/components/agency/ReferralActionModals'
import {
  OverflowMenu,
  ColumnHead,
  DOC_ICON,
  RESCHEDULE_ICON,
  type MenuItem,
} from '@/components/agency/referral-list-ui'

export type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  originalAppointmentDate: string | null
  referralReview: string
  appointmentStatus: string
  clientReceiptUrl: string | null
  referredBy: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

type OutcomeKey = 'completed' | 'missed' | 'cancelled' | 'rejected' | 'withdrawn'
type StatusFilter = 'all' | OutcomeKey
type DateRange = '30' | '60' | '90' | '180' | 'all'

// -------------------------------------------------------------- classification

function outcomeOf(r: Referral): OutcomeKey | 'other' {
  if (r.referralReview === 'Rejected') return 'rejected'
  // Withdrawn is the agency's own doing, not a refusal — it needs its own
  // outcome or it reads back to them as "Cancelled", i.e. as something
  // Furniture Assist did.
  if (r.referralReview === 'Withdrawn') return 'withdrawn'
  if (r.appointmentStatus === 'Completed') return 'completed'
  if (r.appointmentStatus === 'No Show') return 'missed'
  if (r.appointmentStatus === 'Cancelled') return 'cancelled'
  return 'other'
}

// The date a referral is filed under: the effective appointment date (live, or
// the Original Appointment snapshot a cancel leaves behind), or the referral
// date for outcomes that never had an appointment. Drives the month grouping,
// the within-month sort and the date-range filter.
function filingDate(r: Referral): string {
  return effectiveAppointmentDate(r) ?? r.referralDate ?? ''
}

// ---------------------------------------------------------------------- styling

// Matches the referral detail page's header pill colours.
const OUTCOME_PILL: Record<OutcomeKey, { label: string; bg: string; fg: string }> = {
  completed: { label: 'Completed', bg: 'rgba(42,127,111,0.12)', fg: '#1E6B58' },
  missed:    { label: 'Missed',    bg: 'rgba(201,168,76,0.18)', fg: '#8B7724' },
  cancelled: { label: 'Cancelled', bg: 'rgba(192,57,43,0.10)', fg: '#A5342A' },
  rejected:  { label: 'Rejected',  bg: 'rgba(192,57,43,0.10)', fg: '#A5342A' },
  withdrawn: { label: 'Withdrawn', bg: '#EDEBE7',              fg: '#7A8899' },
}

// Sibling of ReferralTable's DATE_HEADING, but grey rather than teal — History
// is uniformly past. First month overrides the top margin down; nothing sits
// above it but the card padding.
const MONTH_HEADING: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#7A8899', margin: '24px 0 2px',
}

const FILTER_SELECT: React.CSSProperties = {
  padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1',
  fontSize: '13px', color: '#2C3A4A', background: 'white', cursor: 'pointer',
  fontFamily: 'inherit',
}

const CARD: React.CSSProperties = {
  background: 'white', borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)', padding: '14px 18px',
}

const EMPTY_BOX: React.CSSProperties = {
  background: 'white', borderRadius: '12px', padding: '36px',
  textAlign: 'center', color: '#7A8899', fontSize: '14px', lineHeight: 1.6,
}

const CLEAR_LINK: React.CSSProperties = {
  background: 'none', border: 'none', color: '#2A7F6F', fontWeight: 700,
  fontSize: '14px', cursor: 'pointer', padding: 0, textDecoration: 'underline',
}

const DATE_RANGES: Array<{ key: DateRange; label: string }> = [
  { key: '30',  label: 'Last 30 days' },
  { key: '60',  label: 'Last 60 days' },
  { key: '90',  label: 'Last 90 days' },
  { key: '180', label: 'Last 6 months' },
  { key: 'all', label: 'All time' },
]

const STATUS_PILLS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all',       label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed',    label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'rejected',  label: 'Rejected' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

// ---------------------------------------------------------------------- cells

function shortDate(iso: string): string {
  return formatDateOnly(iso, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Completed / Missed → the appointment date, navy. Cancelled → the original
// date, struck through and muted (or a dash if the cancel released no slot to
// snapshot). Withdrawn / Rejected → a dash.
function AppointmentCell({ r }: { r: Referral }) {
  const o = outcomeOf(r)
  if (o === 'withdrawn' || o === 'rejected') return <span style={{ color: '#9AA6B2' }}>—</span>
  const d = effectiveAppointmentDate(r)
  if (!d) return <span style={{ color: '#9AA6B2' }}>—</span>
  if (o === 'cancelled') {
    return <span style={{ color: '#7A8899', textDecoration: 'line-through' }}>{shortDate(d)}</span>
  }
  return <span style={{ color: '#1B2B4B', fontWeight: 700 }}>{shortDate(d)}</span>
}

function OutcomePill({ r }: { r: Referral }) {
  const o = outcomeOf(r)
  if (o === 'other') return <span style={{ color: '#9AA6B2' }}>—</span>
  const m = OUTCOME_PILL[o]
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 700,
      padding: '3px 10px', borderRadius: '999px', whiteSpace: 'nowrap',
      background: m.bg, color: m.fg,
    }}>
      {m.label}
    </span>
  )
}

// ------------------------------------------------------------------------- row

function HistoryRow({
  r, items, menuOpen, onMenuOpen, onMenuClose,
}: {
  r: Referral
  items: MenuItem[]
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
}) {
  return (
    <div className="fa-history-row" style={{ borderTop: '1px solid #F3F0EA' }}>
      <div style={{ minWidth: 0 }}>
        <a href={`/referrals/${r.id}`} style={{ display: 'block', textDecoration: 'none', fontSize: '14px', fontWeight: 600, color: '#2A7F6F', overflowWrap: 'anywhere' }}>
          {r.clientName}
        </a>
        <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px', overflowWrap: 'anywhere' }}>
          {clientAddressLine(r) || '—'}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#7A8899', minWidth: 0, overflowWrap: 'anywhere' }}>
        <span className="fa-active-mobile-label">Referred by </span>{r.referredBy ?? '—'}
      </div>

      <div style={{ minWidth: 0, fontSize: '12px' }}>
        <span className="fa-active-mobile-label">Appointment </span><AppointmentCell r={r} />
      </div>

      <div style={{ minWidth: 0, fontSize: '12px' }}>
        <span className="fa-active-mobile-label">Outcome </span><OutcomePill r={r} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {items.length > 0 && (
          <OverflowMenu
            open={menuOpen}
            onOpen={onMenuOpen}
            onClose={onMenuClose}
            items={items}
            label={`Actions for ${r.clientName}`}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------ page

export default function HistoryClient({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter()
  const {
    staffFilter, setStaffFilter, staffNames,
    referrals: allHistory, filtered: staffFiltered,
  } = useStaffFilter<Referral>()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange>('60')
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // Reschedule flow — a missed appointment still inside the window can be
  // picked back up. Same modal and endpoint the Active list and the detail
  // page use.
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleModalState>({ open: false, id: '', name: '' })
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const openReschedule = (id: string, name: string) => {
    setActionError(null)
    setRescheduleModal({ open: true, id, name })
  }

  const handleRescheduleConfirm = async (
    preferredDate: string | null,
    flexible: boolean,
    preferredTime: string | null,
  ) => {
    setLoading(true)
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
      router.refresh()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Search + date range on top of the staff selection. Status is applied AFTER
  // this so the pill counts (computed from preStatus) don't collapse to the
  // one status you clicked.
  const preStatus = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoffISO =
      dateRange === 'all' ? null : addDaysISO(easternTodayISO(), -parseInt(dateRange, 10))
    return staffFiltered.filter(r => {
      if (!matchesSearch(q, r.clientName)) return false
      if (cutoffISO) {
        const d = filingDate(r)
        if (d && d.slice(0, 10) < cutoffISO) return false
      }
      return true
    })
  }, [staffFiltered, search, dateRange])

  const counts = useMemo(() => {
    const c: Record<OutcomeKey, number> = { completed: 0, missed: 0, cancelled: 0, rejected: 0, withdrawn: 0 }
    for (const r of preStatus) {
      const o = outcomeOf(r)
      if (o !== 'other') c[o] += 1
    }
    return c
  }, [preStatus])

  const visible = useMemo(
    () => (statusFilter === 'all' ? preStatus : preStatus.filter(r => outcomeOf(r) === statusFilter)),
    [preStatus, statusFilter],
  )

  // Group by month, newest first; within a month, newest appointment first.
  const months = useMemo(() => {
    const m = new Map<string, Referral[]>()
    for (const r of visible) {
      const d = filingDate(r)
      const key = d ? d.slice(0, 7) : 'undated'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(r)
    }
    const keys = [...m.keys()].sort((a, z) => {
      if (a === 'undated') return 1
      if (z === 'undated') return -1
      return a < z ? 1 : a > z ? -1 : 0
    })
    return keys.map(key => ({
      key,
      label: key === 'undated'
        ? 'UNDATED'
        : formatDateOnly(`${key}-01`, { month: 'long', year: 'numeric' }).toUpperCase(),
      rows: m.get(key)!.slice().sort((a, z) => {
        const da = filingDate(a)
        const db = filingDate(z)
        if (da !== db) return da < db ? 1 : -1
        return a.clientName.localeCompare(z.clientName)
      }),
    }))
  }, [visible])

  const menuItemsFor = (r: Referral): MenuItem[] => {
    const o = outcomeOf(r)
    if (o === 'completed') {
      return r.clientReceiptUrl
        ? [{ label: 'Client Receipt', color: '#2A7F6F', icon: DOC_ICON, href: r.clientReceiptUrl }]
        : []
    }
    if (o === 'missed') {
      const within = withinNoShowRescheduleWindow(r.appointmentDate)
      const { isReschedulable } = agencyReferralActions('Missed Appointment', within)
      return isReschedulable
        ? [{ label: 'Reschedule', color: '#C9A84C', icon: RESCHEDULE_ICON, onClick: () => openReschedule(r.id, r.clientName) }]
        : []
    }
    return []
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setDateRange('all')
    setStaffFilter('all')
  }

  return (
    <>
      <RescheduleModal
        modal={rescheduleModal}
        availableDates={availableDates}
        onConfirm={handleRescheduleConfirm}
        onClose={() => { setActionError(null); setRescheduleModal({ open: false, id: '', name: '' }) }}
        loading={loading}
        submitError={actionError}
      />

      {/* Controls — search left (fills the row), then staff filter (admin) and
          the date-range dropdown, pinned right. No side padding, so the ends
          line up with the card below, same as Active. */}
      <div className="fa-active-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by client name"
          style={{ flex: '1 1 240px', minWidth: 0, padding: '8px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', background: 'white', fontFamily: 'inherit', outline: 'none' }}
        />
        <div className="fa-history-filters">
          {isAdmin && staffNames.length > 0 && (
            <select
              aria-label="Filter by staff"
              value={staffFilter}
              onChange={e => setStaffFilter(e.target.value)}
              style={FILTER_SELECT}
            >
              <option value="all">All Staff</option>
              {staffNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <select
            aria-label="Date range"
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            style={FILTER_SELECT}
          >
            {DATE_RANGES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
      </div>

      {/* Outcome pills with counts — the old stat cards and status tabs merged.
          Counts are over the search + date-range set, so they don't collapse
          when a pill is selected. Zero pills mute but stay clickable. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '22px' }}>
        {STATUS_PILLS.map(p => {
          const n = p.key === 'all' ? preStatus.length : counts[p.key as OutcomeKey]
          const active = statusFilter === p.key
          const muted = n === 0 && p.key !== 'all' && !active
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(p.key)}
              style={{
                display: 'inline-flex', alignItems: 'baseline', gap: '6px',
                padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '12px', fontWeight: 600,
                border: `1px solid ${active ? '#1B2B4B' : '#EDE9E1'}`,
                background: active ? '#1B2B4B' : 'white',
                color: active ? 'white' : '#2C3A4A',
                opacity: muted ? 0.45 : 1,
              }}
            >
              {p.label}
              <span style={{ fontWeight: 500, opacity: 0.65 }}>{n}</span>
            </button>
          )
        })}
      </div>

      {allHistory.length === 0 ? (
        <div style={EMPTY_BOX}>
          No past referrals yet. Completed, cancelled and rejected referrals will appear here.
        </div>
      ) : months.length === 0 ? (
        <div style={EMPTY_BOX}>
          No referrals match your filters.{' '}
          <button type="button" onClick={clearFilters} style={CLEAR_LINK}>Clear filters</button>
        </div>
      ) : (
        <section style={CARD}>
          {months.map((mo, mi) => (
            <div key={mo.key}>
              <div style={mi === 0 ? { ...MONTH_HEADING, marginTop: '2px' } : MONTH_HEADING}>
                {mo.label}
              </div>
              <ColumnHead
                columns={['Client', 'Referred by', 'Appointment', 'Outcome']}
                className="fa-history-row fa-history-row--head"
              />
              {mo.rows.map(r => (
                <HistoryRow
                  key={r.id}
                  r={r}
                  items={menuItemsFor(r)}
                  menuOpen={openMenu === r.id}
                  onMenuOpen={() => setOpenMenu(r.id)}
                  onMenuClose={() => setOpenMenu(null)}
                />
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  )
}
