'use client'

// components/internal/SaturdayCapacityGrid.tsx
//
// Shared Saturday capacity grid. Rows are Saturdays, columns are the five
// pickup hours; each cell shows how full that hour is — hard booked / cap,
// plus a soft count (referrals requesting that hour without holding it).
//
// Three intended call sites, all Dawson-side, NOT wired up in this branch:
//   • Add Referral form   — mode="select", clickable, sets { date, time }
//   • Needs Action rail    — mode="readonly"
//   • "Pick another slot"  — mode="select" + excludeReferralId
//
// 50 is a SOFT cap for Dawson: a full cell and a full day stay clickable, with
// an over-cap warning. `enforceCap` (default false) is the hook for a future
// AGENCY variant where 50 is hard and full === disabled — that variant is not
// built here; this component just doesn't assume "full means clickable".
//
// Data: GET /api/dawson/schedule?from=…&to=…&soft=1[&exclude=id]. The fetch
// lives inside the component so all three call sites stay a one-liner; pass
// `initialData` to skip it (a parent that already holds the rows). The
// "schedule ends here" note only shows on the fetch path — raw rows carry no
// table horizon.

import { useEffect, useMemo, useState } from 'react'
import { addDaysISO, easternTodayISO, formatDateOnly } from '@/lib/dates'
import { TIME_ORDER, type TimeSlot } from '@/lib/schedule/capacity'
import {
  selectBookableWindow,
  type SaturdayGridRow,
  type SaturdayGridResponse,
} from '@/lib/schedule/grid'

export type SlotSelection = { date: string; time: TimeSlot }

