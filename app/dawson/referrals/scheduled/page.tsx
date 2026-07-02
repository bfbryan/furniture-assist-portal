'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  referringAgencyId: string | null     // ← NEW
  referringStaffId?: string | null     // ← NEW (placeholder, wire later)
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  staffPhone?: string | null
}

type AvailableDate = {
  date: string
  slotsRemaining: number
}

const TIME_ORDER = ['9am', '10am', '11am', '12pm', '1pm']
const GRID = '260px 240px 1fr 1fr 1fr 110px'

function formatSatHeader(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function lastNameOf(clientName: string): string {
  const parts = clientName.trim().split(/\s+/)
  return parts[parts.length - 1].toLowerCase()
}

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#1B2B4B', color: 'white', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '5px', pointerEvents: 'none', zIndex: 10 }}>
          {label}
        </div>
      )}
    </div>
  )
}

function IconBtn({ color, onClick, title, children }: {
  color: string; onClick?: () => void; title: string; children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <Tooltip label={title}>
      <button onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color, background: hover ? `${color}15` : 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, transition: 'background 0.12s' }}>
        {children}
      </button>
    </Tooltip>
  )
}

function CancelModal({ open, name, onConfirm, onClose, loading }: {
  open: boolean; name: string; onConfirm: () => void; onClose: () => void; loading: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          Cancel Appointment
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
          Cancel the appointment for {name}? The slot will be freed up and all referral data is preserved.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={onConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: '#C0392B', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RescheduleModal({ open, name, availableDates, onConfirm, onClose, loading }: {
  open: boolean
  name: string
  availableDates: AvailableDate[]
  onConfirm: (preferredDate: string | null, flexible: boolean) => void
  onClose: () => void
  loading: boolean
}) {
  const [preferredDate, setPreferredDate] = useState('')
  const [flexible, setFlexible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setPreferredDate(''); setFlexible(false); setError(null) }
  }, [open])

  if (!open) return null

  const handleConfirm = () => {
    setError(null)
    if (!flexible && !preferredDate) {
      setError('Pick a Saturday or check Flexible.'); return
    }
    onConfirm(flexible ? null : preferredDate, flexible)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '500px', width: '90%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          Reschedule Appointment
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '20px' }}>
          Reschedule for {name}. Pick a specific Saturday or let the scheduler find the next available.
        </p>

        <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#1B2B4B', marginBottom: '6px', display: 'block' }}>
          Preferred Saturday
        </label>
        <select
          value={preferredDate}
          onChange={e => setPreferredDate(e.target.value)}
          disabled={flexible}
          style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '14px', color: '#2C3A4A', background: 'white', outline: 'none', opacity: flexible ? 0.5 : 1, cursor: flexible ? 'not-allowed' : 'pointer', marginBottom: '12px' }}
        >
          <option value="">Select a Saturday...</option>
          {availableDates.map(d => {
            const dateObj = new Date(d.date + 'T00:00:00')
            const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
            return (
              <option key={d.date} value={d.date}>
                {label} — {d.slotsRemaining} slot{d.slotsRemaining === 1 ? '' : 's'}
              </option>
            )
          })}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '9px 14px', borderRadius: '7px', border: `1px solid ${flexible ? '#2A7F6F' : '#EDE9E1'}`, background: flexible ? '#EAF4F2' : 'white', marginBottom: '20px' }}>
          <input type="checkbox" checked={flexible} onChange={e => { setFlexible(e.target.checked); if (e.target.checked) setPreferredDate('') }} style={{ display: 'none' }} />
          <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${flexible ? '#2A7F6F' : '#EDE9E1'}`, background: flexible ? '#2A7F6F' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {flexible && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </div>
          <span style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: flexible ? 600 : 400 }}>Flexible — next available</span>
        </label>

        {error && (
          <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#C0392B' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={handleConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReferralRow({ r, onCancel, onReschedule }: {
  r: Referral
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', alignItems: 'center', padding: '14px 28px', borderBottom: '1px solid #F0EDE5', background: 'white' }}>
      {/* Client — indented 16px */}
      <a href={`/dawson/referrals/${r.id}`} style={{ textDecoration: 'none', display: 'block', paddingLeft: '16px' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '14px', color: '#2A7F6F', lineHeight: 1.3 }}>
          {r.clientName}
        </div>
        {r.phone && (
          <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px' }}>{r.phone}</div>
        )}
      </a>

      {/* Agency — teal bold link to agency profile (matches client ID-link style) */}
<div style={{ fontSize: '14px', lineHeight: 1.3, textAlign: 'center' }}>
  {r.referringAgency ? (
    r.referringAgencyId ? (
      <a
        href={`/dawson/agencies/${r.referringAgencyId}?from=scheduled`}
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

      

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
        <IconBtn color="#C9A84C" onClick={() => onReschedule(r.id, r.clientName)} title="Reschedule">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </IconBtn>
        <IconBtn color="#C0392B" onClick={() => onCancel(r.id, r.clientName)} title="Cancel">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </IconBtn>
      </div>
    </div>
  )
}

function SaturdayGroup({ dateKey, referrals, onCancel, onReschedule, defaultOpen }: {
  dateKey: string
  referrals: Referral[]
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
  defaultOpen: boolean
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
  // Sort each time slot alphabetically by last name
  Object.keys(byTime).forEach(t => {
    byTime[t].sort((a, b) => lastNameOf(a.clientName).localeCompare(lastNameOf(b.clientName)))
  })
  other.sort((a, b) => lastNameOf(a.clientName).localeCompare(lastNameOf(b.clientName)))

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
        <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 11px', borderRadius: '20px', background: 'rgba(42,127,111,0.12)', color: '#2A7F6F' }}>
          {referrals.length} scheduled
        </span>
      </button>

      {open && (
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #EDE9E1', overflow: 'hidden' }}>
          {/* Column header — stronger #F0EBE0 background, navy uppercase 11px */}
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '16px', padding: '12px 28px', borderBottom: '1px solid #E5DECF', background: '#F0EBE0', alignItems: 'center' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', paddingLeft: '16px' }}>Client</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Agency</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Staff</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'center' }}>Staff Phone</div>
            
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B', textAlign: 'right' }}>Actions</div>
          </div>

          {TIME_ORDER.map(t => byTime[t].length > 0 && (
            <div key={t}>
              {/* Time bar — lighter #F0F7F5, 3px teal left border */}
              <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', padding: '10px 28px', background: '#F0F7F5', borderLeft: '3px solid #2A7F6F', borderTop: '1px solid #D4E8E3', borderBottom: '1px solid #D4E8E3', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#2A7F6F' }}>{t}</span>
                <span style={{ color: '#7A8899', fontWeight: 600 }}>·</span>
                <span style={{ color: '#7A8899', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
                  {byTime[t].length} {byTime[t].length === 1 ? 'appt' : 'appts'}
                </span>
              </div>
              {byTime[t].map(r => (
                <ReferralRow key={r.id} r={r} onCancel={onCancel} onReschedule={onReschedule} />
              ))}
            </div>
          ))}

          {other.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', padding: '10px 28px', background: '#FAFCFB', borderLeft: '3px solid #7A8899' }}>
                No time assigned · {other.length}
              </div>
              {other.map(r => (
                <ReferralRow key={r.id} r={r} onCancel={onCancel} onReschedule={onReschedule} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScheduledPage() {
  const router = useRouter()
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])

  const [cancelModal, setCancelModal] = useState({ open: false, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState({ open: false, id: '', name: '' })
  const [actionLoading, setActionLoading] = useState(false)

  const fetchSchedule = (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true)
    fetch('/api/dawson/referrals?status=Pending+Schedule&status=Scheduled', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        setReferrals(Array.isArray(data) ? data : [])
        setLoading(false)
        setRefreshing(false)
      })
      .catch(() => { setLoading(false); setRefreshing(false) })
  }

  const loadAvailability = () => {
    fetch('/api/dawson/schedule/available?weeks=8', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }

  useEffect(() => {
    fetchSchedule()
    loadAvailability()

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSchedule(true)
    }
    const onFocus = () => fetchSchedule(true)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const handleCancelConfirm = async () => {
    setActionLoading(true)
    try {
      await fetch(`/api/dawson/referrals/${cancelModal.id}/cancel`, { method: 'POST' })
      setCancelModal({ open: false, id: '', name: '' })
      fetchSchedule(true)
      loadAvailability()
    } finally {
      setActionLoading(false)
    }
  }

  const handleRescheduleConfirm = async (preferredDate: string | null, flexible: boolean) => {
    setActionLoading(true)
    try {
      await fetch(`/api/dawson/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, flexible }),
      })
      setRescheduleModal({ open: false, id: '', name: '' })
      fetchSchedule(true)
      loadAvailability()
    } finally {
      setActionLoading(false)
    }
  }

  const filtered = referrals.filter(r =>
    r.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (r.referringAgency ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.referredBy ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by Saturday date
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
  const sortedDates = Object.keys(byDate).sort()

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Scheduled</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(42,127,111,0.12)', color: '#2A7F6F' }}>
              {filtered.length} referral{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
          {refreshing && (
            <span style={{ fontSize: '12px', color: '#7A8899', fontStyle: 'italic' }}>Refreshing…</span>
          )}
        </div>

        <button
          onClick={() => fetchSchedule(true)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 14px', borderRadius: '7px',
            border: '1px solid #EDE9E1', background: 'white',
            color: '#1B2B4B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
            cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <input type="text" placeholder="Search by client, agency, or staff..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', marginBottom: '20px', display: 'block', background: 'white' }} />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No scheduled referrals found.</div>
        ) : (
          <>
            {sortedDates.map((dateKey, idx) => (
              <SaturdayGroup
                key={dateKey}
                dateKey={dateKey}
                referrals={byDate[dateKey]}
                onCancel={(id, name) => setCancelModal({ open: true, id, name })}
                onReschedule={(id, name) => setRescheduleModal({ open: true, id, name })}
                defaultOpen={idx === 0}
              />
            ))}
            {noDate.length > 0 && (
              <SaturdayGroup
                dateKey=""
                referrals={noDate}
                onCancel={(id, name) => setCancelModal({ open: true, id, name })}
                onReschedule={(id, name) => setRescheduleModal({ open: true, id, name })}
                defaultOpen={false}
              />
            )}
          </>
        )}
      </div>

      <CancelModal
        open={cancelModal.open}
        name={cancelModal.name}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelModal({ open: false, id: '', name: '' })}
        loading={actionLoading}
      />
      <RescheduleModal
        open={rescheduleModal.open}
        name={rescheduleModal.name}
        availableDates={availableDates}
        onConfirm={handleRescheduleConfirm}
        onClose={() => setRescheduleModal({ open: false, id: '', name: '' })}
        loading={actionLoading}
      />
    </div>
  )
}