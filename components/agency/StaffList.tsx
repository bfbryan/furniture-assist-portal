'use client'

// components/agency/StaffList.tsx
//
// Agency Team — a sibling of the Active / History lists (components/agency/
// ReferralTable.tsx): grouped white cards, one column-header row per section,
// the shared ⋯ overflow menu, the .fa-*-row stacked pattern on mobile.
//
// Groups key primarily on Portal Status; Status wins a conflict, so a person
// marked Inactive lands in Inactive whatever their Portal Status. Wrong Agency
// rows never render here (also filtered server-side in team/page.tsx).
//
// Every menu action hits an /api/admin/staff/[id]/* route that re-checks
// org:admin AND that the row is at the caller's agency — see
// lib/auth/agency-admin-access.ts. Hiding a menu is presentation, not
// permission.

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import InviteStaffModal from '../InviteStaffModal'
import { formatEasternTimestamp } from '@/lib/dates'
import { AGENCY_CONTACT_EMAIL } from '@/lib/contact'
import { OverflowMenu, ColumnHead, type MenuItem } from './referral-list-ui'

type Member = {
  id: string
  clerkUserId: string | null
  name: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string // 'Admin' | 'Staff'
  status: string // 'Unclaimed' | 'Invited' | 'Active' | 'Inactive' | ...
  portalInviteStatus: string // 'Not Invited' | 'Invite Sent' | 'Claimed' | 'Wrong Agency'
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
  inviterEmail: string
}

type GroupKey = 'ready' | 'invited' | 'active' | 'inactive'

// Wrong Agency never renders on the agency side, whatever the Status (the page
// also filters it server-side). Otherwise: group on Portal Status, but Status
// 'Inactive' wins a conflict. Status 'Unclaimed' / 'Invited' are vestigial here
// and ignored. Anything matching nothing is dropped rather than guessed at.
//
// A Claimed row groups as 'active' whatever its Status (Inactive is already
// handled above). The claim handler stamps Portal Status = Claimed and flips
// Status to Active in two separate writes; if the second fails, the row is
// briefly Claimed + Invited. Keying only on Claimed here means that window —
// and any later drift between the two fields — still renders instead of
// vanishing from the page. The Status→Active retry on the next sign-in stands.
function classify(m: Member): GroupKey | null {
  if (m.portalInviteStatus === 'Wrong Agency') return null
  if (m.status === 'Inactive') return 'inactive'
  if (m.portalInviteStatus === 'Not Invited') return 'ready'
  if (m.portalInviteStatus === 'Invite Sent') return 'invited'
  if (m.portalInviteStatus === 'Claimed') return 'active'
  return null
}

// ------------------------------------------------------------------ dates

