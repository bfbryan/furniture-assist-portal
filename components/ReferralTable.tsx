'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  appointmentTime: string | null
  referralReview: string
  appointmentStatus: string
  appointmentSlipUrl: string
  dataPageUrl: string
  referredBy: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getPortalStatus(referralReview: string, appointmentStatus: string) {
  if (referralReview === 'Rejected') return 'Rejected'
  if (appointmentStatus === 'Cancelled') return 'Cancelled'
  if (appointmentStatus === 'Completed') return 'Completed'
  if (referralReview === 'Pending') return 'Submitted'
  if (appointmentStatus === 'Pending Schedule') return 'Scheduling'
  if (appointmentStatus === 'Scheduled') return 'Scheduled'
  return appointmentStatus
}

function sortReferrals(referrals: Referral[], key: string): Referral[] {
  const byAppt = ['Scheduled', 'Completed', 'Cancelled', 'Rejected']
  if (byAppt.includes(key)) {
    return [...referrals].sort((a, b) => {
      const da = a.appointmentDate ?? '9999'
      const db = b.appointmentDate ?? '9999'
      return da < db ? -1 : da > db ? 1 : 0
    })
  }
  return [...referrals].sort((a, b) => {
    return a.referralDate < b.referralDate ? 1 : a.referralDate > b.referralDate ? -1 : 0
  })
}

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Submitted:  { accent: '#C9A84C', badgeBg: '#FEF9EC', badgeText: '#C9A84C' },
  Scheduling: { accent: '#5B8DB8', badgeBg: '#EBF3FB', badgeText: '#5B8DB8' },
  Scheduled:  { accent: '#2A7F6F', badgeBg: '#EAF4F2', badgeText: '#2A7F6F' },
  Completed:  { accent: '#1B2B4B', badgeBg: '#E8ECF2', badgeText: '#1B2B4B' },
  Cancelled:  { accent: '#C0392B', badgeBg: '#FDEDEC', badgeText: '#C0392B' },
  Rejected:   { accent: '#C0392B', badgeBg: '#FDEDEC', badgeText: '#C0392B' },
}

const COL_HEADER: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '6px',
}

const COL_VALUE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 600,
  fontSize: '12px', color: '#1B2B4B',
}

const COL_SUB: React.CSSProperties = {
  fontSize: '11px', color: '#7A8899',
}

type ModalState = {
  open: boolean
  type: 'cancel' | 'reschedule' | 'withdraw' | null
  id: string
  name: string
}

function ConfirmModal({ modal, onConfirm, onClose, loading }: {
  modal: ModalState
  onConfirm: () => void
  onClose: () => void
  loading: boolean
}) {
  if (!modal.open) return null
  const isCancel = modal.type === 'cancel'
  const isWithdraw = modal.type === 'withdraw'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
           {isWithdraw ? 'Withdraw Referral' : isCancel ? 'Cancel Appointment' : 'Request Reschedule'}
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
          {isWithdraw
            ? `Are you sure you want to withdraw the referral for ${modal.name}? It will be removed from the review queue.`
            : isCancel
            ? `Are you sure you want to cancel the appointment for ${modal.name}? Furniture Assist will be notified.`
            : `This will request a reschedule for ${modal.name}. They will be placed back in the scheduling queue.`}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={onConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: isCancel ? '#C0392B' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : isWithdraw ? 'Withdraw Referral' : isCancel ? 'Yes, Cancel' : 'Request Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#1B2B4B', color: 'white', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '5px', pointerEvents: 'none', zIndex: 10 }}>
          {label}
        </div>
      )}
    </div>
  )
}

