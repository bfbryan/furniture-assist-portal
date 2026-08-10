// app/(agency)/dashboard/page.tsx
// Agency Dashboard — home page for the agency portal.
// - Hero: universal AgencyPageHeader with stats (Total / Active / Completed)
// - Left: Upcoming Appointments grouped by Saturday (scheduled/pending, future dates only)
// - Right: Quick Actions
//
// Scope rules:
// - Admin: sees ALL agency referrals
// - Staff: sees only referrals they personally submitted (matches ReferralTable rule)


import Link from 'next/link'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  getAgencyById,
  getReferralsByAgencyId,
} from '@/lib/airtable'
import AgencyPageHeader from '@/components/agency/AgencyPageHeader'


// ---------- helpers ----------


// Airtable date-only fields come back as 'YYYY-MM-DD'. `new Date("YYYY-MM-DD")`
// parses as UTC midnight, which is the previous day in Eastern time.
// Parse the parts manually so the date stays in local time.
function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d))
}


function isTodayOrFuture(iso: string | null | undefined): boolean {
  const then = parseLocalDate(iso)
  if (!then) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return then.getTime() >= now.getTime()
}


function daysUntil(iso: string): number {
  const then = parseLocalDate(iso)
  if (!then) return 0
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((then.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}


function formatSaturday(iso: string): string {
  const d = parseLocalDate(iso)
  if (!d) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}


function statusPillClass(status: string | null): { bg: string; color: string; label: string } {
  const s = (status || '').toLowerCase()
  if (s === 'scheduled') return { bg: 'rgba(42,127,111,0.10)', color: '#2A7F6F', label: 'Scheduled' }
  if (s === 'reschedule') return { bg: 'rgba(74,144,201,0.12)', color: '#4A90C9', label: 'Rescheduling' }
  if (s === 'pending' || !status)
    return { bg: 'rgba(201,168,76,0.12)', color: '#8B7724', label: 'Pending' }
  return { bg: 'rgba(122,136,153,0.15)', color: '#2C3A4A', label: status }
}


function accentColor(status: string | null): string {
  const s = (status || '').toLowerCase()
  if (s === 'scheduled') return '#2A7F6F'
  if (s === 'reschedule') return '#4A90C9'
  return '#C9A84C'
}


// ---------- page ----------


export default async function DashboardPage() {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')


  if (orgId) {
    const client = await clerkClient()
    const org = await client.organizations.getOrganization({
      organizationId: orgId,
    })
    if (org.publicMetadata?.status === 'Inactive') {
      redirect('/inactive')
    }
  }


  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/sign-in')
  if (agencyUser.status === 'Inactive') redirect('/inactive')


  const agency = await getAgencyById(agencyUser.agencyId!)
  const isAdmin = agencyUser.role === 'Admin'


  // Pull agency referrals — filter to staff-owned if not admin
  const allReferrals = await getReferralsByAgencyId(agency.name)


  const scopedReferrals = isAdmin
    ? allReferrals
    : allReferrals.filter((r: any) => r.referredBy === agencyUser.name)


  // Stats — same shape as Profile/Active/History
  const totalCount = scopedReferrals.length
  const activeCount = scopedReferrals.filter((r: any) => {
    if (r.referralReview === 'Rejected') return false
    const s = r.appointmentStatus
    if (s === 'Completed' || s === 'Cancelled' || s === 'No Show') return false
    return true
  }).length
  const completedCount = scopedReferrals.filter(
    (r: any) => r.appointmentStatus === 'Completed'
  ).length


  // Upcoming appointments — future Saturdays, not cancelled/rejected/completed
  const upcoming = scopedReferrals
    .filter((r: any) => {
      if (r.referralReview === 'Rejected') return false
      const s = r.appointmentStatus
      if (s === 'Completed' || s === 'Cancelled' || s === 'No Show') return false
      return isTodayOrFuture(r.appointmentDate)
    })
    .sort((a: any, b: any) => {
      const ta = parseLocalDate(a.appointmentDate)?.getTime() ?? 0
      const tb = parseLocalDate(b.appointmentDate)?.getTime() ?? 0
      return ta - tb
    })


  // Group by Saturday date
  const groups = new Map<string, any[]>()
  for (const r of upcoming) {
    const key = r.appointmentDate as string
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  // Preserve chronological order
  const groupedList = Array.from(groups.entries()).slice(0, 4) // show at most next 4 Saturdays


  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      <AgencyPageHeader
        agencyName={agency.name}
        agencyAddress={agency.address}
        agencyAddress2={agency.address2}
        agencyCity={agency.city}
        agencyState={agency.state}
        agencyZip={agency.zip}
        agencyPhone={agency.phone}
        userName={agencyUser.name}
        userPhone={agencyUser.phone ?? 'No phone on file'}
        userRole={agencyUser.role}
        stats={[
          { label: 'Total', value: totalCount },
          { label: 'Active', value: activeCount, emphasized: true },
          { label: 'Completed', value: completedCount },
        ]}
      />


      <main
        className="max-w-7xl mx-auto px-8 py-9 grid gap-7"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px', alignItems: 'start' }}
      >
        {/* ============ LEFT: Upcoming Appointments ============ */}
        <div
          style={{
            background: 'white',
            borderRadius: '14px',
            boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
            padding: '22px 24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '14px',
              marginBottom: '18px',
              borderBottom: '1px solid #EDE9E1',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 800,
                fontSize: '15px',
                color: '#1B2B4B',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2A7F6F"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Upcoming Appointments
            </h2>
            <Link
              href="/referrals/active"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: '#2A7F6F',
                textDecoration: 'none',
              }}
            >
              View all →
            </Link>
          </div>


          {groupedList.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: '#7A8899',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-montserrat)',
                  fontWeight: 700,
                  fontSize: '14px',
                  color: '#1B2B4B',
                  marginBottom: '6px',
                }}
              >
                No upcoming appointments
              </div>
              <div>
                {isAdmin
                  ? 'When referrals are scheduled, they will appear here.'
                  : 'Your submitted referrals will appear here once scheduled.'}
              </div>
            </div>
          ) : (
            groupedList.map(([date, refs]) => {
              const days = daysUntil(date)
              const dayLabel =
                days === 0
                  ? 'Today'
                  : days === 1
                  ? 'Tomorrow'
                  : days < 0
                  ? `${Math.abs(days)} days ago`
                  : `${days} days away`


              return (
                <div key={date} style={{ marginBottom: '20px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '10px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-montserrat)',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: '#1B2B4B',
                      }}
                    >
                      {formatSaturday(date)}
                      <span
                        style={{
                          fontWeight: 500,
                          color: '#7A8899',
                          marginLeft: '6px',
                          fontSize: '13px',
                        }}
                      >
                        · {dayLabel}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        background: 'rgba(42,127,111,0.10)',
                        color: '#2A7F6F',
                        padding: '3px 8px',
                        borderRadius: '20px',
                      }}
                    >
                      {refs.length} {refs.length === 1 ? 'referral' : 'referrals'}
                    </span>
                  </div>


                  {refs.map((r: any) => {
                    const pill = statusPillClass(r.appointmentStatus)

                    // Defensive: try multiple field name shapes for name + address
                    const firstName =
                      r.clientFirstName ?? r.firstName ?? r.client_first_name ?? ''
                    const lastName =
                      r.clientLastName ?? r.lastName ?? r.client_last_name ?? ''
                    const fullName =
                      lastName && firstName
                        ? `${lastName}, ${firstName}`
                        : lastName || firstName || r.clientName || 'Unknown Client'

                    const address =
                      r.clientAddress ?? r.address ?? r.streetAddress ?? r.street ?? ''
                    const city = r.clientCity ?? r.city ?? ''
                    const state = r.clientState ?? r.state ?? ''
                    const zip = r.clientZip ?? r.zip ?? r.zipCode ?? r.postalCode ?? ''
                    const cityStateZip = [
                      [city, state].filter(Boolean).join(' '),
                      zip,
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <div
                        key={r.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '4px 1fr 90px 130px',
                          alignItems: 'center',
                          background: '#FBFAF7',
                          border: '1px solid #EDE9E1',
                          borderRadius: '10px',
                          marginBottom: '8px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            background: accentColor(r.appointmentStatus),
                            alignSelf: 'stretch',
                          }}
                        />
                        <div style={{ padding: '12px 14px', minWidth: 0 }}>
                          <Link
                            href={`/referrals/${r.id}`}
                            style={{
                              fontFamily: 'var(--font-montserrat)',
                              fontWeight: 700,
                              fontSize: '14px',
                              color: '#2A7F6F',
                              textDecoration: 'none',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: 'block',
                            }}
                            className="hover:underline"
                          >
                            {fullName}
                          </Link>
                          {(address || cityStateZip) && (
                            <div
                              style={{
                                fontSize: '11px',
                                color: '#7A8899',
                                marginTop: '3px',
                                lineHeight: '1.35',
                              }}
                            >
                              {address && (
                                <div
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {address}
                                </div>
                              )}
                              {cityStateZip && (
                                <div
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {cityStateZip}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-montserrat)',
                            fontWeight: 700,
                            fontSize: '13px',
                            color: '#1B2B4B',
                            textAlign: 'center',
                            paddingRight: '8px',
                          }}
                        >
                          {r.appointmentTime || '—'}
                        </div>
                        <div style={{ textAlign: 'center', paddingRight: '14px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: '20px',
                              fontSize: '10px',
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              background: pill.bg,
                              color: pill.color,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pill.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>


        {/* ============ RIGHT: Quick Actions ============ */}
        <div
          style={{
            background: 'white',
            borderRadius: '14px',
            boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
            padding: '22px 24px',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 800,
              fontSize: '15px',
              color: '#1B2B4B',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2A7F6F"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Quick Actions
          </h2>


          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {/* Submit New Referral — disabled/coming soon */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '10px',
                color: 'rgba(122,136,153,0.7)',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: 'not-allowed',
                background: 'rgba(42,127,111,0.05)',
                border: '1px solid rgba(42,127,111,0.15)',
              }}
              title="Coming soon"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(122,136,153,0.5)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Submit New Referral
              </div>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  background: 'rgba(122,136,153,0.15)',
                  color: '#7A8899',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                Soon
              </span>
            </div>


            <QuickActionLink
              href="/referrals/active"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
              label="View Active Referrals"
            />
            <QuickActionLink
              href="/referrals/history"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h18v18H3z" />
                  <polyline points="3 9 21 9" />
                  <polyline points="3 15 21 15" />
                  <polyline points="9 3 9 21" />
                </svg>
              }
              label="Referral History"
            />
            <QuickActionLink
              href="/profile"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              }
              label="Agency Profile"
            />
            {isAdmin && (
              <QuickActionLink
                href="/team"
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                }
                label="Team Management"
              />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}


// ---------- small inline component ----------


function QuickActionLink({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '10px',
        color: '#2C3A4A',
        fontSize: '13.5px',
        fontWeight: 600,
        textDecoration: 'none',
        border: '1px solid transparent',
        transition: 'background 0.15s',
      }}
      className="hover:bg-[#F7F5F1] hover:border-[#EDE9E1]"
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
        {label}
      </span>
      <span style={{ color: '#7A8899', fontSize: '16px' }}>›</span>
    </Link>
  )
}
