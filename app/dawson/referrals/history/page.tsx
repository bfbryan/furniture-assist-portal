// app/dawson/history/page.tsx
'use client'


import { useState, useEffect, useMemo } from 'react'
import CancelModal from '@/components/dawson/modals/CancelModal'
import RescheduleModal, { type AvailableDate } from '@/components/dawson/modals/RescheduleModal'


type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  appointmentTime: string | null
  referralReview: string
  appointmentStatus: string
  referredBy: string | null
  referringAgency: string | null
  referringAgencyId: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  staffPhone?: string | null
}


const TIME_ORDER = ['9am', '10am', '11am', '12pm', '1pm']
// Grid now has a trailing column for the No Show action buttons. Empty for
// Completed and Cancelled rows — keeps column alignment across the group.
const GRID = '260px 240px 1fr 1fr 1fr 130px 190px'


const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  'Completed': { bg: 'rgba(27,43,75,0.08)',   color: '#1B2B4B' },
  'No Show':   { bg: 'rgba(201,168,76,0.15)', color: '#C9A84C' },
  'Cancelled': { bg: 'rgba(192,57,43,0.1)',   color: '#C0392B' },
}


const DATE_RANGES = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 60 days', days: 60 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'All time', days: 0 },
]


const STATUS_FILTERS = ['All', 'Completed', 'No Show', 'Cancelled'] as const
type StatusFilter = typeof STATUS_FILTERS[number]


function formatSatHeader(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}


function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}


function lastNameOf(clientName: string): string {
  const parts = clientName.trim().split(/\s+/)
  return parts[parts.length - 1].toLowerCase()
}


function displayLastFirst(clientName: string): string {
  const parts = clientName.trim().split(/\s+/)
  if (parts.length < 2) return clientName
  const last = parts[parts.length - 1]
  const first = parts.slice(0, -1).join(' ')
  return `${last}, ${first}`
}


function ReferralRow({ r, onReschedule, onCancel }: {
  r: Referral
  onReschedule: (id: string, name: string) => void
  onCancel: (id: string, name: string) => void
}) {
  const s = STATUS_STYLES[r.appointmentStatus] ?? { bg: '#F0F0F0', color: '#7A8899' }
  const isNoShow = r.appointmentStatus === 'No Show'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', alignItems: 'center', padding: '14px 28px', borderBottom: '1px solid #F0EDE5', background: 'white' }}>
      {/* Client — indented 16px */}
      <a href={`/dawson/referrals/${r.id}`} style={{ textDecoration: 'none', display: 'block', paddingLeft: '16px' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '14px', color: '#2A7F6F', lineHeight: 1.3 }}>
                    {displayLastFirst(r.clientName)}
        </div>
        {r.phone && (
          <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px' }}>{r.phone}</div>
        )}
      </a>


      {/* Agency — teal bold link to agency profile (matches Scheduled) */}
      <div style={{ fontSize: '14px', lineHeight: 1.3, textAlign: 'center' }}>
        {r.referringAgency ? (
          r.referringAgencyId ? (
            <a
              href={`/dawson/agencies/${r.referringAgencyId}?from=history`}
              style={{
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 700,
                color: '#2A7F6F',
                textDecoration: 'none',
              }}
            >
              {r.referringAgency}
            </a>
          ) : (
            <span style={{ color: '#1B2B4B' }}>{r.referringAgency}</span>
          )
        ) : (
          <span style={{ color: '#1B2B4B' }}>—</span>
        )}
      </div>


      {/* Staff — centered */}
      <div style={{ fontSize: '14px', color: '#1B2B4B', lineHeight: 1.3, textAlign: 'center' }}>{r.referredBy ?? '—'}</div>


      {/* Staff Phone — centered */}
      <div style={{ fontSize: '13px', color: '#7A8899', textAlign: 'center' }}>{r.staffPhone ?? '—'}</div>


      {/* Town — centered */}
      <div style={{ fontSize: '13px', color: '#7A8899', textAlign: 'center' }}>
        {r.city ? `${r.city}, ${r.state}` : '—'}
      </div>


      {/* Status badge — right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 11px', borderRadius: '20px', background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
          {r.appointmentStatus}
        </span>
      </div>


      {/* Action buttons — only on No Show rows. Follow-up (voicemail/email)
          often arrives days after the missed appt, so Dawson needs to
          transition No Show → Scheduled (reschedule) or → Cancelled from
          this page. Both fire the existing backend + Zap triggers. */}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        {isNoShow ? (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onReschedule(r.id, r.clientName) }}
              style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(201,168,76,0.35)', background: 'rgba(201,168,76,0.1)', color: '#8A6D14', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Reschedule
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCancel(r.id, r.clientName) }}
              style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}


