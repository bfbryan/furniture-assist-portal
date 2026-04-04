'use client'

import { useState, useEffect } from 'react'

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
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  'Pending Schedule': { bg: 'rgba(91,141,184,0.12)', color: '#5B8DB8' },
  'Scheduled':        { bg: 'rgba(42,127,111,0.12)', color: '#2A7F6F' },
}

function ReferralCard({ referral }: { referral: Referral }) {
  const s = STATUS_STYLES[referral.appointmentStatus] ?? { bg: '#F0F0F0', color: '#7A8899' }

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      <div style={{ width: '4px', alignSelf: 'stretch', background: s.color, flexShrink: 0 }} />

      {/* Client */}
      <div style={{ width: '220px', flexShrink: 0, padding: '14px 20px' }}>
        <a href={`/dawson/referrals/${referral.id}`} style={{ textDecoration: 'none' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#1B2B4B', marginBottom: '2px' }}>{referral.clientName}</div>
        </a>
        <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.phone ?? '—'}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>

        {/* Address */}
        <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Address</div>
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.address ?? '—'}</div>
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.city}, {referral.state} {referral.zip}</div>
        </div>

        {/* Agency */}
        <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Agency</div>
          <div style={{ fontSize: '12px', color: '#7A8899' }}>{referral.referringAgency ?? '—'}</div>
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.referredBy ?? '—'}</div>
        </div>

        {/* Appointment */}
        <div style={{ width: '160px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Appointment</div>
          <div style={{ fontSize: '12px', color: '#7A8899' }}>{formatDate(referral.appointmentDate)}</div>
          {referral.appointmentTime && <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.appointmentTime}</div>}
        </div>

        {/* Submitted */}
        <div style={{ width: '130px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Submitted</div>
          <div style={{ fontSize: '12px', color: '#7A8899' }}>{formatDate(referral.referralDate)}</div>
        </div>

      </div>

      {/* Status badge */}
      <div style={{ paddingRight: '20px', flexShrink: 0 }}>
        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 10px', borderRadius: '20px', background: s.bg, color: s.color }}>
          {referral.appointmentStatus}
        </span>
      </div>
    </div>
  )
}

export default function ScheduledPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/dawson/referrals?status=Pending+Schedule&status=Scheduled')
      .then(r => r.json())
      .then(data => { setReferrals(data); setLoading(false) })
  }, [])

  const filtered = referrals.filter(r =>
    r.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (r.referringAgency ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.referredBy ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Scheduled</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(42,127,111,0.12)', color: '#2A7F6F' }}>
              {filtered.length} referral{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <input type="text" placeholder="Search by client, agency, or staff..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', marginBottom: '20px', display: 'block', background: 'white' }} />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No scheduled referrals found.</div>
        ) : (
          filtered.map(r => <ReferralCard key={r.id} referral={r} />)
        )}
      </div>
    </div>
  )
}
