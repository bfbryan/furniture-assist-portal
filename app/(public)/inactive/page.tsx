'use client'

import { useClerk } from '@clerk/nextjs'

export default function InactivePage() {
  const { signOut } = useClerk()

  return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-md p-12 max-w-md text-center">
        {/* Navy line glyph, same style as the portal's other icons — not an
            emoji: this page can be telling someone their access was revoked. */}
        <div className="flex justify-center mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="font-montserrat font-extrabold text-xl text-[#1B2B4B] mb-3">
          Account Inactive
        </h1>
        <p className="text-sm text-[#7A8899] leading-relaxed">
          This account doesn&rsquo;t currently have access to the portal. If you were
          signed in as someone else, sign out and try again. If you believe this is
          an error, contact us.
        </p>
        <a
          href="mailto:agencies@furnitureassist.com"
          className="inline-block mt-6 px-6 py-3 rounded-lg bg-[#1B2B4B] text-white font-montserrat font-bold text-sm"
        >
          Contact Furniture Assist
        </a>
        {/* Secondary — a text link, not a second button. Same sign-out as
            AgencyAvatarMenu (Clerk, redirect to /sign-in). */}
        <div className="mt-4">
          <button
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className="text-sm font-semibold text-[#2A7F6F] underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
