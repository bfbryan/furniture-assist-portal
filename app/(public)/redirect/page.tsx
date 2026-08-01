// app/redirect/page.tsx

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, updateAgencyUserStatus } from '@/lib/airtable'
import { isDawsonPortalUser } from '@/lib/auth/dawson-access'

export default async function RedirectPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Dawson users go straight to /dawson
   if (isDawsonPortalUser(userId)) {
    redirect('/dawson')
  }

  // For agency users — check AT status and flip Pending → Active on first sign in
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (agencyUser && agencyUser.status === 'Pending') {
    await updateAgencyUserStatus(agencyUser.id, 'Active')
  }

  redirect('/dashboard')
}