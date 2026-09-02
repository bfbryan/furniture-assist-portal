'use client'

// components/internal/DawsonAvatarMenu.tsx
//
// Account avatar + dropdown for the internal (Dawson) shell's page bar
// (DawsonPageBar). Mirrors components/agency/AgencyAvatarMenu.tsx but is a
// separate copy, not a shared component: the agency menu renders a /profile
// link and shows the agency name as its second line, whereas this one shows
// the signed-in user's email and offers only Sign out. Type and hit areas are
// a step larger here, matching the rest of the Dawson side.
//
// Sign out uses the same Clerk pattern as the agency menu —
// signOut({ redirectUrl: '/sign-in' }) — replacing the old sidebar-footer
// SignOutButton.

import { useState, useEffect, useRef } from 'react'
import { useClerk } from '@clerk/nextjs'

export default function DawsonAvatarMenu({
  fullName,
  email,
  initials,
}: {
  fullName: string
  email: string
  initials: string
}) {
  const { signOut } = useClerk()
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${fullName}`}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background:
            hover || open ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)',
          color: 'white',
          fontFamily: 'var(--font-montserrat), sans-serif',
          fontWeight: 700,
          fontSize: '13px',
          letterSpacing: '0.02em',
        }}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 60,
            background: 'white',
            borderRadius: '10px',
            border: '1px solid #EDE9E1',
            boxShadow: '0 8px 28px rgba(27,43,75,0.16)',
            minWidth: '244px',
            maxWidth: '300px',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px 12px' }}>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#1B2B4B',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={fullName}
            >
              {fullName}
            </div>
            <div
              style={{
                fontSize: '13px',
                color: '#7A8899',
                marginTop: '2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={email}
            >
              {email}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #EDE9E1' }} />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              signOut({ redirectUrl: '/sign-in' })
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#F7F5F1')}
            onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '13px 16px',
              border: 'none',
              background: 'white',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '14px',
              fontWeight: 600,
              color: '#1B2B4B',
              textAlign: 'left',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
