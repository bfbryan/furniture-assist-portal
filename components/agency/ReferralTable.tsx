'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
// Cancel / withdraw / reschedule dialogs, shared with the referral detail
// page so the agency portal has one copy of each. Unchanged.
import {
  ConfirmModal,
  RescheduleModal,
  type AvailableDate,
  type ConfirmModalState,
  type RescheduleModalState,
} from './ReferralActionModals'
import { getPortalStatus } from '@/lib/referrals/edit-window'
// Same three booleans the referral detail page gates its action bar on.
import { agencyReferralActions } from '@/lib/referrals/agency-actions'
import { requestedSlot } from '@/lib/referrals/requested-slot'
// Same slot phrasing the detail page's RequestedRows uses.
import { formatRequestedSlot, formatSlot } from '@/lib/referrals/slot-display'
import { TIME_ORDER } from '@/lib/schedule/capacity'
import { matchesSearch } from '@/lib/search'
import { clientAddressLine } from '@/lib/address'
// The ⋯ menu, the column-header row and the action icons — shared with the
// History list so the two pages can't drift.
import {
  OverflowMenu,
  ColumnHead,
  DOC_ICON,
  RESCHEDULE_ICON,
  CANCEL_ICON,
  WITHDRAW_ICON,
  type MenuItem,
} from './referral-list-ui'
// Staff filter + the full active set, held by the provider the page wraps.
import { useStaffFilter } from './ActiveReferralsFilter'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  appointmentTime: string | null
  referralReview: string
  appointmentStatus: string
  appointmentSlipUrl: string | null
  dataPageUrl: string | null
  referredBy: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  // Reschedule requests only — what the agency asked for.
  preferredDate?: string | null
  preferredTime?: string | null
  schedulingFlexibility?: string | null
}

// ---------------------------------------------------------------- formatting

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "SATURDAY, OCT 3" — the Scheduled group's per-date heading.
function dateHeading(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    .toUpperCase()
}

function timeRank(time: string | null): number {
  const i = TIME_ORDER.indexOf(time as (typeof TIME_ORDER)[number])
  return i === -1 ? 99 : i
}

// ------------------------------------------------------------------ grouping

type GroupKey = 'pending' | 'scheduled' | 'reschedule' | 'awaitingDate'

// Exactly one bucket per referral. The page's isActive() has already dropped
// Rejected / Completed / Cancelled / No Show upstream, so everything here is a
// live referral; awaitingDate is the catch-all that stops any Approved
// referral vanishing on an unexpected field combination.
//
// Group 3 keys on Appointment Status alone (not Review) — an agency reschedule
// request leaves Referral Review = 'Approved'. Pending is checked first only so
// a would-be Pending+Reschedule contradiction lands in "awaiting approval".
function classify(r: Referral): GroupKey {
  if (r.referralReview === 'Pending') return 'pending'
  if (r.appointmentStatus === 'Reschedule') return 'reschedule'
  if (r.appointmentStatus === 'Scheduled') return 'scheduled'
  return 'awaitingDate'
}

// ---------------------------------------------------------------- UI atoms

const SECTION_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontSize: '13px', fontWeight: 800,
  letterSpacing: '0.10em', textTransform: 'uppercase', color: '#2A7F6F',
}
// Top margin sets the gap between one Saturday's last row and the next date
// heading inside the Scheduled card. 34px read as a page break; 24px keeps
// the sections distinct without splitting the card. The first section
// overrides this down to ~21px under the "Scheduled" heading (see below).
const DATE_HEADING: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#2A7F6F', margin: '24px 0 2px',
}

// ------------------------------------------------------------------- rows

function Row({
  r, dateLabel, dateCell, items, menuOpen, onMenuOpen, onMenuClose,
}: {
  r: Referral
  dateLabel: string
  dateCell: React.ReactNode
  items: MenuItem[]
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
}) {
  return (
    <div className="fa-active-row" style={{ borderTop: '1px solid #F3F0EA' }}>
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
        <span className="fa-active-mobile-label">{dateLabel} </span>{dateCell}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <OverflowMenu
          open={menuOpen}
          onOpen={onMenuOpen}
          onClose={onMenuClose}
          items={items}
          label={`Actions for ${r.clientName}`}
        />
      </div>
    </div>
  )
}

// Every card carries a 3px left accent bar. `gold` (#C9A84C bar, #8B7724
// heading) = waiting on Furniture Assist to act; `teal` (#2A7F6F both) = a
// Saturday appointment is set. The bar is border-box, so the left padding is
// 15px against 18px elsewhere, keeping row content on one vertical line.
function GroupCard({
  title, columns, children, accent, hideHead = false,
}: {
  title: string
  columns: string[]
  children: React.ReactNode
  accent: 'gold' | 'teal'
  hideHead?: boolean
}) {
  const barColor = accent === 'gold' ? '#C9A84C' : '#2A7F6F'
  const headingColor = accent === 'gold' ? '#8B7724' : '#2A7F6F'
  return (
    <section style={{
      background: 'white', borderRadius: '12px',
      boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '20px',
      padding: '14px 18px 14px 15px',
      borderLeft: `3px solid ${barColor}`,
    }}>
      <div style={{ marginBottom: '4px' }}>
        <span style={{ ...SECTION_TITLE, color: headingColor }}>{title}</span>
      </div>
      {!hideHead && <ColumnHead columns={columns} />}
      {children}
    </section>
  )
}

