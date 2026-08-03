'use client'

import { useState, useEffect } from 'react'

type Saturday = {
  id: string
  date: string
  status: string
  slots9am: number
  slots10am: number
  slots11am: number
  slots12pm: number
  slots1pm: number
  totalFilled: number
  totalCapacity: number
  slotsRemaining: number
  mailMergeComplete: boolean
}

const SLOT_MAX: Record<string, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMonthYear(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function isUpcoming(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d >= today
}

function isPast(dateStr: string) {
  return !isUpcoming(dateStr)
}

function inMonth(dateStr: string, year: number, month: number) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getFullYear() === year && d.getMonth() === month
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Open:     { bg: 'rgba(42,127,111,0.12)',  color: '#2A7F6F' },
  Full:     { bg: 'rgba(192,57,43,0.1)',    color: '#C0392B' },
  Blackout: { bg: '#F0F0F0',                color: '#7A8899' },
}

// Shared style for the two per-row print links. `primary` is the full sheet
// packet (the everyday action); the roster is the lighter secondary option.
// Text labels rather than an icon — the 28px icon-only control was not
// discoverable for the primary user of this page.
function printBtn(primary: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: '6px',
    border: primary ? 'none' : '1px solid #EDE9E1',
    background: primary ? '#2A7F6F' : 'white',
    color: primary ? 'white' : '#2A7F6F',
    fontFamily: 'var(--font-montserrat)',
    fontWeight: 700,
    fontSize: '12px',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
  }
}

