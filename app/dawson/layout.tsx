import { auth, currentUser } from '@clerk/nextjs/server'
import { SignOutButton } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { isDawsonPortalUser, isPortalAdmin } from '@/lib/auth/dawson-access'

// Nav category labels — "Overview", "Agencies", "Referrals", "Schedule",
// "Admin". Ben asked for these a little larger so the grouping reads more
// clearly. He also has a standing rule that colour, font style, the left nav
// and the header stay as they are, so this is HIM overriding his own
// constraint, not a change made on his behalf; it is noted as such in the PR.
//
// Only the two size-related values move — 10px to 11.5px, and the tracking
// eased from 0.12em to 0.10em because letter-spacing that wide starts to
// separate the word at the larger size. Weight, colour, transform and padding
// are untouched, so the labels still read as labels and not as links.
//
// Six identical copies of this object were inline in the nav below (five live,
// one in the commented-out Reports block). They are now one constant, so the
// next size change is one edit rather than six.
const NAV_SECTION_LABEL: React.CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.3)',
  padding: '12px 8px 6px',
}

export default async function DawsonLayout({
  children,
}: {
  children: React.ReactNode
}) {
    const { userId } = await auth()
  if (!isDawsonPortalUser(userId)) redirect('/sign-in')

  // Ben only. Dawson, Ray and Chase do not see the Admin section below.
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

        {/* Nav */}
        {/*
          PHASED ROLLOUT (2026-07-06): only surface what Dawson needs day-1.
          Hidden nav sections below are commented out — pages/routes still live
          for admin (Ben) use. Uncomment blocks as each phase ships:
            - Overview → when Dashboard is built                     [SHIPPED]
            - Agencies (all 4) → when agency portal invites go out    [SHIPPED 2026-08-14]
            - Referrals → Awaiting Review → when agencies start
              submitting                                             [SHIPPED 2026-08-14]
            - Reports → Statistics → when Statistics page is built

          Restoring a link does not change the page behind it: the four agency
          pages and Awaiting Review have been live and reachable by URL the
          whole time, they simply had no way in from the sidebar.
        */}
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>

          
          <div style={NAV_SECTION_LABEL}>Overview</div>

          <a href="/dawson" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Dashboard
          </a>
          

          <div style={NAV_SECTION_LABEL}>Agencies</div>

{/* Order follows the lifecycle an agency actually moves through — Unclaimed,
    Pending Approval, Active, then Inactive & Rejected — rather than putting
    the busiest page first. Ben: "should follow the flow." Only the order
    changed; every link, icon and label is untouched. */}
<a href="/dawson/agencies/unclaimed" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
  Unclaimed
</a>

<a href="/dawson/agencies/pending" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  Pending Approval
</a>

<a href="/dawson/agencies/active" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  Active Agencies
</a>

<a href="/dawson/agencies/inactive" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
  Inactive & Rejected
</a>

{/* Staff an agency admin flagged as belonging elsewhere. Sits under Agencies
    rather than Admin because it is agency casework, not back-office tooling,
    and Dawson is the one who moves these people. */}
<a href="/dawson/staff/wrong-agency" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>
  Flagged Wrong Agency
</a>

          <div style={NAV_SECTION_LABEL}>Referrals</div>

<a href="/dawson/referrals/review" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  Awaiting Review
</a>

<a href="/dawson/referrals/scheduled" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  Scheduled
</a>

<a href="/dawson/referrals/history" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3z"/><polyline points="3 9 21 9"/><polyline points="3 15 21 15"/><polyline points="9 3 9 21"/></svg>
  History
</a>

<a href="/dawson/referrals/new" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  Add Referral
</a>

          <div style={NAV_SECTION_LABEL}>Schedule</div>

          <a href="/dawson/schedule" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Saturday Schedule
          </a>

          {/* Admin — Ben only, gated on isPortalAdmin. Everything in here is
              back-office tooling the day-to-day scheduling job never needs, so
              it stays off Dawson's sidebar rather than being one more thing to
              scroll past. */}
          {showAdmin && (
            <>
              <div style={NAV_SECTION_LABEL}>Admin</div>

              <a href="/dawson/scans/upload" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Scan Upload
              </a>

              <a href="/dawson/reports/email-log" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>
                Email Log
              </a>
            </>
          )}

          {/* --- HIDDEN: Reports (Statistics page not built yet) ---
          <div style={NAV_SECTION_LABEL}>Reports</div>

          <a href="/dawson/reports" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Statistics
          </a>
          --- END HIDDEN: Reports --- */}

        </nav>

                        {/* Footer — signed-in user; the whole row is the sign-out control */}
        <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <SignOutButton redirectUrl="/sign-in">
            <button
              title="Sign out"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(255,255,255,0.06)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ width: '32px', height: '32px', background: '#2A7F6F', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '12px', color: 'white', flexShrink: 0 }}>
                {initials}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fullName}
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {email}
                </div>
              </div>

              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </SignOutButton>
        </div>

      </aside>

      <main style={{ marginLeft: '240px', flex: 1 }}>
        {children}
      </main>
    </div>
  )
}
