'use client'

// components/internal/NeedsActionBadge.tsx
//
// The count pill on the "Needs action" nav item. Renders nothing until the
// count loads, and nothing when it's zero — an empty badge would read as "0
// things, but here's a badge anyway". Refetches on focus / tab-visible so it's
// current after Dawson acts on the page and comes back to the rail.
//
// Its own fetch (GET /api/dawson/needs-action/count) rather than a prop from
// the server layout: the layout wraps every Dawson page and must stay cheap.

import { useEffect, useState } from 'react'

export default function NeedsActionBadge() {
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/dawson/needs-action/count', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d && typeof d.total === 'number') setTotal(d.total)
        })
        .catch(() => {})
    }
    load()

    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!total) return null

  return (
    <span
      aria-label={`${total} item${total === 1 ? '' : 's'} need action`}
      style={{
        marginLeft: 'auto',
        minWidth: '20px',
        padding: '1px 6px',
        borderRadius: '10px',
        background: '#C9A84C',
        color: '#1B2B4B',
        fontFamily: 'var(--font-montserrat)',
        fontWeight: 800,
        fontSize: '11px',
        lineHeight: '18px',
        textAlign: 'center',
        flexShrink: 0,
      }}
    >
      {total}
    </span>
  )
}
