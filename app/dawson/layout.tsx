import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const ALLOWED_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', //Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM', //Ray
]

export default async function DawsonLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) redirect('/sign-in')

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
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>

          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '12px 8px 6px' }}>Overview</div>

          <a href="/dawson" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Dashboard
          </a>

          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '12px 8px 6px' }}>Agencies</div>

<a href="/dawson/agencies/active" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  Active Agencies
</a>

<a href="/dawson/agencies/pending" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  Pending Approval
</a>

<a href="/dawson/agencies/inactive" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
  Inactive & Rejected
</a>

          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '12px 8px 6px' }}>Referrals</div>

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

          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '12px 8px 6px' }}>Schedule</div>

          <a href="/dawson/schedule" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Saturday Schedule
          </a>

          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '12px 8px 6px' }}>Reports</div>

          <a href="/dawson/reports" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Statistics
          </a>

        </nav>

        {/* Footer */}
        <div style={{ padding: '16px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px' }}>
            <div style={{ width: '32px', height: '32px', background: '#2A7F6F', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '12px', color: 'white', flexShrink: 0 }}>
              DY
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>Dawson Yeomans</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Administrator</div>
            </div>
          </div>
        </div>

      </aside>

      <main style={{ marginLeft: '240px', flex: 1 }}>
        {children}
      </main>
    </div>
  )
}