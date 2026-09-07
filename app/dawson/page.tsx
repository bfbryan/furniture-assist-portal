// app/dawson/page.tsx
//
// Dawson's Operations Dashboard — his landing page.
//
// Rebuilt September 2026. The August build was three work lists (Awaiting
// review, reschedule requests, pending agencies) plus a Next-2-Saturdays card
// and a Quick Actions rail. This drops all of that:
//
//   • Quick Actions        — every target is one click away in the left nav.
//   • The read-only work lists — replaced by three COUNT cards. The number
//     tells Dawson what KIND of work is waiting before he clicks through to
//     Needs Action, which already shows the same rows in priority order.
//   • Next 2 Saturdays     — widened to Next 4, with per-slot counts, a total
//     against capacity, print buttons, and one attention line beneath.
//
// LAYOUT. Two columns (.fa-dawson-dash-grid): a 320px stack of four stat
// cards on the left, the two Saturday cards on the right. Wrapper capped at
// 1100px and centred, matching the Agencies and Referrals pages. Stacks to one
// column below 1280 (the Dawson shell keeps its 240px sidebar at every width).
//
// DATA. One Promise.all, server-side. Measured against the live base: batch
// wall ~0.9s typical, ~1.3s on a cold/contended hit. The long pole is the
// past-60-days referral read (~350 rows, ~830KB in the full list shape); if
// that latency ever bites, the levers are a shorter window or a field-trimmed
// fetch for this one query.
//   • getSaturdaySchedule()          — both Saturday cards
//   • getNeedsActionCounts()         — the three review stat cards; shared with
//                                      the nav badge route so they can't drift
//   • getAllReferrals(cancelled, cancellationFrom = today-7)  — the fourth card
//   • getAllReferrals(Completed/No Show/Scheduled, effective date in the last
//     60 days) — grouped here by Saturday for the Past-4 card. Bounded
//     server-side on {Effective Appointment Date}; the grouping is over that
//     bounded slice, the same shape the search work settled on.

import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import {
  easternHour,
  easternTodayISO,
  formatDateOnly,
  addDaysISO,
  differenceInDaysISO,
} from '@/lib/dates'
import {
  getSaturdaySchedule,
  getAllReferrals,
  type SaturdayScheduleRow,
} from '@/lib/airtable'
import { getNeedsActionCounts } from '@/lib/dawson/needs-action-counts'
import { isAwaitingOutcome } from '@/lib/referrals/no-show-window'
import { selectBookableWindow, type SaturdayGridRow } from '@/lib/schedule/grid'
import { TIME_ORDER, TIME_CAPS, type TimeSlot } from '@/lib/schedule/capacity'
import DawsonPageControls from '@/components/internal/DawsonPageControls'
import {
  PastSaturdaysCard,
  UpcomingSaturdaysCard,
  type PastWeek,
  type UpcomingWeek,
} from '@/components/internal/DashboardSaturdayCards'

const NAVY = '#1B2B4B'
const MUTED = '#7A8899'
const BORDER = '#EDE9E1'
const GOLD = '#C9A84C'

// How full a Saturday "should" be by the time it is this many weeks out. The
// attention line names the SOONEST upcoming Saturday that falls short — a flat
// threshold would treat "empty at 4 weeks" (normal) like "empty at 1 week" (a
// problem). Silent when nothing qualifies: a line that always fires isn't a
// signal. Starting values; retune against a few real weeks.
const ATTENTION_TARGET: Record<number, number> = { 1: 0.8, 2: 0.6, 3: 0.35, 4: 0.15 }

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "Sat, Oct 3" */
function shortSat(iso: string): string {
  return formatDateOnly(iso, { weekday: 'short', month: 'short', day: 'numeric' })
}

// getSaturdaySchedule's row -> the shape selectBookableWindow (the shared
// "N bookable Saturdays, blackouts struck but not counted" walk) expects. Only
// date/status drive the walk; the slot map carries the per-hour counts through
// for rendering. soft/current are grid-only concerns, zeroed here.
function toGridRow(s: SaturdayScheduleRow): SaturdayGridRow {
  const flat: Record<TimeSlot, number> = {
    '9am': s.slots9am,
    '10am': s.slots10am,
    '11am': s.slots11am,
    '12pm': s.slots12pm,
    '1pm': s.slots1pm,
  }
  const slots = {} as SaturdayGridRow['slots']
  for (const t of TIME_ORDER) {
    slots[t] = { booked: flat[t] ?? 0, cap: TIME_CAPS[t], soft: 0, current: false }
  }
  return {
    id: s.id,
    date: String(s.date).slice(0, 10),
    status: s.status,
    totalCapacity: s.totalCapacity,
    totalFilled: s.totalFilled,
    slotsRemaining: s.slotsRemaining,
    slots,
  }
}

