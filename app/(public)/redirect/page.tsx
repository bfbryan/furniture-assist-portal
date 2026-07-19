// app/redirect/page.tsx

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, updateAgencyUserStatus } from '@/lib/airtable'

const DAWSON_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', // Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM',  // Ray
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg',  // Dawson
]

export default async function RedirectPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Dawson users go straight to /dawson
  if (DAWSON_USER_IDS.includes(userId)) {
    redirect('/dawson')
  }

  // For agency users — check AT status and flip Pending → Active on first sign in
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (agencyUser && agencyUser.status === 'Pending') {
    await updateAgencyUserStatus(agencyUser.id, 'Active')
  }

  redirect('/dashboard')
}