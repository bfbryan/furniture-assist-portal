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

function SlotBar({ filled, max, label }: { filled: number; max: number; label: string }) {
  const pct = Math.min(filled / max, 1)
  const color = pct >= 1 ? '#C0392B' : pct >= 0.8 ? '#C9A84C' : '#2A7F6F'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{ width: '32px', fontSize: '11px', fontWeight: 700, color: '#7A8899', textAlign: 'right', flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, height: '8px', background: '#EDE9E1', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, borderRadius: '4px' }} />
      </div>
      <div style={{ width: '40px', fontSize: '11px', color: '#7A8899', flexShrink: 0 }}>
        {filled}/{max}
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Open:     { bg: 'rgba(42,127,111,0.12)',  color: '#2A7F6F' },
  Full:     { bg: 'rgba(192,57,43,0.1)',    color: '#C0392B' },
  Blackout: { bg: '#F0F0F0',                color: '#7A8899' },
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
  gridTemplateColumns: '100px 90px 1fr 60px 60px 60px 40px',
  alignItems: 'center', gap: '16px',
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

  {/* Time slots */}
  {!isBlackout ? (
    <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', padding: '0 20px' }}>
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

  {/* Print */}
  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
    {!past && !isBlackout && sat.mailMergeComplete && (
  <a href={`/dawson/schedule/${sat.date}/print`} title="Print Forms"
    style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A7F6F', textDecoration: 'none' }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>
  </a>
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

  useEffect(() => {
    fetch('/api/dawson/schedule')
      .then(r => r.json())
      .then(data => { setSaturdays(data); setLoading(false) })
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
      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
          Saturday Schedule
        </div>
        <button onClick={() => setShowPast(!showPast)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', fontSize: '13px', fontWeight: 600, color: '#7A8899', cursor: 'pointer' }}>
          {showPast ? 'Hide Past Dates' : 'Show Past Dates'}
        </button>
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

