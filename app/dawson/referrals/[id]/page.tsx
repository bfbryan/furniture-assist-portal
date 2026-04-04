'use client'

import { useState, useEffect } from 'react'

type Referral = {
  id: string
  clientName: string
  firstName: string
  lastName: string
  dob: string | null
  phone: string | null
  language: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  hhSize: string | null
  children: string | null
  items: string | null
  externalNotes: string | null
  internalNotes: string | null
  referralDate: string
  referralReview: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  appointmentSlipUrl: string | null
  dataPageUrl: string | null
  referredBy: string | null
  referringAgency: string | null
  referredByPhone: string | null
  agencyEmail: string | null
  possibleDuplicate: boolean
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getPortalStatus(review: string, status: string) {
  if (review === 'Rejected') return 'Rejected'
  if (review === 'Withdrawn') return 'Withdrawn'
  if (status === 'Cancelled') return 'Cancelled'
  if (status === 'Completed') return 'Completed'
  if (review === 'Pending') return 'Submitted'
  if (status === 'Pending Schedule') return 'Scheduling'
  if (status === 'Scheduled') return 'Scheduled'
  return status
}

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Submitted:  { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',   badgeText: '#C9A84C' },
  Scheduling: { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',   badgeText: '#5B8DB8' },
  Scheduled:  { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',   badgeText: '#2A7F6F' },
  Completed:  { accent: '#1B2B4B', badgeBg: 'rgba(27,43,75,0.08)',     badgeText: '#1B2B4B' },
  Cancelled:  { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',     badgeText: '#C0392B' },
  Rejected:   { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',     badgeText: '#C0392B' },
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

function InternalNotesModal({ currentNotes, onSave, onCancel, saving }: {
  currentNotes: string; onSave: (notes: string) => void; onCancel: () => void; saving: boolean
}) {
  const [value, setValue] = useState(currentNotes)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '32px', width: '500px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>
          Internal Notes
        </div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '16px' }}>
          These notes are only visible to Furniture Assist staff.
        </div>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={6}
          placeholder="Add internal notes about this referral..."
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

export default function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [referral, setReferral] = useState<Referral | null>(null)
  const [loading, setLoading] = useState(true)
  const [referralId, setReferralId] = useState<string>('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [notesModal, setNotesModal] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)

  useEffect(() => {
    params.then(({ id }) => {
      setReferralId(id)
      fetch(`/api/dawson/referrals/${id}`)
        .then(r => r.json())
        .then(data => { setReferral(data); setLoading(false) })
    })
  }, [params])

  async function handleReview(review: string) {
    if (confirm !== review) { setConfirm(review); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review }),
      })
      if (res.ok && referral) {
        setReferral({ ...referral, referralReview: review })
        setConfirm(null)
      }
    } finally { setActionLoading(false) }
  }

  async function handleSaveNotes(internalNotes: string) {
    setNotesSaving(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes }),
      })
      if (res.ok && referral) {
        setReferral({ ...referral, internalNotes })
        setNotesModal(false)
      }
    } finally { setNotesSaving(false) }
  }

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading referral...
    </div>
  )

  if (!referral) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Referral not found.
    </div>
  )

  const status = getPortalStatus(referral.referralReview, referral.appointmentStatus)
  const colors = STATUS_COLORS[status] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      {notesModal && (
        <InternalNotesModal
          currentNotes={referral.internalNotes ?? ''}
          onSave={handleSaveNotes}
          onCancel={() => setNotesModal(false)}
          saving={notesSaving}
        />
      )}

      {/* Top bar */}
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/dawson/referrals/review" style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Referrals
          </a>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>{referral.clientName}</div>
          {referral.possibleDuplicate && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
              ⚠ Possible Duplicate
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
            {status}
          </span>

          {status === 'Submitted' && (
            <>
              <button onClick={() => handleReview('Approved')} disabled={actionLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Approved' ? '#2A7F6F' : 'rgba(42,127,111,0.1)', color: confirm === 'Approved' ? 'white' : '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {actionLoading && confirm === 'Approved' ? '...' : confirm === 'Approved' ? 'Confirm Approve' : 'Approve'}
              </button>
              <button onClick={() => handleReview('Rejected')} disabled={actionLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Rejected' ? '#C0392B' : 'rgba(192,57,43,0.08)', color: confirm === 'Rejected' ? 'white' : '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {actionLoading && confirm === 'Rejected' ? '...' : confirm === 'Rejected' ? 'Confirm Reject' : 'Reject'}
              </button>
            </>
          )}

          {referral.appointmentSlipUrl && (
            <a href={referral.appointmentSlipUrl} target="_blank" rel="noreferrer"
              style={{ padding: '8px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              Appt Slip
            </a>
          )}

          {referral.dataPageUrl && (
            <a href={referral.dataPageUrl} target="_blank" rel="noreferrer"
              style={{ padding: '8px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#5B8DB8', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>
              Data Page
            </a>
          )}

          {confirm && (
            <button onClick={() => setConfirm(null)}
              style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px', display: 'grid', gridTemplateColumns: '1fr 450px', gap: '20px', alignItems: 'start' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Client Info */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ background: colors.accent, height: '4px' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '11px', letterSpacing: '0.10em', textTransform: 'uppercase', color: '#7A8899', margin: '0 0 12px' }}>Client Information</h2>
              <InfoRow label="Full Name" value={referral.clientName} />
              <InfoRow label="Date of Birth" value={formatDate(referral.dob)} />
              <InfoRow label="Staff Phone" value={referral.referredByPhone} />
              <InfoRow label="Language" value={referral.language} />
              <InfoRow label="Address" value={
                referral.address ? (
                  <>{referral.address}{referral.address2 ? `, ${referral.address2}` : ''}<br />
                  {referral.city}, {referral.state} {referral.zip}
                  {referral.county ? ` · ${referral.county} County` : ''}</>
                ) : null
              } />
              <InfoRow label="Household Size" value={referral.hhSize} />
              <InfoRow label="Children" value={referral.children} />
            </div>
          </div>

          {/* Items Requested */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Items Requested</h2>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {referral.items ? (
                (Array.isArray(referral.items) ? referral.items : referral.items.split(',')).map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ color: '#2A7F6F', fontWeight: 700, flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.6 }}>{item.trim()}</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899' }}>No items specified</div>
              )}
            </div>
          </div>

          {/* External Notes */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Agency Notes</h2>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {referral.externalNotes ? (
                <div style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{referral.externalNotes}</div>
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>No notes submitted by agency.</div>
              )}
            </div>
          </div>

        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Referral Details */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Referral Details</h2>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <InfoRow label="Submitted" value={formatDate(referral.referralDate)} />
              <InfoRow label="Agency" value={referral.referringAgency} />
              <InfoRow label="Staff" value={referral.referredBy} />
              <InfoRow label="Staff Phone" value={referral.referredByPhone} />
              <InfoRow label="Agency Email" value={referral.agencyEmail ? <a href={`mailto:${referral.agencyEmail}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{referral.agencyEmail}</a> : null} />
              <InfoRow label="Review Status" value={
                <span style={{ fontWeight: 700, color: referral.referralReview === 'Approved' ? '#2A7F6F' : referral.referralReview === 'Rejected' ? '#C0392B' : '#C9A84C' }}>
                  {referral.referralReview}
                </span>
              } />
            </div>
          </div>

          {/* Appointment */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Appointment</h2>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <InfoRow label="Status" value={<span style={{ fontWeight: 700, color: colors.badgeText }}>{referral.appointmentStatus || '—'}</span>} />
              <InfoRow label="Date" value={status === 'Scheduled' || status === 'Completed' ? formatDate(referral.appointmentDate) : '—'} />
              <InfoRow label="Time" value={status === 'Scheduled' || status === 'Completed' ? referral.appointmentTime : '—'} />
              {referral.appointmentSlipUrl && (
                <div style={{ paddingTop: '12px' }}>
                  <a href={referral.appointmentSlipUrl} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#2A7F6F', textDecoration: 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    View Appointment Slip
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Internal Notes */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Internal Notes</h2>
              <button onClick={() => setNotesModal(true)}
                style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
                {referral.internalNotes ? 'Edit' : '+ Add Note'}
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {referral.internalNotes ? (
                <div style={{ fontSize: '13px', color: '#1B2B4B', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{referral.internalNotes}</div>
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>No internal notes added yet.</div>
              )}
            </div>
          </div>

          {/* Possible Duplicate Warning */}
          {referral.possibleDuplicate && (
            <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#C0392B', marginBottom: '6px' }}>⚠ Possible Duplicate</div>
              <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6 }}>This client may already be in the system. Review before approving.</div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