function pickAttention(
  weeks: { date: string; totalFilled: number; totalCapacity: number }[],
  todayISO: string,
): string | null {
  let best: { date: string; weeksOut: number; fill: number; filled: number } | null = null
  for (const w of weeks) {
    if (w.totalCapacity <= 0) continue
    const days = differenceInDaysISO(todayISO, w.date)
    if (days === null || days < 0) continue
    const weeksOut = Math.max(1, Math.ceil(days / 7))
    const target = ATTENTION_TARGET[weeksOut] ?? ATTENTION_TARGET[4]
    const fill = w.totalFilled / w.totalCapacity
    if (fill >= target) continue
    if (
      !best ||
      weeksOut < best.weeksOut ||
      (weeksOut === best.weeksOut && fill < best.fill)
    ) {
      best = { date: w.date, weeksOut, fill, filled: w.totalFilled }
    }
  }
  if (!best) return null
  const label = formatDateOnly(best.date, { month: 'short', day: 'numeric' })
  const wk = best.weeksOut === 1 ? '1 week' : `${best.weeksOut} weeks`
  const tail = best.filled === 0 ? 'empty' : `only ${best.filled} booked`
  return `${label} is ${wk} out and ${tail}.`
}

const STAT_CARD: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  background: 'white',
  borderRadius: '14px',
  border: `1px solid ${BORDER}`,
  boxShadow: '0 2px 8px rgba(27,43,75,0.05)',
  padding: '18px 20px',
}

