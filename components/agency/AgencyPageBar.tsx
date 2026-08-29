'use client'

// components/agency/AgencyPageBar.tsx
//
// The slim navy bar that replaced the tall gradient hero on every agency page.
// Rendered by AgencyPortalShell inside <main>, above the page content (and,
// on mobile, below the existing hamburger top bar).
//
//   [ page title ]  ......spacer......  [ + New Referral ]  [ avatar ▾ ]
//
// Flat #1B2B4B — the same value as the sidebar, no gradient, so the two don't
// seam where they meet. The 4px teal rule underneath is the old hero's.
//
// Not sticky: it scrolls with the page. The referral detail page's own
// sub-header is sticky at >=1280, and a second sticky bar above it would
// fight for top:0 — so this one stays in normal flow and they just stack.

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { SignOutButton } from '@clerk/nextjs'

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/referrals/active': 'Active Referrals',
  '/referrals/history': 'Referral History',
  '/referrals/new': 'New Referral',
  '/profile': 'Agency Profile',
  '/team': 'Team',
}

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname]
  // /referrals/[id] — the detail page, which shows the client name in its own
  // sub-header, so the bar just needs a category.
  if (pathname.startsWith('/referrals/')) return 'Referral'
  return ''
}

const MENU_ITEM: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
  padding: '8px 10px', borderRadius: '6px', border: 'none', background: 'transparent',
  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
  color: '#1B2B4B', cursor: 'pointer', textDecoration: 'none', textAlign: 'left',
}

export default function AgencyPageBar({
  userName,
  agencyName,
}: {
  userName: string
  agencyName: string
}) {
  const pathname = usePathname()
  const title = titleFor(pathname)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside mousedown and Escape. The menu items also close it on
  // click, so a route change while it's open is only left standing after a
  // browser back/forward — which the next click then clears.
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
    <div className="fa-pagebar">
      <span
        className="fa-pagebar-title"
        style={{ color: 'white', fontSize: '14.5px', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {title}
      </span>

      <span style={{ flex: 1 }} />

      {/* Disabled until the New Referral flow ships — it returns to the filled
          teal primary then. Rendered muted (not a filled teal button) so the
          most prominent control on the page isn't a dead one; no SOON badge,
          the rail nav item already carries that signal. `disabled` also keeps
          it out of the tab order. */}
      <button
        type="button"
        className="fa-pagebar-newref"
        disabled
        title="New Referral — coming soon"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
          padding: '7px 13px', borderRadius: '8px', border: 'none',
          background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)',
          fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
          cursor: 'not-allowed', whiteSpace: 'nowrap',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Referral
      </button>

      <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
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
          <div
            role="menu"
            style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: '212px', background: 'white', border: '1px solid #EDE9E1', borderRadius: '10px', boxShadow: '0 12px 32px rgba(27,43,75,0.18)', padding: '4px' }}
          >
            <div style={{ padding: '9px 12px 8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1B2B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={userName}>
                {userName}
              </div>
              <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }} title={agencyName}>
                {agencyName}
              </div>
            </div>
            <div style={{ borderTop: '1px solid #EDE9E1', margin: '0 -4px 4px' }} />
            <Link href="/profile" role="menuitem" className="fa-active-menu-item" onClick={() => setOpen(false)} style={MENU_ITEM}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              Profile
            </Link>
            <SignOutButton redirectUrl="/sign-in">
              <button type="button" role="menuitem" className="fa-active-menu-item" style={MENU_ITEM}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </SignOutButton>
          </div>
        )}
      </div>
    </div>
  )
}
