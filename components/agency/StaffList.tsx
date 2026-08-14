'use client'


import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import InviteStaffModal from '../InviteStaffModal'


type Member = {
  id: string
  clerkUserId: string | null
  name: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string
  status: 'Unclaimed' | 'Invited' | 'Active' | 'Inactive'
  portalInviteStatus: 'Not Invited' | 'Invite Sent' | 'Claimed' | 'Wrong Agency'
  invitedDate: string | null
  invitedBy: string | null
  claimedDate: string | null
  clerkRole: string
  lastSignInAt: number | null
}


type Props = {
  members: Member[]
  currentUserId: string
  orgId: string
  agencyId: string
  agencyName: string
  invitedByName: string
}


// ---------- shared styling helpers ----------


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
  whiteSpace: 'nowrap',
}
const COL_SUB: React.CSSProperties = { fontSize: '11px', color: '#7A8899' }
const COL_SUB_NOWRAP: React.CSSProperties = { ...COL_SUB, whiteSpace: 'nowrap' }
const COL_SUB_EMAIL: React.CSSProperties = {
  ...COL_SUB,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}


const BTN_SMALL: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '11px',
  letterSpacing: '0.04em',
  cursor: 'pointer',
  border: 'none',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}
const BTN_PRIMARY: React.CSSProperties = { ...BTN_SMALL, background: '#2A7F6F', color: 'white' }
const BTN_DANGER: React.CSSProperties = { ...BTN_SMALL, background: '#FDF0EE', color: '#C0392B', border: '1px solid #E8B5AE' }
const BTN_MUTED: React.CSSProperties = { ...BTN_SMALL, background: '#F0F0F0', color: '#2C3A4A' }


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
        <div
          style={{
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
            maxWidth: '260px',
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}


function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}


function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24))
}


// ---------- Row renderers ----------


function ReadyToInviteRow({
  member,
  onInvite,
  onWrongAgency,
}: {
  member: Member
  onInvite: (id: string, name: string) => void
  onWrongAgency: (id: string, name: string) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        marginBottom: '10px',
      }}
    >
      <div style={{ background: '#C9A84C', borderRadius: '12px 0 0 12px' }} />
      {/* Column tracks live in globals.css (.fa-staff-row-invite) so they can stack below 1280px. */}
      <div
        className="fa-staff-row-invite"
        style={{
          display: 'grid',
          alignItems: 'center',
          gap: '14px',
          padding: '14px 16px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Name</div>
          <div style={COL_VALUE}>
            {member.lastName}, {member.firstName}
          </div>
          <div style={COL_SUB_NOWRAP}>{member.phone ?? '—'}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Email</div>
          <div style={COL_SUB_EMAIL} title={member.email}>{member.email}</div>
        </div>
        <div>
          <div style={COL_HEADER}>Role</div>
          <div style={COL_SUB}>{member.role}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Tooltip label="Invite staff to activete their portal access">
            <button
              style={BTN_PRIMARY}
              onClick={() => onInvite(member.id, `${member.firstName} ${member.lastName}`)}
            >
              Send Invite
            </button>
          </Tooltip>
          <Tooltip label="Flag as not belonging to this agency">
            <button
              style={BTN_MUTED}
              onClick={() => onWrongAgency(member.id, `${member.firstName} ${member.lastName}`)}
            >
              Wrong Agency
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}


function AwaitingClaimRow({
  member,
  onResend,
  onCancel,
}: {
  member: Member
  onResend: (id: string, name: string) => void
  onCancel: (id: string, name: string) => void
}) {
  const daysOut = daysSince(member.invitedDate)
  const isStale = daysOut !== null && daysOut >= 20
  const daysRemaining = daysOut !== null ? 30 - daysOut : null


  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        marginBottom: '10px',
      }}
    >
      <div style={{ background: isStale ? '#C0392B' : '#4A90C9', borderRadius: '12px 0 0 12px' }} />
      {/* Column tracks live in globals.css (.fa-staff-row-awaiting) so they can stack below 1280px. */}
      <div
        className="fa-staff-row-awaiting"
        style={{
          display: 'grid',
          alignItems: 'center',
          gap: '14px',
          padding: '14px 16px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Name</div>
          <div style={COL_VALUE}>
            {member.lastName}, {member.firstName}
          </div>
          <div style={COL_SUB_NOWRAP}>{member.phone ?? '—'}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Email</div>
          <div style={COL_SUB_EMAIL} title={member.email}>{member.email}</div>
        </div>
        <div>
          <div style={COL_HEADER}>Invited</div>
          <div style={COL_SUB_NOWRAP}>{formatDate(member.invitedDate)}</div>
          {member.invitedBy && <div style={{ ...COL_SUB, fontSize: '10px' }}>by {member.invitedBy}</div>}
        </div>
        <div>
          <div style={COL_HEADER}>Status</div>
          {isStale ? (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: '#FDF0EE',
                color: '#C0392B',
                whiteSpace: 'nowrap',
              }}
            >
              {daysRemaining !== null && daysRemaining > 0
                ? `Stale · ${daysRemaining}d left`
                : 'Expiring'}
            </span>
          ) : (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: '#EAF0F7',
                color: '#4A90C9',
              }}
            >
              Awaiting
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            style={BTN_PRIMARY}
            onClick={() => onResend(member.id, `${member.firstName} ${member.lastName}`)}
          >
            Resend
          </button>
          <button
            style={BTN_DANGER}
            onClick={() => onCancel(member.id, `${member.firstName} ${member.lastName}`)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}


