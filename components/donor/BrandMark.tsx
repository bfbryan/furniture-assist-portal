// components/donor/BrandMark.tsx
//
// The logo tile + wordmark, lifted from app/dawson/layout.tsx's own
// sidebar brand block — same image, same tile treatment, same wordmark
// color split. Not a new mark, the existing one, just not previously its
// own component (the Dawson sidebar and this are the only two places that
// needed it broken out; everywhere else that shows the logo shows only
// the logo, no wordmark, or is an email template with its own markup).
//
// Shared by both donor-checkin surfaces so their headers can't drift
// against each other the way two hand-copied versions eventually would.

export default function BrandMark({ size = 36 }: { size?: number }) {
  const imgSize = Math.round(size * (32 / 36))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: `${size}px`, height: `${size}px`, background: 'white', borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
      }}>
        <img
          src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
          alt="Furniture Assist"
          style={{ width: `${imgSize}px`, height: `${imgSize}px`, objectFit: 'contain' }}
        />
      </div>
      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: 'white', whiteSpace: 'nowrap' }}>
        Furniture <span style={{ color: '#3AA08D' }}>Assist</span>
      </div>
    </div>
  )
}
