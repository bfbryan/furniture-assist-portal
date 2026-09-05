// app/(agency)/dashboard/page.tsx
// Agency Dashboard — home page for the agency portal.
//
//   Left  (actionable):  the This Saturday count card on its own row, then the
//                        two gold "waiting on Furniture Assist" counts paired
//                        beneath it (Awaiting approval, Reschedules awaiting a
//                        new date), then the Last Saturday outcome card.
//   Right (reference):    an Announcement card + "What to tell your client".
//
// Quick Actions is gone — every item in it was one click away in the rail.
//
// Scope: Admin sees agency-wide counts, Staff sees only their own referrals.
// Scoped at the Airtable query (the same branch Active / History / Team use),
// not fetched-then-filtered.

import Link from 'next/link'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  getAgencyById,
  getReferralsByAgencyId,
  getReferralsByStaffName,
} from '@/lib/airtable'
import { easternTodayISO, addDaysISO, parseDateOnly, formatDateOnly } from '@/lib/dates'
import { clientAddressLine } from '@/lib/address'
import { effectiveAppointmentDate } from '@/lib/referrals/effective-date'
import { withinNoShowRescheduleWindow } from '@/lib/referrals/no-show-window'
import DashboardLastSaturday, { type LastSatRow } from '@/components/agency/DashboardLastSaturday'
import ClientGuidelinesBrief from '@/components/agency/ClientGuidelinesBrief'

// 'Scheduled' is included: a referral still on last Saturday with no outcome
// recorded yet (the scan runs Tuesday) is shown with an "Awaiting outcome"
// row rather than dropped, so the list length matches what the agency booked.
const LAST_SAT_STATUSES = ['Completed', 'No Show', 'Cancelled', 'Scheduled'] as const

// The subset of the list-view referral shape (lib/airtable/referrals.ts
// shapeReferralListItem, which is untyped) this page reads.
type ScopedReferral = {
  id: string
  clientName: string
  appointmentDate: string | null
  appointmentStatus: string
  referralReview: string
  clientReceiptUrl: string | null
  originalAppointmentDate: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

// ---------- count card ----------

function CountCard({ accent, count, line, href }: {
  accent: 'teal' | 'gold'
  count: number
  line: string
  href: string
}) {
  const bar = accent === 'teal' ? '#2A7F6F' : '#C9A84C'
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        borderLeft: `3px solid ${bar}`,
        padding: '18px 18px 18px 15px',
      }}
    >
      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '34px', color: '#1B2B4B', lineHeight: 1 }}>
        {count}
      </div>
      <div style={{ fontSize: '12.5px', color: '#7A8899', marginTop: '8px', lineHeight: 1.45 }}>
        {line}
      </div>
    </Link>
  )
}

// ---------- page ----------

