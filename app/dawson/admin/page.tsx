// app/dawson/admin/page.tsx
//
// Admin landing page. Linked from the Overview section of the Dawson sidebar,
// under Dashboard, and shown only to Ben (isPortalAdmin).
//
// Exists because the sidebar had grown long enough to be hard to scan. It
// replaces an Admin section that listed Scan Upload and Email Log directly,
// and it takes on Flagged Wrong Agency, which used to sit under Agencies.
// Ben asked for those three in one place.
//
// Deliberately plain: a labelled link and one line of description each, not a
// dashboard. No counts, no data fetching, nothing that needs to stay in sync
// with the pages it points at. Header chrome and card styling are copied from
// the other Dawson pages so it reads as one of them.
//
// ON ACCESS. isPortalAdmin decides who sees the link, not who can open the
// page. Every route below is still behind requireDawsonAccess like the rest of
// the portal, so Dawson, Ray and Chase can reach Flagged Wrong Agency by URL
// exactly as they could before. That is unchanged on purpose: this was a nav
// change, and closing a route is a separate decision for Ben to make.

import Link from 'next/link'

const LINKS = [
  {
    href: '/dawson/staff/wrong-agency',
    label: 'Flagged Wrong Agency',
    description:
      'Staff an agency admin flagged as belonging somewhere else, ready to be moved to the right agency.',
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
      </div>
    </div>
  )
}
