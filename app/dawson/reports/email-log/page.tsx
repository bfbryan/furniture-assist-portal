// app/dawson/reports/email-log/page.tsx
//
// PLACEHOLDER. Linked from the Admin section of the Dawson sidebar, which is
// Ben-only (see lib/auth/dawson-access.ts → isPortalAdmin).
//
// Deliberately empty for now: Ben asked for the nav entry to exist so the shape
// of the reporting section is visible, and for the report itself to come later.
// The data it will read already exists — the Email Log table in Airtable, one
// row per send with type, status, recipient, sent time and bounce reason, and
// /api/dawson/referrals/[id]/emails already serves it per referral.
//
// Aug 2026: the per-client view of that data still lives on the client detail
// page (the Delivery Log inside EmailHistoryCard), but it now shows only rows
// that are NOT a clean delivery — a Delivered row said the same thing as the
// milestone beside it. So bounced / failed / withheld are still visible per
// referral; what no view in the portal answers is the across-all-clients
// question ("did anything bounce this week"), which is this page's job.
//
// Ben is watching Resend directly in the meantime.
//
// The "Coming soon" pill (all that's left of this page's old header now that
// the title is in the shell bar) keeps it from reading as a broken route.

import DawsonPageControls from '@/components/internal/DawsonPageControls'

export default function EmailLogReportPage() {
  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <DawsonPageControls>
        <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
          Coming soon
        </span>
      </DawsonPageControls>

      <div style={{ padding: '28px 32px' }}>
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '60px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, maxWidth: '520px', margin: '0 auto' }}>
            This report is not built yet. Every email the portal sends is already
            being logged, and the send history for a single client shows on that
            client&apos;s detail page today.
          </div>
        </div>
      </div>
    </div>
  )
}
