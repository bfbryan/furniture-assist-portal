// app/dawson/page.tsx
//
// Dawson's Operations Dashboard.
//
// Rebuilt August 2026. It used to be four shortcut tiles and nothing else, so
// the first thing Dawson did every morning was click one of them to find out
// whether there was anything to do. Ben asked for the time-sensitive work to be
// on the page itself, with the shortcut icons moved to the right, and left the
// arrangement open ("or however you think it logically should sit on the
// page"). What it shows now, top to bottom, is what has a clock on it:
//
//   1. THE NEXT TWO APPOINTMENT SATURDAYS - per-hour appointment counts, and
//      the date itself opens that day's print roster in a new tab. This is the
//      only thing here that is about a fixed date in the near future, so it
//      leads.
//   2. AWAITING REVIEW - split into new referrals and reschedule requests,
//      because they are two different decisions (approve/reject vs. which
//      date), which is the same split /dawson/referrals/review makes.
//   3. AGENCIES PENDING APPROVAL - real work, but it waits without costing
//      anybody an appointment, so it sits last.
//
// The four shortcuts are unchanged in label, description, colour, icon and
// destination. They are a right-hand rail now instead of a 2x2 block filling
// the page, and each row carries its icon on the right.
//
// WIDTH. Dawson works on an iPad, and the Dawson shell's sidebar is a fixed
// 240px at every width, so the content area is 784px in landscape and 528px in
// portrait. Every grid on this page is either a single column or collapses to
// one through .fa-dawson-dash-grid / .fa-dawson-cols in globals.css, which use
// the project's existing 1280px breakpoint. Measured at 1440, 1024, 768 and
// 390; see the PR.
//
// EMPTY STATES. All three sections render whether or not they have anything in
// them. A missing section and an empty one look identical, and "nothing to
// review" is information Dawson wants rather than a reason to hide the card.

import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import {
  easternHour,
  easternTodayISO,
  formatDateOnly,
  differenceInDaysISO,
} from '@/lib/dates'
import { getSaturdaySchedule, getAllReferrals, getAllAgencies } from '@/lib/airtable'
import { TIME_ORDER } from '@/lib/schedule/capacity'
import DawsonPageControls from '@/components/internal/DawsonPageControls'

// The slices of getSaturdaySchedule / getAllReferrals / getAllAgencies this page
// reads. Structural rather than imported, so a change to one of those helpers
// shows up here as a type error instead of silently rendering blanks.
type Saturday = {
  id: string
  date: string
  status: string
  slots9am: number
  slots10am: number
  slots11am: number
  slots12pm: number
  slots1pm: number
  totalFilled: number
}

type PendingReferral = {
  id: string
  clientName: string
  referralDate: string | null
  appointmentDate: string | null
  appointmentStatus: string
  preferredDate: string | null
  referringAgency: string | null
}

type PendingAgency = {
  id: string
  name: string
  registrationDate: string | null
}

// How many rows each work list shows before it says "+N more". Enough to see
// the shape of the queue without turning the dashboard into the queue.
const MAX_ROWS = 5

// Ben asked for "the next two appointment weeks".
const WEEKS_AHEAD = 2

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const MUTED = '#7A8899'
const BORDER = '#EDE9E1'
const GOLD = '#C9A84C'
const BLUE = '#5B8DB8'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "Sat, Oct 3" */
function shortSaturday(iso: string): string {
  return formatDateOnly(iso, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Oct 3, 2026" */
function shortDate(iso: string | null): string {
  if (!iso) return '-'
  return formatDateOnly(iso.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Today", "Tomorrow", "in 12 days". */
function relativeDay(iso: string, todayISO: string): string {
  const days = differenceInDaysISO(todayISO, iso)
  if (days === null) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '14px',
  border: `1px solid ${BORDER}`,
  boxShadow: '0 2px 8px rgba(27,43,75,0.05)',
  overflow: 'hidden',
}

const CARD_HEAD: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '16px 20px',
  borderBottom: `1px solid ${BORDER}`,
}

const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 800,
  fontSize: '14px',
  color: NAVY,
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: MUTED,
}

const EMPTY: React.CSSProperties = {
  padding: '14px 20px',
  fontSize: '13px',
  color: MUTED,
}

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '10px 20px',
  borderBottom: `1px solid #F7F5F1`,
}

const ROW_LINK: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: TEAL,
  textDecoration: 'none',
  overflowWrap: 'anywhere',
}

