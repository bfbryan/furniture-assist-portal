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
import { isAwaitingOutcome } from '@/lib/referrals/no-show-window'

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

  // `awaitingOutcome`: Scheduled, but the appointment date has passed and no
  // outcome is recorded yet. Computed here (server, Eastern "today") with the
  // same helper the Dashboard and referral detail page use, so the client
  // table carries no date arithmetic and no hydration seam.
  const activeReferrals = allReferrals.filter(isActive).map(
    (r: { appointmentStatus: string; appointmentDate: string | null }) => ({
      ...r,
      awaitingOutcome: isAwaitingOutcome(r.appointmentStatus, r.appointmentDate),
    }),
  )

  // StaffFilterProvider holds the active set + the staff filter; the table
  // (and its search) read from it. The navy hero that used to sit here was
  // replaced by the shell's slim page bar — see AgencyPortalShell / AgencyPageBar.
  return (
    <StaffFilterProvider referrals={activeReferrals}>
    <div className="min-h-screen bg-[#F7F5F1]">
      <main className="max-w-6xl mx-auto px-8 py-9">
        <ReferralTable isAdmin={agencyUser.role === 'Admin'} />
      </main>
    </div>
    </StaffFilterProvider>
  )
}
