'use client'

import { useState, useEffect } from 'react'
import { matchesSearch } from '@/lib/search'
import { useAgencyStaffSearch } from '@/components/internal/useAgencyStaffSearch'
import StaffMatchHint from '@/components/internal/StaffMatchHint'
import DawsonPageControls from '@/components/internal/DawsonPageControls'
import { cityStateZip } from '@/lib/address'
import { formatEasternTimestamp } from '@/lib/dates'

// Address fields are string | null: Airtable omits blank fields, and most of
// these are blank on plenty of rows (75 of 129 unclaimed agencies have no
// City). Searching them goes through matchesSearch, which treats missing as
// "does not match" rather than crashing or falsely matching.
type Agency = {
  id: string
  name: string
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  // email + contactName come from the Primary Admin lookup chain (June 2026).
  // Ben links a Primary Admin during reconciliation, so a populated email
  // here means there is an admin on file to invite.
  email: string | null
  website: string | null
  officeName: string | null
  contactName: string
  status: string
  registrationDate: string | null
  approvalDate: string | null
  invitedDate: string | null
  rejectedDate: string | null
  possibleDuplicate: boolean
  reconciled: boolean
}

// Ben invites agencies one at a time as he reconciles them. An agency is only
// invitable once BOTH are true in Airtable: Reconciled is ticked, and a
// Primary Admin with an email is linked. Everything else stays disabled with
// the reason shown, so nothing can be invited early by accident.
function inviteBlockReason(agency: Agency): string | null {
  if (!agency.reconciled) return 'Not reconciled yet'
  if (!agency.email) return 'No admin on file'
  return null
}

// Agency name column. Wider than it was (270px) because long agency names were
// truncating mid-word; the width the Source column gave up covers it.
const NAME_COL_WIDTH = '360px'

