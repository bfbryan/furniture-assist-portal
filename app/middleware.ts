import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const DAWSON_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', // Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM',  // Ray
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg',  //Dawson
]

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/referrals/submit(.*)',
  '/inactive(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()
  const url = req.nextUrl.clone()

  // If signed in and hitting the root or sign-in page, redirect appropriately
  if (userId && (url.pathname === '/' || url.pathname === '/sign-in')) {
    url.pathname = '/redirect'
    return NextResponse.redirect(url)
}

  // Protect non-public routes
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