function ActiveOrInactiveRow({
  member,
  currentUserId,
  onDeactivate,
  onReactivate,
  onWrongAgency,
}: {
  member: Member
  currentUserId: string
  onDeactivate: (id: string, name: string) => void
  onReactivate: (id: string, name: string) => void
  onWrongAgency: (id: string, name: string) => void
}) {
  const isCurrentUser = member.clerkUserId === currentUserId
  const isActive = member.status === 'Active'
  const accent = isActive ? '#2A7F6F' : '#7A8899'


  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        marginBottom: '10px',
      }}
    >
      <div style={{ background: accent, borderRadius: '12px 0 0 12px' }} />
      {/* Column tracks live in globals.css (.fa-staff-row-active) so they can stack below 1280px. */}
      <div
        className="fa-staff-row-active"
        style={{
          display: 'grid',
          alignItems: 'center',
          gap: '14px',
          padding: '14px 16px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Staff Member</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              flexWrap: 'nowrap',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={COL_VALUE}>
              {member.lastName}, {member.firstName}
            </span>
            {isCurrentUser && <span style={{ fontSize: '11px', color: '#7A8899' }}>(You)</span>}
          </div>
          <div style={COL_SUB_NOWRAP}>{member.phone ?? '—'}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={COL_HEADER}>Email</div>
          <div style={COL_SUB_EMAIL} title={member.email}>{member.email}</div>
        </div>
        <div>
          <div style={COL_HEADER}>Role</div>
          <div style={COL_SUB}>{member.role}</div>
        </div>
        <div>
          <div style={COL_HEADER}>Last Login</div>
          <div style={COL_SUB_NOWRAP}>
            {member.lastSignInAt
              ? new Date(member.lastSignInAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Never'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {!isCurrentUser && isActive && (
            <>
              <button
                style={BTN_DANGER}
                onClick={() => onDeactivate(member.id, `${member.firstName} ${member.lastName}`)}
              >
                Deactivate
              </button>
              <Tooltip label="Flag as not belonging to this agency">
                <button
                  style={BTN_MUTED}
                  onClick={() =>
                    onWrongAgency(member.id, `${member.firstName} ${member.lastName}`)
                  }
                >
                  Wrong Agency
                </button>
              </Tooltip>
            </>
          )}
          {!isCurrentUser && !isActive && (
            <button
              style={BTN_PRIMARY}
              onClick={() => onReactivate(member.id, `${member.firstName} ${member.lastName}`)}
            >
              Reactivate
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// ---------- Section wrapper ----------


function Section({
  title,
  accent,
  count,
  collapsible,
  defaultOpen = true,
  actionButton,
  children,
}: {
  title: string
  accent: string
  count: number
  collapsible?: boolean
  defaultOpen?: boolean
  actionButton?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Section is hidden when empty AND has no action button (Ready to Invite always shows so admin can add)
  if (count === 0 && !actionButton) return null


  return (
    <div style={{ marginBottom: '36px' }}>
      {/* Wrapping lives in globals.css (.fa-staff-section-header) so the action
          button drops to its own line below 1280px instead of compressing. */}
      <div
        className="fa-staff-section-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
        }}
      >
        <button
          onClick={() => collapsible && setOpen(!open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'none',
            border: 'none',
            cursor: collapsible ? 'pointer' : 'default',
            padding: 0,
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: 800,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: accent,
              fontFamily: 'var(--font-montserrat)',
            }}
          >
            {title}
          </span>
          {collapsible && (
            <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>
          )}
          <span
            style={{
              fontSize: '12px',
              color: '#7A8899',
              fontWeight: 600,
              marginLeft: '4px',
            }}
          >
            · {count} {count === 1 ? 'person' : 'people'}
          </span>
        </button>
        {actionButton}
      </div>
      {open && children}
    </div>
  )
}


// ---------- Confirm modal ----------


type ConfirmAction =
  | 'invite'
  | 'resend'
  | 'cancel'
  | 'deactivate'
  | 'reactivate'
  | 'wrong-agency'


type ConfirmState = {
  open: boolean
  action: ConfirmAction | null
  id: string
  name: string
}


const CONFIRM_COPY: Record<
  ConfirmAction,
  { title: string; body: (name: string) => React.ReactNode; button: string; danger?: boolean }
> = {
  invite: {
    title: 'Send Portal Invitation',
    body: (name) => (
      <>
        Send a secure portal invitation email to <strong style={{ color: '#1B2B4B' }}>{name}</strong>? They&apos;ll receive a magic link to activate their account.
      </>
    ),
    button: 'Send Invite',
  },
  resend: {
    title: 'Resend Portal Invitation',
    body: (name) => (
      <>
        Resend the invitation to <strong style={{ color: '#1B2B4B' }}>{name}</strong>? Their existing magic link will be refreshed and the 30-day expiration resets.
      </>
    ),
    button: 'Resend',
  },
  cancel: {
    title: 'Cancel Invitation',
    body: (name) => (
      <>
        Cancel <strong style={{ color: '#1B2B4B' }}>{name}</strong>&apos;s pending invitation? Their access token will be revoked and they&apos;ll return to Ready to Invite.
      </>
    ),
    button: 'Cancel Invite',
    danger: true,
  },
  deactivate: {
    title: 'Deactivate Staff Member',
    body: (name) => (
      <>
        This will immediately block <strong style={{ color: '#1B2B4B' }}>{name}</strong>&apos;s portal access. Their referral history is preserved and they can be reactivated at any time.
      </>
    ),
    button: 'Deactivate',
    danger: true,
  },
  reactivate: {
    title: 'Reactivate Staff Member',
    body: (name) => <>This will restore <strong style={{ color: '#1B2B4B' }}>{name}</strong>&apos;s portal access.</>,
    button: 'Reactivate',
  },
  'wrong-agency': {
    title: 'Not in this Agency',
    body: (name) => (
      <>
        Flag <strong style={{ color: '#1B2B4B' }}>{name}</strong> as not belonging to this agency? They&apos;ll be hidden from your team view. Contact Furniture Assist to have them reassigned or removed.
      </>
    ),
    button: 'Flag Wrong Agency',
    danger: true,
  },
}


// ---------- Main component ----------


export default function StaffList({
  members,
  currentUserId,
  orgId,
  agencyId,
  agencyName,
  invitedByName,
}: Props) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    action: null,
    id: '',
    name: '',
  })
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)


  // Close the confirm modal on Esc — same as InviteStaffModal.
  useEffect(() => {
    if (!confirm.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        setConfirm({ open: false, action: null, id: '', name: '' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirm.open, loading])


  // -------- section buckets --------
  const byLastName = (a: Member, b: Member) => a.lastName.localeCompare(b.lastName)


  const readyToInvite = members
    .filter((m) => m.status === 'Unclaimed' && m.portalInviteStatus === 'Not Invited')
    .sort(byLastName)


  const awaitingClaim = members
    .filter((m) => m.status === 'Invited' && m.portalInviteStatus === 'Invite Sent')
    .sort((a, b) => {
      const at = a.invitedDate ? new Date(a.invitedDate).getTime() : 0
      const bt = b.invitedDate ? new Date(b.invitedDate).getTime() : 0
      return bt - at
    })


  // Active Staff — excludes admins (admin lives in the header "Logged In As" area)
  const activeStaff = members
    .filter((m) => m.status === 'Active' && m.role !== 'Admin')
    .sort(byLastName)


  const inactiveStaff = members
    .filter((m) => m.status === 'Inactive')
    .sort(byLastName)


  // -------- action dispatch --------
  const openConfirm = (action: ConfirmAction, id: string, name: string) =>
    setConfirm({ open: true, action, id, name })


  const closeConfirm = () => setConfirm({ open: false, action: null, id: '', name: '' })


  const handleConfirm = async () => {
    if (!confirm.action) return
    setLoading(true)
    setFlash(null)


    try {
      let res: Response


      switch (confirm.action) {
        case 'invite':
        case 'resend':
          res = await fetch(`/api/admin/staff/${confirm.id}/invite`, { method: 'POST' })
          break
        case 'cancel':
          res = await fetch(`/api/admin/staff/${confirm.id}/cancel-invite`, { method: 'POST' })
          break
        case 'deactivate':
          res = await fetch(`/api/admin/staff/${confirm.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Inactive' }),
          })
          break
        case 'reactivate':
          res = await fetch(`/api/admin/staff/${confirm.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Active' }),
          })
          break
        case 'wrong-agency':
          res = await fetch(`/api/admin/staff/${confirm.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portalInviteStatus: 'Wrong Agency' }),
          })
          break
        default:
          return
      }


      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFlash({ tone: 'error', text: data.error || 'Something went wrong.' })
      } else {
        const label =
          confirm.action === 'invite' || confirm.action === 'resend'
            ? 'Invitation sent'
            : confirm.action === 'cancel'
            ? 'Invitation cancelled'
            : confirm.action === 'deactivate'
            ? 'Deactivated'
            : confirm.action === 'reactivate'
            ? 'Reactivated'
            : 'Flagged as wrong agency'
        setFlash({ tone: 'success', text: `${label} — ${confirm.name}` })
        router.refresh()
      }
      closeConfirm()
    } catch {
      setFlash({ tone: 'error', text: 'Network error. Please try again.' })
    } finally {
      setLoading(false)
      setTimeout(() => setFlash(null), 4000)
    }
  }


  const cc = confirm.action ? CONFIRM_COPY[confirm.action] : null


  // Invite button used in the Ready to Invite section header
  const inviteButton = (
    <button
      onClick={() => setInviteModalOpen(true)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 14px',
        borderRadius: '7px',
        border: 'none',
        background: '#2A7F6F',
        color: 'white',
        fontFamily: 'var(--font-montserrat)',
        fontWeight: 700,
        fontSize: '12px',
        letterSpacing: '0.03em',
        cursor: 'pointer',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Invite Staff Member
    </button>
  )


  return (
    <div>
      {/* Flash */}
      {flash && (
        <div
          style={{
            background: flash.tone === 'success' ? 'rgba(42,127,111,0.10)' : '#FDF0EE',
            border: `1px solid ${flash.tone === 'success' ? '#2A7F6F' : '#C0392B'}`,
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '13px',
            color: flash.tone === 'success' ? '#2A7F6F' : '#C0392B',
            fontWeight: 600,
          }}
        >
          {flash.tone === 'success' ? '✓ ' : ''}
          {flash.text}
        </div>
      )}


      {/* Invite modal */}
      <InviteStaffModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        orgId={orgId}
        agencyId={agencyId}
        agencyName={agencyName}
        invitedByName={invitedByName}
      />


      {/* Confirm modal */}
      {confirm.open && cc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={(e) => e.target === e.currentTarget && closeConfirm()}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '16px',
              padding: '36px',
              maxWidth: '440px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 800,
                fontSize: '18px',
                color: '#1B2B4B',
                marginBottom: '10px',
              }}
            >
              {cc.title}
            </h3>
            <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
              {cc.body(confirm.name)}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={closeConfirm}
                style={{
                  padding: '10px 20px',
                  borderRadius: '7px',
                  border: '1px solid #EDE9E1',
                  background: 'white',
                  color: '#2C3A4A',
                  fontFamily: 'var(--font-montserrat)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '7px',
                  border: 'none',
                  background: cc.danger ? '#C0392B' : '#2A7F6F',
                  color: 'white',
                  fontFamily: 'var(--font-montserrat)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? '...' : cc.button}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Sections */}
      <Section
        title="Ready to Invite to Portal"
        accent="#C9A84C"
        count={readyToInvite.length}
        actionButton={inviteButton}
      >
        {readyToInvite.length === 0 ? (
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              textAlign: 'center',
              color: '#7A8899',
              fontSize: '13px',
              boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
            }}
          >
            No staff waiting to be invited. Add someone with the button above.
          </div>
        ) : (
          readyToInvite.map((m) => (
            <ReadyToInviteRow
              key={m.id}
              member={m}
              onInvite={(id, name) => openConfirm('invite', id, name)}
              onWrongAgency={(id, name) => openConfirm('wrong-agency', id, name)}
            />
          ))
        )}
      </Section>


      <Section title="Awaiting Claim" accent="#4A90C9" count={awaitingClaim.length}>
        {awaitingClaim.map((m) => (
          <AwaitingClaimRow
            key={m.id}
            member={m}
            onResend={(id, name) => openConfirm('resend', id, name)}
            onCancel={(id, name) => openConfirm('cancel', id, name)}
          />
        ))}
      </Section>


      <Section title="Active Staff" accent="#2A7F6F" count={activeStaff.length}>
        {activeStaff.map((m) => (
          <ActiveOrInactiveRow
            key={m.id}
            member={m}
            currentUserId={currentUserId}
            onDeactivate={(id, name) => openConfirm('deactivate', id, name)}
            onReactivate={(id, name) => openConfirm('reactivate', id, name)}
            onWrongAgency={(id, name) => openConfirm('wrong-agency', id, name)}
          />
        ))}
      </Section>


      <Section
        title="Inactive"
        accent="#7A8899"
        count={inactiveStaff.length}
        collapsible
        defaultOpen={false}
      >
        {inactiveStaff.map((m) => (
          <ActiveOrInactiveRow
            key={m.id}
            member={m}
            currentUserId={currentUserId}
            onDeactivate={(id, name) => openConfirm('deactivate', id, name)}
            onReactivate={(id, name) => openConfirm('reactivate', id, name)}
            onWrongAgency={(id, name) => openConfirm('wrong-agency', id, name)}
          />
        ))}
      </Section>
    </div>
  )
}
