'use client'

// app/(public)/donor-checkin-unauthorized/page.tsx
//
// Where app/(donor)/layout.tsx sends a SIGNED-IN user who isn't a
// provisioned donor-checkin device — as opposed to redirect('/sign-in'),
// which is only correct for someone with no session at all. A signed-in
// visitor sent to /sign-in gets bounced by proxy.ts's own middleware
// (already-signed-in visits to /sign-in redirect to /redirect) straight
// into whatever THEIR identity's real home is — /dawson for a Dawson
// user, in the exact case that surfaced this. Landing on THIS page
// instead means the visitor sees why, rather than landing somewhere that
// looks like success.
//
// Same shape as app/(public)/inactive/page.tsx (that page's own shell,
// same "sign out and try again" affordance) but not the same page —
// /inactive's copy ("Account Inactive," an agencies@ contact) is about a
// revoked agency account, a different condition from "this Clerk
// identity was never a donor-checkin device to begin with." Reusing it
// verbatim would say the wrong thing.
//
// Deliberately doesn't name DONOR_CHECKIN_DEVICE_USER_IDS or any other
// implementation detail in the rendered copy — this is a real,
// reachable, public page, not a debug screen.

import { useClerk } from '@clerk/nextjs'

export default function DonorCheckinUnauthorizedPage() {
  const { signOut } = useClerk()

  return (
    <div style={{ minHeight: '100vh', background: '#F7F5F1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '48px', maxWidth: '420px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', margin: '0 0 12px' }}>
          Not a check-in device
        </h1>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.6, margin: 0 }}>
          This account isn&rsquo;t set up for donor check-in. If you were signed in
          as someone else, sign out and try again. If you think this is a
          mistake, contact Ben.
        </p>
        <a
          href="mailto:ben@furnitureassist.com"
          style={{
            display: 'inline-block', marginTop: '24px', padding: '12px 24px', borderRadius: '8px',
            background: '#1B2B4B', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700,
            fontSize: '14px', textDecoration: 'none',
          }}
        >
          Contact Ben
        </a>
        <div style={{ marginTop: '16px' }}>
          <button
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            style={{ background: 'none', border: 'none', fontSize: '14px', fontWeight: 600, color: '#2A7F6F', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
