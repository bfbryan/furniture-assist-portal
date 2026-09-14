// components/agency/ClientGuidelinesBrief.tsx
//
// The "What to tell your client" card on the agency Dashboard.
//
// Content is shared with the Help page (app/(agency)/help/page.tsx) via
// lib/content/client-guidelines.tsx — this card renders that module's
// `cardSummary` per point (verbatim sentences selected from the same
// approved copy the Help page shows in full), not a separate piece of
// writing. Update the wording in one place, not two.
//
// This is a deliberate SUBSET of a fuller Client Guidelines page planned
// later — see the shared module's own header for what "subset" means now
// that both surfaces exist.

import { CLIENT_GUIDELINES, CLIENT_GUIDELINES_INTRO } from '@/lib/content/client-guidelines'

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
  padding: '18px 20px',
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ position: 'relative', paddingLeft: '16px', fontSize: '13px', color: '#2C3A4A', lineHeight: 1.5 }}>
      <span style={{ position: 'absolute', left: 0, color: '#2A7F6F', fontWeight: 700 }}>•</span>
      {children}
    </li>
  )
}

export default function ClientGuidelinesBrief() {
  return (
    <section style={CARD}>
      <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#1B2B4B', margin: 0 }}>
        What to tell your client
      </h3>
      <p style={{ fontSize: '12.5px', color: '#7A8899', lineHeight: 1.5, margin: '6px 0 14px' }}>
        {CLIENT_GUIDELINES_INTRO}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {CLIENT_GUIDELINES.map(point => (
          <Bullet key={point.key}>{point.cardSummary}</Bullet>
        ))}
      </ul>
    </section>
  )
}