function IconBtn({ color, onClick, title, children }: {
  color: string
  onClick?: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Tooltip label={title}>
      <button onClick={onClick} style={{ width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
        {children}
      </button>
    </Tooltip>
  )
}

function ClientCard({ r, onCancel, onReschedule, onWithdraw }: {
  r: Referral
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
  onWithdraw: (id: string, name: string) => void
}) {
  const status = getPortalStatus(r.referralReview, r.appointmentStatus)
  const colors = STATUS_COLORS[status] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }
  const isScheduled    = status === 'Scheduled'
  const isCompleted    = status === 'Completed'
  const isWithdrawable = status === 'Submitted'
  const isCancellable  = status === 'Scheduling' || status === 'Scheduled'

  const addressLine1 = [r.address, r.address2].filter(Boolean).join(', ')
  const addressLine2 = [r.city, r.state, r.zip].filter(Boolean).join(' ')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '4px 1fr', background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px' }}>
      <div style={{ background: colors.accent }} />

      <div style={{ display: 'grid', gridTemplateColumns: '130px 130px 160px 180px 140px 120px 1fr', alignItems: 'start', gap: '10px', padding: '14px 16px' }}>

        {/* CLIENT NAME */}
<div>
  <div style={COL_HEADER}>Client Name</div>
  <Tooltip label="View Client Detail">
    <a href={`/dawson/referrals/${r.id}`} style={{ textDecoration: 'none' }}>
  <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#2A7F6F', marginBottom: '2px' }}>{referral.clientName}</div>
</a>
  </Tooltip>
</div>

        {/* ADDRESS */}
        <div>
          <div style={COL_HEADER}>Address</div>
          {addressLine1 && <div style={COL_SUB}>{addressLine1}</div>}
          {addressLine2 && <div style={COL_SUB}>{addressLine2}</div>}
          {!addressLine1 && !addressLine2 && <div style={COL_SUB}>—</div>}
        </div>

        {/* PHONE */}
        <div>
          <div style={COL_HEADER}>Phone</div>
          <div style={COL_SUB}>{r.phone ?? '—'}</div>
        </div>

        {/* REFERRED BY */}
        <div>
          <div style={COL_HEADER}>Referred By</div>
          <div style={COL_SUB}>{r.referredBy ?? '—'}</div>
        </div>

        {/* SUBMITTED */}
        <div>
          <div style={COL_HEADER}>Submitted</div>
          <div style={COL_SUB}>{formatDate(r.referralDate)}</div>
        </div>

        {/* APPOINTMENT */}
<div>
  <div style={COL_HEADER}>Appointment</div>
  <div style={COL_SUB}>
    {status === 'Scheduled' ? formatDate(r.appointmentDate) : '—'}
  </div>
  {status === 'Scheduled' && r.appointmentTime && (
    <div style={{ ...COL_SUB, marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      {r.appointmentTime}
    </div>
  )}
</div>

        {/* ACTIONS */}
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', paddingTop: '14px' }}>
  {(isScheduled || isCompleted) && (
    <Tooltip label="Appointment Slip">
      <a href={r.appointmentSlipUrl || 'Appt Slip'} target="_blank" rel="noreferrer"
        style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A7F6F', textDecoration: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </a>
    </Tooltip>
  )}
  {isCompleted && r.dataPageUrl && (
    <Tooltip label="Completed Form">
      <a href={r.dataPageUrl} target="_blank" rel="noreferrer"
        style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5B8DB8', textDecoration: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
        </svg>
      </a>
    </Tooltip>
  )}
  {isScheduled && (
    <IconBtn color="#C9A84C" onClick={() => onReschedule(r.id, r.clientName)} title="Reschedule">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </IconBtn>
  )}
  {isWithdrawable && (
    <IconBtn color="#C0392B" onClick={() => onWithdraw(r.id, r.clientName)} title="Withdraw Referral">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/><path d="M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </IconBtn>
  )}
  {isCancellable && (
    <IconBtn color="#C0392B" onClick={() => onCancel(r.id, r.clientName)} title="Cancel Appointment">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    </IconBtn>
  )}
</div>

      </div>
    </div>
  )
}

type StatusGroup = {
  key: string
  sectionTitle: string
  referrals: Referral[]
  collapsible?: boolean
}

export default function ReferralTable({ referrals, isAdmin = false }: { referrals: Referral[], isAdmin?: boolean }) {
  const router = useRouter()
  const [modal, setModal] = useState<ModalState>({ open: false, type: null, id: '', name: '' })
  const [loading, setLoading] = useState(false)
  const [staffFilter, setStaffFilter] = useState<string>('all')

  // Extract unique staff names for filter dropdown
  const staffNames = Array.from(new Set(referrals.map(r => r.referredBy).filter(Boolean))) as string[]
  
  // Apply staff filter
  const filteredReferrals = staffFilter === 'all' 
    ? referrals 
    : referrals.filter(r => r.referredBy === staffFilter)
    
  const handleConfirm = async () => {
  setLoading(true)
  await fetch(`/api/referrals/${modal.id}/${modal.type}`, { method: 'POST' })
  setLoading(false)
  setModal({ open: false, type: null, id: '', name: '' })
  router.refresh()
}

  const groups: StatusGroup[] = [
    { key: 'Submitted',  sectionTitle: 'Awaiting Approval',        referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Submitted'),  'Submitted') },
    { key: 'Scheduling', sectionTitle: 'Awaiting Appointment Date', referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Scheduling'), 'Scheduling') },
    { key: 'Scheduled',  sectionTitle: 'Appointment Scheduled',     referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Scheduled'),  'Scheduled') },
    { key: 'Completed',  sectionTitle: 'Completed Clients',         referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Completed'),  'Completed'),  collapsible: true },
    { key: 'Cancelled',  sectionTitle: 'Cancelled Appointments',    referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Cancelled'),  'Cancelled'),  collapsible: true },
    { key: 'Rejected',   sectionTitle: 'Rejected Referrals',        referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Rejected'),   'Rejected'),   collapsible: true },
  ]

  if (referrals.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px' }}>
        No referrals found.
      </div>
    )
  }

  return (
    <>
      <ConfirmModal
        modal={modal}
        onConfirm={handleConfirm}
        onClose={() => setModal({ open: false, type: null, id: '', name: '' })}
        loading={loading}
      />
      {/* Staff filter — admin only */}
      {isAdmin && staffNames.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#1B2B4B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Filter by Staff
          </label>
          <select
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            style={{
              padding: '8px 14px',
              borderRadius: '7px',
              border: '1px solid #EDE9E1',
              fontSize: '13px',
              color: '#2C3A4A',
              background: 'white',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Staff</option>
            {staffNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {groups.map(group => (
  <GroupSection
    key={group.key}
    group={group}
    onCancel={(id, name) => setModal({ open: true, type: 'cancel', id, name })}
    onReschedule={(id, name) => setModal({ open: true, type: 'reschedule', id, name })}
    onWithdraw={(id, name) => setModal({ open: true, type: 'withdraw', id, name })}
  />
))}
    </>
  )
}

function GroupSection({ group, onCancel, onReschedule, onWithdraw }: {
  group: StatusGroup
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
  onWithdraw: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(!group.collapsible)
  if (group.referrals.length === 0) return null
  const colors = STATUS_COLORS[group.key] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }

  return (
    <div style={{ marginBottom: '40px' }}>
      <button
        onClick={() => group.collapsible && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: group.collapsible ? 'pointer' : 'default', padding: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: colors.accent, fontFamily: 'var(--font-montserrat)' }}>
            {group.sectionTitle}
          </span>
          {group.collapsible && (
            <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {group.referrals.length} referral{group.referrals.length !== 1 ? 's' : ''}
        </span>
      </button>
      {open && group.referrals.map(r => (
  <ClientCard key={r.id} r={r} onCancel={onCancel} onReschedule={onReschedule} onWithdraw={onWithdraw} />
))}
    </div>
  )
}