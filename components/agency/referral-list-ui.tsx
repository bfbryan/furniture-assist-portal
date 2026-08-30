'use client'

// components/agency/referral-list-ui.tsx
//
// The pieces the Active (ReferralTable) and History (HistoryClient) referral
// lists share, so the two pages stay one design and can't drift the way
// "Currently / Requested" vs "NOW / ASKED" once did:
//
//   • OverflowMenu — the ⋯ row-actions button and its dropdown
//   • ColumnHead   — the one label row per section
//   • the action icons and the MenuItem shape they fill
//   • MENU_SURFACE / MENU_ITEM — the dropdown chrome, also used by the header
//     avatar menu (AgencyAvatarMenu) so the portal has one menu style
//
// The ⋯ button's look lives in globals.css (.fa-active-menu-trigger): 32px
// box, #EDE9E1 hover fill, navy glyph on hover, 2px teal focus ring.

import { useEffect, useRef } from 'react'

// ---------------------------------------------------------------- menu chrome

/** The white dropdown panel. */
export const MENU_SURFACE: React.CSSProperties = {
  minWidth: '184px', background: 'white', border: '1px solid #EDE9E1',
  borderRadius: '8px', boxShadow: '0 8px 24px rgba(27,43,75,0.16)', padding: '4px',
}

/** One row inside it — spread `{ color }` per item. `.fa-active-menu-item`
 *  carries the hover fill (globals.css). */
export const MENU_ITEM: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
  padding: '8px 10px', borderRadius: '6px', border: 'none', background: 'transparent',
  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
  cursor: 'pointer', textDecoration: 'none', textAlign: 'left',
}

// ---------------------------------------------------------------- icons

export function Icon({ path, size = 15 }: { path: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {path}
    </svg>
  )
}

export const DOC_ICON = (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>)
export const RESCHEDULE_ICON = (<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>)
export const CANCEL_ICON = (<><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>)
export const WITHDRAW_ICON = (<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>)

// ---------------------------------------------------------------- menu

export type MenuItem = {
  label: string
  color: string
  icon: React.ReactNode
  href?: string
  onClick?: () => void
  divider?: boolean
}

// One ⋯ menu. The parent holds `open` so only one is open across a whole list;
// closes on outside click and Escape. `label` names the row for screen readers
// ("Actions for Jane Doe").
export function OverflowMenu({
  open, onOpen, onClose, items, label,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  items: MenuItem[]
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
        className="fa-active-menu-trigger"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
        </svg>
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, ...MENU_SURFACE }}>
          {items.map((it, i) => {
            const style: React.CSSProperties = {
              ...MENU_ITEM,
              color: it.color,
              ...(it.divider ? { borderTop: '1px solid #EDE9E1', marginTop: '4px', paddingTop: '10px' } : {}),
            }
            return it.href ? (
              <a key={i} className="fa-active-menu-item" href={it.href} target="_blank" rel="noreferrer"
                role="menuitem" onClick={onClose} style={style}>
                <Icon path={it.icon} />{it.label}
              </a>
            ) : (
              <button key={i} className="fa-active-menu-item" type="button" role="menuitem"
                onClick={() => { onClose(); it.onClick?.() }} style={style}>
                <Icon path={it.icon} />{it.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- column head

// Last in the visual hierarchy — the section heading and the row data both
// outrank it — so 10px, light weight, pale grey.
export const COL_HEADER: React.CSSProperties = {
  fontSize: '10px', fontWeight: 500, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#9AA6B2',
}

// The one label row a section carries. `className` selects the row grid:
// Active passes the default, History passes 'fa-history-row fa-history-row--head'.
// One trailing empty cell for the ⋯ column.
export function ColumnHead({
  columns,
  className = 'fa-active-row fa-active-row--head',
}: {
  columns: string[]
  className?: string
}) {
  return (
    <div className={className} style={{ padding: '6px 0' }}>
      {columns.map((c, i) => <div key={i} style={COL_HEADER}>{c}</div>)}
      <div />
    </div>
  )
}
