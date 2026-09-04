// app/not-found.tsx
//
// One root not-found for every unmatched URL, agency and Dawson alike. Route-
// group not-found files (app/(agency)/not-found.tsx etc.) only reliably catch
// notFound() calls from pages inside that group — not an arbitrary unknown URL,
// which belongs to no group — so partitioning by audience there doesn't work.
// Instead this resolves the "back" link server-side from the session.
//
// Reached only by a SIGNED-IN user: proxy.ts runs auth.protect() on non-public
// routes first, so an unknown URL while signed out bounces to sign-in before
// this ever renders. The signed-out branch below is defensive only.
//
// Renders in the ROOT layout, not the agency or Dawson shell — a not-found
// bubbles to the nearest boundary, which is here.

import { auth } from '@clerk/nextjs/server'
import { isDawsonPortalUser } from '@/lib/auth/dawson-access'

export default async function NotFound() {
  let href = '/'
  let label = 'Go to the portal'
  try {
    const { userId } = await auth()
    if (userId && isDawsonPortalUser(userId)) {
      href = '/dawson'
      label = 'Back to the Dawson portal'
    } else if (userId) {
      href = '/dashboard'
      label = 'Back to your dashboard'
    } else {
      href = '/sign-in'
      label = 'Go to sign in'
    }
  } catch {
    // auth() unavailable in this render context — '/' does its own routing.
  }

  return (
    <main className="min-h-screen bg-[#F7F5F1] flex flex-col items-center justify-center px-4 py-12 text-center">
      <img
        src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
        alt="Furniture Assist"
        className="w-16 h-16 object-contain mb-5"
      />
      <div className="font-montserrat font-extrabold text-2xl text-[#1B2B4B] mb-2">
        Page not found
      </div>
      <p className="text-sm text-[#7A8899] max-w-sm leading-relaxed mb-7">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <a
        href={href}
        className="px-6 py-3 rounded-lg bg-[#1B2B4B] text-white font-montserrat font-bold text-sm"
      >
        {label}
      </a>
    </main>
  )
}
