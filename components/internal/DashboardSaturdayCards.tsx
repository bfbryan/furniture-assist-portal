'use client'

// components/internal/DashboardSaturdayCards.tsx
//
// The two right-hand cards on /dawson — Past 4 Saturdays and Next 4 Saturdays.
// Presentation only: app/dawson/page.tsx does every Airtable read and all the
// grouping/derivation server-side and hands these plain arrays.
//
// NOT SaturdayCapacityGrid. That grid's cells are clickable (they book a slot);
// these rows navigate to the Referrals list filtered to the Saturday, and the
// slot numbers are read-only context. Two look-alike grids with different click
// behaviour is exactly the confusion to avoid, so they share the endpoint
// (getSaturdaySchedule, via the page) and nothing else.
//
// A row navigates on click (useRouter). On the Next card the Print buttons are
// real <a>s inside that row, so they stopPropagation — the same pattern the
// Referrals list row uses.

import { useRouter } from 'next/navigation'

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const MUTED = '#7A8899'
const BORDER = '#EDE9E1'
const GOLD = '#C9A84C'
const RED = '#C0392B'

// The cards FILL their column now (no width: max-content) — both the same
// width, left and right edges aligned. The grid tracks below are sized to add
// up to that filled width, so the figures use the room rather than a spacer
// eating it.
const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '14px',
  border: `1px solid ${BORDER}`,
  boxShadow: '0 2px 8px rgba(27,43,75,0.05)',
  overflow: 'hidden',
}
const CARD_HEAD: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '18px 22px',
  borderBottom: `1px solid ${BORDER}`,
}
const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 800,
  fontSize: '16px',
  color: NAVY,
}
const EMPTY: React.CSSProperties = { padding: '16px 22px', fontSize: '14px', color: MUTED }

// Both cards are small tables: a header row, then one grid row per Saturday on
// the SAME column template, so a column reads straight down and four Saturdays
// compare at a glance.
//
//   Next:  date | 9 | 10 | 11 | 12 | 1 | total | print   (tracks fill the card)
//   Past:  date | completed                               (tracks sit left; the
//                                                          rest of the card is
//                                                          empty — No-show and
//                                                          Rate were removed
//                                                          because both decay
//                                                          when a no-show is
//                                                          rescheduled off the
//                                                          Saturday; Completed
//                                                          doesn't)
//
// DATE_COL is shared by both grids so the first data column starts at the same
// x. On Next the tracks sum (with GRID_GAP and the row padding) to the filled
// card width; on Past they don't — COMPLETED sits at its natural position and
// the card keeps its full width so its right edge lines up with Next 4 above.
const DATE_COL = '155px'
const NEXT_GRID = `${DATE_COL} repeat(5, 43px) 74px 118px`
// Same 152px track as a Next 4 count column, so the two stacked cards' first
// data column starts at the same x. Header + value both left-aligned in it —
// a centred label shifts when a count goes 1→2 digits; a fixed left edge is
// stable. The card keeps its full width; the space to the right stays empty.
const PAST_GRID = `${DATE_COL} 152px`
// The awaiting / "no appointments" message doesn't fit the 152px count track;
// its row swaps to date + one wide column instead. The counts row and the
// message row don't need the same tracks.
const PAST_MESSAGE_GRID = `${DATE_COL} 1fr`
const GRID_GAP = '12px'

const HEAD_ROW: React.CSSProperties = {
  display: 'grid',
  columnGap: GRID_GAP,
  alignItems: 'baseline',
  padding: '11px 22px 9px',
  borderBottom: `1px solid ${BORDER}`,
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '11px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: MUTED,
}
const ROW_GRID: React.CSSProperties = {
  display: 'grid',
  columnGap: GRID_GAP,
  alignItems: 'baseline',
  padding: '18px 22px',
  borderTop: `1px solid #F7F5F1`,
  cursor: 'pointer',
}
const DATE_LINK: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 800,
  fontSize: '17px',
  color: TEAL,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}
// A figure cell — Montserrat, left-aligned under its header (so "9" and
// "Completed" share a left edge across the two cards). Total / Rate override
// to the right.
const NUM: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 800,
  fontSize: '17px',
  textAlign: 'left',
}
const PRINT_LINK: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '13px',
  color: TEAL,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

function slotColor(booked: number, cap: number): string {
  if (cap > 0 && booked >= cap) return RED
  if (cap > 0 && booked >= cap * 0.8) return GOLD
  return NAVY
}

// ---------------------------------------------------------------- shared shapes

