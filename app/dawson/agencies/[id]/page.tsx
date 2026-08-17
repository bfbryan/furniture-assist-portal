'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AgencyReferralsPanel, { AgencyReferral, ReferralStatus } from "@/components/internal/AgencyReferralsPanel"
import { cityStateZip } from '@/lib/address'
import { formatEasternTimestamp } from '@/lib/dates'

type AgencyUser = {
  id: string
  name: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string
  status: string
  invitedDate: string | null
  needsReview: boolean         // June 2026: placeholder users from Excel import
  isPrimaryAdmin: boolean      // June 2026: derived from Agency.Primary Admin link
}

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null   // July 2026: shown as “Appt Date” in the panel when present
  referralReview: string
  appointmentStatus: string
  referredBy: string | null
}

// Optional Airtable fields are string | null — Airtable omits blank fields,
// so anything not guaranteed present must not be typed as a bare string.
type Agency = {
  id: string
  name: string
  ein: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  officeName: string | null
  phone: string | null
  website: string | null
  // Admin-derived fields are LOOKUPS via Primary Admin link (June 2026).
  // All four will be null for Unclaimed agencies with no Primary Admin set.
  email: string | null
  contactFirstName: string | null
  contactLastName: string | null
  contactPhone: string | null
  primaryAdminId: string | null
  status: string
  registrationDate: string | null
  approvalDate: string | null
  invitedDate: string | null
  rejectedDate: string | null
  source: string | null
  agencyNumber: string | null
  possibleDuplicate: boolean
  notes: string | null
  users: AgencyUser[]
  referralCount: number
  referrals: Referral[]
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  // June 2026 migration added Unclaimed + Invited.
  Unclaimed: { accent: '#7A8899', badgeBg: '#F0F0F0',                 badgeText: '#7A8899' },
  Invited:   { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',   badgeText: '#5B8DB8' },
  Pending:   { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',   badgeText: '#C9A84C' },
  Approved:  { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',   badgeText: '#2A7F6F' },
  Rejected:  { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',     badgeText: '#C0392B' },
  Inactive:  { accent: '#7A8899', badgeBg: '#F0F0F0',                 badgeText: '#7A8899' },
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '160px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || '—'}
      </div>
    </div>
  )
}

function NotesModal({ currentNotes, onSave, onCancel, saving }: {
  currentNotes: string; onSave: (notes: string) => void; onCancel: () => void; saving: boolean
}) {
  const [value, setValue] = useState(currentNotes)
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'white', borderRadius: '14px', padding: '32px',
        width: '500px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)',
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>Edit Notes</div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '16px' }}>These notes are saved to the agency record.</div>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={6}
          placeholder="Add notes about this agency..."
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'white' }}
        />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => onSave(value)} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Map the existing Referral type (from the API) to AgencyReferral (for the
// panel component). July 2026: statuses now pass through 1:1 from Airtable
// Appointment Status (Unscheduled | Pending Schedule | Scheduled | Cancelled |
// Completed | No Show). The old “Pending Review” label was retired —
// pre-review referrals now live natively as Appointment Status = Unscheduled.
function toAgencyReferral(r: Referral): AgencyReferral {
  const isRejected  = r.referralReview === 'Rejected'
  const isWithdrawn = r.referralReview === 'Withdrawn'

  let status: ReferralStatus
  if (isRejected || isWithdrawn) {
    // Review-stage rejection/withdrawal surfaces as Cancelled in the panel.
    status = 'Cancelled'
  } else {
    const map: Record<string, ReferralStatus> = {
      'Unscheduled':      'Unscheduled',
      'Pending Schedule': 'Pending Schedule',
      'Scheduled':        'Scheduled',
      'Cancelled':        'Cancelled',
      'Completed':        'Completed',
      'No Show':          'No Show',
    }
    status = map[r.appointmentStatus] ?? 'Unscheduled'
  }

  return {
    id: r.id,
    clientName: r.clientName,
    submittedBy: r.referredBy ?? '—',
    referralDate: r.referralDate,
    appointmentDate: r.appointmentDate,
    status,
  }
}

export default function AgencyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [agency, setAgency] = useState<Agency | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [agencyId, setAgencyId] = useState<string>('')
  const [notesModal, setNotesModal] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
 const [back, setBack] = useState<{ href: string; label: string }>({
  href: '/dawson/agencies/active',
  label: 'Agencies',
})

useEffect(() => {
  const p = new URLSearchParams(window.location.search)
  const from = p.get('from')
  switch (from) {
    case 'scheduled':
      setBack({ href: '/dawson/admin/scheduled', label: 'Scheduled' })
      break
    case 'pending':
      setBack({ href: '/dawson/agencies/pending', label: 'Pending Agencies' })
      break
    case 'inactive':
      setBack({ href: '/dawson/agencies/inactive', label: 'Inactive Agencies' })
      break
    case 'unclaimed':
      setBack({ href: '/dawson/agencies/unclaimed', label: 'Unclaimed Agencies' })
      break
    case 'active':
    default:
      setBack({ href: '/dawson/agencies/active', label: 'Agencies' })
  }
}, [])

  async function handleStatusChange(newStatus: string) {
    if (!agency) return
    if (confirm !== newStatus) { setConfirm(newStatus); return }
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, previousStatus: agency.status }),
      })
      if (res.ok) {
        setAgency({ ...agency, status: newStatus })
        setConfirm(null)
      }
    } finally { setStatusLoading(false) }
  }

  async function handleSaveNotes(notes: string) {
    setNotesSaving(true)
    try {
      const res = await fetch(`/api/dawson/agencies/${agencyId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (res.ok && agency) {
        setAgency({ ...agency, notes })
        setNotesModal(false)
      }
    } finally { setNotesSaving(false) }
  }

  useEffect(() => {
    params.then(({ id }) => {
      setAgencyId(id)
      fetch(`/api/dawson/agencies/${id}`)
        .then(r => r.json())
        .then(data => { setAgency(data); setLoading(false) })
    })
  }, [params])

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading agency...
    </div>
  )

  if (!agency) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Agency not found.
    </div>
  )

  const colors = STATUS_COLORS[agency.status] ?? STATUS_COLORS.Inactive
  const initials = agency.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const panelReferrals = agency.referrals.map(toAgencyReferral)

  const locality = cityStateZip(agency.city, agency.state, agency.zip)

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      {notesModal && (
        <NotesModal
          currentNotes={agency.notes ?? ''}
          onSave={handleSaveNotes}
          onCancel={() => setNotesModal(false)}
          saving={notesSaving}
        />
      )}

      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* July 2026: back button uses router.back() so it returns to whichever list
              (Active / Pending / Inactive / Unclaimed) the user came from.
              Falls back to /dawson/agencies if there's no history (fresh tab). */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/dawson/agencies')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>{agency.name}</div>
          {agency.possibleDuplicate && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
              ⚠ Possible Duplicate
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
            {agency.status}
          </span>

          {agency.status === 'Pending' && (
            <>
              <button onClick={() => handleStatusChange('Approved')} disabled={statusLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Approved' ? '#2A7F6F' : 'rgba(42,127,111,0.1)', color: confirm === 'Approved' ? 'white' : '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {statusLoading && confirm === 'Approved' ? '...' : confirm === 'Approved' ? 'Confirm Approve' : 'Approve'}
              </button>
              <button onClick={() => handleStatusChange('Rejected')} disabled={statusLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Rejected' ? '#C0392B' : 'rgba(192,57,43,0.08)', color: confirm === 'Rejected' ? 'white' : '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {statusLoading && confirm === 'Rejected' ? '...' : confirm === 'Rejected' ? 'Confirm Reject' : 'Reject'}
              </button>
            </>
          )}
          {agency.status === 'Approved' && (
            <button onClick={() => handleStatusChange('Inactive')} disabled={statusLoading}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Inactive' ? '#7A8899' : '#F0F0F0', color: confirm === 'Inactive' ? 'white' : '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              {statusLoading ? '...' : confirm === 'Inactive' ? 'Confirm Inactive' : 'Mark Inactive'}
            </button>
          )}
          {agency.status === 'Rejected' && (
            <button onClick={() => handleStatusChange('Pending')} disabled={statusLoading}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Pending' ? '#C9A84C' : 'rgba(201,168,76,0.12)', color: confirm === 'Pending' ? 'white' : '#C9A84C', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              {statusLoading ? '...' : confirm === 'Pending' ? 'Confirm' : 'Reconsider'}
            </button>
          )}
          {agency.status === 'Inactive' && (
            <button onClick={() => handleStatusChange('Approved')} disabled={statusLoading}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Approved' ? '#2A7F6F' : 'rgba(42,127,111,0.1)', color: confirm === 'Approved' ? 'white' : '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              {statusLoading ? '...' : confirm === 'Approved' ? 'Confirm' : 'Reinstate'}
            </button>
          )}
          {confirm && (
            <button onClick={() => setConfirm(null)}
              style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Agency Info */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ background: colors.accent, height: '4px' }} />
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: '#1B2B4B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#3AA08D', flexShrink: 0 }}>
                  {initials}
                </div>
                <div>
                  <h1 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', margin: '0 0 4px' }}>{agency.name}</h1>
                  {agency.agencyNumber && <div style={{ fontSize: '12px', color: '#7A8899' }}>Agency #{agency.agencyNumber}</div>}
                </div>
              </div>
              <div style={{ borderTop: '1px solid #F7F5F1', paddingTop: '4px' }}>
                <InfoRow label="EIN" value={agency.ein} />
                {agency.officeName && <InfoRow label="Office" value={agency.officeName} />}
                <InfoRow label="Address" value={
                  agency.address || locality ? (
                    <>
                      {agency.address}{agency.address2 ? `, ${agency.address2}` : ''}
                      {agency.address && locality ? <br /> : null}
                      {locality}
                    </>
                  ) : null
                } />
                {agency.county && <InfoRow label="County" value={`${agency.county} County`} />}<InfoRow label="Main Phone" value={agency.phone} />
                <InfoRow label="Website" value={agency.website ? <a href={agency.website} target="_blank" rel="noreferrer" style={{ color: '#2A7F6F', textDecoration: 'none' }}>{agency.website}</a> : null} />
                <InfoRow label="Record Created" value={formatDate(agency.registrationDate)} />
                {/* Invited Date is a dateTime field, i.e. a true instant, not
                    one of Airtable's date-only values. formatDate below builds
                    `${value}T12:00:00`, which on "2026-07-18T04:00:00.000Z"
                    produces an unparseable string and printed the literal text
                    "Invalid Date" on this row. See the header of lib/dates.ts
                    for which helper belongs to which kind of value. */}
                {agency.invitedDate && <InfoRow label="Invited" value={formatEasternTimestamp(agency.invitedDate, { month: 'short', day: 'numeric', year: 'numeric' })} />}
                <InfoRow label="Approval Date" value={formatDate(agency.approvalDate)} />
                {agency.rejectedDate && <InfoRow label="Rejected" value={formatDate(agency.rejectedDate)} />}
                {agency.source && <InfoRow label="Source" value={agency.source} />}
                {agency.possibleDuplicate && (
                  <InfoRow label="Duplicate Flag" value={<span style={{ color: '#C0392B', fontWeight: 700 }}>⚠ Flagged as possible duplicate</span>} />
                )}
              </div>
            </div>
          </div>

          {/* Primary Admin — comes from Primary Admin lookup chain (June 2026).
             For Unclaimed agencies this card is empty until an admin is assigned. */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B' }}>Primary Admin</div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {agency.primaryAdminId ? (
                <>
                  <InfoRow label="Name" value={`${agency.contactFirstName ?? ''} ${agency.contactLastName ?? ''}`.trim() || null} />
                  <InfoRow label="Email" value={agency.email ? <a href={`mailto:${agency.email}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{agency.email}</a> : null} />
                  <InfoRow label="Phone" value={agency.contactPhone} />
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>
                  No primary admin assigned yet. Set one from the Portal Staff list when the agency claims.
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B' }}>Notes</div>
              <button onClick={() => setNotesModal(true)}
                style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
                {agency.notes ? 'Edit' : '+ Add Note'}
              </button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {agency.notes ? (
                <div style={{ fontSize: '13px', color: '#1B2B4B', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{agency.notes}</div>
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>No notes added yet.</div>
              )}
            </div>
          </div>

          {/* Referrals */}
          <AgencyReferralsPanel referrals={panelReferrals} />

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '20px' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', marginBottom: '16px' }}>Agency Stats</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '24px', color: '#1B2B4B', lineHeight: 1 }}>{agency.referralCount}</div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#7A8899', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Referrals</div>
              </div>
              <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '24px', color: '#2A7F6F', lineHeight: 1 }}>{agency.users.filter(u => u.status === 'Active').length}</div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#7A8899', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active Staff</div>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B' }}>Portal Staff</div>
            </div>
            {agency.users.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#7A8899', fontSize: '13px' }}>No portal users yet</div>
            ) : (
              agency.users.map(u => {
                // Status colors expanded for the new Unclaimed/Invited statuses
                // introduced in the June 2026 migration.
                const userColors =
                  u.status === 'Active'   ? { bg: 'rgba(42,127,111,0.12)', color: '#2A7F6F' } :
                  u.status === 'Invited'  ? { bg: 'rgba(91,141,184,0.12)', color: '#5B8DB8' } :
                  u.status === 'Pending'  ? { bg: 'rgba(201,168,76,0.15)', color: '#C9A84C' } :
                                            { bg: '#F0F0F0',               color: '#7A8899' }
                const displayName = u.name || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—'
                const uInitials = displayName.split(' ').map((w: string) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?'
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 20px', borderBottom: '1px solid #F7F5F1' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#1B2B4B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '11px', color: '#3AA08D', flexShrink: 0 }}>
                      {uInitials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B2B4B', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>{displayName}</span>
                        {u.isPrimaryAdmin && (
                          <span title="Primary Admin" style={{ fontSize: '9px', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', background: 'rgba(42,127,111,0.15)', color: '#2A7F6F', letterSpacing: '0.06em' }}>
                            ADMIN
                          </span>
                        )}
                        {u.needsReview && (
                          <span title="Created from Excel import without an email — needs admin review" style={{ fontSize: '9px', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', background: 'rgba(201,168,76,0.18)', color: '#C9A84C', letterSpacing: '0.06em' }}>
                            REVIEW
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: '#7A8899' }}>
                        {u.email || <em style={{ color: '#C9A84C' }}>no email on file</em>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: userColors.bg, color: userColors.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {u.status}
                      </span>
                      <span style={{ fontSize: '10px', color: '#7A8899' }}>{u.role}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
