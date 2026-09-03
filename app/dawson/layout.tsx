import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isDawsonPortalUser, isPortalAdmin } from '@/lib/auth/dawson-access'
import DawsonPageBar from '@/components/internal/DawsonPageBar'
import NeedsActionBadge from '@/components/internal/NeedsActionBadge'

// Sep 2026: the rail is now a flat list, no section headers. OVERVIEW /
// REFERRALS / SCHEDULE stopped earning their place once Agencies collapsed to
// one item, Scheduled + History collapsed to one Referrals item, and SCHEDULE
// was left with a single child — a header over one item, or over a list that
// is already "the nav", labels nothing. The NAV_SECTION_LABEL style went with
// them. The agency rail KEEPS its REFERRALS header because it still has real
// sub-items under it; the two rails diverging here is intentional, not drift.

// One style for every rail link. Was eleven identical inline copies; now one
// constant so the next size change is a single edit. Sep 2026 step-up (Ben's
// override of the "left nav stays as it is" rule, noted in that PR): font
// 13.5px -> 15px, padding 9/12 -> 12/14, gap 10 -> 12, so a rail row clears a
// ~46px hit target. Weight stays 500 — density on Dawson's side comes from
// space, not weight.
const NAV_LINK: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '8px',
  color: 'rgba(255,255,255,0.6)',
  fontSize: '15px',
  fontWeight: 500,
  textDecoration: 'none',
}

export default async function DawsonLayout({
  children,
}: {
  children: React.ReactNode
}) {
    const { userId } = await auth()
  if (!isDawsonPortalUser(userId)) redirect('/sign-in')

  // Ben only. Dawson, Ray and Chase do not see the Admin link below.
  const showAdmin = isPortalAdmin(userId)

  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress ?? ''
  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email || 'User'
  const initials =
    ((user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '')).toUpperCase() ||
    (email[0] ?? 'U').toUpperCase()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: '240px', background: '#1B2B4B', minHeight: '100vh', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100, boxShadow: '4px 0 24px rgba(27,43,75,0.25)', display: 'flex', flexDirection: 'column' }}>

        {/* Brand */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <div style={{ width: '36px', height: '36px', background: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              <img src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg" alt="FA" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            </div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: 'white' }}>
              Furniture <span style={{ color: '#3AA08D' }}>Assist</span>
            </div>
          </div>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', paddingLeft: '48px' }}>
            Operations Portal
          </div>
        </div>

        {/* Nav — one flat list (Sep 2026; see the note by NAV_LINK). Order is
            Dashboard / Admin / Agencies / Needs action / Referrals / Add
            Referral / Saturday Schedule.

            Sep 2026: "Awaiting Review" replaced by "Needs action" — the queue
            it was became one of five cards on /dawson/needs-action. The count
            badge is a client island (NeedsActionBadge) so the server layout
            stays cheap.

            PHASED ROLLOUT (2026-07-06): only surface what Dawson needs. The
            one hidden item left (Statistics) is commented out below — the
            route still lives for admin use. Restoring a link does not change
            the page behind it; every Dawson page is gated on
            requireDawsonAccess regardless of whether the rail links to it. */}
        <nav style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '3px', overflowY: 'auto' }}>

          <a href="/dawson" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Dashboard
          </a>

          {/* Admin, Ben only, gated on isPortalAdmin exactly as the Admin
              section it replaces was. It sits directly under Dashboard because
              it is a way in to the back-office screens rather than a fifth nav
              category, and one link is shorter than the section it collapses,
              which is the point of the change.

              Nobody loses a screen to this: that section was already
              isPortalAdmin-only and held these same two pages. isPortalAdmin
              is presentation only (see lib/auth/dawson-access.ts), so the
              pages behind these links are still gated on requireDawsonAccess
              like the rest of the portal. Hiding a link does not close a
              route. */}
          {showAdmin && (
            <a href="/dawson/admin" style={NAV_LINK}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
              Admin
            </a>
          )}


          {/* Sep 2026: the four Agencies pages (Active / Pending Approval /
              Unclaimed / Inactive & Rejected) collapsed into one — same task
              on different records, so one screen with a status filter. This is
              now a lone top-level item, no section header, matching the
              proposal Ben approved.

              PENDING APPROVAL is deliberately not in the nav: it's a decision
              queue, not a browse list, and folds into a Needs Action page that
              isn't built yet. Until then /dawson/agencies/pending stays a
              working route with no link — reach it by URL. TEMPORARY; remove
              this note when Needs Action ships. */}
          <a href="/dawson/agencies" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Agencies
          </a>

          <a href="/dawson/needs-action" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            Needs action
            <NeedsActionBadge />
          </a>

          {/* Sep 2026: Scheduled + History collapsed into one Referrals lookup
              page. The two old routes 307-redirect to this one. */}
          <a href="/dawson/referrals" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
            Referrals
          </a>

          <a href="/dawson/referrals/new" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Referral
          </a>

          <a href="/dawson/schedule" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Saturday Schedule
          </a>

          {/* --- HIDDEN: Statistics (page not built yet). Restore as a flat
              item, like the rest of the rail —
          <a href="/dawson/reports" style={NAV_LINK}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Statistics
          </a>
          --- END HIDDEN --- */}

        </nav>

        {/* No footer. User identity and Sign out moved to the page bar's
            avatar menu (DawsonPageBar / DawsonAvatarMenu); the empty rail
            bottom is intentional, matching the agency side. The old
            sidebar-footer SignOutButton was removed — it was easy to miss and
            easy to hit by accident. */}

      </aside>

      <main style={{ marginLeft: '240px', flex: 1 }}>
        <DawsonPageBar fullName={fullName} email={email} initials={initials} />
        {children}
      </main>
    </div>
  )
}
