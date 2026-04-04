'use client'

import { useState, useEffect } from 'react'

type Referral = {
  id: string
  clientName: string
  referralDate: string
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

function ConfirmModal({ clientName, action, onConfirm, onCancel, loading }: {
  clientName: string; action: 'Approved' | 'Rejected'; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '32px', width: '380px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>
          {action === 'Approved' ? 'Approve Referral' : 'Reject Referral'}
        </div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '24px' }}>
          Are you sure you want to <strong>{action === 'Approved' ? 'approve' : 'reject'}</strong> the referral for <strong>{clientName}</strong>?
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: action === 'Approved' ? '#2A7F6F' : '#C0392B', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {loading ? '...' : action === 'Approved' ? 'Yes, Approve' : 'Yes, Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReferralCard({ referral, onAction }: { referral: Referral; onAction: (id: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<'Approved' | 'Rejected' | null>(null)

  async function handleConfirm() {
    if (!modal) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referral.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: modal }),
      })
      if (res.ok) { onAction(referral.id); setModal(null) }
    } finally { setLoading(false) }
  }

  return (
    <>
      {modal && (
        <ConfirmModal
          clientName={referral.clientName}
          action={modal}
          onConfirm={handleConfirm}
          onCancel={() => setModal(null)}
          loading={loading}
        />
      )}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: '#C9A84C', flexShrink: 0 }} />

        {/* Client info */}
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

          {/* Date */}
          <div style={{ width: '130px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Submitted</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>{formatDate(referral.referralDate)}</div>
          </div>

        </div>

        {/* Actions */}
        <div style={{ paddingRight: '20px', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setModal('Approved')} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Approve
          </button>
          <button onClick={() => setModal('Rejected')} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Reject
          </button>
        </div>
      </div>
    </>
  )
}

export default function AwaitingReviewPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/dawson/referrals?review=Pending')
      .then(r => r.json())
      .then(data => { setReferrals(data); setLoading(false) })
  }, [])

  function handleAction(id: string) {
    setReferrals(prev => prev.filter(r => r.id !== id))
  }

  const filtered = referrals.filter(r =>
    r.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (r.referringAgency ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.referredBy ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Awaiting Review</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
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
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No referrals awaiting review 🎉</div>
        ) : (
          filtered.map(r => <ReferralCard key={r.id} referral={r} onAction={handleAction} />)
        )}
      </div>
    </div>
  )
}
