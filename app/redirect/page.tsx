import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const DAWSON_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj',
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM',
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg',
]

export default async function RedirectPage() {
  const { userId } = await auth()
  console.log('REDIRECT PAGE HIT - userId:', userId)
  console.log('IS DAWSON:', userId ? DAWSON_USER_IDS.includes(userId) : false)
  
  if (!userId) redirect('/sign-in')
  
  if (DAWSON_USER_IDS.includes(userId)) {
    redirect('/dawson')
  } else {
    redirect('/dashboard')
  }
}