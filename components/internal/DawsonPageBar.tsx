'use client'

// components/internal/DawsonPageBar.tsx
//
// The slim navy bar at the top of every internal (Dawson) page, ported from
// the agency side's AgencyPageBar. Page title on the left (resolved from the
// pathname), account avatar menu on the right. Rendered once by
// app/dawson/layout.tsx inside <main>, so it replaces the per-page white
// <header> blocks the Dawson pages used to hand-roll.
//
// A COPY of the agency bar, not a shared component: AgencyPageBar hardcodes
// agency routes and a disabled New Referral button, and Dawson's type / hit
// areas step up. See the note in DawsonAvatarMenu.tsx.
//
// STICKY ON EVERY ROUTE, including the three record-detail pages
// (/dawson/agencies/[id], /dawson/referrals/[id], /dawson/staff/[id]). The bar
// carries identity and Sign out; if it scrolled away on one page type out of
// five, Dawson could lose his only way to sign out partway down a long record.
// So it stays pinned everywhere.
//
// The detail pages keep their own sticky sub-header (Back + record name +
// status + actions) as well — two pinned elements, the sub-header sitting
// directly below the bar. Those sub-headers offset their `top` by
// DAWSON_PAGE_BAR_HEIGHT (exported below) so they stick under the bar rather
// than colliding with it, and the bar's z-index sits above theirs.
//
// On the detail routes the bar names the *section* (plural, matching the nav)
// while the sub-header names the record. Both portals now work this way: the
// agency bar (AgencyPageBar / .fa-pagebar) is sticky on every route too, with
// its referral-detail sub-header offset below it by AGENCY_PAGE_BAR_HEIGHT.

import { usePathname } from 'next/navigation'
import DawsonAvatarMenu from './DawsonAvatarMenu'

// The bar's fixed height in px. Hardcoded (a layout height can't be derived in
// CSS), but kept as ONE constant: the bar sets its own minHeight from it, and
// the three [id] sub-headers import it for their sticky `top` offset, so the
// bar height and the offset cannot drift apart. With box-sizing: border-box
// (globals.css) this value already includes the 4px teal bottom rule.
export const DAWSON_PAGE_BAR_HEIGHT = 64

// Exact-match titles. Anything not here and not a detail route (below) gets an
// empty title — the bar still renders with the avatar, same as the agency bar.
const TITLES: Record<string, string> = {
  '/dawson': 'Operations Dashboard',
  '/dawson/admin': 'Admin',
  '/dawson/admin/import': 'Import Referrals',
  '/dawson/admin/import-agencies': 'Import Agencies',
  '/dawson/agencies': 'Agencies',
  '/dawson/needs-action': 'Needs action',
  // Sep 2026: active / unclaimed / inactive collapsed into /dawson/agencies
  // (308-redirect). /dawson/agencies/pending and /dawson/referrals/review both
  // folded into /dawson/needs-action (307-redirect) — their queues are two of
  // its five cards.
  '/dawson/referrals': 'Referrals',
  '/dawson/referrals/new': 'Add Referral',
  '/dawson/schedule': 'Saturday Schedule',
  '/dawson/reports/email-log': 'Email Log',
  '/dawson/scans/upload': 'Upload Saturday Scan',
  '/dawson/staff/wrong-agency': 'Flagged Wrong Agency',
}

// /dawson/agencies/<id>, /dawson/referrals/<id>, /dawson/staff/<id> — one path
// segment under the section, and NOT one of the named routes above. The bar
// names the section; the page's own sub-header names the record.
const DETAIL_SECTIONS: { re: RegExp; title: string }[] = [
  { re: /^\/dawson\/agencies\/[^/]+$/, title: 'Agencies' },
  { re: /^\/dawson\/referrals\/[^/]+$/, title: 'Referrals' },
  { re: /^\/dawson\/staff\/[^/]+$/, title: 'Staff' },
]

function detailSectionTitle(pathname: string): string | null {
  if (TITLES[pathname]) return null
  return DETAIL_SECTIONS.find(d => d.re.test(pathname))?.title ?? null
}

export default function DawsonPageBar({
  fullName,
  email,
  initials,
}: {
  fullName: string
  email: string
  initials: string
}) {
  const pathname = usePathname()
  // detailSectionTitle still drives the title on the [id] routes (plural
  // section name); it no longer changes the bar's position — the bar is sticky
  // everywhere now.
  const title = TITLES[pathname] ?? detailSectionTitle(pathname) ?? ''

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        minHeight: DAWSON_PAGE_BAR_HEIGHT,
        padding: '10px 32px',
        background: '#1B2B4B',
        borderBottom: '4px solid #2A7F6F',
        position: 'sticky',
        top: 0,
        // Above the detail pages' sub-headers (z-index 50), which stick
        // directly beneath this bar.
        zIndex: 60,
      }}
    >
      <span
        style={{
          color: 'white',
          fontFamily: 'var(--font-montserrat), sans-serif',
          fontSize: '17px',
          fontWeight: 600,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>

      <span style={{ flex: 1 }} />

      <DawsonAvatarMenu fullName={fullName} email={email} initials={initials} />
    </div>
  )
}
