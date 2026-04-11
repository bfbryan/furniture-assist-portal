'use client'

import { useState, useEffect } from 'react'

type Agency = {
  id: string
  name: string
  address: string
  address2: string | null
  city: string
  state: string
  zip: string
  phone: string
  email: string
  website: string | null
  contactName: string
  status: string
  registrationDate: string
  approvalDate: string | null
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ConfirmModal({ agencyName, action, label, onConfirm, onCancel, loading }: {
  agencyName: string; action: string; label: string; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  const buttonColor = action === 'Approved' ? '#2A7F6F' : '#C9A84C'
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
          {label}
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
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: buttonColor, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {loading ? '...' : `Yes, ${label}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgencyCard({ agency, onStatusChange }: { agency: Agency; onStatusChange: (id: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<{ action: string; label: string } | null>(null)
  const isInactive = agency.status === 'Inactive'
  const accentColor = isInactive ? '#7A8899' : '#C0392B'

  async function handleConfirm() {
    if (!modal) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agency.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: modal.action, previousStatus: agency.status }),
      })
      if (res.ok) { onStatusChange(agency.id); setModal(null) }
    } finally { setLoading(false) }
  }

  return (
    <>
      {modal && (
        <ConfirmModal
          agencyName={agency.name}
          action={modal.action}
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
        <div style={{ width: '4px', alignSelf: 'stretch', background: accentColor, flexShrink: 0 }} />

        <div style={{ width: '270px', flexShrink: 0, padding: '14px 20px', alignSelf: 'flex-start' }}>
          <a href={`/dawson/agencies/${agency.id}?from=inactive`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agency.name}
            </div>
          </a>
          {agency.website && (
            <a href={agency.website} target="_blank" rel="noreferrer" style={{ fontSize: '14px', color: '#2A7F6F', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', marginTop: '2px' }}>
              {agency.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Location</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.city}, {agency.state} {agency.zip}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Contact</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.contactName}</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.email}</div>
          </div>
          <div style={{ width: '130px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Applied</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{formatDate(agency.registrationDate)}</div>
          </div>
          <div style={{ width: '130px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>
              {isInactive ? 'Approved' : 'Rejected'}
            </div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>
              {isInactive ? formatDate(agency.approvalDate) : '—'}
            </div>
          </div>
        </div>

        <div style={{ paddingRight: '20px', flexShrink: 0, width: '120px' }}>
          {isInactive ? (
            <button onClick={() => setModal({ action: 'Approved', label: 'Reinstate' })} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', width: '100%' }}>
              Reinstate
            </button>
          ) : (
            <button onClick={() => setModal({ action: 'Pending', label: 'Reconsider' })} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'rgba(201,168,76,0.12)', color: '#C9A84C', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', width: '100%' }}>
              Reconsider
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function GroupSection({ title, agencies, accent, onStatusChange, defaultOpen = true }: {
  title: string
  agencies: Agency[]
  accent: string
  onStatusChange: (id: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (agencies.length === 0) return null

  return (
    <div style={{ marginBottom: '40px' }}>
      <button onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent, fontFamily: 'var(--font-montserrat)' }}>
            {title}
          </span>
          <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>
        </div>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {agencies.length} {agencies.length === 1 ? 'agency' : 'agencies'}
        </span>
      </button>
      {open && agencies.map(a => (
        <AgencyCard key={a.id} agency={a} onStatusChange={onStatusChange} />
      ))}
    </div>
  )
}

export default function InactiveAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/dawson/agencies?status=Inactive').then(r => r.json()),
      fetch('/api/dawson/agencies?status=Rejected').then(r => r.json()),
    ]).then(([inactive, rejected]) => {
      setAgencies([...inactive, ...rejected])
      setLoading(false)
    })
  }, [])

  function handleStatusChange(id: string) {
    setAgencies(prev => prev.filter(a => a.id !== id))
  }

  const filtered = agencies.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.city.toLowerCase().includes(search.toLowerCase()) ||
    a.contactName.toLowerCase().includes(search.toLowerCase())
  )

  const inactive = filtered.filter(a => a.status === 'Inactive')
  const rejected = filtered.filter(a => a.status === 'Rejected')

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Inactive & Rejected</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: '#F0F0F0', color: '#7A8899' }}>
              {filtered.length} {filtered.length === 1 ? 'agency' : 'agencies'}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <input type="text" placeholder="Search agencies..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '260px', outline: 'none', marginBottom: '20px', display: 'block', background: 'white' }} />
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No inactive or rejected agencies.</div>
        ) : (
          <>
            <GroupSection title="Inactive Agencies" agencies={inactive} accent="#7A8899" onStatusChange={handleStatusChange} defaultOpen={true} />
            <GroupSection title="Rejected Applications" agencies={rejected} accent="#C0392B" onStatusChange={handleStatusChange} defaultOpen={false} />
          </>
        )}
      </div>
    </div>
  )
}