type SortKey = 'name' | 'created'
type SortDir = 'asc' | 'desc'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isResend = agency.status === 'Invited'

  // The admin's identity comes from the Primary Admin already linked in
  // Airtable — nothing is typed here, so the invite can only ever go to the
  // person on file. The endpoint re-checks the same guard server-side.
  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dawson/agencies/${agency.id}/invite`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error || `Invite failed (${res.status})`)
        return
      }
      // The route returns 200 whether or not the email actually went out — the
      // Airtable stamps are already committed by then and are not undone by a
      // send failure. So the card would flip to Invited and look finished even
      // when Resend rejected the message and the admin has no link. Once the
      // automations are enabled at go-live, a bad key or an unverified sender
      // would do that silently for every agency in a row.
      //
      // A skipped send is NOT a failure: while the automation is disabled in
      // Airtable, { skipped: true } is the designed behaviour and the invite
      // has genuinely succeeded.
      const body = await res.json().catch(() => ({}))
      const email = body?.email
      if (email && email.skipped === false && email.sent === false) {
        setError(
          `${agency.name} is marked Invited, but the email did not send: ${email.error ?? 'unknown error'}. ` +
          `Use Resend Invite once that is fixed.`
        )
        return
      }
      onInvited(agency.id)
    } catch (e) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
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
          {isResend ? 'Resend Invitation' : 'Invite Primary Admin'}
        </div>
        <div style={{ fontSize: '12px', color: '#7A8899', marginBottom: '20px' }}>
          {agency.name}
        </div>

        <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '14px 16px', marginBottom: '18px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '6px' }}>
            Admin on file
          </div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1B2B4B' }}>
            {agency.contactName || '—'}
          </div>
          <div style={{ fontSize: '13px', color: '#2C3A4A' }}>{agency.email}</div>
        </div>

        {error && (
          <div style={{ fontSize: '12px', color: '#C0392B', marginBottom: '14px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px' }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: '11px', color: '#7A8899', marginBottom: '18px', lineHeight: 1.5 }}>
          {isResend ? (
            <>A fresh sign-in link is emailed to this person. Their previous link stops working.</>
          ) : (
            <>This creates the agency&apos;s portal account and emails this person their
            sign-in link. The agency moves to <strong>Invited</strong> and stays on this
            page until they sign in for the first time.</>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: 'none',
              background: '#2A7F6F',
              color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            {loading ? 'Sending...' : isResend ? 'Resend Invitation' : 'Send Invitation'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UnclaimedCard({ agency, matchedStaff, onInvited }: { agency: Agency; matchedStaff: string[]; onInvited: (id: string) => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const blockReason = inviteBlockReason(agency)
  const isInvited = agency.status === 'Invited'

  return (
    <>
      {modalOpen && (
        <InviteModal
          agency={agency}
          onClose={() => setModalOpen(false)}
          onInvited={(id) => { setModalOpen(false); onInvited(id) }}
        />
      )}
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px',
        display: 'flex', alignItems: 'center', overflow: 'hidden',
      }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: isInvited ? '#5B8DB8' : '#7A8899', flexShrink: 0 }} />

        <div style={{ width: NAME_COL_WIDTH, flexShrink: 0, padding: '14px 20px', alignSelf: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a href={`/dawson/agencies/${agency.id}?from=unclaimed`} style={{ textDecoration: 'none', minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {agency.name}
              </div>
            </a>
            {/* formatDate is for Airtable's date-only fields — it appends
                'T12:00:00'. Invited Date is a dateTime, so it arrives as a
                full instant ("2026-07-18T04:00:00.000Z") and that
                concatenation does not parse: the tooltip read "Invited
                Invalid Date". formatEasternTimestamp is the helper for an
                instant; see the header of lib/dates.ts. */}
            {isInvited && (
              <span title={agency.invitedDate ? `Invited ${formatEasternTimestamp(agency.invitedDate, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Invited'}
                style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(91,141,184,0.12)', color: '#5B8DB8', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
                Invited
              </span>
            )}
          </div>
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
          <StaffMatchHint names={matchedStaff} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{cityStateZip(agency.city, agency.state, agency.zip)}</div>
          </div>
          <div style={{ width: '190px', flexShrink: 0, padding: '0px 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>{agency.phone || '—'}</div>
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
          {blockReason ? (
            <button disabled title={blockReason}
              style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#EDE9E1', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'not-allowed', flex: 1 }}>
              {blockReason}
            </button>
          ) : (
            <button onClick={() => setModalOpen(true)}
              style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: isInvited ? 'rgba(91,141,184,0.12)' : '#2A7F6F', color: isInvited ? '#5B8DB8' : 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', flex: 1 }}>
              {isInvited ? 'Resend Invite' : 'Invite'}
            </button>
          )}
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
    // Invited agencies stay on this page (with a badge and a Resend button)
    // until their admin claims — otherwise a pending invite would be
    // invisible in every list between Invite and first sign-in.
    fetch('/api/dawson/agencies?status=Unclaimed,Invited')
      .then(r => r.json())
      .then(data => { setAgencies(data); setLoading(false) })
  }, [])

  function handleInvited(id: string) {
    // Flip the card to its Invited look in place; it leaves the page for
    // good once the admin signs in and the agency moves to Approved.
    setAgencies(prev => prev.map(a =>
      a.id === id ? { ...a, status: 'Invited', invitedDate: new Date().toISOString() } : a
    ))
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Searching a PERSON keeps their agency on screen. `selfMatch` is the test
  // this page always had; `staffMatches` adds the people who work there, from
  // one read of Agency Users per page load. The hint under an agency's name is
  // shown only when the agency itself did NOT match, so typing an agency name
  // changes nothing about how this page already looked.
  const staffMatches = useAgencyStaffSearch()
  const selfMatch = (a: Agency) => matchesSearch(search, a.name, a.city, a.officeName)
  const staffHint = (a: Agency) => (selfMatch(a) ? [] : staffMatches(a.id, search))

  const filtered = agencies
    .filter(a => selfMatch(a) || staffMatches(a.id, search).length > 0)
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
      <DawsonPageControls>
        {!loading && (
          <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(122,136,153,0.15)', color: '#7A8899' }}>
            {filtered.length} {filtered.length === 1 ? 'agency' : 'agencies'}
          </span>
        )}
      </DawsonPageControls>

      <div style={{ padding: '28px 32px' }}>
        <input
          type="text"
          placeholder="Search agencies or staff..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '260px', outline: 'none', marginBottom: '16px', display: 'block', background: 'white' }}
        />

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '4px', marginBottom: '6px' }}>
            <div style={{ width: '4px', flexShrink: 0 }} />
            <SortHeader label="Agency" sortKey="name" current={sortKey} dir={sortDir} onClick={handleSort} width={NAME_COL_WIDTH} />
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Location</div>
              <div style={{ width: '190px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', paddingRight: '20px' }}>Main Phone</div>
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
          filtered.map(a => <UnclaimedCard key={a.id} agency={a} matchedStaff={staffHint(a)} onInvited={handleInvited} />)
        )}
      </div>
    </div>
  )
}
