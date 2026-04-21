'use client'

import { useState, useEffect } from 'react'

type Agency = {
  id: string
  name: string
  ein: string
  address: string
  address2: string | null
  city: string
  state: string
  zip: string
  phone: string
  email: string
  website: string | null
  officeName: string | null
  contactName: string
  status: string
  registrationDate: string
  approvalDate: string | null
  possibleDuplicate: boolean

}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ConfirmModal({ agencyName, label, onConfirm, onCancel, loading }: {
  agencyName: string; label: string; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', borderRadius: '14px', padding: '32px',
        width: '380px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)',
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>
          Confirm {label}
        </div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '24px' }}>
          Are you sure you want to <strong>{label.toLowerCase()}</strong> <strong>{agencyName}</strong>?
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: 'none',
              background: label === 'Approve' ? '#2A7F6F' : '#C0392B',
              color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
            }}>
            {loading ? '...' : `Yes, ${label}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function PendingCard({ agency, onStatusChange }: { agency: Agency; onStatusChange: (id: string, status: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<{ action: string; label: string } | null>(null)

  async function handleConfirm() {
    if (!modal) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agency.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: modal.action, previousStatus: agency.status }),
      })
      if (res.ok) { onStatusChange(agency.id, modal.action); setModal(null) }
    } finally { setLoading(false) }
  }

  return (
    <>
      {modal && (
        <ConfirmModal
          agencyName={agency.name}
          label={modal.label}
          onConfirm={handleConfirm}
          onCancel={() => setModal(null)}
          loading={loading}
        />
      )}
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px',
        display: 'flex', alignItems: 'center', overflow: 'hidden',
      }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: '#C9A84C', flexShrink: 0 }} />

        <div style={{ width: '270px', flexShrink: 0, padding: '14px 20px', alignSelf: 'flex-start' }}>
         <a href={`/dawson/agencies/${agency.id}?from=pending`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agency.name}
            </div>
          </a>
          {agency.possibleDuplicate && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B', display: 'inline-block', marginTop: '4px' }}>
              ⚠ Possible Duplicate
            </span>
          )}
          {agency.officeName && (
            <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agency.officeName}
            </div>
          )}
          {agency.website && (
            <a href={agency.website} target="_blank" rel="noreferrer" style={{ fontSize: '14px', color: '#1B2B4B', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', marginTop: '2px' }}>
              {agency.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>
          <div style={{ width: '150px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>EIN</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.ein}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Location</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.city}, {agency.state} {agency.zip}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Main Phone</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.phone}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Contact</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.contactName}</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.email}</div>
          </div>
          <div style={{ width: '110px', flexShrink: 0, padding: '0px 20px 14px 0', alignSelf: 'flex-start' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Applied</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{formatDate(agency.registrationDate)}</div>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', paddingRight: '20px', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          {agency.possibleDuplicate && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#C0392B', textAlign: 'center', lineHeight: 1.4 }}>
              ⚠ Possible<br />Duplicate
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '120px' }}>
          <button onClick={() => setModal({ action: 'Approved', label: 'Approve' })} disabled={loading}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', width: '100%' }}>
            Approve
          </button>
          <button onClick={() => setModal({ action: 'Rejected', label: 'Reject' })} disabled={loading}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', width: '100%' }}>
            Reject
          </button>
        </div>
        </div>
      </div>
    </>
  )
}

export default function PendingAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/dawson/agencies?status=Pending')
      .then(r => r.json())
      .then(data => { setAgencies(data); setLoading(false) })
  }, [])

  function handleStatusChange(id: string) {
    setAgencies(prev => prev.filter(a => a.id !== id))
  }

  const filtered = agencies.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.city.toLowerCase().includes(search.toLowerCase()) ||
    a.contactName.toLowerCase().includes(search.toLowerCase()) ||
    (a.officeName ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Pending Approval</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
              {filtered.length} application{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <input
          type="text"
          placeholder="Search agencies..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '260px', outline: 'none', marginBottom: '20px', display: 'block', background: 'white' }}
        />
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No pending applications 🎉</div>
        ) : (
          filtered.map(a => <PendingCard key={a.id} agency={a} onStatusChange={handleStatusChange} />)
        )}
      </div>
    </div>
  )
}