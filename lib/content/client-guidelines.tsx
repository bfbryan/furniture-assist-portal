// lib/content/client-guidelines.tsx
//
// The three "What to tell your client" points — single source for two
// surfaces:
//   • app/(agency)/help/page.tsx           — the Help page's open section,
//     full body text, one icon per point.
//   • components/agency/ClientGuidelinesBrief.tsx — the Dashboard card,
//     a condensed subset.
//
// `body` is Ben's approved copy (agency-faq-copy.md, Aug 2026) verbatim.
// `cardSummary` is NOT a separate piece of writing — it's exact sentences
// lifted from that same `body`, selected rather than reworded, so the two
// surfaces can disagree on how much of the text they show but never on the
// wording itself. See ClientGuidelinesBrief.tsx for which sentences and why.
//
// Icons are feather-style (stroke, 24x24 viewBox, currentColor) matching the
// rest of the portal's iconography. PeopleIcon reuses the exact path data
// from the sidebar's Team icon (components/agency/AgencyPortalShell.tsx) —
// same concept, one copy.

import type { ReactNode } from 'react'

export function TransportIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  )
}

export function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

export function PackageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

// One link, used by both the transport point's `body` and `cardSummary` —
// a component rather than two hand-typed copies, so they can't diverge
// again the way the Dashboard card and the Help page just did.
function ProvidersLink() {
  return (
    <a
      href="https://furnitureassist.com/client-transportation/"
      target="_blank"
      rel="noreferrer"
      style={{ color: '#2A7F6F', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      See providers →
    </a>
  )
}

export type ClientGuidelinePoint = {
  key: 'transport' | 'people' | 'supplies'
  icon: () => ReactNode
  heading: string
  body: ReactNode
  cardSummary: ReactNode
}

// Section intro on the Help page, directly above the three points.
export const CLIENT_GUIDELINES_INTRO =
  'A few things to go over before pickup day. Transport is the one that most often goes wrong.'

export const CLIENT_GUIDELINES: ClientGuidelinePoint[] = [
  {
    key: 'transport',
    icon: TransportIcon,
    heading: 'They need to arrange their own transportation',
    body: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          This is the most important thing to confirm before the appointment. The vehicle
          has to be at the warehouse for the pickup to go ahead — we don&apos;t deliver, and
          we can&apos;t hold furniture for a later date.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          A van or a pickup truck is usually needed; a car won&apos;t hold a bed frame or a
          sofa.
        </p>
        <p style={{ margin: 0 }}>
          It&apos;s worth asking your client specifically what vehicle they&apos;re bringing
          and who&apos;s driving, rather than whether they have a ride. <ProvidersLink />
        </p>
      </>
    ),
    cardSummary: (
      <>
        The vehicle has to be at the warehouse for the pickup to go ahead — we don&apos;t
        deliver, and we can&apos;t hold furniture for a later date. <ProvidersLink />
      </>
    ),
  },
  {
    key: 'people',
    icon: PeopleIcon,
    heading: 'Only the client and one other person may enter',
    body: (
      <p style={{ margin: 0 }}>
        No young children — the warehouse has moving equipment and heavy furniture.
      </p>
    ),
    cardSummary: (
      <>
        Only the client and one other person may enter. No young children — the warehouse
        has moving equipment and heavy furniture.
      </>
    ),
  },
  {
    key: 'supplies',
    icon: PackageIcon,
    heading: 'They bring their own rope, tarps and blankets',
    body: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          For securing and protecting furniture in the vehicle. We provide boxes and bags
          for kitchen items and clothing.
        </p>
        <p style={{ margin: 0 }}>Everything they&apos;re given goes with them that day.</p>
      </>
    ),
    cardSummary: (
      <>
        They bring their own rope, tarps and blankets. We provide boxes and bags for kitchen
        items and clothing. Everything they&apos;re given goes with them that day.
      </>
    ),
  },
]
