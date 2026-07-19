// app/(agency)/layout.tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'
import AgencyPortalShell from '@/components/AgencyPortalShell'

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  // Not signed in
  if (!userId) redirect('/sign-in')

  // Not in Airtable Agency Users table
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/sign-in')

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
