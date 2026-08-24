// app/(agency)/referrals/history/page.tsx
// History — terminal referrals grouped by appointment week (newest first),
// plus a Rejected section (no appointment date). Includes search + filter chips.
//
// Admin: all agency referrals. Staff: only their own.

import { auth, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  getAgencyById,
  getReferralsByStaffName,
  getReferralsByAgencyId,
} from '@/lib/airtable'
import HistoryClient, { HistoryHeroStats, type Referral } from './HistoryClient'
import { StaffFilterProvider } from '@/components/agency/ActiveReferralsFilter'
import { cityStateZip } from '@/lib/address'

// Terminal statuses only.
//
// 'Withdrawn' has to be here. The Withdraw button writes Referral Review =
// 'Withdrawn', getPortalStatus returns it, and ReferralTable has no group for
// it — so the card rendered nowhere on Active, and without this line it never
// reached History either. One click made the referral disappear from the
// agency's portal completely. Nothing else in the app surfaces it.
function isTerminal(r: {
  referralReview: string
  appointmentStatus: string
}): boolean {
  if (r.referralReview === 'Rejected') return true
  if (r.referralReview === 'Withdrawn') return true
  if (r.appointmentStatus === 'Completed') return true
  if (r.appointmentStatus === 'Cancelled') return true
  if (r.appointmentStatus === 'No Show') return true
  return false
}

export default async function HistoryPage() {
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
  if (!agencyUser) {
    return (
      <main className="p-8">
        <p className="text-red-600">
          Your account is not linked to an agency yet. Please contact Furniture Assist.
        </p>
      </main>
    )
  }
  if (agencyUser.status === 'Inactive') redirect('/inactive')

  const agency = await getAgencyById(agencyUser.agencyId!)

  const allReferrals =
    agencyUser.role === 'Admin'
      ? await getReferralsByAgencyId(agency.name)
      : await getReferralsByStaffName(agency.name, agencyUser.name)

  const historyReferrals = allReferrals.filter(isTerminal) as Referral[]

  // The four hero KPI tiles used to be counted right here, across the whole
  // agency, while the "Filter by staff" dropdown inside HistoryClient filtered
  // the list in the browser - so picking a staff member changed the list and
  // left the numbers above it still. This is the same fix the Active page
  // already had: one StaffFilterProvider wrapping the hero AND the body, with
  // the tiles reading the filtered set. Tiles are HistoryHeroStats; the
  // fourth (Rejected) is still there for the same reason it was added, which
  // is that four tiles make an even 2x2 on a phone.
  return (
    <StaffFilterProvider referrals={historyReferrals}>
    <div className="min-h-screen bg-[#F7F5F1]">
      {/* Hero — same layout as Active/Dashboard */}
      <div className="bg-gradient-to-br from-[#1B2B4B] to-[#253F6A] border-b-4 border-[#2A7F6F] px-8 py-9">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">
          {/* Left — Agency + Staff info blocks */}
          <div className="flex gap-10 flex-wrap">
            <div>
              <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
                Agency Partner
              </span>
              <h1 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
                {agency.name}
              </h1>
              {/* Joined rather than interpolated — see the same block on
                  app/(agency)/referrals/active/page.tsx. */}
              <p className="text-sm text-white/50 font-light">
                {[[agency.address, agency.address2].filter(Boolean).join(', '),
                  cityStateZip(agency.city, agency.state, agency.zip)].filter(Boolean).join(', ')}
              </p>
              <p className="text-sm text-white/50 font-light">{agency.phone}</p>
            </div>

            <div
              style={{
                width: '1px',
                background: 'rgba(255,255,255,0.12)',
                alignSelf: 'stretch',
              }}
            />

            <div>
              <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
                Logged In As
              </span>
              <h2 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
                {agencyUser.name}
              </h2>
              <p className="text-sm text-white/50 font-light">
                {agencyUser.phone ?? 'No phone on file'}
              </p>
              <p className="text-sm text-white/50 font-light">{agencyUser.role}</p>
            </div>
          </div>

          {/* Right - KPI tiles. Same four, same order; they moved into a
              client component only so they can see the staff filter. */}
          <HistoryHeroStats />

        </div>
      </div>

      {/* Body — search + chips + week buckets */}
      <main className="max-w-6xl mx-auto px-8 py-9">
        <HistoryClient isAdmin={agencyUser.role === 'Admin'} />
      </main>
    </div>
    </StaffFilterProvider>
  )
}