// ------------------------------------------------------------------- page

export default function ReferralTable({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter()
  const {
    staffFilter, setStaffFilter, staffNames,
    referrals: allActive, filtered: staffFiltered,
  } = useStaffFilter<Referral>()

  const [search, setSearch] = useState('')
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ open: false, type: null, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleModalState>({ open: false, id: '', name: '' })
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // Saturdays for the reschedule modal. 2-week lead (leadDays=14).
  useEffect(() => {
    fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Cancel / Withdraw — unchanged: modal stays open and shows the error unless
  // the write actually landed.
  const handleConfirm = async () => {
    setLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/referrals/${confirmModal.id}/${confirmModal.type}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || 'That did not go through. Please try again.')
        return
      }
      setConfirmModal({ open: false, type: null, id: '', name: '' })
      router.refresh()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
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
      fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => setAvailableDates(Array.isArray(data) ? data : []))
        .catch(() => {})
      setRescheduleModal({ open: false, id: '', name: '' })
      router.refresh()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const openReschedule = (id: string, name: string) => { setActionError(null); setRescheduleModal({ open: true, id, name }) }
  const openCancel = (id: string, name: string) => { setActionError(null); setConfirmModal({ open: true, type: 'cancel', id, name }) }
  const openWithdraw = (id: string, name: string) => { setActionError(null); setConfirmModal({ open: true, type: 'withdraw', id, name }) }

  // staffFiltered is already staff-scoped; layer the client-name search on top.
  const rows = useMemo(
    () => staffFiltered.filter(r => matchesSearch(search, r.clientName)),
    [staffFiltered, search],
  )

  const buckets = useMemo(() => {
    const b: Record<GroupKey, Referral[]> = { pending: [], scheduled: [], reschedule: [], awaitingDate: [] }
    for (const r of rows) b[classify(r)].push(r)
    b.pending.sort((a, z) => (a.referralDate < z.referralDate ? 1 : a.referralDate > z.referralDate ? -1 : 0))
    b.reschedule.sort((a, z) => (a.referralDate < z.referralDate ? 1 : a.referralDate > z.referralDate ? -1 : 0))
    b.awaitingDate.sort((a, z) => (a.referralDate < z.referralDate ? 1 : a.referralDate > z.referralDate ? -1 : 0))
    return b
  }, [rows])

  // Scheduled → date groups, ascending; rows by time then client name.
  const scheduledGroups = useMemo(() => {
    const m = new Map<string, Referral[]>()
    for (const r of buckets.scheduled) {
      const k = r.appointmentDate ?? 'zzzz'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.keys()].sort().map(date => ({
      date,
      rows: m.get(date)!.slice().sort(
        (a, z) => timeRank(a.appointmentTime) - timeRank(z.appointmentTime) || a.clientName.localeCompare(z.clientName),
      ),
    }))
  }, [buckets.scheduled])

  const menuFor = (r: Referral, group: GroupKey): MenuItem[] => {
    const status = getPortalStatus(r.referralReview, r.appointmentStatus)
    const { isReschedulable, isCancellable, isWithdrawable } = agencyReferralActions(status)
    const items: MenuItem[] = []

    if (group === 'pending') {
      if (isWithdrawable) items.push({ label: 'Withdraw Referral', color: '#C0392B', icon: WITHDRAW_ICON, onClick: () => openWithdraw(r.id, r.clientName) })
      return items
    }
    if (group === 'scheduled') {
      if (r.appointmentSlipUrl) items.push({ label: 'Appointment Slip', color: '#2A7F6F', icon: DOC_ICON, href: r.appointmentSlipUrl })
      if (isReschedulable) items.push({ label: 'Reschedule', color: '#C9A84C', icon: RESCHEDULE_ICON, onClick: () => openReschedule(r.id, r.clientName) })
      if (isCancellable) items.push({ label: 'Cancel Appointment', color: '#C0392B', icon: CANCEL_ICON, onClick: () => openCancel(r.id, r.clientName), divider: items.length > 0 })
      return items
    }
    // reschedule + awaitingDate: Cancel only.
    if (isCancellable) items.push({ label: 'Cancel Appointment', color: '#C0392B', icon: CANCEL_ICON, onClick: () => openCancel(r.id, r.clientName) })
    return items
  }

  const rowProps = (r: Referral, group: GroupKey) => ({
    r,
    items: menuFor(r, group),
    menuOpen: openMenu === r.id,
    onMenuOpen: () => setOpenMenu(r.id),
    onMenuClose: () => setOpenMenu(null),
  })

  const clearFilters = () => { setSearch(''); setStaffFilter('all') }

  return (
    <>
      <ConfirmModal
        modal={confirmModal}
        onConfirm={handleConfirm}
        onClose={() => { setActionError(null); setConfirmModal({ open: false, type: null, id: '', name: '' }) }}
        loading={loading}
        error={actionError}
      />
      <RescheduleModal
        modal={rescheduleModal}
        availableDates={availableDates}
        onConfirm={handleRescheduleConfirm}
        onClose={() => { setActionError(null); setRescheduleModal({ open: false, id: '', name: '' }) }}
        loading={loading}
        submitError={actionError}
      />

      {/* Controls — client-name search (left, fills the row) + staff filter
          (admin only, pinned right). No side padding: the row spans the full
          content width, so its ends line up with the card boxes below. */}
      <div className="fa-active-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by client name"
          style={{ flex: '1 1 240px', minWidth: 0, padding: '8px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', background: 'white', fontFamily: 'inherit', outline: 'none' }}
        />
        {isAdmin && staffNames.length > 0 && (
          <div className="fa-active-filter">
            <label
              htmlFor="fa-active-staff-filter"
              className="fa-active-filter-label"
              style={{ fontSize: '12px', fontWeight: 700, color: '#1B2B4B', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
            >
              Filter by Staff
            </label>
            <select
              id="fa-active-staff-filter"
              aria-label="Filter by Staff"
              value={staffFilter}
              onChange={e => setStaffFilter(e.target.value)}
              className="fa-active-filter-select"
              style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', background: 'white', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="all">All Staff</option>
              {staffNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        )}
      </div>

      {allActive.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px', lineHeight: 1.6 }}>
          No active referrals. Approved referrals and upcoming appointments will appear here.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px', lineHeight: 1.6 }}>
          No referrals match your {search.trim() ? 'search' : 'filter'}
          {search.trim() && staffFilter !== 'all' ? ' and staff filter' : ''}.{' '}
          <button
            type="button"
            onClick={clearFilters}
            style={{ background: 'none', border: 'none', color: '#2A7F6F', fontWeight: 700, fontSize: '14px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            Clear
          </button>
        </div>
      ) : (
        <>
          {buckets.pending.length > 0 && (
            <GroupCard title="Awaiting approval" accent="gold" columns={['Client', 'Referred by', 'Requested']}>
              {buckets.pending.map(r => (
                <Row
                  key={r.id}
                  {...rowProps(r, 'pending')}
                  dateLabel="Requested"
                  dateCell={
                    <span style={{ fontStyle: 'italic', color: '#8B7724' }}>
                      {formatRequestedSlot(requestedSlot(r), formatDate)}
                    </span>
                  }
                />
              ))}
            </GroupCard>
          )}

          {/* Reschedule requested sits above Scheduled: the page exists mainly
              so an agency can see a just-submitted referral landed and where it
              stands. The waiting groups answer that; Scheduled is the routine
              case and reads below them. */}
          {buckets.reschedule.length > 0 && (
            <GroupCard title="Reschedule requested" accent="gold" columns={['Client', 'Referred by', 'Currently / Requested']}>
              {buckets.reschedule.map(r => (
                <Row
                  key={r.id}
                  {...rowProps(r, 'reschedule')}
                  dateLabel="Currently / Requested"
                  dateCell={
                    <span className="fa-active-reschedule-value" style={{ display: 'block', lineHeight: 1.5 }}>
                      <span style={{ color: '#1B2B4B' }}>
                        Currently: {formatSlot(r.appointmentDate, r.appointmentTime, formatDate)}
                      </span>
                      <br />
                      <span style={{ color: '#8B7724' }}>
                        Requested: {formatRequestedSlot(requestedSlot(r), formatDate)}
                      </span>
                    </span>
                  }
                />
              ))}
            </GroupCard>
          )}

          {buckets.scheduled.length > 0 && (
            <GroupCard title="Scheduled" accent="teal" hideHead columns={['Client', 'Referred by', 'Time']}>
              {scheduledGroups.map((g, gi) => (
                <div key={g.date}>
                  {/* Date heading introduces the section; column headers sit
                      beneath it, repeated per Saturday so each block is
                      self-labelling however many there are. */}
                  <div style={gi === 0 ? { ...DATE_HEADING, marginTop: '18px' } : DATE_HEADING}>
                    {g.date === 'zzzz' ? 'NO DATE' : dateHeading(g.date)}
                  </div>
                  <ColumnHead columns={['Client', 'Referred by', 'Time']} />
                  {g.rows.map(r => (
                    <Row
                      key={r.id}
                      {...rowProps(r, 'scheduled')}
                      dateLabel="Time"
                      dateCell={
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#1B2B4B' }}>
                          {r.appointmentTime ?? '—'}
                        </span>
                      }
                    />
                  ))}
                </div>
              ))}
            </GroupCard>
          )}

          {buckets.awaitingDate.length > 0 && (
            <GroupCard title="Awaiting appointment date" accent="gold" columns={['Client', 'Referred by', '']}>
              {buckets.awaitingDate.map(r => (
                <Row
                  key={r.id}
                  {...rowProps(r, 'awaitingDate')}
                  dateLabel=""
                  dateCell={<span style={{ color: '#7A8899' }}>Furniture Assist will confirm a date.</span>}
                />
              ))}
            </GroupCard>
          )}
        </>
      )}
    </>
  )
}
