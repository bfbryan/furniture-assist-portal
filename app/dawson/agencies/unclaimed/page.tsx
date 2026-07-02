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
  // email + contactName come from the Primary Admin lookup chain (June 2026).
  // For Unclaimed agencies these are null by definition — no admin assigned yet.
  email: string | null
  website: string | null
  officeName: string | null
  contactName: string
  status: string
  registrationDate: string | null
  approvalDate: string | null
  invitedDate: string | null
  rejectedDate: string | null
  source: string | null
  possibleDuplicate: boolean
}

type SortKey = 'name' | 'created'
type SortDir = 'asc' | 'desc'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sourceBadgeColors(source: string | null): { bg: string; fg: string } {
  switch (source) {
    case 'Created via Referral': return { bg: 'rgba(58,160,141,0.12)', fg: '#2A7F6F' }
    case 'Created via Import':   return { bg: 'rgba(201,168,76,0.15)', fg: '#C9A84C' }
    case 'Manual Entry':         return { bg: 'rgba(122,136,153,0.15)', fg: '#7A8899' }
    case 'Self Registration':    return { bg: 'rgba(27,43,75,0.10)',   fg: '#1B2B4B' }
    default:                     return { bg: 'rgba(122,136,153,0.12)', fg: '#7A8899' }
  }
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

function InviteModal({ agency, onClose, onInvited }: {
  agency: Agency
  onClose: () => void
  onInvited: (id: string) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(email.trim())

  async function handleSubmit() {
    if (!valid) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dawson/agencies/${agency.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error || `Invite failed (${res.status})`)
        return
      }
      onInvited(agency.id)
    } catch (e) {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: '8px',
    border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A',
    outline: 'none', background: 'white', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '6px', display: 'block',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', borderRadius: '14px', padding: '28px',
        width: '440px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)',
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '4px' }}>
          Invite Primary Admin
        </div>
        <div style={{ fontSize: '12px', color: '#7A8899', marginBottom: '20px' }}>
          {agency.name}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>First Name</label>
            <input style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} autoFocus />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Last Name</label>
            <input style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        {error && (
          <div style={{ fontSize: '12px', color: '#C0392B', marginBottom: '14px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px' }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: '11px', color: '#7A8899', marginBottom: '18px', lineHeight: 1.5 }}>
          An invitation email will be sent. The agency moves to <strong>Invited</strong> and this person becomes the Primary Admin.
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading || !valid}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: 'none',
              background: valid ? '#2A7F6F' : '#B8C3CC',
              color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
              cursor: valid && !loading ? 'pointer' : 'not-allowed',
            }}>
            {loading ? 'Sending...' : 'Send Invitation'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UnclaimedCard({ agency, onInvited }: { agency: Agency; onInvited: (id: string) => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const src = sourceBadgeColors(agency.source)

  return (
    <>
      {modalOpen && (
        <InviteModal
          agency={agency}
          onClose={() => setModalOpen(false)}
          onInvited={onInvited}
        />
      )}
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px',
        display: 'flex', alignItems: 'center', overflow: 'hidden',
      }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: '#7A8899', flexShrink: 0 }} />

        <div style={{ width: '270px', flexShrink: 0, padding: '14px 20px', alignSelf: 'flex-start' }}>
          <a href={`/dawson/agencies/${agency.id}?from=unclaimed`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agency.name}
            </div>
          </a>
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
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.city}, {agency.state} {agency.zip}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>{agency.phone || '—'}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <span style={{
              display: 'inline-block', fontSize: '10px', fontWeight: 700,
              padding: '3px 8px', borderRadius: '12px',
              background: src.bg, color: src.fg,
              letterSpacing: '0.04em',
            }}>
              {agency.source || 'Unknown'}
            </span>
          </div>
          <div style={{ width: '150px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>{formatDate(agency.registrationDate)}</div>
          </div>
        </div>

        <div style={{ paddingRight: '20px', flexShrink: 0, width: '160px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {agency.possibleDuplicate && (
            <div title="Possible duplicate" style={{ fontSize: '18px', color: '#C0392B', flexShrink: 0 }}>
              ⚠
            </div>
          )}
          <button onClick={() => setModalOpen(true)}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', flex: 1 }}>
            Invite Admin
          </button>
        </div>
      </div>
    </>
  )
}

export default function UnclaimedAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    fetch('/api/dawson/agencies?status=Unclaimed')
      .then(r => r.json())
      .then(data => { setAgencies(data); setLoading(false) })
  }, [])

  function handleInvited(id: string) {
    // After invite, the agency moves to Invited status and leaves this list
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

  const filtered = agencies
    .filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.city.toLowerCase().includes(search.toLowerCase()) ||
      (a.officeName ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (a.source ?? '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let val = 0
      if (sortKey === 'name') val = a.name.localeCompare(b.name)
      else if (sortKey === 'created') {
        const aT = a.registrationDate ? new Date(a.registrationDate).getTime() : 0
        const bT = b.registrationDate ? new Date(b.registrationDate).getTime() : 0
        val = aT - bT
      }
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
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Unclaimed Agencies</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(122,136,153,0.15)', color: '#7A8899' }}>
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
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Source</div>
              <SortHeader label="Created" sortKey="created" current={sortKey} dir={sortDir} onClick={handleSort} width="150px" />
            </div>
            <div style={{ width: '160px', flexShrink: 0, paddingRight: '20px' }} />
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>
            {search ? 'No agencies match your search.' : 'No unclaimed agencies — everything is accounted for 🎉'}
          </div>
        ) : (
          filtered.map(a => <UnclaimedCard key={a.id} agency={a} onInvited={handleInvited} />)
        )}
      </div>
    </div>
  )
}
