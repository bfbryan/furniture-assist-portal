'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Member = {
  clerkUserId: string
  firstName: string
  lastName: string
  email: string
  role: string
  createdAt: number
  imageUrl: string
  lastSignInAt: number | null
}

type Props = {
  members: Member[]
  currentUserId: string
  orgId: string
}

// Match ReferralTable status colors pattern
const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Active:   { accent: '#2A7F6F', badgeBg: '#EAF4F2', badgeText: '#2A7F6F' },
  Pending:  { accent: '#C9A84C', badgeBg: '#FEF9EC', badgeText: '#C9A84C' },
  Inactive: { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' },
}

const COL_HEADER: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#1B2B4B',
  marginBottom: '4px',
}

const COL_VALUE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 600,
  fontSize: '13px',
  color: '#1B2B4B',
}

const COL_SUB: React.CSSProperties = {
  fontSize: '11px',
  color: '#7A8899',
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'org:admin'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      background: isAdmin ? '#1B2B4B' : '#EDE9E1',
      color: isAdmin ? '#3AA08D' : '#7A8899',
    }}>
      {isAdmin ? 'Admin' : 'Staff'}
    </span>
  )
}

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1B2B4B',
          color: 'white',
          fontSize: '11px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          padding: '4px 8px',
          borderRadius: '5px',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {label}
        </div>
      )}
    </div>
  )
}

type ConfirmModal = {
  open: boolean
  memberId: string
  memberName: string
}

function StaffCard({
  member,
  currentUserId,
  orgId,
  status,
  onMarkInactive,
}: {
  member: Member
  currentUserId: string
  orgId: string
  status: 'Active' | 'Pending' | 'Inactive'
  onMarkInactive: (id: string, name: string) => void
}) {
  const colors = STATUS_COLORS[status]
  const isCurrentUser = member.clerkUserId === currentUserId
  const joinDate = new Date(member.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const initials = `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '4px 1fr',
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
      marginBottom: '10px',
    }}>
      {/* Color accent bar */}
      <div style={{ background: colors.accent, borderRadius: '12px 0 0 12px' }} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '44px 200px 220px 160px 120px 1fr',
        alignItems: 'center',
        gap: '16px',
        padding: '14px 16px',
      }}>

        {/* Avatar */}
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%',
          background: '#1B2B4B', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
          fontFamily: 'var(--font-montserrat)', fontWeight: 800,
          fontSize: '13px', color: '#3AA08D',
        }}>
          {initials}
        </div>

        {/* Name + role */}
        <div>
          <div style={COL_HEADER}>Staff Member</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={COL_VALUE}>
              {member.firstName} {member.lastName}
            </span>
            {isCurrentUser && (
              <span style={{ fontSize: '11px', color: '#7A8899' }}>(You)</span>
            )}
          </div>
          <div style={{ marginTop: '4px' }}>
            <RoleBadge role={member.role} />
          </div>
        </div>

        {/* Email */}
        <div>
          <div style={COL_HEADER}>Email</div>
          <div style={COL_SUB}>{member.email}</div>
        </div>

        {/* Date added */}
        <div>
          <div style={COL_HEADER}>Date Added</div>
          <div style={COL_SUB}>{joinDate}</div>
        </div>

        {/* Status */}
        <div>
          <div style={COL_HEADER}>Status</div>
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: '20px',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText,
          }}>
            {status}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', alignSelf: 'center' }}>

          

          {/* Mark inactive — only for active non-current users */}
          {!isCurrentUser && status === 'Active' && (
            
              <button
               onClick={() => onMarkInactive(member.clerkUserId, `${member.firstName} ${member.lastName}`)}
                title="Mark Inactive"
                style={{
                  width: '32px', height: '32px', borderRadius: '6px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#C0392B', background: 'transparent', border: 'none', cursor: 'pointer',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </button>
            
          )}
        </div>

      </div>
    </div>
  )
}

function GroupSection({
  sectionTitle,
  status,
  members,
  currentUserId,
  orgId,
  collapsible,
  onMarkInactive,
}: {
  sectionTitle: string
  status: 'Active' | 'Pending' | 'Inactive'
  members: Member[]
  currentUserId: string
  orgId: string
  collapsible?: boolean
  onMarkInactive: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(!collapsible)
  if (members.length === 0) return null
  const colors = STATUS_COLORS[status]

  return (
    <div style={{ marginBottom: '40px' }}>
      <button
        onClick={() => collapsible && setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '16px', width: '100%', textAlign: 'left',
          background: 'none', border: 'none',
          cursor: collapsible ? 'pointer' : 'default', padding: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em',
            textTransform: 'uppercase', color: colors.accent,
            fontFamily: 'var(--font-montserrat)',
          }}>
            {sectionTitle}
          </span>
          {collapsible && (
            <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {members.length} {members.length === 1 ? 'person' : 'people'}
        </span>
      </button>

      {open && members.map(m => (
        <StaffCard
          key={m.clerkUserId}
          member={m}
          currentUserId={currentUserId}
          orgId={orgId}
          status={status}
          onMarkInactive={onMarkInactive}
        />
      ))}
    </div>
  )
}

function InactiveConfirmModal({
  modal,
  onConfirm,
  onClose,
  loading,
}: {
  modal: ConfirmModal
  onConfirm: () => void
  onClose: () => void
  loading: boolean
}) {
  if (!modal.open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'white', borderRadius: '16px', padding: '36px',
        maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
      }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          Mark as Inactive
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
          This will remove <strong style={{ color: '#1B2B4B' }}>{modal.memberName}</strong>'s portal access immediately.
          Their referral history will be preserved and they will remain in your records as inactive.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1',
              background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)',
              fontWeight: 700, fontSize: '13px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '10px 20px', borderRadius: '7px', border: 'none',
              background: '#C0392B', color: 'white', fontFamily: 'var(--font-montserrat)',
              fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? '...' : 'Mark Inactive'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StaffList({ members, currentUserId, orgId }: Props) {
  const router = useRouter()
  const [modal, setModal] = useState<ConfirmModal>({ open: false, memberId: '', memberName: '' })
  const [loading, setLoading] = useState(false)

  // For now all Clerk members are Active — Pending/Inactive come from AT in future phase
 const activeMembers = members.filter(m => m.lastSignInAt !== null)
const pendingMembers = members.filter(m => m.lastSignInAt === null)
const inactiveMembers: Member[] = []

  const handleMarkInactive = (id: string, name: string) => {
    setModal({ open: true, memberId: id, memberName: name })
  }

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await fetch('/api/admin/remove', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerkUserId: modal.memberId, orgId }),
      })
      setModal({ open: false, memberId: '', memberName: '' })
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
      <InactiveConfirmModal
        modal={modal}
        onConfirm={handleConfirm}
        onClose={() => setModal({ open: false, memberId: '', memberName: '' })}
        loading={loading}
      />

      <GroupSection
        sectionTitle="Active Staff"
        status="Active"
        members={activeMembers}
        currentUserId={currentUserId}
        orgId={orgId}
        onMarkInactive={handleMarkInactive}
      />
      <GroupSection
        sectionTitle="Pending Invitations"
        status="Pending"
        members={pendingMembers}
        currentUserId={currentUserId}
        orgId={orgId}
        collapsible
        onMarkInactive={handleMarkInactive}
      />
      <GroupSection
        sectionTitle="Inactive Staff"
        status="Inactive"
        members={inactiveMembers}
        currentUserId={currentUserId}
        orgId={orgId}
        collapsible
        onMarkInactive={handleMarkInactive}
      />
      </div>
    
  )
}