export default async function DashboardPage() {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')

  if (orgId) {
    const client = await clerkClient()
    const org = await client.organizations.getOrganization({ organizationId: orgId })
    if (org.publicMetadata?.status === 'Inactive') redirect('/inactive')
  }

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/sign-in')
  if (agencyUser.status === 'Inactive') redirect('/inactive')

  const agency = await getAgencyById(agencyUser.agencyId!)
  const isAdmin = agencyUser.role === 'Admin'

  const scopedReferrals: ScopedReferral[] = isAdmin
    ? await getReferralsByAgencyId(agency.name)
    : await getReferralsByStaffName(agency.name, agencyUser.name)

  // One Eastern "today" for the whole render.
  const todayISO = easternTodayISO()
  const dow = parseDateOnly(todayISO)!.getUTCDay() // 0 Sun … 6 Sat

  // "This Saturday" is the next upcoming Saturday (today if today is Saturday).
  const nextSaturdayISO = addDaysISO(todayISO, (6 - dow + 7) % 7)
  // "Last Saturday" is the most recent PAST Saturday — on a Saturday itself the
  // day hasn't passed yet, so it's still the one a week back.
  const lastSaturdayISO = addDaysISO(todayISO, -(dow === 6 ? 7 : (dow + 1) % 7))

  const thisSatCount = scopedReferrals.filter(
    r => r.appointmentStatus === 'Scheduled' && r.appointmentDate === nextSaturdayISO,
  ).length

  const pendingCount = scopedReferrals.filter(r => r.referralReview === 'Pending').length

  // Reschedule requests the agency has sent and is waiting on a new Saturday
  // for. Keys on Appointment Status alone — the same predicate the Active
  // list's "Reschedule requested" group uses (components/agency/ReferralTable),
  // so this count and that group can't disagree. Scoped for free: it filters
  // the same role-scoped `scopedReferrals` a staff user only ever sees their own.
  const rescheduleCount = scopedReferrals.filter(
    r => r.appointmentStatus === 'Reschedule',
  ).length

  const lastSatRows: LastSatRow[] = scopedReferrals
    .filter(r =>
      effectiveAppointmentDate(r) === lastSaturdayISO &&
      (LAST_SAT_STATUSES as readonly string[]).includes(r.appointmentStatus),
    )
    .map(r => ({
      id: r.id,
      clientName: r.clientName || 'Unknown Client',
      addressLine: clientAddressLine(r),
      outcome: r.appointmentStatus as LastSatRow['outcome'],
      hasReceipt: !!r.clientReceiptUrl,
      receiptUrl: r.clientReceiptUrl,
      canReschedule:
        r.appointmentStatus === 'No Show' &&
        withinNoShowRescheduleWindow(r.appointmentDate, todayISO),
      note:
        r.appointmentStatus === 'Scheduled'
          ? 'Furniture Assist has not recorded this appointment yet.'
          : undefined,
    }))
    .sort((a, z) => a.clientName.localeCompare(z.clientName))

  const nextSatShort = formatDateOnly(nextSaturdayISO, { month: 'short', day: 'numeric' })
  const lastSatShort = formatDateOnly(lastSaturdayISO, { month: 'short', day: 'numeric' })

  // The counts already differ by role (query-level scoping above); the labels
  // say so, so a Staff user doesn't read their own number as the office total.
  const mine = isAdmin ? '' : 'your '
  // A plain noun phrase, not a sentence: the big numeral above it does the
  // counting, so at zero this reads "0 appointments this Saturday, Sep 12".
  // A self-contained label ("no appointments this Saturday") would put the
  // word "no" under the numeral "0" and state zero twice. Same shape as the
  // two gold cards' lines below.
  const thisSatLine = `${mine}appointment${thisSatCount === 1 ? '' : 's'} this Saturday, ${nextSatShort}`

  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      {/* Column tracks live in globals.css (.fa-dashboard-grid) so they stack below 1280px. */}
      <main
        className="fa-dashboard-grid max-w-7xl mx-auto px-8 py-9 grid gap-7"
        style={{ alignItems: 'start' }}
      >
        {/* ============ LEFT — actionable ============ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
          {/* Count cards — two rows. "This Saturday" is a confirmed, time-bound
              fact; the two gold cards both mean "waiting to hear back from
              Furniture Assist", so they're paired on the second row while the
              teal card sits apart above them. The teal card spans the full
              left-column width (a direct grid child, no column template); the
              gold pair (.fa-dash-counts, auto-fit) fills that same width as two
              cards and drops to 1-up below ~432px. So the teal card, the gold
              pair, and the Last Saturday card below all keep one left and right
              edge. */}
          <div style={{ display: 'grid', gap: '16px' }}>
            <CountCard accent="teal" count={thisSatCount} line={thisSatLine} href="/referrals/active" />
            <div className="fa-dash-counts" style={{ display: 'grid', gap: '16px' }}>
              <CountCard
                accent="gold"
                count={pendingCount}
                line={`${mine}referrals awaiting Furniture Assist approval`}
                href="/referrals/active"
              />
              <CountCard
                accent="gold"
                count={rescheduleCount}
                line={`${mine}reschedule request${rescheduleCount === 1 ? '' : 's'} awaiting a new date`}
                href="/referrals/active"
              />
            </div>
          </div>

          <DashboardLastSaturday
            rows={lastSatRows}
            dateLabel={lastSatShort}
            heading={isAdmin ? 'Last Saturday' : 'Your Last Saturday'}
          />
        </div>

        {/* ============ RIGHT — reference ============ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
          {/* PLACEHOLDER. Hardcoded until an Airtable "Announcements" table and a
              publish flow exist — then this reads the current row (label /
              heading / body / optional link) the way sendPortalAccountEmail
              reads Email Automations. Keep the shape: label, heading, one or
              two short paragraphs. */}
          <section
            style={{
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
              padding: '16px 18px 16px 15px',
              borderLeft: '3px solid #C9A84C',
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8B7724', marginBottom: '6px' }}>
              Announcement
            </div>
            <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '14px', color: '#1B2B4B', margin: '0 0 6px' }}>
              Welcome to the Furniture Assist Agency Portal
            </h3>
            <p style={{ fontSize: '13px', color: '#2C3A4A', lineHeight: 1.55, margin: 0 }}>
              Take a minute to check your agency details and{' '}
              <Link href="/profile" style={{ color: '#2A7F6F', fontWeight: 700, textDecoration: 'none' }}>
                your own profile
              </Link>{' '}
              are up to date.
              {isAdmin && (
                <>
                  {' '}If anyone on your team is missing, add them from the{' '}
                  <Link href="/team" style={{ color: '#2A7F6F', fontWeight: 700, textDecoration: 'none' }}>
                    Team page
                  </Link>
                  .
                </>
              )}
            </p>
          </section>

          <ClientGuidelinesBrief />
        </div>
      </main>
    </div>
  )
}
