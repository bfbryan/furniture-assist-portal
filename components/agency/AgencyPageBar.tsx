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
// STICKY ON EVERY ROUTE (globals.css). This bar carries identity and Sign out,
// so it must not scroll away partway down any page — that once cost the user
// their only sign-out path on a long referral record. It matches the Dawson
// shell, which made the same change earlier.
//   - Desktop (>=1280): sticky at top: 0, z-index 50.
//   - Below 1280: sticky at top: 64px, directly under the shell's mobile top
//     bar (z-index 30, below that bar's 40). The New Referral button — either
//     state — and the avatar slot both hide there; the mobile top bar carries
//     the visible avatar and sign-out.
//
// The referral detail page has its own sub-header (Reschedule / Cancel / the
// status pill). On desktop it sticks at top: AGENCY_PAGE_BAR_HEIGHT, directly
// below this bar; below 1280 it is position: static and scrolls with the page.

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import AgencyAvatarMenu from './AgencyAvatarMenu'

// The bar's rendered desktop height in px. Mirrors `min-height: 60px` on
// .fa-pagebar in globals.css (box-sizing: border-box, so the 4px top/bottom
// borders are inside it; the flex content is shorter, so min-height governs).
// The referral detail sub-header imports this for its sticky `top` offset so
// the two heights can't drift — same arrangement as DAWSON_PAGE_BAR_HEIGHT.
// A CSS media query can't read a JS constant, so the below-1280 offset
// (top: 64px, under the mobile top bar) stays in globals.css; it isn't needed
// here because the sub-header is static at that width.
export const AGENCY_PAGE_BAR_HEIGHT = 60

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

export default function AgencyPageBar({
  userName,
  agencyName,
  canSubmitReferrals,
}: {
  userName: string
  agencyName: string
  canSubmitReferrals: boolean
}) {
  const pathname = usePathname()
  const title = titleFor(pathname)

  return (
    <div className="fa-pagebar">
      <span
        className="fa-pagebar-title"
        style={{ color: 'white', fontSize: '14.5px', fontWeight: 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {title}
      </span>

      <span style={{ flex: 1 }} />

      {/* Muted until the agency has access, filled teal primary once it does
          — canSubmitReferrals is the same composed flag the rail nav item
          gates on (AgencyPortalShell), threaded down from the layout. No
          SOON badge either way; the rail nav item already carries that
          signal. All layout — including the display, so the below-1280
          `display: none` can win — stays in globals.css; only the
          enabled/disabled modifier class differs. */}
      {canSubmitReferrals ? (
        <Link href="/referrals/new" className="fa-pagebar-newref fa-pagebar-newref--active">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Referral
        </Link>
      ) : (
        <button type="button" className="fa-pagebar-newref" disabled title="New Referral — coming soon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Referral
        </button>
      )}

      <AgencyAvatarMenu userName={userName} agencyName={agencyName} className="fa-pagebar-avatar-slot" />
    </div>
  )
}
