// components/internal/CompactTimeline.tsx
//
// Extracted from app/dawson/agencies/[id]/page.tsx (staff-detail-reshape) so
// app/dawson/staff/[id]/page.tsx can render an identical timeline rather than
// a hand-copied one — the same reasoning lib/referrals/effective-date.ts's
// consolidation was built on: a second local copy is how two pages that are
// supposed to look the same start disagreeing.
//
// This component is rendering only. Segment content stays page-specific —
// the agency page's five segments (Created / Invited / Claimed / Approved
// or Rejected / Referrals live) and the staff page's four (Created /
// Invited / Claimed / Last login) mean different things and are built by
// each page's own function; this just draws whatever TimelineSegment[]
// it's handed.
//
// Compact inline timeline: dot + label + short date per segment, joined by
// small arrows to show progression. The earlier version drew a stepper —
// dots linked by full-width connecting rules, ~90px per segment, one wide
// row on its own line — which read fine but was wider than it needed to be
// and forced the timeline onto a line of its own below the controls. Rules
// carried no information a reader needs (adjacent-reached is implied by the
// dots themselves being filled), so those were dropped; arrows are a
// different, much cheaper mark that shows the same direction of travel
// without a full rule's width.
//
// Measured (Playwright, real fonts, real stylesheet, against this exact
// markup): five chips with short "Mon DD" dates and no arrows run 612px
// natural width; adding an arrow glyph in each of the four gaps between them
// pushes that to 660px — close to what the original full-date, no-arrow
// version needed (652px), same tradeoff the arrows were warned to risk.
// Below ~660px the row wraps via `flexWrap: wrap`; tested with arrows at
// 550/480/420/360px, each wraps cleanly to two lines (34px height, no
// scrollWidth overflow) with every chip and arrow staying intact — the same
// clean wrap the no-arrow version had, so the arrows were kept rather than
// dropped.

export type TimelineSegment = { label: string; reached: boolean; date: string | null; tone: 'teal' | 'red' }

export default function CompactTimeline({ segments }: { segments: TimelineSegment[] }) {
  const nodes: React.ReactNode[] = []
  segments.forEach((s, i) => {
    if (i > 0) {
      nodes.push(<span key={`arrow-${i}`} style={{ fontSize: '10px', color: '#D8DEE6' }}>→</span>)
    }
    nodes.push(
      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
          background: s.reached ? (s.tone === 'red' ? '#C0392B' : '#2A7F6F') : 'white',
          border: `1.5px solid ${s.reached ? (s.tone === 'red' ? '#C0392B' : '#2A7F6F') : '#D8DEE6'}`,
        }} />
        <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11.5px', color: s.reached ? '#1B2B4B' : '#B8C1CC' }}>
          {s.label}
        </span>
        <span style={{ fontSize: '11px', color: s.reached ? '#7A8899' : '#C7CFD7' }}>
          {s.reached ? (s.date ?? 'Reached') : 'Not yet'}
        </span>
      </div>
    )
  })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
      {nodes}
    </div>
  )
}
