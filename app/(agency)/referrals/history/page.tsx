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
import HistoryClient, { type Referral } from './HistoryClient'
import { StaffFilterProvider } from '@/components/agency/ActiveReferralsFilter'

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

  // StaffFilterProvider wraps the body so the staff dropdown, the outcome-pill
  // counts and the list all read one selection. The navy hero that used to sit
  // here (KPI tiles + agency/user identity) was replaced by the shell's slim
  // page bar — see AgencyPortalShell / AgencyPageBar.
  return (
    <StaffFilterProvider referrals={historyReferrals}>
    <div className="min-h-screen bg-[#F7F5F1]">
      <main className="max-w-6xl mx-auto px-8 py-9">
        <HistoryClient isAdmin={agencyUser.role === 'Admin'} />
      </main>
    </div>
    </StaffFilterProvider>
  )
}
