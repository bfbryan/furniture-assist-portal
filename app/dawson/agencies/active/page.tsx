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
  approvalDate: string | null
  submitted?: number
  completed?: number
}

type SortKey = 'name' | 'submitted' | 'completed' | 'completion'
type SortDir = 'asc' | 'desc'

function ConfirmModal({ agencyName, onConfirm, onCancel, loading }: {
  agencyName: string; onConfirm: () => void; onCancel: () => void; loading: boolean
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
          Mark Inactive
        </div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '24px' }}>
          Are you sure you want to mark <strong>{agencyName}</strong> as inactive?
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: '#7A8899', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {loading ? '...' : 'Yes, Mark Inactive'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, current, dir, onClick, width }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void; width: string
}) {
  const active = current === sortKey
  return (
    <button onClick={() => onClick(sortKey)} style={{
      width, flexShrink: 0,
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '0 20px 8px 0', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: '4px',
      fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: active ? '#2A7F6F' : '#1B2B4B',
      fontFamily: 'var(--font-montserrat)',
    }}>
      {label}
      <span style={{ fontSize: '9px', color: active ? '#2A7F6F' : '#C4C9D0' }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  )
}

function ActiveCard({ agency, onStatusChange }: { agency: Agency; onStatusChange: (id: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)

  const submitted = agency.submitted ?? null
  const completed = agency.completed ?? null
  const completion = submitted && completed ? Math.round((completed / submitted) * 100) : null

  async function handleConfirm() {
    setLoading(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agency.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Inactive', previousStatus: agency.status }),
      })
      if (res.ok) { onStatusChange(agency.id); setModal(false) }
    } finally { setLoading(false) }
  }

  return (
    <>
      {modal && (
        <ConfirmModal
          agencyName={agency.name}
          onConfirm={handleConfirm}
          onCancel={() => setModal(false)}
          loading={loading}
        />
      )}
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px',
        display: 'flex', alignItems: 'center', overflow: 'hidden',
      }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: '#2A7F6F', flexShrink: 0 }} />

        <div style={{ width: '270px', flexShrink: 0, padding: '14px 20px', alignSelf: 'flex-start' }}>
          <a href={`/dawson/agencies/${agency.id}?from=active`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agency.name}
            </div>
          </a>
          {agency.website && (
            <a href={agency.website} target="_blank" rel="noreferrer" style={{ fontSize: '14px', color: '#1B2B4B', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', marginTop: '2px' }}>
              {agency.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.city}, {agency.state} {agency.zip}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>{agency.phone}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.contactName}</div>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.email}</div>
          </div>
          <div style={{ width: '150px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '22px', fontFamily: 'var(--font-montserrat)', fontWeight: 800, color: '#1B2B4B', lineHeight: 1 }}>
              {submitted !== null ? submitted : '—'}
            </div>
          </div>
          <div style={{ width: '150px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '22px', fontFamily: 'var(--font-montserrat)', fontWeight: 800, color: '#2A7F6F', lineHeight: 1 }}>
              {completed !== null ? completed : '—'}
            </div>
          </div>
          <div style={{ width: '150px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '22px', fontFamily: 'var(--font-montserrat)', fontWeight: 800, color: '#1B2B4B', lineHeight: 1 }}>
              {completion !== null ? `${completion}%` : '—'}
            </div>
          </div>
        </div>

        <div style={{ paddingRight: '20px', flexShrink: 0, width: '120px' }}>
          <button onClick={() => setModal(true)} disabled={loading}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#F0F0F0', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', width: '100%' }}>
            Mark Inactive
          </button>
        </div>
      </div>
    </>
  )
}

export default function ActiveAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    fetch('/api/dawson/agencies?status=Approved')
      .then(r => r.json())
      .then(data => { setAgencies(data); setLoading(false) })
  }, [])

  function handleStatusChange(id: string) {
    setAgencies(prev => prev.filter(a => a.id !== id))
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function getCompletion(a: Agency) {
    if (a.submitted && a.completed) return Math.round((a.completed / a.submitted) * 100)
    return -1
  }

  const filtered = agencies
    .filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.city.toLowerCase().includes(search.toLowerCase()) ||
      a.contactName.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let val = 0
      if (sortKey === 'name') val = a.name.localeCompare(b.name)
      else if (sortKey === 'submitted') val = (a.submitted ?? -1) - (b.submitted ?? -1)
      else if (sortKey === 'completed') val = (a.completed ?? -1) - (b.completed ?? -1)
      else if (sortKey === 'completion') val = getCompletion(a) - getCompletion(b)
      return sortDir === 'asc' ? val : -val
    })

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Active Agencies</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(42,127,111,0.12)', color: '#2A7F6F' }}>
              {filtered.length} {filtered.length === 1 ? 'agency' : 'agencies'}
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
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '260px', outline: 'none', marginBottom: '16px', display: 'block', background: 'white' }}
        />

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '4px', marginBottom: '6px' }}>
            <div style={{ width: '4px', flexShrink: 0 }} />
            <SortHeader label="Agency" sortKey="name" current={sortKey} dir={sortDir} onClick={handleSort} width="270px" />
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Location</div>
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Main Phone</div>
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Contact</div>
              <SortHeader label="Submitted" sortKey="submitted" current={sortKey} dir={sortDir} onClick={handleSort} width="150px" />
              <SortHeader label="Completed" sortKey="completed" current={sortKey} dir={sortDir} onClick={handleSort} width="150px" />
              <SortHeader label="Completion %" sortKey="completion" current={sortKey} dir={sortDir} onClick={handleSort} width="150px" />
            </div>
            <div style={{ width: '120px', flexShrink: 0, paddingRight: '20px' }} />
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No active agencies found.</div>
        ) : (
          filtered.map(a => <ActiveCard key={a.id} agency={a} onStatusChange={handleStatusChange} />)
        )}
      </div>
    </div>
  )
}


