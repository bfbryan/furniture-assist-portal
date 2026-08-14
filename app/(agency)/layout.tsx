// app/(agency)/layout.tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'
import AgencyPortalShell from '@/components/agency/AgencyPortalShell'

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  // Not signed in
  if (!userId) redirect('/sign-in')

  // Signed in, but no Agency Users row is linked to this Clerk account yet.
  //
  // This used to redirect to /sign-in, which the middleware bounces straight
  // back to /redirect for anyone already signed in — so the person got a white
  // screen and an endless loop with nothing explaining it. /inactive is the
  // splash the very next check already uses for the closely related "linked to
  // no agency" case, and it names a person to contact.
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/inactive')

  // No linked agency
  if (!agencyUser.agencyId) redirect('/inactive')

  // Fetch agency to check status
  const agency = await getAgencyById(agencyUser.agencyId)

  // Agency inactive or rejected — bounce to inactive splash
  if (agency.status === 'Inactive' || agency.status === 'Rejected') {
    redirect('/inactive')
  }

  const isAdmin = agencyUser.role === 'Admin'

  return (
    <AgencyPortalShell
      agencyName={agency.name}
      userName={agencyUser.name || agencyUser.email}
      userRole={agencyUser.role}
      isAdmin={isAdmin}
    >
      {children}
    </AgencyPortalShell>
  )
}