function shortDate(iso: string | number | null | undefined): string {
  return formatEasternTimestamp(iso, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "today" · "yesterday" · "5 days ago" · "3 weeks ago" · "4 months ago". */
function relative(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const then = typeof value === 'number' ? value : new Date(value).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 21) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

// ------------------------------------------------------------------ icons

const MAIL_ICON = (<><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/></>)
const RESEND_ICON = (<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>)
const X_ICON = (<><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>)
const PIN_OFF_ICON = (<><path d="M21 10c0 6-9 12-9 12S3 16 3 10a9 9 0 0 1 .6-3.2"/><path d="M8.4 4.4A9 9 0 0 1 21 10"/><line x1="2" y1="2" x2="22" y2="22"/></>)
const UNDO_ICON = (<><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></>)
// SHIELD_ICON removed with the Make/Remove Admin menu items — re-add it when
// self-service role management comes back (see menuFor / the 'active' branch).

// ------------------------------------------------------------------ styling

const SECTION_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontSize: '13px', fontWeight: 800,
  letterSpacing: '0.10em', textTransform: 'uppercase',
}
const ACCENT: Record<GroupKey, { bar: string; heading: string }> = {
  ready:    { bar: '#C9A84C', heading: '#8B7724' },
  invited:  { bar: '#C9A84C', heading: '#8B7724' },
  active:   { bar: '#2A7F6F', heading: '#2A7F6F' },
  inactive: { bar: '#9AA6B2', heading: '#7A8899' },
}
const CARD: React.CSSProperties = {
  background: 'white', borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '20px',
  padding: '14px 18px 14px 15px',
}
const EMPTY_BOX: React.CSSProperties = {
  background: 'white', borderRadius: '12px', padding: '36px',
  textAlign: 'center', color: '#7A8899', fontSize: '14px', lineHeight: 1.6,
}

// ------------------------------------------------------------------ card

function GroupCard({
  groupKey, title, count, columns, collapsible, children,
}: {
  groupKey: GroupKey
  title: string
  count: number
  columns: string[]
  collapsible?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!collapsible)
  const a = ACCENT[groupKey]
  return (
    <section style={{ ...CARD, borderLeft: `3px solid ${a.bar}` }}>
      <button
        type="button"
        onClick={() => collapsible && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px',
          background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left',
          cursor: collapsible ? 'pointer' : 'default',
        }}
      >
        <span style={{ ...SECTION_TITLE, color: a.heading }}>{title}</span>
        {/* No count on the open groups — the lists are short. Kept only while a
            collapsible group is closed, where it's the one signal of what's inside. */}
        {collapsible && !open && (
          <span style={{ fontSize: '13px', color: '#9AA6B2', fontWeight: 600 }}>{count}</span>
        )}
        {collapsible && (
          <span style={{ fontSize: '10px', color: '#9AA6B2', marginLeft: '2px' }}>{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && <ColumnHead columns={columns} className="fa-team-row fa-team-row--head" />}
      {open && children}
    </section>
  )
}

// ------------------------------------------------------------------ row

function Row({
  m, context, items, menuOpen, onMenuOpen, onMenuClose,
}: {
  m: Member
  /** Sent / Last Login — always rendered so the column lines up across every
      group; empty on Ready to invite and Inactive (the cell collapses on mobile). */
  context?: React.ReactNode
  items: MenuItem[]
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
}) {
  return (
    <div className="fa-team-row" style={{ borderTop: '1px solid #F3F0EA' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B2B4B', overflowWrap: 'anywhere' }}>
          {m.lastName}, {m.firstName}
        </div>
        {m.phone && <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '1px' }}>{m.phone}</div>}
      </div>

      <div style={{ fontSize: '12px', color: '#7A8899', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.email}>
        <span className="fa-active-mobile-label">Email </span>{m.email}
      </div>

      <div style={{ fontSize: '12px', color: '#7A8899', minWidth: 0 }}>
        <span className="fa-active-mobile-label">Role </span>{m.role}
      </div>

      <div style={{ fontSize: '12px', color: '#7A8899', minWidth: 0 }}>{context}</div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {items.length > 0 && (
          <OverflowMenu
            open={menuOpen}
            onOpen={onMenuOpen}
            onClose={onMenuClose}
            items={items}
            label={`Actions for ${m.firstName} ${m.lastName}`}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ confirm

type ActionKey =
  | 'send-invite' | 'resend' | 'revoke' | 'not-here'
  | 'make-admin' | 'remove-admin' | 'deactivate' | 'reactivate'

// The subject — the name the reader scans before confirming — is bold navy so
// it's the most scannable thing in the sentence.
const SUBJECT: React.CSSProperties = { color: '#1B2B4B', fontWeight: 700 }

// Only three actions stop for a confirm; the rest fire and flash.
const CONFIRM: Partial<Record<ActionKey, { title: string; body: (n: string) => React.ReactNode; button: string; danger?: boolean }>> = {
  revoke: {
    title: 'Revoke invitation',
    body: n => <>Revoke the invitation for <strong style={SUBJECT}>{n}</strong>? Their invite link will stop working.</>,
    button: 'Revoke Invite', danger: true,
  },
  'not-here': {
    title: 'Not at this office',
    body: n => <>Furniture Assist will move <strong style={SUBJECT}>{n}</strong> to the correct agency. They&apos;ll no longer appear on your team list.</>,
    button: 'Confirm', danger: true,
  },
  deactivate: {
    title: 'Remove portal access',
    body: n => <>Remove <strong style={SUBJECT}>{n}</strong>&apos;s access to the portal? Their referral history stays on file and access can be restored later.</>,
    button: 'Deactivate', danger: true,
  },
}

// ------------------------------------------------------------------ page

export default function StaffList({
  members, currentUserId, orgId, agencyId, agencyName, invitedByName, inviterEmail,
}: Props) {
  const router = useRouter()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // 'warn' = the action succeeded but the invite email did not send. Styled
  // amber, and it does NOT auto-dismiss — it points at Resend Invite.
  const [flash, setFlash] = useState<{ tone: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ action: ActionKey; id: string; name: string } | null>(null)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) setConfirm(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirm, loading])

  const buckets = useMemo(() => {
    const b: Record<GroupKey, Member[]> = { ready: [], invited: [], active: [], inactive: [] }
    for (const m of members) {
      const k = classify(m)
      if (k) b[k].push(m)
    }
    const byName = (a: Member, z: Member) => a.lastName.localeCompare(z.lastName)
    b.ready.sort(byName)
    b.inactive.sort(byName)
    b.active.sort(byName)
    b.invited.sort((a, z) => {
      const at = a.invitedDate ? new Date(a.invitedDate).getTime() : 0
      const zt = z.invitedDate ? new Date(z.invitedDate).getTime() : 0
      return zt - at
    })
    return b
  }, [members])

  const run = async (action: ActionKey, id: string) => {
    setLoading(true)
    setFlash(null)
    let keepFlash = false
    try {
      const req: Record<ActionKey, () => Promise<Response>> = {
        'send-invite': () => fetch(`/api/admin/staff/${id}/invite`, { method: 'POST' }),
        resend: () => fetch(`/api/admin/staff/${id}/invite`, { method: 'POST' }),
        revoke: () => fetch(`/api/admin/staff/${id}/cancel-invite`, { method: 'POST' }),
        'not-here': () => fetch(`/api/admin/staff/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portalInviteStatus: 'Wrong Agency' }) }),
        deactivate: () => fetch(`/api/admin/staff/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Inactive' }) }),
        reactivate: () => fetch(`/api/admin/staff/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Active' }) }),
        'make-admin': () => fetch(`/api/admin/staff/${id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Admin' }) }),
        'remove-admin': () => fetch(`/api/admin/staff/${id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Staff' }) }),
      }
      const res = await req[action]()
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFlash({ tone: 'err', text: body.error || 'That did not go through. Please try again.' })
        return false
      }
      const ok: Record<ActionKey, string> = {
        'send-invite': 'Invite sent', resend: 'Invite re-sent', revoke: 'Invitation revoked',
        'not-here': 'Flagged for Furniture Assist', deactivate: 'Access removed', reactivate: 'Access restored',
        'make-admin': 'Now an admin', 'remove-admin': 'Now staff',
      }
      // The invite routes return 200 with emailSent:false when the row was
      // written but Resend didn't take the message. The person is still
      // invited and the link is live — say so, and point at Resend Invite.
      if ((action === 'send-invite' || action === 'resend') && body.emailSent === false) {
        keepFlash = true
        setFlash({
          tone: 'warn',
          text: 'The invite was recorded, but the email didn’t send. Use Resend Invite, or contact Furniture Assist if it keeps failing.',
        })
        router.refresh()
        return true
      }
      setFlash({ tone: 'ok', text: ok[action] })
      router.refresh()
      return true
    } catch {
      setFlash({ tone: 'err', text: 'Network error. Please try again.' })
      return false
    } finally {
      setLoading(false)
      if (!keepFlash) setTimeout(() => setFlash(null), 4000)
    }
  }

  // Fires directly (with a flash) or opens the confirm dialog first.
  const act = (action: ActionKey, m: Member) => {
    setOpenMenu(null)
    if (CONFIRM[action]) setConfirm({ action, id: m.id, name: `${m.firstName} ${m.lastName}` })
    else run(action, m.id)
  }

  const rowProps = (m: Member) => ({
    m,
    menuOpen: openMenu === m.id,
    onMenuOpen: () => setOpenMenu(m.id),
    onMenuClose: () => setOpenMenu(null),
  })

  const menuFor = (m: Member, g: GroupKey): MenuItem[] => {
    if (g === 'ready') return [
      { label: 'Send Invite', color: '#2A7F6F', icon: MAIL_ICON, onClick: () => act('send-invite', m) },
      { label: 'Not at this office', color: '#C0392B', icon: PIN_OFF_ICON, onClick: () => act('not-here', m) },
    ]
    if (g === 'invited') return [
      { label: 'Resend Invite', color: '#2A7F6F', icon: RESEND_ICON, onClick: () => act('resend', m) },
      { label: 'Revoke Invite', color: '#C0392B', icon: X_ICON, onClick: () => act('revoke', m) },
      { label: 'Not at this office', color: '#C0392B', icon: PIN_OFF_ICON, onClick: () => act('not-here', m), divider: true },
    ]
    if (g === 'active') {
      // The signed-in admin's own row carries no menu — you can't deactivate
      // yourself and lock the agency out.
      //
      // Make / Remove Admin were removed: role changes are handled by Furniture
      // Assist directly for now. The 'make-admin' / 'remove-admin' actions and
      // /api/admin/staff/[id]/role are left intact for when self-service role
      // management is added back.
      if (m.clerkUserId && m.clerkUserId === currentUserId) return []
      return [
        { label: 'Deactivate', color: '#C0392B', icon: X_ICON, onClick: () => act('deactivate', m) },
      ]
    }
    // inactive
    return [{ label: 'Reactivate', color: '#2A7F6F', icon: UNDO_ICON, onClick: () => act('reactivate', m) }]
  }

  const total = buckets.ready.length + buckets.invited.length + buckets.active.length + buckets.inactive.length

  const cc = confirm ? CONFIRM[confirm.action] : null

  return (
    <>
      {/* Header. Desktop (.fa-team-header grid): heading top-left, Add Staff
          Member top-right, the two-line description under the heading (capped
          at ~640px so it wraps rather than reaching the card edge). Mobile:
          heading, description, then the button on its own line beneath — see
          the media query in globals.css. Children are in that DOM order so the
          mobile stack needs no reordering, only the button repositioned. */}
      <div className="fa-team-header" style={{ marginBottom: '20px' }}>
        <h2 style={{ fontFamily: 'var(--font-montserrat)', fontSize: '15px', fontWeight: 600, color: '#1B2B4B', margin: 0 }}>
          Team Members
        </h2>
        <div className="fa-team-header-desc" style={{ maxWidth: '640px', fontSize: '13px', lineHeight: 1.6, margin: '4px 0 0' }}>
          <p style={{ color: '#7A8899', margin: 0 }}>
            Manage who at your agency has access to the Furniture Assist portal.
          </p>
          {/* One step more muted than the line above — purpose vs. operational note.
              #9AA6B2 is the same grey already used for the Inactive accent / counts. */}
          <p style={{ color: '#9AA6B2', margin: 0 }}>
            People already in our records appear below — use Add Staff Member for anyone who isn&apos;t listed.
          </p>
        </div>
        <button
          type="button"
          className="fa-team-header-add"
          onClick={() => setInviteOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '9px 16px', borderRadius: '8px', border: 'none',
            background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)',
            fontWeight: 700, fontSize: '12px', letterSpacing: '0.03em', cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Staff Member
        </button>
      </div>

      {flash && (
        <div style={{
          borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
          fontSize: '13px', fontWeight: 600,
          background: flash.tone === 'ok' ? 'rgba(42,127,111,0.10)' : flash.tone === 'warn' ? '#FEF9EC' : '#FDF0EE',
          border: `1px solid ${flash.tone === 'ok' ? '#2A7F6F' : flash.tone === 'warn' ? '#E6D3A3' : '#C0392B'}`,
          color: flash.tone === 'ok' ? '#2A7F6F' : flash.tone === 'warn' ? '#6B5518' : '#C0392B',
        }}>
          {flash.tone === 'ok' ? '✓ ' : ''}{flash.text}
        </div>
      )}

      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        orgId={orgId}
        agencyId={agencyId}
        agencyName={agencyName}
        invitedByName={invitedByName}
        inviterEmail={inviterEmail}
      />

      {confirm && cc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={e => e.target === e.currentTarget && !loading && setConfirm(null)}
        >
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
            <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '17px', color: '#1B2B4B', marginBottom: '10px' }}>{cc.title}</h3>
            <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.6, marginBottom: '22px' }}>{cc.body(confirm.name)}</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirm(null)} disabled={loading}
                style={{ padding: '9px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" disabled={loading}
                onClick={async () => { const done = await run(confirm.action, confirm.id); if (done) setConfirm(null) }}
                style={{ padding: '9px 18px', borderRadius: '7px', border: 'none', background: cc.danger ? '#C0392B' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
                {loading ? '…' : cc.button}
              </button>
            </div>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div style={EMPTY_BOX}>
          No other team members yet. Use <strong style={{ color: '#1B2B4B' }}>Add Staff Member</strong> to give a colleague portal access.
        </div>
      ) : (
        <>
          {buckets.ready.length > 0 && (
            <GroupCard groupKey="ready" title="Ready to invite" count={buckets.ready.length}
              columns={['Name', 'Email', 'Role', '']}>
              {buckets.ready.map(m => (
                <Row key={m.id} {...rowProps(m)} items={menuFor(m, 'ready')} />
              ))}
            </GroupCard>
          )}

          {buckets.invited.length > 0 && (
            <GroupCard groupKey="invited" title="Invitation sent" count={buckets.invited.length}
              columns={['Name', 'Email', 'Role', 'Invited']}>
              {buckets.invited.map(m => (
                <Row key={m.id} {...rowProps(m)} items={menuFor(m, 'invited')}
                  context={
                    <>
                      <span className="fa-active-mobile-label">Invited </span>
                      {m.invitedDate
                        ? <>Sent {shortDate(m.invitedDate)}{relative(m.invitedDate) ? ` · ${relative(m.invitedDate)}` : ''}</>
                        : '—'}
                      {m.invitedBy && <div style={{ fontSize: '11px', color: '#9AA6B2', marginTop: '1px' }}>by {m.invitedBy}</div>}
                    </>
                  }
                />
              ))}
            </GroupCard>
          )}

          {buckets.active.length > 0 && (
            <GroupCard groupKey="active" title="Active members" count={buckets.active.length}
              columns={['Name', 'Email', 'Role', 'Last Login']}>
              {buckets.active.map(m => (
                <Row key={m.id} {...rowProps(m)} items={menuFor(m, 'active')}
                  context={
                    <>
                      <span className="fa-active-mobile-label">Last login </span>
                      {m.lastSignInAt
                        ? <span style={{ color: '#1B2B4B' }}>{relative(m.lastSignInAt)}</span>
                        : <span style={{ color: '#9AA6B2' }}>Never</span>}
                      {m.clerkUserId === currentUserId && <span style={{ color: '#9AA6B2' }}> · you</span>}
                    </>
                  }
                />
              ))}
              <p style={{ fontSize: '12px', color: '#9AA6B2', lineHeight: 1.6, margin: '12px 0 2px' }}>
                To change your agency&apos;s primary administrator, email{' '}
                <a href={`mailto:${AGENCY_CONTACT_EMAIL}`} style={{ color: '#7A8899', textDecoration: 'underline' }}>{AGENCY_CONTACT_EMAIL}</a>.
              </p>
            </GroupCard>
          )}

          {buckets.inactive.length > 0 && (
            <GroupCard groupKey="inactive" title="Inactive" count={buckets.inactive.length} collapsible
              columns={['Name', 'Email', 'Role', '']}>
              {buckets.inactive.map(m => (
                <Row key={m.id} {...rowProps(m)} items={menuFor(m, 'inactive')} />
              ))}
            </GroupCard>
          )}
        </>
      )}
    </>
  )
}
