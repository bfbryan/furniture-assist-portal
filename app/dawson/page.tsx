import { getDashboardStats } from '@/lib/airtable'
import { UserButton } from '@clerk/nextjs'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysSince(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function StatusPill({ review, status }: { review: string, status: string }) {
  const map: Record<string, { label: string, bg: string, color: string }> = {
    'Pending':          { label: 'Pending',    bg: 'rgba(201,168,76,0.15)',   color: '#C9A84C' },
    'Approved':         { label: 'Approved',   bg: 'rgba(42,127,111,0.12)',   color: '#2A7F6F' },
    'Rejected':         { label: 'Rejected',   bg: 'rgba(192,57,43,0.1)',     color: '#C0392B' },
    'Withdrawn':        { label: 'Withdrawn',  bg: '#F0F0F0',                 color: '#7A8899' },
    'Scheduled':        { label: 'Scheduled',  bg: 'rgba(42,127,111,0.12)',   color: '#2A7F6F' },
    'Pending Schedule': { label: 'Scheduling', bg: 'rgba(91,141,184,0.12)',   color: '#5B8DB8' },
    'Completed':        { label: 'Completed',  bg: 'rgba(27,43,75,0.08)',     color: '#1B2B4B' },
    'Cancelled':        { label: 'Cancelled',  bg: 'rgba(192,57,43,0.1)',     color: '#C0392B' },
  }
  const key = review === 'Pending' ? 'Pending' : status
  const s = map[key] ?? { label: key, bg: '#F0F0F0', color: '#7A8899' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '20px',
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  )
}

export default async function DawsonDashboard() {
  const stats = await getDashboardStats()

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
          <span style={{ fontSize: '12px', color: '#7A8899' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <a href="/dawson/referrals/new" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', background: '#2A7F6F', color: 'white',
            border: 'none', borderRadius: '7px', fontFamily: 'var(--font-montserrat)',
            fontWeight: 700, fontSize: '12px', cursor: 'pointer', textDecoration: 'none',
            letterSpacing: '0.03em',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Referral
          </a>
          <UserButton />
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>

          {/* Referrals this month */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', borderTop: '3px solid #2A7F6F' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '10px' }}>Referrals This Month</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '32px', color: '#1B2B4B', lineHeight: 1, marginBottom: '6px' }}>{stats.thisMonthReferrals}</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>
              <span style={{ color: '#2A7F6F', fontWeight: 700 }}>{stats.totalReferrals}</span> total all time
            </div>
          </div>

          {/* Awaiting review */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', borderTop: '3px solid #C9A84C' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '10px' }}>Awaiting Review</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '32px', color: '#1B2B4B', lineHeight: 1, marginBottom: '6px' }}>{stats.pendingReferrals}</div>
            <a href="/dawson/referrals?status=pending" style={{ fontSize: '12px', color: '#C9A84C', fontWeight: 700, textDecoration: 'none' }}>Review now →</a>
          </div>

          {/* Scheduled */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', borderTop: '3px solid #1B2B4B' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '10px' }}>Scheduled</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '32px', color: '#1B2B4B', lineHeight: 1, marginBottom: '6px' }}>{stats.scheduledReferrals}</div>
            <a href="/dawson/schedule" style={{ fontSize: '12px', color: '#5B8DB8', fontWeight: 700, textDecoration: 'none' }}>View schedule →</a>
          </div>

          {/* Agencies */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', borderTop: '3px solid #5B8DB8' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '10px' }}>Active Agencies</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '32px', color: '#1B2B4B', lineHeight: 1, marginBottom: '6px' }}>{stats.approvedAgencies}</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>
              <span style={{ color: '#C9A84C', fontWeight: 700 }}>{stats.pendingAgencies}</span> pending approval
            </div>
          </div>

        </div>

        {/* TWO COL */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', marginBottom: '20px' }}>

          {/* PENDING REFERRALS */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9A84C' }}></div>
                Awaiting Your Review
              </div>
              <a href="/dawson/referrals?review=pending" style={{ fontSize: '12px', fontWeight: 600, color: '#2A7F6F', textDecoration: 'none' }}>
                View all {stats.pendingReferrals} →
              </a>
            </div>

            {stats.recentReferrals.filter((r: any) => r.referralReview === 'Pending').length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px' }}>
                No referrals awaiting review 🎉
              </div>
            ) : (
              stats.recentReferrals.filter((r: any) => r.referralReview === 'Pending').map((r: any) => {
                const days = daysSince(r.referralDate)
                return (
                  <a key={r.id} href={`/dawson/referrals/${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none', cursor: 'pointer' }}
                    
                  >
                    <div style={{ width: '4px', height: '36px', borderRadius: '2px', background: '#C9A84C', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: '13px', color: '#1B2B4B' }}>{r.clientName}</div>
                      <div style={{ fontSize: '11px', color: '#7A8899' }}>{r.referringAgency} · {r.referredBy}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: days > 7 ? '#C0392B' : days > 4 ? '#C9A84C' : '#7A8899', fontWeight: days > 4 ? 700 : 400 }}>
                        {days}d ago
                      </div>
                      <div style={{ fontSize: '10px', color: '#7A8899' }}>{formatDate(r.referralDate)}</div>
                    </div>
                    <StatusPill review={r.referralReview} status={r.appointmentStatus} />
                  </a>
                )
              })
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ACTION ITEMS */}
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1' }}>
                <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C0392B' }}></div>
                  Action Items
                </div>
              </div>
              <div>
                {stats.pendingReferrals > 0 && (
                  <a href="/dawson/referrals?review=pending" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 20px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none', cursor: 'pointer' }}
                   
                  >
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#C0392B', flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B2B4B' }}>Review pending referrals</div>
                      <div style={{ fontSize: '11px', color: '#7A8899' }}>Awaiting your approval</div>
                    </div>
                    <div style={{ background: 'rgba(192,57,43,0.1)', color: '#C0392B', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
                      {stats.pendingReferrals}
                    </div>
                  </a>
                )}
                {stats.pendingAgencies > 0 && (
                  <a href="/dawson/agencies?status=pending" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 20px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none', cursor: 'pointer' }}
               
                  >
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#C9A84C', flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B2B4B' }}>Approve agency applications</div>
                      <div style={{ fontSize: '11px', color: '#7A8899' }}>New registrations awaiting review</div>
                    </div>
                    <div style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
                      {stats.pendingAgencies}
                    </div>
                  </a>
                )}
                {stats.pendingReferrals === 0 && stats.pendingAgencies === 0 && (
                  <div style={{ padding: '24px 20px', textAlign: 'center', color: '#7A8899', fontSize: '13px' }}>
                    All caught up! ✅
                  </div>
                )}
              </div>
            </div>

            {/* PENDING AGENCIES */}
            {stats.pendingAgencyList.length > 0 && (
              <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9A84C' }}></div>
                    Pending Agency Applications
                  </div>
                  <a href="/dawson/agencies?status=pending" style={{ fontSize: '12px', fontWeight: 600, color: '#2A7F6F', textDecoration: 'none' }}>View all →</a>
                </div>
                {stats.pendingAgencyList.map((agency: any) => {
                  const initials = agency.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
                  return (
                    <a key={agency.id} href={`/dawson/agencies/${agency.id}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 20px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none' }}
                      
                    >
                      <div style={{ width: '32px', height: '32px', background: '#1B2B4B', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '11px', color: '#3AA08D', flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B2B4B' }}>{agency.name}</div>
                        <div style={{ fontSize: '11px', color: '#7A8899' }}>{agency.city} · Applied {formatDate(agency.registrationDate)}</div>
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 9px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                        Pending
                      </span>
                    </a>
                  )
                })}
              </div>
            )}

          </div>
        </div>

        {/* QUICK ACTIONS */}
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDE9E1' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#1B2B4B' }}></div>
              Quick Actions
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', padding: '16px' }}>
            {[
              { label: 'Review Referrals', href: '/dawson/referrals?review=pending', icon: '✓', bg: 'rgba(42,127,111,0.1)', color: '#2A7F6F' },
              { label: 'Approve Agency', href: '/dawson/agencies?status=pending', icon: '🏠', bg: 'rgba(201,168,76,0.12)', color: '#C9A84C' },
              { label: 'Add Referral', href: '/dawson/referrals/new', icon: '+', bg: 'rgba(27,43,75,0.07)', color: '#1B2B4B' },
              { label: 'Saturday Schedule', href: '/dawson/schedule', icon: '📅', bg: 'rgba(91,141,184,0.12)', color: '#5B8DB8' },
            ].map(action => (
              <a key={action.label} href={action.href} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                padding: '16px 12px', borderRadius: '10px', border: '1.5px solid #EDE9E1',
                cursor: 'pointer', textDecoration: 'none', background: 'white', transition: 'all 0.15s',
              }}
                
              >
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: action.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                  {action.icon}
                </div>
                <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', color: '#1B2B4B', textAlign: 'center' }}>
                  {action.label}
                </span>
              </a>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
