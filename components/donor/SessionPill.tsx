// components/donor/SessionPill.tsx
//
// A passive status indicator, not a control — no Log Out anywhere on
// either donor-checkin surface (a kiosk; a volunteer tapping one strands
// the device until Ben reprovisions it, and screen pinning should make it
// unreachable regardless). This exists only to reassure whoever's nearby
// that the device is properly signed in and working — nothing tappable,
// no onClick, no cursor:pointer.

export default function SessionPill() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3AA08D', flexShrink: 0 }} />
      <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.6)' }}>
        Session active
      </span>
    </div>
  )
}
