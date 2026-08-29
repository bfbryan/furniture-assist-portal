// app/(agency)/referrals/active/page.tsx
// Active Referrals — Pending Review + Scheduling + Scheduled only.
// Admin sees all agency referrals with staff filter; staff see only their own.

import { auth, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  getAgencyById,
  getReferralsByStaffName,
  getReferralsByAgencyId,
} from '@/lib/airtable'
import ReferralTable from '@/components/agency/ReferralTable'
import { StaffFilterProvider } from '@/components/agency/ActiveReferralsFilter'
import { cityStateZip } from '@/lib/address'

// Active = not yet approved OR upcoming appointment.
// Excludes Completed, Cancelled, Rejected and No Show.
//
// No Show has to be excluded here to match isTerminal() on the History page,
// which already treats it as finished. While the two disagreed, a No Show was
// kept by this filter and then matched none of ReferralTable's seven status
// groups, so it rendered in no section at all — and the table's empty state
// tested the ungrouped array, so it did not fire either. An agency whose only
// remaining referrals were No Shows opened Active to a completely blank page.
// No Show is the largest bucket in the base by some way.
function isActive(r: {
  referralReview: string
  appointmentStatus: string
}): boolean {
  if (r.referralReview === 'Rejected') return false
  if (r.appointmentStatus === 'Completed') return false
  if (r.appointmentStatus === 'Cancelled') return false
  if (r.appointmentStatus === 'No Show') return false
  return true
}

export default async function ActiveReferralsPage() {
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

  const activeReferrals = allReferrals.filter(isActive)

  // StaffFilterProvider holds the active set + the staff filter; the table
  // (and its search) read from it. It used to also feed Pending / Scheduled
  // count tiles in the hero — those were removed (they duplicated the
  // dashboard and neither was actionable), which is what gives the navy
  // header back its height.
  return (
    <StaffFilterProvider referrals={activeReferrals}>
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1B2B4B] to-[#253F6A] border-b-4 border-[#2A7F6F] px-8 py-7">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">

          {/* Agency + Staff info blocks */}
          <div className="flex gap-10 flex-wrap">

            {/* Agency block */}
            <div>
              <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
                Agency Partner
              </span>
              <h1 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
                {agency.name}
              </h1>
              {/* Joined rather than interpolated. 75 of the 129 agencies queued
                  for onboarding have no City, and an agency with no address at
                  all rendered a line reading ", ," under its own name. This is
                  what lib/address.ts exists for; the other agency surfaces
                  already use it. */}
              <p className="text-sm text-white/50 font-light">
                {[[agency.address, agency.address2].filter(Boolean).join(', '),
                  cityStateZip(agency.city, agency.state, agency.zip)].filter(Boolean).join(', ')}
              </p>
              <p className="text-sm text-white/50 font-light">{agency.phone}</p>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.12)', alignSelf: 'stretch' }} />

            {/* Staff block */}
            <div>
              <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
                Logged In As
              </span>
              <h2 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
                {agencyUser.name}
              </h2>
              <p className="text-sm text-white/50 font-light">{agencyUser.phone ?? 'No phone on file'}</p>
              <p className="text-sm text-white/50 font-light">{agencyUser.role}</p>
            </div>

          </div>

        </div>
      </div>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-8 py-9">
        <ReferralTable isAdmin={agencyUser.role === 'Admin'} />
      </main>
    </div>
    </StaffFilterProvider>
  )
}
