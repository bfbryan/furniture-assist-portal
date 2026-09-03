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

  /** Escape hatch: render these rows instead of fetching. No horizon note. */
  initialData?: SaturdayGridRow[]
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
  soft:     { bg: 'rgba(201,168,76,0.10)', fg: '#8A6D14', border: 'rgba(201,168,76,0.35)' },
  full:     { bg: 'rgba(192,57,43,0.08)',  fg: '#C0392B', border: 'rgba(192,57,43,0.30)' },
  selected: { bg: '#2A7F6F',               fg: '#FFFFFF', border: '#2A7F6F' },
  current:  { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F', border: '#2A7F6F' },
  disabled: { bg: '#F7F5F1',               fg: '#B8C1CC', border: '#EDE9E1' },
}

// Blackout is a whole-row band, rendered from `status` and never from counts.
const BLACKOUT = { band: '#F0F0F0', text: '#7A8899' }
const SOFT_TEXT = '#8A6D14'
const WARN = { bg: '#FDF6E7', border: '#C9A84C', text: '#8A6D14' }

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
  initialData,
}: Props) {
  const today = easternTodayISO()
  const windowStart = fromDate ?? today
  // Lead is measured from TODAY, not from the window start.
  const firstBookable = addDaysISO(today, Math.max(0, leadDays))
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

    fetch(`/api/dawson/schedule?${qs.toString()}`, { cache: 'no-store' })
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
  }, [initialData, windowStart, windowEnd, showSoft, excludeReferralId, retry])

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

  const cellPad = dense ? '6px 4px' : '10px 6px'
  const dateColW = dense ? '96px' : '124px'
  const gridCols = `${dateColW} repeat(5, 1fr)`

  if (loading) {
    return <div style={shell}><div style={muted}>Loading Saturdays…</div></div>
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
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px', marginBottom: '4px' }}>
        <div />
        {TIME_ORDER.map((t) => (
          <div
            key={t}
            style={{
              textAlign: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 700,
              fontSize: dense ? '11px' : '12px', color: '#7A8899',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            {t}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {visible.map((row) => {
          if (row.status === 'Blackout') {
            return (
              <div
                key={row.id}
                style={{
                  display: 'grid', gridTemplateColumns: gridCols, gap: '4px',
                  background: BLACKOUT.band, borderRadius: '8px',
                }}
              >
                <div style={{ ...dateCell(dense), color: BLACKOUT.text, textDecoration: 'line-through' }}>
                  {fmtDate(row.date)}
                </div>
                <div
                  style={{
                    gridColumn: '2 / -1', display: 'flex', alignItems: 'center',
                    padding: cellPad, fontSize: dense ? '11px' : '12px', color: BLACKOUT.text,
                  }}
                >
                  Blackout — warehouse closed
                </div>
              </div>
            )
          }

          const preLead = row.date < firstBookable
          const dayFull = row.totalFilled >= row.totalCapacity

          return (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px' }}>
              <div style={{ ...dateCell(dense), color: preLead ? '#B8C1CC' : '#1B2B4B' }}>
                {fmtDate(row.date)}
                {dayFull && (
                  <span
                    style={{
                      display: 'block', fontSize: '10px', fontWeight: 700, color: '#C0392B',
                      letterSpacing: '0.06em', marginTop: '1px',
                    }}
                  >
                    DAY FULL
                  </span>
                )}
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

                return (
                  <button
                    key={t}
                    type="button"
                    disabled={!clickable}
                    onClick={clickable ? () => onChange?.({ date: row.date, time: t }) : undefined}
                    style={{
                      padding: cellPad, borderRadius: '8px', border: `1px solid ${c.border}`,
                      background: c.bg, color: c.fg, cursor: clickable ? 'pointer' : 'default',
                      textAlign: 'center', font: 'inherit', lineHeight: 1.25,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: dense ? '13px' : '15px' }}>
                      {cell.booked}/{cell.cap}
                    </span>
                    {showSoft && cell.soft > 0 && (
                      <span
                        style={{
                          display: 'block', fontSize: '10px', fontWeight: 700,
                          color: state === 'selected' ? 'rgba(255,255,255,0.9)' : SOFT_TEXT,
                        }}
                      >
                        +{cell.soft} soft
                      </span>
                    )}
                    {cell.current && (
                      <span
                        style={{
                          display: 'block', fontSize: '9px', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          color: state === 'selected' ? 'rgba(255,255,255,0.9)' : '#2A7F6F',
                        }}
                      >
                        current
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

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
    padding: dense ? '6px 4px' : '10px 6px',
    fontFamily: 'var(--font-montserrat)', fontWeight: 700,
    fontSize: dense ? '12px' : '13px',
  }
}
