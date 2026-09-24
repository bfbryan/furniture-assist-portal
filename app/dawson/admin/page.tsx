// app/dawson/admin/page.tsx
//
// Admin landing page. Linked from the Overview section of the Dawson sidebar,
// under Dashboard, and shown only to Ben (isPortalAdmin).
//
// Exists because the sidebar had grown long enough to be hard to scan. It
// replaces an Admin section that listed Scan Upload and Email Log directly,
// and it takes on "Not at this office" (formerly "Flagged Wrong Agency"),
// which used to sit under Agencies. Ben asked for those three in one place.
//
// Deliberately plain: a labelled link and one line of description each, not a
// dashboard. Header chrome and card styling are copied from the other Dawson
// pages so it reads as one of them.
//
// Sep 2026 — it is no longer true that this page holds no data. The links
// above still hold none, but UntoldReschedules at the foot fetches and can act
// on real records. Ben's call, made knowingly: "booked, agency not told" is a
// system fault rather than scheduling work, so it does not belong on Dawson's
// Needs Action queue, where every other card is a decision he has to take.
// Putting it here makes it Ben's to act on, on the page only Ben opens. He has
// said he will redesign this page around it and the Email Log data later; this
// is the first thing on it that is not a link, not the shape it settles into.
//
// ON ACCESS. isPortalAdmin decides who sees the link, not who can open the
// page. Every route below is still behind requireDawsonAccess like the rest of
// the portal, so Dawson, Ray and Chase can reach "Not at this office" by URL
// exactly as they could before. That is unchanged on purpose: this was a nav
// change, and closing a route is a separate decision for Ben to make.

import Link from 'next/link'
import UntoldReschedules from '@/components/internal/UntoldReschedules'

const LINKS = [
  {
    href: '/dawson/staff/wrong-agency',
    label: 'Not at this office',
    description:
      'Staff an agency admin flagged as not working at their office. Their portal access and referral visibility are already revoked; ready to be moved to the right agency.',
  },
  {
    href: '/dawson/scans/upload',
    label: 'Scan Upload',
    description:
      'Upload the consolidated Saturday scan and let the portal read each referral slip.',
  },
  {
    href: '/dawson/reports/email-log',
    label: 'Email Log',
    description:
      'Every email the portal has sent, across all clients. Not built yet.',
  },
]

export default function DawsonAdminPage() {
  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <div style={{ padding: '28px 32px' }}>
        <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6, marginBottom: '16px', maxWidth: '760px' }}>
          Back-office screens, kept out of the main nav so the day-to-day
          scheduling job is not scrolling past them.
        </div>

        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', maxWidth: '760px', overflow: 'hidden' }}>
          {LINKS.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'block',
                padding: '18px 24px',
                textDecoration: 'none',
                borderTop: i === 0 ? 'none' : '1px solid #EDE9E1',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1B2B4B', marginBottom: '4px' }}>
                {link.label}
              </div>
              <div style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.5 }}>
                {link.description}
              </div>
            </Link>
          ))}
        </div>

        {/* Renders its heading even when empty — see the component's own note.
            This page is opened to check something, and a section that vanishes
            when there is nothing cannot be told apart from one that was never
            built. */}
        <UntoldReschedules />
      </div>
    </div>
  )
}