const ROW_META: React.CSSProperties = {
  fontSize: '11px',
  color: MUTED,
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

const MORE: React.CSSProperties = {
  display: 'block',
  padding: '10px 20px',
  fontSize: '12px',
  fontWeight: 700,
  color: TEAL,
  textDecoration: 'none',
}

export default async function DawsonDashboard() {
  const user = await currentUser()
  const firstName = user?.firstName ?? ''
  // Eastern, not the runtime's clock: this renders on Vercel, where local time
  // is UTC, so after 8pm Eastern the greeting read "Good morning" and the date
  // line showed tomorrow.
  const greeting = greetingFor(easternHour())
  const todayISO = easternTodayISO()
  const dateStr = formatDateOnly(todayISO, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // In parallel: 41 Saturdays, new-referral requests (Review = 'Pending'),
  // reschedule requests (Appointment Status = 'Reschedule', regardless of
  // review), and the pending agencies. New referrals and reschedules are two
  // separate queries now — an agency reschedule request leaves the referral
  // 'Approved', so it no longer shows up under review = 'Pending'.
  const [schedule, pendingReview, rescheduleRequests, pendingAgencies] = await Promise.all([
    getSaturdaySchedule(),
    getAllReferrals({ review: 'Pending' }),
    getAllReferrals({ statuses: ['Reschedule'] }),
    getAllAgencies('Pending'),
  ])

  // The next two APPOINTMENT Saturdays. Blackouts are skipped rather than
  // counted: a blackout is a Saturday with no appointments on it, so showing
  // one would spend half of this card saying nothing is happening.
  const upcomingSaturdays = schedule
    .filter((s: Saturday) => {
      if (!s.date) return false
      if (s.status === 'Blackout') return false
      const diff = differenceInDaysISO(todayISO, s.date)
      return diff !== null && diff >= 0
    })
    .slice(0, WEEKS_AHEAD)

  // Two queries above. Belt and braces: keep any 'Reschedule'-status record out
  // of the new-referral list even if it somehow also matched review='Pending'.
  const newRequests = pendingReview.filter(
    (r: PendingReferral) => r.appointmentStatus !== 'Reschedule',
  )
  const awaitingReviewCount = newRequests.length + rescheduleRequests.length

  const actions = [
    {
      label: 'Add Referral',
      description: 'Create a new client referral',
      href: '/dawson/referrals/new',
      color: NAVY,
      bg: 'rgba(27,43,75,0.08)',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      ),
    },
    {
      label: 'Scheduled Referrals',
      description: 'View upcoming pickups',
      href: '/dawson/referrals/scheduled',
      color: TEAL,
      bg: 'rgba(42,127,111,0.1)',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
    },
    {
      label: 'Saturday Schedule',
      description: 'Appointments by time slot, print pickup sheets',
      href: '/dawson/schedule',
      color: BLUE,
      bg: 'rgba(91,141,184,0.12)',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      ),
    },
    {
      label: 'View History',
      description: 'Past referrals & appointments',
      href: '/dawson/referrals/history',
      color: MUTED,
      bg: 'rgba(122,136,153,0.14)',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

      <DawsonPageControls>
        <span style={{ fontSize: '12px', color: MUTED }}>{dateStr}</span>
      </DawsonPageControls>

      <div style={{ padding: '28px 32px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            fontFamily: 'var(--font-montserrat)', fontWeight: 800,
            fontSize: '26px', color: NAVY, lineHeight: 1.15,
          }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </div>
        </div>

        {/* Work on the left, shortcuts on the right. Below 1280px the rail
            drops under the work rather than squeezing beside it - see
            .fa-dawson-dash-grid in globals.css. */}
        <div
          className="fa-dawson-dash-grid"
          style={{ display: 'grid', gap: '20px', alignItems: 'start' }}
        >

          {/* ================= LEFT: the work ================= */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

            {/* ---------- 1. Next two Saturdays ---------- */}
            <div style={CARD}>
              <div style={CARD_HEAD}>
                <div style={CARD_TITLE}>Next {WEEKS_AHEAD} Saturdays</div>
                <Link href="/dawson/schedule" style={{ ...ROW_META, color: TEAL, fontWeight: 700, textDecoration: 'none' }}>
                  Saturday Schedule
                </Link>
              </div>

              {upcomingSaturdays.length === 0 ? (
                <div style={EMPTY}>No upcoming Saturdays on the schedule.</div>
              ) : (
                <div
                  className="fa-dawson-cols"
                  style={{ display: 'grid', gap: '1px', background: BORDER }}
                >
                  {upcomingSaturdays.map((sat: Saturday) => {
                    const counts: Array<[string, number]> = [
                      ['9am',  sat.slots9am],
                      ['10am', sat.slots10am],
                      ['11am', sat.slots11am],
                      ['12pm', sat.slots12pm],
                      ['1pm',  sat.slots1pm],
                    ]
                    // TIME_ORDER is the fill order the schedulers use; keeping
                    // the same order here means this reads like the Saturday
                    // Schedule page and the time-slot pills on Add Referral.
                    const ordered = TIME_ORDER.map(
                      t => counts.find(([label]) => label === t) ?? [t, 0],
                    ) as Array<[string, number]>

                    return (
                      <div key={sat.id} style={{ background: 'white', padding: '14px 20px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                          {/* The date IS the link to that day's roster, and it
                              opens in a new tab: Dawson prints the roster while
                              still working from the dashboard, and losing the
                              page he came from to a print view is the whole
                              reason he would not use it. */}
                          <a
                            href={`/print/roster/${sat.date}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open this day's print roster in a new tab"
                            style={{
                              fontFamily: 'var(--font-montserrat)',
                              fontWeight: 800,
                              fontSize: '15px',
                              color: TEAL,
                              textDecoration: 'none',
                            }}
                          >
                            {shortSaturday(sat.date)}
                          </a>
                          <span style={ROW_META}>{relativeDay(sat.date, todayISO)}</span>
                        </div>

                        <div style={{ marginTop: '10px' }}>
                          {ordered.map(([label, count]) => (
                            <div
                              key={label}
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: '10px',
                                padding: '5px 0',
                                borderBottom: '1px solid #F7F5F1',
                              }}
                            >
                              <span style={{ fontSize: '12.5px', color: '#2C3A4A' }}>{label}</span>
                              <span style={{
                                fontFamily: 'var(--font-montserrat)',
                                fontWeight: 800,
                                fontSize: '13px',
                                color: count > 0 ? NAVY : MUTED,
                              }}>
                                {count}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div style={{
                          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                          gap: '10px', padding: '9px 0 10px',
                        }}>
                          <span style={SECTION_LABEL}>Total</span>
                          <span style={{
                            fontFamily: 'var(--font-montserrat)', fontWeight: 800,
                            fontSize: '14px', color: NAVY,
                          }}>
                            {sat.totalFilled}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ---------- 2. Awaiting review ---------- */}
            <div style={CARD}>
              <div style={CARD_HEAD}>
                <div style={CARD_TITLE}>Awaiting review</div>
                <Link href="/dawson/referrals/review" style={{ ...ROW_META, color: TEAL, fontWeight: 700, textDecoration: 'none' }}>
                  {awaitingReviewCount} waiting
                </Link>
              </div>

              {/* New referrals */}
              <div style={{ padding: '12px 20px 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '3px', height: '12px', background: GOLD, borderRadius: '2px' }} />
                <span style={SECTION_LABEL}>New referrals</span>
                <span style={{ ...ROW_META, marginLeft: 'auto' }}>{newRequests.length}</span>
              </div>
              {newRequests.length === 0 ? (
                <div style={{ ...EMPTY, paddingTop: '2px' }}>Nothing new to review.</div>
              ) : (
                <>
                  {newRequests.slice(0, MAX_ROWS).map((r: PendingReferral) => (
                    <div key={r.id} style={ROW}>
                      <Link href={`/dawson/referrals/${r.id}`} style={ROW_LINK}>
                        {r.clientName || 'Unnamed client'}
                      </Link>
                      <span style={ROW_META}>{r.referringAgency || shortDate(r.referralDate)}</span>
                    </div>
                  ))}
                  {newRequests.length > MAX_ROWS && (
                    <Link href="/dawson/referrals/review" style={MORE}>
                      +{newRequests.length - MAX_ROWS} more
                    </Link>
                  )}
                </>
              )}

              {/* Reschedule requests */}
              <div style={{ padding: '12px 20px 6px', display: 'flex', alignItems: 'center', gap: '8px', borderTop: `1px solid ${BORDER}` }}>
                <span style={{ width: '3px', height: '12px', background: BLUE, borderRadius: '2px' }} />
                <span style={SECTION_LABEL}>Reschedule requests</span>
                <span style={{ ...ROW_META, marginLeft: 'auto' }}>{rescheduleRequests.length}</span>
              </div>
              {rescheduleRequests.length === 0 ? (
                <div style={{ ...EMPTY, paddingTop: '2px' }}>No reschedule requests.</div>
              ) : (
                <>
                  {rescheduleRequests.slice(0, MAX_ROWS).map((r: PendingReferral) => (
                    <div key={r.id} style={ROW}>
                      <Link href={`/dawson/referrals/${r.id}`} style={ROW_LINK}>
                        {r.clientName || 'Unnamed client'}
                      </Link>
                      {/* What they asked to move TO, which is the decision in
                          front of him. Falls back to the booked date. */}
                      <span style={ROW_META}>
                        {shortDate(r.preferredDate ?? r.appointmentDate)}
                      </span>
                    </div>
                  ))}
                  {rescheduleRequests.length > MAX_ROWS && (
                    <Link href="/dawson/referrals/review" style={MORE}>
                      +{rescheduleRequests.length - MAX_ROWS} more
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* ---------- 3. Agencies pending approval ---------- */}
            <div style={CARD}>
              <div style={CARD_HEAD}>
                <div style={CARD_TITLE}>Agencies pending approval</div>
                <Link href="/dawson/agencies/pending" style={{ ...ROW_META, color: TEAL, fontWeight: 700, textDecoration: 'none' }}>
                  {pendingAgencies.length} waiting
                </Link>
              </div>

              {pendingAgencies.length === 0 ? (
                <div style={EMPTY}>No agencies awaiting approval.</div>
              ) : (
                <>
                  {pendingAgencies.slice(0, MAX_ROWS).map((a: PendingAgency) => (
                    <div key={a.id} style={ROW}>
                      <Link href={`/dawson/agencies/${a.id}?from=pending`} style={ROW_LINK}>
                        {a.name}
                      </Link>
                      <span style={ROW_META}>{shortDate(a.registrationDate)}</span>
                    </div>
                  ))}
                  {pendingAgencies.length > MAX_ROWS && (
                    <Link href="/dawson/agencies/pending" style={MORE}>
                      +{pendingAgencies.length - MAX_ROWS} more
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ================= RIGHT: the shortcuts ================= */}
          <div style={{ ...CARD, minWidth: 0 }}>
            <div style={CARD_HEAD}>
              <div style={CARD_TITLE}>Quick actions</div>
            </div>
            {actions.map(action => (
              <Link
                key={action.label}
                href={action.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 20px',
                  borderBottom: '1px solid #F7F5F1',
                  textDecoration: 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-montserrat)', fontWeight: 700,
                    fontSize: '14px', color: NAVY, marginBottom: '2px',
                  }}>
                    {action.label}
                  </div>
                  <div style={{ fontSize: '12px', color: MUTED }}>
                    {action.description}
                  </div>
                </div>
                {/* Ben asked for the icons on the right. */}
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: action.bg, color: action.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {action.icon}
                </div>
              </Link>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