export type PastWeek = {
  date: string
  dateLabel: string
  /** true when the Saturday has passed but ≥1 referral is still 'Scheduled'
      with no outcome recorded — the same isAwaitingOutcome check the Referrals
      page uses. The count is withheld in this state (not shown as a zero). */
  awaiting: boolean
  /** Per-referral Appointment Status === 'Completed', grouped by Effective
      Appointment Date. Does not decay: a completed referral is never
      rescheduled. */
  completed: number
  /** true when no referral at all grouped to this Saturday. */
  empty: boolean
}

export type UpcomingWeek = {
  date: string
  dateLabel: string
  slots: { label: string; booked: number; cap: number }[]
  totalFilled: number
  totalCapacity: number
}

// ---------------------------------------------------------------- Past card

export function PastSaturdaysCard({ weeks }: { weeks: PastWeek[] }) {
  const router = useRouter()

  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <div style={CARD_TITLE}>Past 4 Saturdays</div>
      </div>

      {weeks.length === 0 ? (
        <div style={EMPTY}>No past Saturdays on the schedule.</div>
      ) : (
        <>
          <div style={{ ...HEAD_ROW, gridTemplateColumns: PAST_GRID }}>
            <span />
            <span>Completed</span>
          </div>

          {weeks.map(w => {
            const href = `/dawson/referrals?date=${w.date}`
            const isMessage = w.awaiting || w.empty
            return (
              <div
                key={w.date}
                onClick={() => router.push(href)}
                style={{
                  ...ROW_GRID,
                  gridTemplateColumns: isMessage ? PAST_MESSAGE_GRID : PAST_GRID,
                }}
              >
                <a href={href} onClick={e => e.stopPropagation()} style={DATE_LINK}>
                  {w.dateLabel}
                </a>

                {w.awaiting ? (
                  <span style={{ fontSize: '12px', color: GOLD, fontWeight: 700 }}>
                    Awaiting outcome — not scanned yet
                  </span>
                ) : w.empty ? (
                  <span style={{ fontSize: '12px', color: MUTED }}>No appointments</span>
                ) : (
                  <span style={{ ...NUM, color: NAVY }}>{w.completed}</span>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Next card

export function UpcomingSaturdaysCard({
  weeks,
  horizonNote,
}: {
  weeks: UpcomingWeek[]
  /** "Schedule published through Nov 28." — shown when fewer than 4 bookable
      Saturdays were found. */
  horizonNote: string | null
}) {
  const router = useRouter()

  // The attention line is NOT rendered here — the page places it in its own
  // grid-area row beneath this card, so it doesn't count toward the height the
  // left stat column stretches to match.
  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <div style={CARD_TITLE}>Next 4 Saturdays</div>
      </div>

      {weeks.length === 0 ? (
        <div style={EMPTY}>No upcoming Saturdays on the schedule.</div>
      ) : (
        <>
          {/* One meridiem marker at each end — the Saturday crosses noon once,
              so 9AM … 1PM resolves the middle three. Full labels won't fit the
              43px tracks; the tracks are sized to the counts, not the header.
              The print track (last) gets no header cell. */}
          <div style={{ ...HEAD_ROW, gridTemplateColumns: NEXT_GRID }}>
            <span />
            <span>9am</span>
            <span>10</span>
            <span>11</span>
            <span>12</span>
            <span>1pm</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>

          {weeks.map(w => {
            const href = `/dawson/referrals?date=${w.date}`
            const overCap = w.totalCapacity > 0 && w.totalFilled >= w.totalCapacity
            return (
              <div
                key={w.date}
                onClick={() => router.push(href)}
                style={{ ...ROW_GRID, gridTemplateColumns: NEXT_GRID }}
              >
                <a href={href} onClick={e => e.stopPropagation()} style={DATE_LINK}>
                  {w.dateLabel}
                </a>

                {w.slots.map(s => (
                  <span key={s.label} style={{ ...NUM, color: slotColor(s.booked, s.cap) }}>
                    {s.booked}
                  </span>
                ))}

                <span style={{ ...NUM, textAlign: 'right', color: overCap ? RED : NAVY }}>
                  {w.totalFilled}
                  <span style={{ color: MUTED, fontWeight: 400 }}>/{w.totalCapacity}</span>
                </span>

                <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'flex-end' }}>
                  <a href={`/print/roster/${w.date}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={PRINT_LINK}>
                    Roster
                  </a>
                  <span style={{ color: BORDER }}>·</span>
                  <a href={`/print/schedule/${w.date}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={PRINT_LINK}>
                    Sheets
                  </a>
                </span>
              </div>
            )
          })}
        </>
      )}

      {horizonNote && (
        <div style={{ padding: '10px 20px', fontSize: '11px', color: MUTED, borderTop: `1px solid #F7F5F1` }}>
          {horizonNote}
        </div>
      )}
    </div>
  )
}
