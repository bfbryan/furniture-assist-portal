// components/agency/ClientGuidelinesBrief.tsx
//
// The "What to tell your client" card on the agency Dashboard.
//
// This is a deliberate SUBSET of a fuller Client Guidelines page planned
// later. It takes no props and owns its own content so that page (and any
// other surface) can render the same three points without a second copy —
// extract this component, don't duplicate the text.
//
// "See providers" links to the live Client Transportation page. The rework
// brief named https://furnitureassist.com/transportation, which 404s; the
// real path is /client-transportation/ — verified: the page is titled
// "Client Transportation" and carries "Transportation Partners / Available
// Transportation Providers".

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
      <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', margin: 0 }}>
        What to tell your client
      </h3>
      <p style={{ fontSize: '12.5px', color: '#7A8899', lineHeight: 1.5, margin: '6px 0 14px' }}>
        Clients are turned away for these more than anything else.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Bullet>
          They arrange their own transport — the vehicle must be there before they can enter.{' '}
          <a
            href="https://furnitureassist.com/client-transportation/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2A7F6F', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            See providers →
          </a>
        </Bullet>
        <Bullet>Only the client and one other person may enter. No young children.</Bullet>
        <Bullet>They bring their own rope, tarps and blankets, and take everything that day.</Bullet>
      </ul>
    </section>
  )
}
