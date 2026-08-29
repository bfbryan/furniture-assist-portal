'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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

// One line: "12 Main St, Apt 2, Newark, NJ 07101".
function fullAddress(r: Referral): string {
  return [r.address, r.address2, r.city, [r.state, r.zip].filter(Boolean).join(' ')]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
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
const SECTION_COUNT: React.CSSProperties = {
  fontSize: '13px', color: '#7A8899', fontWeight: 600,
}
const COL_HEADER: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#7A8899',
}
const DATE_HEADING: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#2A7F6F', margin: '14px 0 2px',
}

function Icon({ path, size = 15 }: { path: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {path}
    </svg>
  )
}
const SLIP_ICON = (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>)
const RESCHEDULE_ICON = (<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>)
const CANCEL_ICON = (<><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>)
const WITHDRAW_ICON = (<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>)

type MenuItem = {
  label: string
  color: string
  icon: React.ReactNode
  href?: string
  onClick?: () => void
  divider?: boolean
}

// One ⋯ menu. Only one open across the whole list (parent holds `open`);
// closes on outside click and Escape.
function OverflowMenu({
  open, onOpen, onClose, items,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  items: MenuItem[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
        style={{
          width: '28px', height: '28px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: open ? '#F3F0EA' : 'transparent', color: '#7A8899',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
        </svg>
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
          minWidth: '184px', background: 'white', border: '1px solid #EDE9E1',
          borderRadius: '8px', boxShadow: '0 8px 24px rgba(27,43,75,0.16)', padding: '4px',
        }}>
          {items.map((it, i) => {
            const style: React.CSSProperties = {
              display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
              padding: '8px 10px', borderRadius: '6px', border: 'none', background: 'transparent',
              fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
              cursor: 'pointer', textDecoration: 'none', textAlign: 'left', color: it.color,
              ...(it.divider ? { borderTop: '1px solid #EDE9E1', marginTop: '4px', paddingTop: '10px' } : {}),
            }
            return it.href ? (
              <a key={i} className="fa-active-menu-item" href={it.href} target="_blank" rel="noreferrer"
                role="menuitem" onClick={onClose} style={style}>
                <Icon path={it.icon} />{it.label}
              </a>
            ) : (
              <button key={i} className="fa-active-menu-item" type="button" role="menuitem"
                onClick={() => { onClose(); it.onClick?.() }} style={style}>
                <Icon path={it.icon} />{it.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
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
    <div className="fa-active-row" style={{ padding: '12px 0', borderTop: '1px solid #F3F0EA', alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        <a href={`/referrals/${r.id}`} style={{ display: 'block', textDecoration: 'none', fontSize: '14px', fontWeight: 500, color: '#2A7F6F', overflowWrap: 'anywhere' }}>
          {r.clientName}
        </a>
        <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px', overflowWrap: 'anywhere' }}>
          {fullAddress(r) || '—'}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#7A8899', minWidth: 0, overflowWrap: 'anywhere' }}>
        <span className="fa-active-mobile-label">Referred by </span>{r.referredBy ?? '—'}
      </div>

      <div style={{ minWidth: 0, fontSize: '12px' }}>
        <span className="fa-active-mobile-label">{dateLabel} </span>{dateCell}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <OverflowMenu open={menuOpen} onOpen={onMenuOpen} onClose={onMenuClose} items={items} />
      </div>
    </div>
  )
}

function GroupCard({
  title, count, columns, children,
}: {
  title: string
  count: number
  columns: string[]
  children: React.ReactNode
}) {
  return (
    <section style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '20px', padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={SECTION_TITLE}>{title}</span>
        <span style={SECTION_COUNT}>{count}</span>
      </div>
      <div className="fa-active-row fa-active-row--head" style={{ padding: '6px 0' }}>
        {columns.map((c, i) => <div key={i} style={COL_HEADER}>{c}</div>)}
        <div />
      </div>
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
      if (r.appointmentSlipUrl) items.push({ label: 'Appointment Slip', color: '#2A7F6F', icon: SLIP_ICON, href: r.appointmentSlipUrl })
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

      {/* Controls — staff filter (admin) + client-name search. Wrapping lives
          in globals.css (.fa-active-controls). */}
      <div className="fa-active-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
        {isAdmin && staffNames.length > 0 && (
          <>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#1B2B4B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Filter by Staff
            </label>
            <select
              value={staffFilter}
              onChange={e => setStaffFilter(e.target.value)}
              style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', background: 'white', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="all">All Staff</option>
              {staffNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </>
        )}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by client name"
          style={{ flex: '1 1 220px', maxWidth: '320px', padding: '8px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', background: 'white', fontFamily: 'inherit', outline: 'none' }}
        />
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
            <GroupCard title="Awaiting approval" count={buckets.pending.length} columns={['Client', 'Referred by', 'Requested']}>
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

          {buckets.scheduled.length > 0 && (
            <GroupCard title="Scheduled" count={buckets.scheduled.length} columns={['Client', 'Referred by', 'Time']}>
              {scheduledGroups.map(g => (
                <div key={g.date}>
                  <div style={DATE_HEADING}>
                    {g.date === 'zzzz' ? 'NO DATE' : dateHeading(g.date)} · {g.rows.length}
                  </div>
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

          {buckets.reschedule.length > 0 && (
            <GroupCard title="Reschedule requested" count={buckets.reschedule.length} columns={['Client', 'Referred by', 'Currently / Requested']}>
              {buckets.reschedule.map(r => (
                <Row
                  key={r.id}
                  {...rowProps(r, 'reschedule')}
                  dateLabel="Currently / Requested"
                  dateCell={
                    <span style={{ display: 'block', lineHeight: 1.5 }}>
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

          {buckets.awaitingDate.length > 0 && (
            <GroupCard title="Awaiting appointment date" count={buckets.awaitingDate.length} columns={['Client', 'Referred by', '']}>
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
