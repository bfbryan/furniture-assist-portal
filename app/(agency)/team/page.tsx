// app/(agency)/team/page.tsx
// Agency admin team page — 5-section layout
// - Needs confirmation (Not Invited rows the admin hasn't confirmed yet)
// - Awaiting Claim  (Invited + Invite Sent)
// - Active Staff    (Active + Claimed, admins excluded — admin lives in header)
// - Inactive        (collapsed)
// - Not at this office (collapsed) — Membership Status = 'Not At This Office'
//
// Membership is a SEPARATE axis from the invite lifecycle: the buckets above
// are still driven by Status / Portal Invite Status. "Not at this office" is
// the one exception — those rows are pulled out into their own collapsed
// section (with Confirm as the undo) regardless of where their account
// lifecycle would otherwise place them. Nothing is server-side filtered any
// more; StaffList.classify() routes every row.
//
// Delegates the invite form to StaffList's modal-driven
// "+ Invite Staff Member" button.


import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById, getAgencyUsersByAgencyId } from '@/lib/airtable'
import { auth, clerkClient } from '@clerk/nextjs/server'
import StaffList from '@/components/agency/StaffList'


export default async function AdminPage() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) redirect('/sign-in')
  if (orgRole !== 'org:admin') redirect('/dashboard')


  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/dashboard')


  const agency = await getAgencyById(agencyUser.agencyId!)


  // Clerk memberships → last-sign-in for claimed users
  const client = await clerkClient()
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId!,
  })


  const clerkMembers = await Promise.all(
    memberships.data.map(async (m) => {
      const user = await client.users.getUser(m.publicUserData?.userId ?? '')
      return {
        clerkUserId: m.publicUserData?.userId ?? '',
        role: m.role,
        lastSignInAt: user.lastSignInAt,
      }
    })
  )


  // AT staff → source of truth for status, invite state, and identity.
  // Scoped by the agency RECORD ID, not the name — Agency Name is not unique
  // across offices of one organisation, so a name match rendered both offices'
  // rosters here with a live Send Invite button beside each.
  const atStaff = await getAgencyUsersByAgencyId(agency.id)


  // Every row goes through — StaffList.classify() decides the section, including
  // routing Membership Status = 'Not At This Office' into its own collapsed
  // group. The membership fields ride along on the spread below.
  const members = atStaff.map((staff: any) => {
    const clerkMember = clerkMembers.find(
      (c: any) => c.clerkUserId === staff.clerkUserId
    )
    return {
      ...staff,
      clerkRole: clerkMember?.role ?? 'org:member',
      lastSignInAt: clerkMember?.lastSignInAt ?? null,
    }
  })


  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      <main className="max-w-6xl mx-auto px-8 py-9">
        <StaffList
          members={members}
          currentUserId={userId}
          orgId={orgId!}
          agencyId={agencyUser.agencyId!}
          agencyName={agency.name}
          invitedByName={agencyUser.name}
          inviterEmail={agencyUser.email}
        />
      </main>
    </div>
  )
}
