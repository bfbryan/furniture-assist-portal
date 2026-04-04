'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  referralDate: string
  referralReview: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  appointmentSlipUrl: string | null
  dataPageUrl: string | null
  referredBy: string | null
  referringAgency: string | null
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
  Submitted:  { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',  badgeText: '#C9A84C' },
  Scheduling: { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',  badgeText: '#5B8DB8' },
  Scheduled:  { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',  badgeText: '#2A7F6F' },
  Completed:  { accent: '#1B2B4B', badgeBg: 'rgba(27,43,75,0.08)',    badgeText: '#1B2B4B' },
  Cancelled:  { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',    badgeText: '#C0392B' },
  Rejected:   { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',    badgeText: '#C0392B' },
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

export default function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [referral, setReferral] = useState<Referral | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then(({ id }) => {
      fetch(`/api/referrals/${id}`)
        .then(async r => {
          if (!r.ok) {
            const data = await r.json()
            setError(data.error ?? 'Failed to load referral')
            setLoading(false)
            return
          }
          return r.json()
        })
        .then(data => { if (data) { setReferral(data); setLoading(false) } })
    })
  }, [params])

  if (loading) return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center text-[#7A8899]">
      Loading referral...
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center text-[#C0392B]">
      {error}
    </div>
  )

  if (!referral) return null

  const status = getPortalStatus(referral.referralReview, referral.appointmentStatus)
  const colors = STATUS_COLORS[status] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }

  return (
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* Top bar */}
      <header className="bg-[#1B2B4B] h-16 flex items-center justify-between px-8 sticky top-0 z-50 shadow-lg">
        <a href="/dashboard" style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Portal
        </a>
        <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
          {status}
        </span>
      </header>

      <div style={{ padding: '28px 32px', maxWidth: '960px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 380px', gap: '20px', alignItems: 'start' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Client Info */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ background: colors.accent, height: '4px' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '11px', letterSpacing: '0.10em', textTransform: 'uppercase', color: '#7A8899', margin: '0 0 12px' }}>Client Information</h2>
              <InfoRow label="Full Name" value={referral.clientName} />
              <InfoRow label="Date of Birth" value={formatDate(referral.dob)} />
              <InfoRow label="Phone" value={referral.phone} />
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

          {/* Agency Notes */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDE9E1' }}>
              <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>Your Notes</h2>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {referral.externalNotes ? (
                <div style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{referral.externalNotes}</div>
              ) : (
                <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }}>No notes submitted.</div>
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
              <InfoRow label="Referred By" value={referral.referredBy} />
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
              {referral.dataPageUrl && status === 'Completed' && (
                <div style={{ paddingTop: '8px' }}>
                  <a href={referral.dataPageUrl} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#5B8DB8', textDecoration: 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    View Completed Form
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Duplicate warning */}
          {referral.possibleDuplicate && (
            <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#C0392B', marginBottom: '6px' }}>⚠ Possible Duplicate</div>
              <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6 }}>Our team has flagged this as a possible duplicate and will review before processing.</div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