function SaturdayCard({ sat }: { sat: Saturday }) {
  const past = isPast(sat.date)
  const isBlackout = sat.status === 'Blackout'
  const fillPct = sat.totalCapacity > 0 ? sat.totalFilled / sat.totalCapacity : 0
  const accentColor = isBlackout ? '#7A8899' : fillPct >= 1 ? '#C0392B' : fillPct >= 0.8 ? '#C9A84C' : '#2A7F6F'
  const statusStyle = STATUS_STYLE[sat.status] ?? STATUS_STYLE.Open

  const slots = [
    { label: '9am',  filled: sat.slots9am,  max: SLOT_MAX['9am'] },
    { label: '10am', filled: sat.slots10am, max: SLOT_MAX['10am'] },
    { label: '11am', filled: sat.slots11am, max: SLOT_MAX['11am'] },
    { label: '12pm', filled: sat.slots12pm, max: SLOT_MAX['12pm'] },
    { label: '1pm',  filled: sat.slots1pm,  max: SLOT_MAX['1pm'] },
  ]

  return (
    <div style={{
      background: 'white', borderRadius: '12px',
      boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
      marginBottom: '10px', opacity: past ? 0.55 : 1,
      display: 'grid', gridTemplateColumns: '4px 1fr',
    }}>
      <div style={{ background: accentColor, borderRadius: '12px 0 0 12px' }} />
      <div style={{ padding: '14px 20px' }}>
        <div style={{
          display: 'grid',
          // Stats tightened 60px -> 52px and the row gap 16px -> 12px to fund a
          // 236px action column for two text buttons. Ten columns for the ten
          // children below:
          //   Date, Status, [gap A], Slots, [gap B], Total, Open, Cap, [gap C], Print
          //
          // Positioning is done with the three flexible gaps rather than by
          // centering inside a wide column, because centering couples the slot
          // strip's position to space taken elsewhere in the row -- shrinking
          // the column to make room for the stats also dragged the slots left.
          // With the strip content-sized ('auto') the gaps place each group
          // independently:
          //   A = 2fr  keeps the slots where they sat originally (they had half
          //            the row's slack to their left back when nothing followed
          //            the stats)
          //   B = C = 1fr  equal space either side of the stat trio, so it sits
          //            centered between the slots and the buttons
          // The ratio holds at any window width.
          gridTemplateColumns: '96px 84px 2fr auto 1fr 52px 52px 52px 1fr 236px',
          alignItems: 'center', gap: '12px',
        }}>

          {/* Date */}
          <div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B' }}>
              {formatShortDate(sat.date)}
            </div>
            <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '1px' }}>Saturday</div>
          </div>

          {/* Status */}
          <div style={{ width: '80px', flexShrink: 0 }}>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: statusStyle.bg, color: statusStyle.color, whiteSpace: 'nowrap',
            }}>
              {sat.status}
            </span>
          </div>

          {/* Gap A — see the grid comment above. */}
          <div />

          {/* Time slots — content-sized; the surrounding gaps do the placing. */}
          {!isBlackout ? (
            <div style={{ display: 'flex', gap: '18px' }}>
              {slots.map(s => {
                const pct = s.max > 0 ? s.filled / s.max : 0
                const color = pct >= 1 ? '#C0392B' : pct >= 0.8 ? '#C9A84C' : '#2A7F6F'
                return (
                  <div key={s.label} style={{ textAlign: 'center', minWidth: '40px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899', marginBottom: '4px' }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color, lineHeight: 1 }}>{s.filled}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#7A8899' }}>Blackout — no appointments</div>
          )}

          {/* Gap B */}
          <div />

          {/* Scheduled */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899', marginBottom: '2px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B' }}>{sat.totalFilled}</div>
          </div>

          {/* Remaining */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899', marginBottom: '2px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Open</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: sat.slotsRemaining === 0 ? '#C0392B' : '#2A7F6F' }}>{sat.slotsRemaining}</div>
          </div>

          {/* Capacity */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899', marginBottom: '2px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cap</div>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B' }}>{sat.totalCapacity}</div>
          </div>

          {/* Gap C */}
          <div />

          {/* Print */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            {!past && !isBlackout && (
              <>
                <a href={`/print/roster/${sat.date}`} style={printBtn(false)}>
                  Print Roster
                </a>
                <a href={`/print/schedule/${sat.date}`} style={printBtn(true)}>
                  Print Sat Sheets
                </a>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function MonthStatCard({ label, saturdays }: { label: string; saturdays: Saturday[] }) {
  const openSats = saturdays.filter(s => s.status !== 'Blackout')
  const booked = openSats.reduce((sum, s) => sum + s.totalFilled, 0)
  const remaining = openSats.reduce((sum, s) => sum + s.slotsRemaining, 0)
  const capacity = openSats.reduce((sum, s) => sum + s.totalCapacity, 0)
  const pct = capacity > 0 ? Math.round((booked / capacity) * 100) : 0
  const color = pct >= 90 ? '#C0392B' : pct >= 70 ? '#C9A84C' : '#2A7F6F'
  const blackouts = saturdays.filter(s => s.status === 'Blackout').length

  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A8899', marginBottom: '14px' }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '28px', color: '#1B2B4B', lineHeight: 1 }}>{booked}</div>
          <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '3px' }}>booked</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '28px', color: color, lineHeight: 1 }}>{remaining}</div>
          <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '3px' }}>remaining</div>
        </div>
      </div>
      <div style={{ height: '6px', background: '#EDE9E1', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#7A8899' }}>
        <span>{pct}% full · {saturdays.length} Saturday{saturdays.length !== 1 ? 's' : ''}</span>
        {blackouts > 0 && <span style={{ color: '#C0392B' }}>{blackouts} blackout</span>}
      </div>
    </div>
  )
}

export default function SchedulePage() {
  const [saturdays, setSaturdays] = useState<Saturday[]>([])
  const [loading, setLoading] = useState(true)
  const [showPast, setShowPast] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchSchedule() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/dawson/schedule', { cache: 'no-store' })
      const data = await res.json()
      setSaturdays(data)
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchSchedule()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchSchedule()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', fetchSchedule)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', fetchSchedule)
    }
  }, [])

  const now = new Date()
  const m0 = { year: now.getFullYear(), month: now.getMonth() }
  const m1 = { year: now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(), month: (now.getMonth() + 1) % 12 }
  const m2 = { year: now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear(), month: (now.getMonth() + 2) % 12 }

  const thisMonth  = saturdays.filter(s => inMonth(s.date, m0.year, m0.month))
  const nextMonth  = saturdays.filter(s => inMonth(s.date, m1.year, m1.month))
  const monthAfter = saturdays.filter(s => inMonth(s.date, m2.year, m2.month))

  const upcoming = saturdays.filter(s => isUpcoming(s.date))
  const displayed = showPast ? saturdays : upcoming

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinning { animation: spin 0.8s linear infinite; }
      `}</style>

      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
          Saturday Schedule
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {refreshing && (
            <span style={{ fontSize: '12px', color: '#7A8899', marginRight: '4px' }}>
              Refreshing…
            </span>
          )}
          <button onClick={fetchSchedule}
            disabled={refreshing}
            title="Refresh"
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', fontSize: '13px', fontWeight: 600, color: '#2A7F6F', cursor: refreshing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: refreshing ? 0.7 : 1 }}>
            <svg className={refreshing ? 'spinning' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          <button onClick={() => setShowPast(!showPast)}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', fontSize: '13px', fontWeight: 600, color: '#7A8899', cursor: 'pointer' }}>
            {showPast ? 'Hide Past Dates' : 'Show Past Dates'}
          </button>
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>

        {/* Rolling 3-month stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
          <MonthStatCard label={formatMonthYear(new Date(m0.year, m0.month))} saturdays={thisMonth} />
          <MonthStatCard label={formatMonthYear(new Date(m1.year, m1.month))} saturdays={nextMonth} />
          <MonthStatCard label={formatMonthYear(new Date(m2.year, m2.month))} saturdays={monthAfter} />
        </div>

        {/* Schedule list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading schedule...</div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No upcoming Saturdays found.</div>
        ) : (
          displayed.map(sat => <SaturdayCard key={sat.id} sat={sat} />)
        )}

      </div>
    </div>
  )
}
