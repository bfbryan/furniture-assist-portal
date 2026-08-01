
import { currentUser } from '@clerk/nextjs/server'

// PHASED ROLLOUT (2026-07-06): Simplified dashboard for Dawson's day-1 view.
// Only surfaces shortcuts for the 4 nav items he currently uses:
//   Scheduled, History, Add Referral, Saturday Schedule.
// Hidden (agency flow, awaiting review, stats grid) code preserved in git
// history — see prior version of this file. Restore each section as the
// corresponding phase ships.

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default async function DawsonDashboard() {
  const user = await currentUser()
  const firstName = user?.firstName ?? ''
  const now = new Date()
  const greeting = greetingFor(now.getHours())
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const actions = [
    {
      label: 'Scheduled Referrals',
      description: 'View upcoming pickups',
      href: '/dawson/referrals/scheduled',
      color: '#2A7F6F',
      bg: 'rgba(42,127,111,0.1)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
    },
    {
      label: 'Saturday Schedule',
      description: 'Appointments by time slot, print pickup sheets',
      href: '/dawson/schedule',
      color: '#5B8DB8',
      bg: 'rgba(91,141,184,0.12)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      ),
    },
    {
      label: 'Add Referral',
      description: 'Create a new client referral',
      href: '/dawson/referrals/new',
      color: '#1B2B4B',
      bg: 'rgba(27,43,75,0.08)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      ),
    },
    {
      label: 'View History',
      description: 'Past referrals & appointments',
      href: '/dawson/referrals/history',
      color: '#7A8899',
      bg: 'rgba(122,136,153,0.14)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h18v18H3z"/>
          <polyline points="3 9 21 9"/>
          <polyline points="3 15 21 15"/>
          <polyline points="9 3 9 21"/>
        </svg>
      ),
    },
  ]

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      {/* Top bar */}
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
          Operations Dashboard
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '12px', color: '#7A8899' }}>{dateStr}</span>
          
        </div>
      </header>

      <div style={{ padding: '48px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{
            fontFamily: 'var(--font-montserrat)', fontWeight: 800,
            fontSize: '32px', color: '#1B2B4B', lineHeight: 1.15,
            marginBottom: '8px',
          }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </div>
          <div style={{ fontSize: '14px', color: '#7A8899' }}>
            {dateStr}
          </div>
        </div>

        {/* Quick Actions — 2x2 grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '20px',
        }}>
          {actions.map(action => (
            <a
              key={action.label}
              href={action.href}
              style={{
                background: 'white',
                borderRadius: '14px',
                border: '1.5px solid #EDE9E1',
                boxShadow: '0 2px 8px rgba(27,43,75,0.05)',
                padding: '28px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: '56px', height: '56px', borderRadius: '12px',
                background: action.bg, color: action.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {action.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-montserrat)', fontWeight: 800,
                  fontSize: '16px', color: '#1B2B4B', marginBottom: '4px',
                }}>
                  {action.label}
                </div>
                <div style={{ fontSize: '13px', color: '#7A8899' }}>
                  {action.description}
                </div>
              </div>
            </a>
          ))}
        </div>

      </div>
    </div>
  )
}
