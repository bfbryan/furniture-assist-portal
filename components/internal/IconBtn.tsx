// components/internal/IconBtn.tsx
//
// Extracted verbatim from dawson/referrals/scheduled/page.tsx (July 2026).
// The referral detail page is the second consumer, so the pattern moved here
// rather than being copy-pasted. RescheduleIcon / CancelIcon travel with it —
// the two are always used together and their colors are part of the meaning
// (gold = reversible, red = destructive).
//
// If you add a third consumer, import from here. Do not re-inline.

'use client'

import { useState } from 'react'

export const RESCHEDULE_COLOR = '#C9A84C'
export const CANCEL_COLOR = '#C0392B'

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        // Renders ABOVE the button. Any container holding this must not set
        // `overflow: hidden` or the bubble gets clipped to a dark sliver.
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)', background: '#1B2B4B', color: 'white',
          fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
          padding: '4px 8px', borderRadius: '5px', pointerEvents: 'none', zIndex: 10,
        }}>
          {label}
        </div>
      )}
    </div>
  )
}

export function IconBtn({ color, onClick, title, disabled, children }: {
  color: string
  onClick?: () => void
  title: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <Tooltip label={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '36px', height: '36px', borderRadius: '8px', display: 'flex',
          alignItems: 'center', justifyContent: 'center', color,
          background: hover && !disabled ? `${color}15` : 'transparent',
          border: 'none', cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1, flexShrink: 0, transition: 'background 0.12s',
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function RescheduleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

export function CancelIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