type Props = {
  mode: 'select' | 'readonly'

  /** select mode — the currently chosen cell, and the setter. */
  value?: SlotSelection | null
  onChange?: (sel: SlotSelection) => void

  /** How many BOOKABLE (non-blackout, on/after lead) Saturdays to show. */
  weeks?: number
  /** Earliest selectable date = today + leadDays. Select sites pass 1. */
  leadDays?: number
  /** Window start, 'YYYY-MM-DD'. Defaults to today. */
  fromDate?: string

  /**
   * The referral being rescheduled (Pick Another). Subtracts it from both
   * sides of its cell: its HELD slot comes off `booked` and is marked
   * "current" (only when that Saturday is in the window — otherwise a no-op),
   * and its own pending request comes out of the SOFT tally so the count is
   * "what else wants this hour" rather than an echo of the decision at hand.
   */
  excludeReferralId?: string

  /** Agency variant hook: true → a full cell/day is disabled, not just warned. */
  enforceCap?: boolean
  /** Show the soft (requested-not-held) counts. Default true. */
  showSoft?: boolean
  /** Compact rows for the rail / modal. */
  dense?: boolean

  /**
   * 'counts' (default, Dawson) — every cell shows `booked/cap`.
   * 'binary' (agency) — every cell shows only Open / Full. Exposing the
   * numbers invites optimising against the schedule; an agency needs to know
   * whether a slot is available, not how close it is to the cap. A pre-lead
   * Saturday renders as a struck "Less than two weeks away" row here rather
   * than five greyed cells.
   */
  capacityDisplay?: 'counts' | 'binary'

  /**
   * Grid data endpoint. Default '/api/dawson/schedule' (Dawson-gated). The
   * agency callers pass '/api/agency/schedule' — same wire shape, agency auth,
   * no soft counts. `?from`/`?to` are always sent; `?soft`/`?exclude` only
   * when showSoft / excludeReferralId are set, which the agency route ignores.
   */
  endpoint?: string

  /** Escape hatch: render these rows instead of fetching. No horizon note. */
  initialData?: SaturdayGridRow[]

  /**
   * Bump this (a counter) to make the grid refetch — e.g. the Needs Action
   * rail after an action books an appointment. The old rows stay on screen
   * until the new data lands (no remount, no loading flash). Callers that
   * fetch on mount only (the modal, the Add Referral form) leave it unset.
   */
  refreshToken?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVISIONAL COLOURS — one map, changed in one place.
//
// Ben is revisiting the cell scheme once the Needs Action page exists and the
// grid can be seen next to the cards it supports. Every cell-state colour is
// HERE; adding or recolouring a state is an edit to this object, never a hunt
// through the JSX. All values are already in the portal palette.
// ─────────────────────────────────────────────────────────────────────────────
type CellState = 'open' | 'soft' | 'full' | 'selected' | 'current' | 'disabled'

const CELL: Record<CellState, { bg: string; fg: string; border: string }> = {
  open:     { bg: '#FFFFFF',               fg: '#1B2B4B', border: '#EDE9E1' },
  // Not a fullness signal — a discrete flag that this hour has pending
  // requests. The gold +N chip below is the real marker; the tint just backs
  // it. Rare (requests are few), so it never approaches a coloured-everywhere
  // gradient, and red stays the only "genuine exception" colour.
  soft:     { bg: 'rgba(201,168,76,0.14)', fg: '#1B2B4B', border: 'rgba(201,168,76,0.55)' },
  full:     { bg: 'rgba(192,57,43,0.08)',  fg: '#C0392B', border: 'rgba(192,57,43,0.30)' },
  selected: { bg: '#2A7F6F',               fg: '#FFFFFF', border: '#2A7F6F' },
  current:  { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F', border: '#2A7F6F' },
  disabled: { bg: '#F7F5F1',               fg: '#B8C1CC', border: '#EDE9E1' },
}

// Blackout is a whole-row band, rendered from `status` and never from counts.
const BLACKOUT = { band: '#F0F0F0', text: '#7A8899' }
const SOFT_TEXT = '#8A6D14'
const WARN = { bg: '#FDF6E7', border: '#C9A84C', text: '#8A6D14' }

// Reschedule-modal-mobile: binary (agency) mode below the breakpoint drops the
// Open/Current/Selected word from a cell — nothing on a 390px screen has room
// for "Current" or "Selected" (see the .fa-cap-bin-* rules in globals.css).
// Current/Selected get this checkmark instead, same glyph and stroke pattern
// as the "on" state of NewReferralForm's item chips, so it isn't a new
// convention. "Full" is unaffected — it keeps its word at every width, it's
// short and it's the one state that needs naming.
const CHECK_ICON = (
  <polyline points="20 6 9 17 4 12" />
)

// The +N chip on a cell that carries pending requests. Its vertical space is
// reserved in EVERY slot cell (an invisible copy when soft === 0) so a row
// with requests isn't taller than one without — a height difference that
// would otherwise read as a difference between the Saturdays themselves.
const SOFT_CHIP: React.CSSProperties = {
  display: 'inline-block', marginTop: '2px', padding: '0 6px', borderRadius: '9px',
  background: 'rgba(201,168,76,0.22)', color: SOFT_TEXT, fontWeight: 800,
  fontFamily: 'var(--font-montserrat)',
}

// Precedence, highest first: selected → disabled → current → full → soft →
// open. The soft "+N" badge renders on top of whatever the base state is, so a
// full cell that also has requests still shows its "+2".
function cellState(a: {
  full: boolean
  soft: number
  isSelected: boolean
  isCurrent: boolean
  disabled: boolean
}): CellState {
  if (a.isSelected) return 'selected'
  if (a.disabled) return 'disabled'
  if (a.isCurrent) return 'current'
  if (a.full) return 'full'
  if (a.soft > 0) return 'soft'
  return 'open'
}

function fmtDate(iso: string): string {
  return formatDateOnly(iso, { weekday: 'short', month: 'short', day: 'numeric' })
}

// Loading-state height reservation. The loading branch used to render one
// ~32px line where the loaded grid renders ~217px (measured, non-dense
// binary, 4 weeks) — the difference is what made a centred modal (the agency
// Reschedule modal, Dawson's PickSlotModal — both `fixed inset-0 … flex
// items-center justify-center`) grow around its own centre on every open, and
// "Send Request" moved out from under a resting thumb.
//
// dense/capacityDisplay/weeks are all known from props before the fetch
// resolves, so the placeholder can reserve roughly the right amount of space
// instead of none. Not pixel-exact: it can't know yet whether a given row
// will need the "current" sub-label or a soft-count chip reserved — those
// depend on data that hasn't loaded. That's fine; it only needs to keep the
// jump small and bounded, the same tolerance already accepted for the
// ranShort note that can still land below the grid after it loads.
//
// Row/header pixel values below are measured (Chromium, real Lato/Montserrat
// metrics), not estimated from the CSS alone:
//   non-dense: header 13px, row 45px, gap 6px
//   dense:     header 14px, row 31px, gap 4px  (no current caller is
//              dense + binary; kept correct for when one is)
//   + ~36px for counts mode's "+1 = requests…" legend line, which binary
//     mode never renders.
function estimatedGridHeight({
  dense, binary, weeks,
}: { dense: boolean; binary: boolean; weeks: number }): number {
  const headerH = dense ? 14 : 13
  const rowH = dense ? 31 : 45
  const gap = dense ? 4 : 6
  const legend = binary ? 0 : 36
  return headerH + weeks * (rowH + gap) + legend
}

export default function SaturdayCapacityGrid({
  mode,
  value = null,
  onChange,
  weeks = 4,
  leadDays = 0,
  fromDate,
  excludeReferralId,
  enforceCap = false,
  showSoft = true,
  dense = false,
  capacityDisplay = 'counts',
  endpoint = '/api/dawson/schedule',
  initialData,
  refreshToken,
}: Props) {
  const binary = capacityDisplay === 'binary'
  const today = easternTodayISO()
  // Lead is measured from TODAY, not from the window start.
  const firstBookable = addDaysISO(today, Math.max(0, leadDays))
  // Binary (agency) mode starts AT the first bookable Saturday: a date an
  // agency cannot pick is not shown at all — not struck, not greyed. Counts
  // (Dawson) mode still starts at today, so he sees and can book pre-lead
  // Saturdays, greyed. A Blackout inside the two-week line therefore never
  // reaches the agency grid; Blackouts beyond it still render struck.
  const windowStart = fromDate ?? (binary ? firstBookable : today)
  // Over-fetch by four weeks so interleaved blackouts can't starve the window.
  const windowEnd = addDaysISO(windowStart, (weeks + 4) * 7)

  const [data, setData] = useState<SaturdayGridResponse | null>(
    initialData
      ? { rows: initialData, horizon: { lastDate: null, truncated: false } }
      : null,
  )
  const [error, setError] = useState(false)
  // Bumped by the error state's "Try again" button to re-run the fetch.
  const [retry, setRetry] = useState(0)

  // `loading` is derived, not stored: the first render with no data and no
  // error IS the loading state. A re-fetch on a prop change keeps the previous
  // window's grid on screen until the new data lands rather than flashing —
  // and keeps every setState off the effect body (react-hooks/set-state-in-effect).
  const loading = !initialData && !data && !error

  useEffect(() => {
    if (initialData) return

    let cancelled = false
    const qs = new URLSearchParams({ from: windowStart, to: windowEnd })
    if (showSoft) qs.set('soft', '1')
    if (excludeReferralId) qs.set('exclude', excludeReferralId)

    fetch(`${endpoint}?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: SaturdayGridResponse) => {
        if (cancelled) return
        setData(body)
        setError(false)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [initialData, endpoint, windowStart, windowEnd, showSoft, excludeReferralId, retry, refreshToken])

  const { visible, bookableShown } = useMemo(() => {
    if (!data) return { visible: [] as SaturdayGridRow[], bookableShown: 0 }
    return selectBookableWindow(data.rows, {
      weeks,
      fromISO: windowStart,
      firstBookableISO: firstBookable,
    })
  }, [data, weeks, windowStart, firstBookable])

  // Over-cap warning: a selected cell that is at/over its cap while the cap is
  // soft (Dawson). enforceCap makes such a cell unselectable, so it can't arise
  // there.
  const overCap = useMemo(() => {
    if (mode !== 'select' || enforceCap || !value || !data) return null
    const row = data.rows.find((r) => r.date === value.date)
    if (!row) return null
    const cell = row.slots[value.time]
    const dayFull = row.totalFilled >= row.totalCapacity
    if (!cell || (cell.booked < cell.cap && !dayFull)) return null
    return { date: value.date, time: value.time, booked: cell.booked, cap: cell.cap, dayFull }
  }, [mode, enforceCap, value, data])

  // Non-dense is the reference rail (Needs Action) — the numbers there are
  // consulted on every decision, so it's noticeably larger than dense (the
  // Add Referral form and the Pick Another modal). Date column is trimmed on
  // non-dense to make room for the Total column without shrinking the slot
  // cells — "Sat, Sep 12" needs ~88px.
  const cellPad = dense ? '6px 4px' : '12px 8px'
  // Vertical only, for binary cells below the breakpoint: .fa-cap-bin-cell
  // (globals.css) shrinks their horizontal padding, so it's left out of the
  // inline style there — an inline value always beats a media query. Vertical
  // stays inline and unconditional at every width: it's what
  // estimatedGridHeight's row-height constant assumes, and shrinking it too
  // would make that reservation wrong below the breakpoint. Counts mode keeps
  // using the combined `cellPad` shorthand above, unaffected.
  const cellPadV = dense ? '6px' : '12px'
  const dateColW = dense ? '96px' : '108px'
  const cellGap = dense ? '4px' : '6px'
  const numSize = dense ? '13px' : '16px'
  const headSize = dense ? '11px' : '13px'
  const subSize = dense ? '10px' : '11px'
  const currentSize = dense ? '9px' : '10px'
  // (the date cell's own font is set in the dateCell() style helper below)
  // One track for the date, then six equal ones: the five bookable hours + a
  // Total rollup. minmax(0, 1fr) — see the grid comment below for why not 1fr.
  // Six data columns in counts mode (five hours + Total), five in binary — the
  // day rollup is dropped there, "Open" after five Opens says nothing.
  const gridCols = `${dateColW} repeat(${binary ? 5 : 6}, minmax(0, 1fr))`

  if (loading) {
    return (
      <div style={shell}>
        <div style={{ ...muted, minHeight: estimatedGridHeight({ dense, binary, weeks }) }}>
          Loading Saturdays…
        </div>
      </div>
    )
  }
  if (error || !data) {
    // A failed fetch here means no date can be picked — say that, and give a
    // way back, rather than showing an empty grid that looks like "no
    // Saturdays".
    return (
      <div style={shell}>
        <div
          style={{
            padding: '12px 14px', borderRadius: '8px',
            background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.30)',
            fontSize: '13px', color: '#C0392B',
          }}
        >
          Couldn’t load the Saturday schedule.
          {mode === 'select' && ' You can’t pick a date until this loads.'}
          {' '}Check your connection, then{' '}
          <button
            type="button"
            onClick={() => { setError(false); setRetry((n) => n + 1) }}
            style={{
              font: 'inherit', fontWeight: 700, color: '#C0392B', background: 'none',
              border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            try again
          </button>
          .
        </div>
      </div>
    )
  }
  if (visible.length === 0) {
    return (
      <div style={shell}>
        <div style={muted}>
          No bookable Saturdays on the schedule.
          {data.horizon.lastDate && ` Published through ${fmtDate(data.horizon.lastDate)}.`}
        </div>
      </div>
    )
  }

  const ranShort = bookableShown < weeks

  return (
    <div style={shell}>
      {/* ONE grid. The header row and every data row are children of this
          single grid and share its column tracks, so a column lines up top to
          bottom when scanned. Each data row is a display:contents wrapper — its
          seven cells (date + five hours + Total) drop straight onto these
          tracks; the wrapper adds a React key without a layout box of its own.
          The blackout row is a single `grid-column: 1 / -1` item that spans the
          tracks instead of redefining them.

          Tracks are `minmax(0, 1fr)`, NOT `1fr`: a bare `1fr` is
          `minmax(auto, 1fr)`, whose `auto` floor lets a wide cell ("50/50", a
          +N chip) push its own column wider. With separate per-row grids that
          made each row size its columns independently and nothing aligned —
          the bug this rewrite fixes. `minmax(0, …)` pins all six to equal. */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: cellGap }}>
        {/* Header */}
        <div />
        {/* Binary mode's font-size/letter-spacing/padding move into
            .fa-cap-bin-header (globals.css) instead of staying inline below
            the breakpoint — an inline style always wins over a stylesheet
            rule, so it has to physically leave the object to be shrunk by a
            media query, same as every other responsive row in this codebase
            (.fa-team-row, .fa-active-row). Counts mode never gets the class,
            so Dawson's headers are untouched at any width. The base (above
            the breakpoint) values in that class are the same 13px/0.04em/8px
            this file used inline before — binary is never dense today, so
            that's the only case the class needs to match exactly. */}
        {(binary ? TIME_ORDER : [...TIME_ORDER, 'Total']).map((t) => (
          <div
            key={`h-${t}`}
            className={binary ? 'fa-cap-bin-header' : undefined}
            style={{
              textAlign: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 700,
              color: '#7A8899', textTransform: 'uppercase',
              ...(binary
                ? {}
                : { fontSize: headSize, letterSpacing: '0.04em', padding: `0 ${dense ? '4px' : '8px'}` }),
            }}
          >
            {t}
          </div>
        ))}

        {visible.map((row) => {
          if (row.status === 'Blackout') {
            return (
              <div
                key={row.id}
                style={{
                  gridColumn: '1 / -1',
                  display: 'grid', gridTemplateColumns: `${dateColW} 1fr`, gap: cellGap,
                  background: BLACKOUT.band, borderRadius: '8px',
                }}
              >
                <div style={{ ...dateCell(dense), color: BLACKOUT.text, textDecoration: 'line-through' }}>
                  {fmtDate(row.date)}
                </div>
                <div
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: cellPad, fontSize: subSize, color: BLACKOUT.text,
                  }}
                >
                  Blackout — warehouse closed
                </div>
              </div>
            )
          }

          // Counts (Dawson) mode greys pre-lead Saturdays; binary mode never
          // shows them (windowStart is firstBookable there), so this is always
          // false in binary and no "inside the lead" row is rendered.
          const preLead = row.date < firstBookable
          const dayFull = row.totalFilled >= row.totalCapacity

          return (
            <div key={row.id} style={{ display: 'contents' }}>
              <div style={{ ...dateCell(dense), color: preLead ? '#B8C1CC' : '#1B2B4B' }}>
                {fmtDate(row.date)}
              </div>

              {TIME_ORDER.map((t) => {
                const cell = row.slots[t]
                // totalCapacity defense: a Saturday whose Total Capacity is set
                // below what TIME_CAPS sums to would otherwise offer cell room
                // the day can't hold. Not a live bug — every row is 50 today and
                // TIME_CAPS happens to sum to 50 — but nothing enforces that, so
                // a full day forces every cell to read full.
                const full = cell.booked >= cell.cap || dayFull
                const isSelected =
                  mode === 'select' && value?.date === row.date && value?.time === t
                const disabled = preLead || (enforceCap && full)
                const state = cellState({
                  full, soft: cell.soft, isSelected, isCurrent: cell.current, disabled,
                })
                const c = CELL[state]
                const clickable = mode === 'select' && !disabled
                // Binary only. Same precedence the label always used: selected
                // beats current beats full beats open. "Full" is the one word
                // that stays put at every width — binaryWordHides is false only
                // for it, so it never gets the mobile-hide class below.
                const binaryWord = isSelected ? 'Selected' : cell.current ? 'Current' : full ? 'Full' : 'Open'
                const binaryWordHides = binaryWord !== 'Full'
                const binaryIcon = isSelected || cell.current

                return (
                  <button
                    key={t}
                    type="button"
                    disabled={!clickable}
                    onClick={clickable ? () => onChange?.({ date: row.date, time: t }) : undefined}
                    // Below the breakpoint the visible word for Open/Current/
                    // Selected is hidden (see .fa-cap-bin-word-hide) —
                    // visibility:hidden also drops it from the accessibility
                    // tree, so the state still needs to reach a screen reader
                    // some other way.
                    aria-label={binary ? `${fmtDate(row.date)} ${t}: ${binaryWord}` : undefined}
                    className={binary ? 'fa-cap-bin-cell' : undefined}
                    style={{
                      position: 'relative',
                      // Horizontal padding is binary-mode's to shrink below the
                      // breakpoint (.fa-cap-bin-cell in globals.css), so it's
                      // left out of the inline style there — an inline value
                      // would always beat the media query. Vertical stays
                      // inline and unconditional: it's what
                      // estimatedGridHeight's row-height constant assumes, at
                      // every width. Counts mode keeps the combined `cellPad`
                      // shorthand exactly as before.
                      ...(binary
                        ? { paddingTop: cellPadV, paddingBottom: cellPadV }
                        : { padding: cellPad }),
                      borderRadius: '8px', border: `1px solid ${c.border}`,
                      background: c.bg, color: c.fg, cursor: clickable ? 'pointer' : 'default',
                      textAlign: 'center', font: 'inherit', lineHeight: 1.25,
                    }}
                  >
                    {binary ? (
                      <>
                        {/* The word: the label carries the state, not just the
                            fill — every open cell says "Open" so the teal fill
                            alone is easy to miss and fails on colour.
                            .fa-cap-bin-word shrinks every binary word 13px →
                            10px below the breakpoint (Full included — even at
                            10px it needs the cell's horizontal padding to also
                            drop, see .fa-cap-bin-cell). Open/Current/Selected
                            additionally go visibility:hidden there
                            (.fa-cap-bin-word-hide) — hidden, not removed, so
                            the line still reserves the row's height and a cell
                            showing "Full" next to one showing nothing stay the
                            same height. "Full" doesn't get that second class,
                            so it's never hidden, at any width. */}
                        <span
                          className={`fa-cap-bin-word${binaryWordHides ? ' fa-cap-bin-word-hide' : ''}`}
                          style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800 }}
                        >
                          {binaryWord}
                        </span>
                        {/* The checkmark: Current/Selected only, shown ONLY
                            below the breakpoint (.fa-cap-bin-icon is display:
                            none above it) — absolutely centred over the same
                            box the now-invisible word still reserves, so it
                            doesn't add a second line. Same glyph as the "on"
                            state of NewReferralForm's item chips. */}
                        {binaryIcon && (
                          <span className="fa-cap-bin-icon" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              {CHECK_ICON}
                            </svg>
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: numSize }}>
                        {`${cell.booked}/${cell.cap}`}
                      </span>
                    )}
                    {/* Chip line — always present when soft counts are shown, so
                        every row is the same height. soft === 0 renders an
                        invisible copy (visibility:hidden keeps the box, drops it
                        from the a11y tree). Not absolutely positioned — that
                        would crowd the number above it. */}
                    {showSoft && (
                      <span style={{ display: 'block' }} aria-hidden={cell.soft === 0 || undefined}>
                        <span
                          style={
                            cell.soft === 0
                              ? { ...SOFT_CHIP, fontSize: subSize, visibility: 'hidden' }
                              : state === 'selected'
                                ? { ...SOFT_CHIP, background: 'rgba(255,255,255,0.25)', color: '#FFFFFF', fontSize: subSize }
                                : { ...SOFT_CHIP, fontSize: subSize }
                          }
                        >
                          +{cell.soft}
                        </span>
                      </span>
                    )}
                    {/* "current" sub-label — COUNTS mode only. Reserved in every
                        cell of a grid that has an excludeReferralId (the only
                        grids where it can appear), same invisible-placeholder
                        trick as the chip above, so the one held-slot cell isn't
                        ~10px taller than its row in the PickSlotModal. Binary
                        mode carries "Current" in the main label instead, so it
                        needs neither this line nor its placeholder. */}
                    {excludeReferralId && !binary && (
                      <span
                        aria-hidden={!cell.current || undefined}
                        style={{
                          display: 'block', fontSize: currentSize, fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          ...(cell.current
                            ? { color: state === 'selected' ? 'rgba(255,255,255,0.9)' : '#2A7F6F' }
                            : { visibility: 'hidden' }),
                        }}
                      >
                        current
                      </span>
                    )}
                  </button>
                )
              })}

              {/* Total — counts mode only. Plain text (not a bordered cell like
                  the five hours), booked/capacity, red+bold at/over cap. Binary
                  mode drops the column entirely. */}
              {!binary && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: cellPad, textAlign: 'center', lineHeight: 1.25,
                    color: dayFull ? CELL.full.fg : '#1B2B4B',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-montserrat)',
                    fontWeight: dayFull ? 800 : 600, fontSize: numSize,
                  }}>
                    {row.totalFilled}/{row.totalCapacity}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend — just the chip. The booked count is exactly booked: a pending
          request shows as the +N chip and is NOT in it. Said outright because a
          bare "4/14" otherwise invites the assumption that the 4 already
          includes a request. The 1/5 shape needs no gloss. Suppressed in
          binary mode, which shows neither counts nor the chip. */}
      {!binary && (
        <div style={{ ...muted, marginTop: '10px', fontSize: '11px', lineHeight: 1.7 }}>
          <span style={{ ...SOFT_CHIP, fontSize: '10px', marginTop: 0, marginRight: '4px' }}>+1</span>
          {' = requests not yet accepted, and not counted in the booked number.'}
        </div>
      )}

      {ranShort && (
        <div style={{ ...muted, marginTop: '10px' }}>
          Only {bookableShown} bookable Saturday{bookableShown === 1 ? '' : 's'} on the schedule
          {data.horizon.lastDate && ` — published through ${fmtDate(data.horizon.lastDate)}`}.
        </div>
      )}

      {overCap && (
        <div
          style={{
            marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
            background: WARN.bg, border: `1px solid ${WARN.border}`,
            fontSize: '12px', color: WARN.text,
          }}
        >
          {fmtDate(overCap.date)} at {overCap.time} is over cap
          {overCap.dayFull ? ' (the day is full)' : ` (${overCap.booked}/${overCap.cap} booked)`}.
          Booking here exceeds the slot limit.
        </div>
      )}
    </div>
  )
}

// ── local style helpers ──────────────────────────────────────────────────────

const shell: React.CSSProperties = {
  fontFamily: 'var(--font-lato), sans-serif',
}
const muted: React.CSSProperties = {
  fontSize: '13px', color: '#7A8899', padding: '8px 2px',
}
function dateCell(dense: boolean): React.CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    padding: dense ? '6px 4px' : '12px 8px',
    fontFamily: 'var(--font-montserrat)', fontWeight: 700,
    fontSize: dense ? '12px' : '14px',
  }
}
