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
// Sticky at top:0 on desktop (globals.css, >=1280) on every page EXCEPT the
// referral detail page: there its own sub-header carries Reschedule / Cancel /
// the status pill and is the more valuable thing to keep in view, so this bar
// gets .fa-pagebar--plain and returns to normal flow, leaving the sub-header as
// the single sticky element. Below 1280 this bar is never sticky — the shell's
// navy top bar is the one sticky header on a phone.
//
// Below 1280: the disabled New Referral button is hidden (globals.css) and the
// avatar slot is hidden — the mobile top bar carries the visible avatar.

import { usePathname } from 'next/navigation'
import AgencyAvatarMenu from './AgencyAvatarMenu'

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

// The referral detail page (/referrals/[id]) is the one page with its own
// sticky sub-header, so the page bar yields the top:0 slot to it there.
function isReferralDetail(pathname: string): boolean {
  return pathname.startsWith('/referrals/') && !TITLES[pathname]
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

  return (
    <div className={`fa-pagebar${isReferralDetail(pathname) ? ' fa-pagebar--plain' : ''}`}>
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
          it out of the tab order. All styling — including the display, so the
          below-1280 `display: none` can win — is in globals.css. */}
      <button type="button" className="fa-pagebar-newref" disabled title="New Referral — coming soon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Referral
      </button>

      <AgencyAvatarMenu userName={userName} agencyName={agencyName} className="fa-pagebar-avatar-slot" />
    </div>
  )
}
