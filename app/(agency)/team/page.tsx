// app/(agency)/team/page.tsx
// Agency admin team page — 4-section layout
// - Ready to Invite to Portal (Unclaimed + Not Invited)
// - Awaiting Claim  (Invited + Invite Sent)
// - Active Staff    (Active + Claimed, admins excluded — admin lives in header)
// - Inactive        (collapsed)
// Hidden entirely: Portal Invite Status = Wrong Agency (server-side filter)
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


  // AT staff → source of truth for status, invite state, and identity
  const atStaff = await getAgencyUsersByAgencyId(agency.name)


  // Hide Wrong Agency rows entirely — Dawson handles them from his backend
  const visibleStaff = atStaff.filter(
    (s: any) => s.portalInviteStatus !== 'Wrong Agency'
  )


  const members = visibleStaff.map((staff: any) => {
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
