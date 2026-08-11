// components/agency/AgencyPortalShell.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import Link from 'next/link'

type Props = {
  children: React.ReactNode
  agencyName: string
  userName: string
  userRole: string
  isAdmin: boolean
}

export default function AgencyPortalShell({
  children,
  agencyName,
  userName,
  userRole,
  isAdmin,
}: Props) {
  const pathname = usePathname()

  // Off-canvas drawer state — below 1280px only. Above it the sidebar is
  // permanently in place and this state is never read.
  //
  // The drawer is open only while we are still on the page it was opened from,
  // so navigating closes it for free — including via browser back/forward.
  const [openedFrom, setOpenedFrom] = useState<string | null>(null)
  const navOpen = openedFrom === pathname
  const closeNav = () => setOpenedFrom(null)

  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  // At 1280px and up the sidebar is permanent, so a drawer left open on a
  // smaller viewport (iPad Pro portrait 1024 → landscape 1366) must close —
  // otherwise the body scroll lock below would never be released.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const onChange = () => {
      if (mq.matches) setOpenedFrom(null)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // While open: Escape closes, body scroll is locked, focus moves into the
  // drawer, and focus returns to the hamburger when it closes.
  useEffect(() => {
    if (!navOpen) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenedFrom(null)
    }
    document.addEventListener('keydown', onKey)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const hamburger = hamburgerRef.current
    drawerRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      hamburger?.focus()
    }
  }, [navOpen])

  // Active link if pathname starts with href (so /referrals/[id] highlights /referrals/history via loose match — we handle exact/prefix per link below)
  const isActive = (href: string, mode: 'exact' | 'prefix' = 'prefix') => {
    if (mode === 'exact') return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

    const linkStyle = (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 12px',
    borderRadius: '8px',
    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: active ? 'white' : 'rgba(255,255,255,0.6)',
    fontSize: '13.5px',
    fontWeight: 500,
    textDecoration: 'none',
  })

  const disabledLinkStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '9px 12px',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '13.5px',
    fontWeight: 500,
    cursor: 'not-allowed',
  }

  const sectionHeader: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
    padding: '12px 8px 6px',
  }

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="fa-portal" style={{ display: 'flex', minHeight: '100vh' }}>
      {navOpen && (
        <div
          className="fa-shell-backdrop"
          onClick={closeNav}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            background: 'rgba(27,43,75,0.55)',
          }}
        />
      )}

      <aside
        id="fa-agency-nav"
        className="fa-shell-sidebar"
        ref={drawerRef}
        tabIndex={-1}
        data-open={navOpen}
        style={{
          width: '240px',
          background: '#1B2B4B',
          minHeight: '100vh',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 100,
          boxShadow: '4px 0 24px rgba(27,43,75,0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Brand */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                background: 'white',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img
                src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
                alt="FA"
                style={{ width: '32px', height: '32px', objectFit: 'contain' }}
              />
            </div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: 'white' }}>
              Furniture <span style={{ color: '#3AA08D' }}>Assist</span>
            </div>
          </div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.35)',
              paddingLeft: '48px',
            }}
          >
            Agency Portal
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
          <div style={sectionHeader}>Overview</div>
          <Link href="/dashboard" style={linkStyle(isActive('/dashboard'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            Dashboard
          </Link>

          <div style={sectionHeader}>Referrals</div>
          <Link href="/referrals/active" style={linkStyle(isActive('/referrals/active'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Active
          </Link>
          <Link href="/referrals/history" style={linkStyle(isActive('/referrals/history'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18v18H3z" />
              <polyline points="3 9 21 9" />
              <polyline points="3 15 21 15" />
              <polyline points="9 3 9 21" />
            </svg>
            History
          </Link>
          <div style={disabledLinkStyle} title="Coming soon">
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Referral
            </span>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                background: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.5)',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              Soon
            </span>
          </div>

          <div style={sectionHeader}>Agency</div>
          <Link href="/profile" style={linkStyle(isActive('/profile'))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </Link>

          {isAdmin && (
            <>
              <div style={sectionHeader}>Admin</div>
              <Link href="/team" style={linkStyle(isActive('/team'))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Team
              </Link>
            </>
          )}
        </nav>

        {/* Footer — user identity */}
        <div style={{ padding: '16px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px' }}>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: { width: '32px', height: '32px' },
                },
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'white',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={userName}
              >
                {userName}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.4)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={agencyName}
              >
                {agencyName}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="fa-shell-main" style={{ flex: 1, background: '#F7F6F2', minHeight: '100vh' }}>
        {/* Mobile top bar — below 1280px only. This is the navy h-16 header
            that /referrals/[id] and /referrals/new used to hand-roll, promoted
            into the shell so there is one copy and it carries the hamburger. */}
        <header className="fa-shell-topbar bg-[#1B2B4B] h-16 items-center justify-between px-8 sticky top-0 z-40 shadow-lg">
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setOpenedFrom(navOpen ? null : pathname)}
            aria-expanded={navOpen}
            aria-controls="fa-agency-nav"
            aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-extrabold text-sm text-white tracking-wide">
            Furniture Assist <span className="text-[#3AA08D]">| Agency Portal</span>
          </span>
          <UserButton
            appearance={{
              elements: {
                avatarBox: { width: '32px', height: '32px' },
              },
            }}
          />
        </header>
        {children}
      </main>
    </div>
  )
}
