// app/(agency)/profile/page.tsx
// Agency Profile.
// Two-column body: Agency Info + My Profile on the left, Primary Admin on the right.


import { auth, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import {
  getAgencyUserByClerkId,
  getAgencyById,
} from '@/lib/airtable'
import ProfileClient from './ProfileClient'


export default async function ProfilePage() {
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


  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      <main className="max-w-6xl mx-auto px-8 py-9">
        <ProfileClient
          agency={agency}
          agencyUser={agencyUser}
          isAdmin={agencyUser.role === 'Admin'}
        />
      </main>
    </div>
  )
}
