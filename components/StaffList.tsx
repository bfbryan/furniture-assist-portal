'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Member = {
  id: string // AT record ID
  clerkUserId: string | null
  name: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string // AT role: Admin or Staff
  status: string // AT status: Active, Pending, Inactive
  clerkRole: string
  lastSignInAt: number | null
  invitedDate: string | null
}

type Props = {
  members: Member[]
  currentUserId: string
  orgId: string
}

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Active:   { accent: '#2A7F6F', badgeBg: '#EAF4F2', badgeText: '#2A7F6F' },
  Pending:  { accent: '#C9A84C', badgeBg: '#FEF9EC', badgeText: '#C9A84C' },
  Inactive: { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' },
}

const COL_HEADER: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '4px',
}
const COL_VALUE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: '13px', color: '#1B2B4B',
}
const COL_SUB: React.CSSProperties = { fontSize: '11px', color: '#7A8899' }

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
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

function StaffCard({
  member,
  currentUserId,
  onDeactivate,
  onReactivate,
}: {
  member: Member
  currentUserId: string
  onDeactivate: (id: string, name: string) => void
  onReactivate: (id: string, name: string) => void
}) {
  const status = member.status as 'Active' | 'Pending' | 'Inactive'
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.Active
  const isCurrentUser = member.clerkUserId === currentUserId
  const isAdmin = member.role === 'Admin'

  const dateLabel = member.invitedDate
    ? new Date(member.invitedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  const lastSignIn = member.lastSignInAt
    ? new Date(member.lastSignInAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  const initials = `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '4px 1fr', background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px' }}>
      <div style={{ background: colors.accent, borderRadius: '12px 0 0 12px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '44px 190px 200px 120px 100px 100px 1fr', alignItems: 'center', gap: '14px', padding: '14px 16px' }}>

        {/* Avatar */}
        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: isAdmin ? '#1B2B4B' : '#EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: isAdmin ? '#3AA08D' : '#7A8899' }}>
          {initials}
        </div>

        {/* Name */}
        <div>
          <div style={COL_HEADER}>{isAdmin ? 'Admin' : 'Staff Member'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={COL_VALUE}>{member.name}</span>
            {isCurrentUser && <span style={{ fontSize: '11px', color: '#7A8899' }}>(You)</span>}
          </div>
          <div style={COL_SUB}>{member.phone ?? '—'}</div>
        </div>

        {/* Email */}
        <div>
          <div style={COL_HEADER}>Email</div>
          <div style={COL_SUB}>{member.email}</div>
        </div>

        {/* Date Invited */}
        <div>
          <div style={COL_HEADER}>Invited</div>
          <div style={COL_SUB}>{dateLabel}</div>
        </div>

        {/* Last Sign In */}
        <div>
          <div style={COL_HEADER}>Last Login</div>
          <div style={COL_SUB}>{lastSignIn}</div>
        </div>

        {/* Status */}
        <div>
          <div style={COL_HEADER}>Status</div>
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>
            {status}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
          {!isCurrentUser && status === 'Active' && (
            <Tooltip label="Deactivate">
              <button onClick={() => onDeactivate(member.id, member.name)}
                style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </button>
            </Tooltip>
          )}
          {!isCurrentUser && status === 'Inactive' && (
            <Tooltip label="Reactivate">
              <button onClick={() => onReactivate(member.id, member.name)}
                style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A7F6F', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </Tooltip>
          )}
        </div>

      </div>
    </div>
  )
}

function Section({
  title,
  accent,
  members,
  currentUserId,
  collapsible,
  onDeactivate,
  onReactivate,
}: {
  title: string
  accent: string
  members: Member[]
  currentUserId: string
  collapsible?: boolean
  onDeactivate: (id: string, name: string) => void
  onReactivate: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(!collapsible)
  if (members.length === 0) return null

  return (
    <div style={{ marginBottom: '36px' }}>
      <button onClick={() => collapsible && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', width: '100%', background: 'none', border: 'none', cursor: collapsible ? 'pointer' : 'default', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent, fontFamily: 'var(--font-montserrat)' }}>
            {title}
          </span>
          {collapsible && <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>}
        </div>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {members.length} {members.length === 1 ? 'person' : 'people'}
        </span>
      </button>
      {open && members.map(m => (
        <StaffCard key={m.id} member={m} currentUserId={currentUserId} onDeactivate={onDeactivate} onReactivate={onReactivate} />
      ))}
    </div>
  )
}

type ConfirmState = { open: boolean; action: 'deactivate' | 'reactivate' | null; id: string; name: string }

export default function StaffList({ members, currentUserId, orgId }: Props) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, action: null, id: '', name: '' })
  const [loading, setLoading] = useState(false)

  const admins = members.filter(m => m.role === 'Admin').sort((a, b) => a.lastName.localeCompare(b.lastName))
  const activeStaff = members.filter(m => m.role !== 'Admin' && m.status === 'Active').sort((a, b) => a.lastName.localeCompare(b.lastName))
  const pendingStaff = members.filter(m => m.role !== 'Admin' && m.status === 'Pending').sort((a, b) => a.lastName.localeCompare(b.lastName))
  const inactiveStaff = members.filter(m => m.role !== 'Admin' && m.status === 'Inactive').sort((a, b) => a.lastName.localeCompare(b.lastName))

  const handleConfirm = async () => {
    setLoading(true)
    const newStatus = confirm.action === 'deactivate' ? 'Inactive' : 'Active'
    try {
      await fetch(`/api/admin/staff/${confirm.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      setConfirm({ open: false, action: null, id: '', name: '' })
      router.refresh()
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (members.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px' }}>
        No staff members found.
      </div>
    )
  }

  return (
    <div>
      {/* Confirm modal */}
      {confirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={e => e.target === e.currentTarget && setConfirm({ open: false, action: null, id: '', name: '' })}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
            <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
              {confirm.action === 'deactivate' ? 'Deactivate Staff Member' : 'Reactivate Staff Member'}
            </h3>
            <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
  {confirm.action === 'deactivate'
    ? <>This will immediately block <strong style={{ color: '#1B2B4B' }}>{confirm.name}</strong>'s portal access. Their referral history is preserved and they can be reactivated at any time.</>
    : <>This will restore <strong style={{ color: '#1B2B4B' }}>{confirm.name}</strong>'s portal access.</>}
</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm({ open: false, action: null, id: '', name: '' })}
                style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirm} disabled={loading}
                style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: confirm.action === 'deactivate' ? '#C0392B' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
                {loading ? '...' : confirm.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Section title="Admins" accent="#1B2B4B" members={admins} currentUserId={currentUserId}
        onDeactivate={(id, name) => setConfirm({ open: true, action: 'deactivate', id, name })}
        onReactivate={(id, name) => setConfirm({ open: true, action: 'reactivate', id, name })} />

      <Section title="Active Staff" accent="#2A7F6F" members={activeStaff} currentUserId={currentUserId}
        onDeactivate={(id, name) => setConfirm({ open: true, action: 'deactivate', id, name })}
        onReactivate={(id, name) => setConfirm({ open: true, action: 'reactivate', id, name })} />

      <Section title="Pending Invitations" accent="#C9A84C" members={pendingStaff} currentUserId={currentUserId} collapsible
        onDeactivate={(id, name) => setConfirm({ open: true, action: 'deactivate', id, name })}
        onReactivate={(id, name) => setConfirm({ open: true, action: 'reactivate', id, name })} />

      <Section title="Inactive Staff" accent="#7A8899" members={inactiveStaff} currentUserId={currentUserId} collapsible
        onDeactivate={(id, name) => setConfirm({ open: true, action: 'deactivate', id, name })}
        onReactivate={(id, name) => setConfirm({ open: true, action: 'reactivate', id, name })} />
    </div>
  )
}
