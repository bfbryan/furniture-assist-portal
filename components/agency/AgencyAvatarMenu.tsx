'use client'

// components/agency/AgencyAvatarMenu.tsx
//
// The account avatar + dropdown in the page bar (AgencyPageBar) and the mobile
// top bar (AgencyPortalShell). One component in both places so they can't drift.
//
// Deliberately NOT Clerk's <UserButton>: that renders its own menu ("Manage
// account", "Secured by Clerk", the dev-mode banner) and reads identity from
// the Clerk profile. Name and agency here come from the Airtable Agency User /
// Agency records (passed as props), and the only account action offered is
// sign out. Manage-account settings — including the invite email — are not
// something agency staff should be editing in passing.
//
// Dropdown chrome (MENU_SURFACE / MENU_ITEM) is shared with the ⋯ menus on
// Active and History, so the portal has one menu style.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useClerk } from '@clerk/nextjs'
import { Icon, MENU_SURFACE, MENU_ITEM } from './referral-list-ui'

const PROFILE_ICON = (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)
const SIGNOUT_ICON = (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>)

export default function AgencyAvatarMenu({
  userName,
  agencyName,
  className,
}: {
  userName: string
  agencyName: string
  /** Applied to the wrapper — the page bar passes fa-pagebar-avatar-slot to
      hide its instance below 1280 (the mobile top bar carries the visible one). */
  className?: string
}) {
  const { signOut } = useClerk()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div ref={ref} className={className} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="fa-pagebar-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${userName}`}
        onClick={() => setOpen(o => !o)}
      >
        {initials}
      </button>

      {open && (
        /* maxWidth bounds the header rows: without it a long agency name grows
           the menu to fit on one line instead of wrapping / truncating. */
        <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, ...MENU_SURFACE, minWidth: '212px', maxWidth: '264px' }}>
          <div style={{ padding: '9px 12px 8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1B2B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={userName}>
              {userName}
            </div>
            {/* Wraps to at most two lines (break-word so one long word can't
                widen the menu), then ellipsis; full name on the title attribute.
                Same clamp as the rail agency block in AgencyPortalShell.tsx. */}
            <div
              style={{
                fontSize: '11px',
                color: '#7A8899',
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
                overflowWrap: 'break-word',
                marginTop: '1px',
              }}
              title={agencyName}
            >
              {agencyName}
            </div>
          </div>
          <div style={{ borderTop: '1px solid #EDE9E1', margin: '0 -4px 4px' }} />
          <Link href="/profile" role="menuitem" className="fa-active-menu-item" onClick={() => setOpen(false)} style={{ ...MENU_ITEM, color: '#1B2B4B' }}>
            <Icon path={PROFILE_ICON} />Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            className="fa-active-menu-item"
            onClick={() => { setOpen(false); signOut({ redirectUrl: '/sign-in' }) }}
            style={{ ...MENU_ITEM, color: '#1B2B4B' }}
          >
            <Icon path={SIGNOUT_ICON} />Sign out
          </button>
        </div>
      )}
    </div>
  )
}