export default async function DawsonDashboard() {
  const todayISO = easternTodayISO()

  const [user, schedule, counts, cancelledRecent, pastRows] = await Promise.all([
    currentUser(),
    getSaturdaySchedule(),
    getNeedsActionCounts(todayISO),
    getAllReferrals({ statuses: ['Cancelled'], cancellationFrom: addDaysISO(todayISO, -7) }),
    getAllReferrals({
      statuses: ['Completed', 'No Show', 'Scheduled'],
      appointmentDateFrom: addDaysISO(todayISO, -60),
      appointmentDateTo: todayISO,
    }),
  ])

  const firstName = user?.firstName ?? ''
  const greeting = greetingFor(easternHour())
  const dateStr = formatDateOnly(todayISO, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  // ---- LEFT: four stat cards. The first three go plainly to Needs Action
  // (no anchors) — its cards are short and already priority-ordered; three
  // counts still earn their place by naming the kind of work first. The
  // cancelled card is the Phase-1 signal: cancellations coming through the
  // portal instead of dying in an inbox.
  const statCards = [
    { label: 'Reschedules to review', value: counts.reschedule, gold: true, href: '/dawson/needs-action' },
    { label: 'New referrals to review', value: counts.newReferrals, gold: true, href: '/dawson/needs-action' },
    { label: 'Agencies to review', value: counts.agencies, gold: true, href: '/dawson/needs-action' },
    {
      label: 'Cancelled, last 7 days',
      value: cancelledRecent.length,
      gold: false,
      href: '/dawson/referrals?pill=cancelled&range=7d',
    },
  ]

  // ---- RIGHT: Past 4 Saturdays, oldest → newest (same direction as Next 4).
  //
  // Only Completed is shown. No-show and show-rate were removed because both
  // decay: rescheduling a no-show overwrites its status to 'Scheduled' and
  // repoints its Saturday link, so it leaves the old Saturday's counts (Aug 29
  // reads high only because ~40 of its no-shows were swept forward). Completed
  // doesn't decay — a completed referral is never rescheduled.
  //
  // 'No Show' stays in the fetch even though it isn't displayed: `empty` is
  // "no referral grouped to this Saturday at all", and without the No Show rows
  // a Saturday where every appointment was missed would look like a day nothing
  // was booked. A still-'Scheduled' past row is "Awaiting" (isAwaitingOutcome,
  // the Referrals page's check) and withholds the count.
  const pastWeeks: PastWeek[] = schedule
    .filter(s => s.date && String(s.date).slice(0, 10) < todayISO && s.status !== 'Blackout')
    .slice(-4)
    .map(s => {
      const d = String(s.date).slice(0, 10)
      const rows = pastRows.filter(
        (r: { effectiveAppointmentDate: string | null }) =>
          (r.effectiveAppointmentDate ?? '').slice(0, 10) === d,
      )
      const completed = rows.filter(
        (r: { appointmentStatus: string }) => r.appointmentStatus === 'Completed',
      ).length
      const awaiting = rows.some(
        (r: { appointmentStatus: string; appointmentDate: string | null }) =>
          isAwaitingOutcome(r.appointmentStatus, r.appointmentDate, todayISO),
      )
      return {
        date: d,
        dateLabel: shortSat(d),
        awaiting,
        completed,
        empty: rows.length === 0,
      }
    })

  // ---- RIGHT: Next 4 Saturdays via the shared bookable walk. Blackouts are
  // dropped here, not struck through — this card is about what needs filling,
  // and the Saturday Schedule page shows closures for anyone who wants them.
  const { visible, bookableShown } = selectBookableWindow(schedule.map(toGridRow), {
    weeks: 4,
    fromISO: todayISO,
    firstBookableISO: todayISO,
  })
  const upcomingWeeks: UpcomingWeek[] = visible
    .filter(r => r.status !== 'Blackout')
    .map(r => ({
      date: r.date,
      dateLabel: shortSat(r.date),
      slots: TIME_ORDER.map(t => ({ label: t, booked: r.slots[t].booked, cap: r.slots[t].cap })),
      totalFilled: r.totalFilled,
      totalCapacity: r.totalCapacity,
    }))

  const lastPublished = schedule.length
    ? String(schedule[schedule.length - 1].date).slice(0, 10)
    : null
  const horizonNote =
    bookableShown < 4 && lastPublished
      ? `Schedule published through ${formatDateOnly(lastPublished, { month: 'short', day: 'numeric' })}.`
      : null

  const attention = pickAttention(
    upcomingWeeks.map(w => ({
      date: w.date,
      totalFilled: w.totalFilled,
      totalCapacity: w.totalCapacity,
    })),
    todayISO,
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <DawsonPageControls>
        <span style={{ fontSize: '12px', color: MUTED }}>{dateStr}</span>
      </DawsonPageControls>

      <div style={{ padding: '28px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        <div
          style={{
            marginBottom: '22px',
            fontFamily: 'var(--font-montserrat)',
            fontWeight: 800,
            fontSize: '24px',
            color: NAVY,
            lineHeight: 1.15,
          }}
        >
          {greeting}
          {firstName ? `, ${firstName}` : ''}
        </div>

        {/* grid-template-areas (globals.css): "stats cards" / ".  attn".
            alignItems: stretch grows the stats column to the CARDS' height —
            row 1 — while the attention line sits in row 2 and doesn't drag the
            last stat card past the bottom of Next 4. */}
        <div
          className="fa-dawson-dash-grid"
          style={{ display: 'grid', columnGap: '20px', rowGap: '10px', alignItems: 'stretch' }}
        >
          {/* LEFT — four stat cards, each flex: 1 so they divide the column
              height evenly. The numeral is pinned at 2rem and does NOT scale
              with the card. */}
          <div style={{ gridArea: 'stats', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
            {statCards.map(c => (
              <Link key={c.label} href={c.href} style={{ ...STAT_CARD, textDecoration: 'none' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-montserrat)',
                    fontWeight: 800,
                    fontSize: '2rem',
                    lineHeight: 1,
                    // Zero isn't waiting on anything — the muted zero-count grey
                    // from the Agencies FilterPill, not gold. Non-zero keeps its
                    // colour (gold for the review queues, navy for cancelled).
                    color: c.value === 0 ? '#B8C1CC' : c.gold ? GOLD : NAVY,
                  }}
                >
                  {c.value}
                </div>
                <div style={{ fontSize: '13px', color: MUTED, marginTop: '7px' }}>{c.label}</div>
              </Link>
            ))}
          </div>

          {/* RIGHT row 1 — the two Saturday cards */}
          <div style={{ gridArea: 'cards', display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
            <PastSaturdaysCard weeks={pastWeeks} />
            <UpcomingSaturdaysCard weeks={upcomingWeeks} horizonNote={horizonNote} />
          </div>

          {/* RIGHT row 2 — the attention line, out of the height the stats
              column matches against. */}
          {attention && (
            <div style={{ gridArea: 'attn', fontSize: '12.5px', color: '#8A6A00' }}>
              {attention}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
