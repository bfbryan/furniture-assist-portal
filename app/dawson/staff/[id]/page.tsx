'use client'

// app/dawson/staff/[id]/page.tsx
//
// Staff detail page — mirrors dawson-agencies-detail-page.tsx structure.
// Backing endpoint: GET /api/dawson/staff/[id] → getStaffWithDetails().
//
// Deep-linked from:
//   • Referral detail page → "Staff" row in Referral Details card
//   • (future) Agency detail page → Portal Staff row click
//
// Read-only for now — no status changes, no editing. Follow-ups will layer
// on edit modes and admin actions once the workflow is defined.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AgencyReferralsPanel, { AgencyReferral, ReferralStatus } from '@/components/internal/AgencyReferralsPanel'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  referralReview: string
  appointmentStatus: string
  referredBy: string | null
}

type Staff = {
  id: string
  firstName: string
  lastName: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  status: string | null
  invitedDate: string | null
  recordCreationDate: string | null
  needsReview: boolean
  clerkUserId: string | null
  agencyId: string | null
  agencyName: string | null
  agencyStatus: string | null
  referrals: Referral[]
  referralCount: number
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Staff statuses come from Agency Users.Status: Active | Invited | Unclaimed |
// Pending | Inactive. Mirror the agency detail palette so the two pages read
// consistently side-by-side.
const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Active:    { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',   badgeText: '#2A7F6F' },
  Invited:   { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',   badgeText: '#5B8DB8' },
  Unclaimed: { accent: '#7A8899', badgeBg: '#F0F0F0',                 badgeText: '#7A8899' },
  Pending:   { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',   badgeText: '#C9A84C' },
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

// Same mapper the agency page uses — Rejected/Withdrawn collapse into
// Cancelled, everything else passes through 1:1.
function toAgencyReferral(r: Referral): AgencyReferral {
  const isRejected  = r.referralReview === 'Rejected'
  const isWithdrawn = r.referralReview === 'Withdrawn'

  let status: ReferralStatus
  if (isRejected || isWithdrawn) {
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

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    params.then(({ id }) => {
      fetch(`/api/dawson/staff/${id}`)
        .then(async r => {
          if (r.status === 404) { setNotFound(true); setLoading(false); return null }
          if (!r.ok) throw new Error('load failed')
          return r.json()
        })
        .then(data => {
          if (data) setStaff(data)
          setLoading(false)
        })
        .catch(() => { setNotFound(true); setLoading(false) })
    })
  }, [params])

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading staff...
    </div>
  )

  if (notFound || !staff) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Staff not found.
    </div>
  )

  const colors = STATUS_COLORS[staff.status ?? ''] ?? STATUS_COLORS.Inactive
  const initials =
    (staff.name || '?')
      .split(' ')
      .map(w => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  const panelReferrals = staff.referrals.map(toAgencyReferral)

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Fallback to /dawson/agencies/active when opened in a fresh tab —
              staff pages are always reached from an agency or referral page. */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/dawson/agencies/active')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
            {staff.name || '—'}
          </div>
          {staff.needsReview && (
            <span
              title="Created from Excel import without an email — needs admin review"
              style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(201,168,76,0.18)', color: '#C9A84C' }}
            >
              ⚠ Review
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {staff.status && (
            <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
              {staff.status}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Staff Info */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ background: colors.accent, height: '4px' }} />
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: '#1B2B4B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#3AA08D', flexShrink: 0 }}>
                  {initials}
                </div>
                <div>
                  <h1 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', margin: '0 0 4px' }}>
                    {staff.name || '—'}
                  </h1>
                  {staff.role && (
                    <div style={{ fontSize: '12px', color: '#7A8899' }}>{staff.role}</div>
                  )}
                </div>
              </div>
              <div style={{ borderTop: '1px solid #F7F5F1', paddingTop: '4px' }}>
                <InfoRow
                  label="Agency"
                  value={
                    staff.agencyId && staff.agencyName ? (
                      <a
                        href={`/dawson/agencies/${staff.agencyId}`}
                        style={{ color: '#2A7F6F', textDecoration: 'none', fontWeight: 600 }}
                      >
                        {staff.agencyName}
                        {staff.agencyStatus && (
                          <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, padding: '1px 8px', borderRadius: '20px', background: '#F0F0F0', color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {staff.agencyStatus}
                          </span>
                        )}
                      </a>
                    ) : (
                      <span style={{ color: '#7A8899', fontStyle: 'italic' }}>No agency linked</span>
                    )
                  }
                />
                <InfoRow label="Role" value={staff.role} />
                <InfoRow
                  label="Email"
                  value={staff.email
                    ? <a href={`mailto:${staff.email}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{staff.email}</a>
                    : <em style={{ color: '#C9A84C' }}>no email on file</em>}
                />
                <InfoRow label="Phone" value={staff.phone} />
                <InfoRow label="Record Created" value={formatDate(staff.recordCreationDate)} />
                {staff.invitedDate && <InfoRow label="Invited" value={formatDate(staff.invitedDate)} />}
                {staff.needsReview && (
                  <InfoRow
                    label="Review Flag"
                    value={<span style={{ color: '#C9A84C', fontWeight: 700 }}>⚠ Placeholder from Excel import — needs admin review</span>}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Referrals — same panel component used by the agency detail page */}
          <AgencyReferralsPanel referrals={panelReferrals} />

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '20px' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', marginBottom: '16px' }}>Staff Stats</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '24px', color: '#1B2B4B', lineHeight: 1 }}>
                  {staff.referralCount}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#7A8899', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Total Referrals
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
