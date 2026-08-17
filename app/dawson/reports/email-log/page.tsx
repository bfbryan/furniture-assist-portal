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
// Aug 2026: this page is now the ONLY planned home for that data. The
// per-client view of it used to sit on the client detail page (the Delivery
// Log block inside EmailHistoryCard) and was dropped at Ben's request for
// duplicating the milestone list beside it. Delivery outcome — bounced,
// withheld, failed — is therefore not visible anywhere in the portal until
// this page is built, which raises its priority rather than lowering it.
//
// Header chrome matches the other Dawson list pages so it does not read as a
// broken route.

export default function EmailLogReportPage() {
  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
            Email Log
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
            Coming soon
          </span>
        </div>
      </header>

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