function SaturdayGroup({ dateKey, referrals, defaultOpen, onReschedule, onCancel }: {
  dateKey: string
  referrals: Referral[]
  defaultOpen: boolean
  onReschedule: (id: string, name: string) => void
  onCancel: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)


  // Group by time slot
  const byTime: Record<string, Referral[]> = {}
  TIME_ORDER.forEach(t => byTime[t] = [])
  const other: Referral[] = []
  referrals.forEach(r => {
    const t = r.appointmentTime
    if (t && byTime[t]) byTime[t].push(r)
    else other.push(r)
  })
  Object.keys(byTime).forEach(t => {
    byTime[t].sort((a, b) => lastNameOf(a.clientName).localeCompare(lastNameOf(b.clientName)))
  })
  other.sort((a, b) => lastNameOf(a.clientName).localeCompare(lastNameOf(b.clientName)))


  const completed = referrals.filter(r => r.appointmentStatus === 'Completed').length
  const noShow = referrals.filter(r => r.appointmentStatus === 'No Show').length
  const cancelled = referrals.filter(r => r.appointmentStatus === 'Cancelled').length


  return (
    <div style={{ marginBottom: '20px' }}>
      <button onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderRadius: '10px',
          background: 'white', border: '1px solid #EDE9E1',
          cursor: 'pointer', boxShadow: '0 1px 3px rgba(27,43,75,0.04)',
          marginBottom: open ? '6px' : 0,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#1B2B4B' }}>
            {dateKey ? formatSatHeader(dateKey) : 'No appointment date'}
          </div>
          <div style={{ fontSize: '13px', color: '#7A8899', fontWeight: 500 }}>
            ({referrals.length})
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {completed > 0 && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 11px', borderRadius: '20px', background: 'rgba(27,43,75,0.08)', color: '#1B2B4B' }}>
              {completed} completed
            </span>
          )}
          {noShow > 0 && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 11px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
              {noShow} no show
            </span>
          )}
          {cancelled > 0 && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 11px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
              {cancelled} cancelled
            </span>
          )}
        </div>
      </button>


      {open && (
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #EDE9E1', overflow: 'hidden' }}>
          {/* Column header */}
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', padding: '12px 28px', borderBottom: '1px solid #E5DECF', background: '#F0EBE0', alignItems: 'center' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', paddingLeft: '16px' }}>Client</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Agency</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Staff</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Staff Phone</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Town</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'right' }}>Status</div>
          </div>


          {TIME_ORDER.map(t => byTime[t].length > 0 && (
            <div key={t}>
              <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', padding: '10px 28px', background: '#F0F7F5', borderLeft: '3px solid #2A7F6F', borderTop: '1px solid #D4E8E3', borderBottom: '1px solid #D4E8E3', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#2A7F6F' }}>{t}</span>
                <span style={{ color: '#7A8899', fontWeight: 600 }}>·</span>
                <span style={{ color: '#7A8899', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
                  {byTime[t].length} {byTime[t].length === 1 ? 'appt' : 'appts'}
                </span>
              </div>
              {byTime[t].map(r => (
                <ReferralRow key={r.id} r={r} onReschedule={onReschedule} onCancel={onCancel} />
              ))}
            </div>
          ))}


          {other.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', padding: '10px 28px', background: '#FAFCFB', borderLeft: '3px solid #7A8899' }}>
                No time assigned · {other.length}
              </div>
              {other.map(r => (
                <ReferralRow key={r.id} r={r} onReschedule={onReschedule} onCancel={onCancel} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


export default function HistoryPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [rangeDays, setRangeDays] = useState(60)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')


  // Reschedule + Cancel modal wiring for No Show rows. Follow-up (voicemail
  // /email) often arrives days after the missed appt, so Dawson triages from
  // this page. Both modals hit the same backend endpoints as the detail
  // page — no new APIs, just a new entry point.
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [modalLoading, setModalLoading] = useState(false)
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [refreshTick, setRefreshTick] = useState(0)


  // Load referrals — refetches on refreshTick bump after a modal action so
  // the row status flips (No Show → Scheduled/Cancelled) immediately.
  useEffect(() => {
    setLoading(true)
    const dateFrom = rangeDays > 0 ? daysAgo(rangeDays) : undefined
    const url = `/api/dawson/referrals?status=Completed&status=No+Show&status=Cancelled${dateFrom ? `&dateFrom=${dateFrom}` : ''}`
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => { setReferrals(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [rangeDays, refreshTick])


  // Load available Saturdays once on mount — same source the detail page +
  // schedule page use. Cheap enough to keep in memory.
  useEffect(() => {
    fetch('/api/dawson/schedule/available', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableDates(data) })
      .catch(() => {})
  }, [])


  const handleRescheduleClick = (id: string, name: string) => {
    setRescheduleModal({ open: true, id, name })
  }
  const handleCancelClick = (id: string, name: string) => {
    setCancelModal({ open: true, id, name })
  }


async function handleRescheduleConfirm(
  preferredDate: string,
  appointmentTime: string | null,
) {
  // ...
  await fetch(`/api/dawson/referrals/${rescheduleModal.id}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferredDate, appointmentTime }),
  })
  // ...
}


  async function handleCancelConfirm() {
    if (!cancelModal.id) return
    setModalLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${cancelModal.id}/cancel`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Cancel failed: ${err.error || res.statusText}`)
        return
      }
      setCancelModal({ open: false, id: '', name: '' })
      setRefreshTick(t => t + 1)
    } finally {
      setModalLoading(false)
    }
  }


  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return referrals.filter(r => {
      const matchesSearch = !q ||
        r.clientName.toLowerCase().includes(q) ||
        (r.referringAgency ?? '').toLowerCase().includes(q) ||
        (r.referredBy ?? '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'All' || r.appointmentStatus === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [referrals, search, statusFilter])


  const completed = filtered.filter(r => r.appointmentStatus === 'Completed').length
  const noShow = filtered.filter(r => r.appointmentStatus === 'No Show').length
  const cancelled = filtered.filter(r => r.appointmentStatus === 'Cancelled').length


  // Group by Saturday date — DESC (most recent first), no-date pinned at bottom
  const byDate: Record<string, Referral[]> = {}
  const noDate: Referral[] = []
  filtered.forEach(r => {
    if (r.appointmentDate) {
      if (!byDate[r.appointmentDate]) byDate[r.appointmentDate] = []
      byDate[r.appointmentDate].push(r)
    } else {
      noDate.push(r)
    }
  })
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
  const mostRecentDated = sortedDates[0]


  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>History</div>
          {!loading && (
            <>
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(27,43,75,0.08)', color: '#1B2B4B' }}>
                {completed} completed
              </span>
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                {noShow} no show
              </span>
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
                {cancelled} cancelled
              </span>
            </>
          )}
        </div>
      </header>


      <div style={{ padding: '28px 32px' }}>
        {/* Filters row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Search by client, agency, or staff..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', background: 'white' }} />


          <div style={{ display: 'flex', gap: '6px' }}>
            {DATE_RANGES.map(range => (
              <button key={range.days} onClick={() => setRangeDays(range.days)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-montserrat)', cursor: 'pointer', background: rangeDays === range.days ? '#1B2B4B' : '#EDE9E1', color: rangeDays === range.days ? 'white' : '#7A8899' }}>
                {range.label}
              </button>
            ))}
          </div>
        </div>


        {/* Status pills row */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '5px 12px', borderRadius: '20px', border: '1px solid', borderColor: statusFilter === s ? '#2A7F6F' : '#EDE9E1', fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-montserrat)', cursor: 'pointer', background: statusFilter === s ? '#2A7F6F' : 'white', color: statusFilter === s ? 'white' : '#7A8899', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {s}
            </button>
          ))}
        </div>


        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No records found.</div>
        ) : (
          <>
            {sortedDates.map(dateKey => (
              <SaturdayGroup
                key={dateKey}
                dateKey={dateKey}
                referrals={byDate[dateKey]}
                defaultOpen={dateKey === mostRecentDated}
                onReschedule={handleRescheduleClick}
                onCancel={handleCancelClick}
              />
            ))}
            {noDate.length > 0 && (
              <SaturdayGroup
                dateKey=""
                referrals={noDate}
                defaultOpen={false}
                onReschedule={handleRescheduleClick}
                onCancel={handleCancelClick}
              />
            )}
          </>
        )}
      </div>


      <CancelModal
        open={cancelModal.open}
        name={cancelModal.name}
        loading={modalLoading}
        onClose={() => setCancelModal({ open: false, id: '', name: '' })}
        onConfirm={handleCancelConfirm}
      />
      <RescheduleModal
        open={rescheduleModal.open}
        name={rescheduleModal.name}
        availableDates={availableDates}
        loading={modalLoading}
        onClose={() => setRescheduleModal({ open: false, id: '', name: '' })}
        onConfirm={handleRescheduleConfirm}
      />
    </div>
  )
}
