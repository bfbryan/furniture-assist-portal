'use client'

// components/agency/DashboardLastSaturday.tsx
//
// The "Last Saturday" card on the agency Dashboard — the outcome of the most
// recent past Saturday, so an agency can confirm what happened and act on it.
//
// Row shape, card treatment and the pill values are the Active page's
// (components/agency/ReferralTable.tsx): client name bold + linked, address
// muted beneath, the action then the status pill on the right. The only
// interactive action here is Reschedule, which reuses RescheduleModal — the
// same dialog the Active list and the referral detail page use.
//
// The card carries a muted grey accent (#9AA6B2, the Team "Inactive" grey):
// this is a past, done-with Saturday, not something to act on urgently.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RescheduleModal, type RescheduleModalState } from './ReferralActionModals'

export type LastSatRow = {
  id: string
  clientName: string
  addressLine: string
  // 'Scheduled' = still on last Saturday but no outcome recorded yet (the scan
  // hasn't run). Shown rather than hidden so a caseworker isn't short rows with
  // no explanation.
  outcome: 'Completed' | 'No Show' | 'Cancelled' | 'Scheduled'
  hasReceipt: boolean
  receiptUrl: string | null
  /** Missed AND still inside the no-show reschedule window (computed server-side). */
  canReschedule: boolean
  /** The missed slot's date/time — passed to the reschedule modal so it shows
      "Missed appointment: {date}" and the window deadline. Only the No Show
      rows that can reschedule need it. */
  apptDate: string | null
  apptTime: string | null
  /** Muted line under the address — only the 'Scheduled' rows carry one. */
  note?: string
}

// Same values as ReferralTable / the referral detail page. Airtable's
// 'No Show' shows to the agency as "Missed".
const PILL: Record<LastSatRow['outcome'], { bg: string; color: string; label: string }> = {
  Completed: { bg: 'rgba(42,127,111,0.10)', color: '#2A7F6F', label: 'Completed' },
  'No Show': { bg: 'rgba(201,168,76,0.12)', color: '#8B7724', label: 'Missed' },
  Cancelled: { bg: '#FDF0EE', color: '#C0392B', label: 'Cancelled' },
  Scheduled: { bg: '#EDEBE7', color: '#7A8899', label: 'Awaiting outcome' },
}

// Teal accent, matching the "Scheduled" card on the Active page. This is the
// most actionable card on the Dashboard — receipts and reschedules live here —
// so it should not read as archival grey next to the coloured count cards.
const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
  padding: '14px 18px 14px 15px',
  borderLeft: '3px solid #2A7F6F',
}

// Quiet outline buttons, geometry lifted from HeaderButton on the referral
// detail page: 'doc' = navy outline for a paperwork link, 'amber' = the
// reschedule request.
function OutlineBtn({ tone, href, onClick, children }: {
  tone: 'doc' | 'amber'
  href?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  const t = tone === 'amber'
    ? { border: 'rgba(201,168,76,0.9)', color: '#7A6A28', hoverBg: '#FDF8EC' }
    : { border: 'rgba(27,43,75,0.55)', color: '#1B2B4B', hoverBg: '#F7F5F1' }
  const [hover, setHover] = useState(false)
  const style: React.CSSProperties = {
    padding: '6px 12px', borderRadius: '7px', border: `1px solid ${t.border}`,
    background: hover ? t.hoverBg : 'transparent', color: t.color,
    fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px',
    cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center',
  }
  const hp = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }
  return href
    ? <a href={href} target="_blank" rel="noreferrer" style={style} {...hp}>{children}</a>
    : <button type="button" onClick={onClick} style={style} {...hp}>{children}</button>
}

export default function DashboardLastSaturday({ rows, dateLabel, heading }: {
  rows: LastSatRow[]
  dateLabel: string
  /** "Last Saturday" for an admin (the office's Saturday); "Your Last
      Saturday" for a Staff user, whose rows are only their own clients. */
  heading: string
}) {
  const router = useRouter()
  const [reschedule, setReschedule] = useState<RescheduleModalState>({ open: false, id: '', name: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (preferredDate: string, preferredTime: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/referrals/${reschedule.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, preferredTime }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'That did not go through. Please try again.')
        return
      }
      setReschedule({ open: false, id: '', name: '' })
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const empty = rows.length === 0

  return (
    <section style={CARD}>
      {/* One block, not a flex row — the heading is plain inline text with the
          date after a middot, so nothing can collapse it. */}
      <div style={{ fontFamily: 'var(--font-montserrat)', marginBottom: empty ? '8px' : '4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#2A7F6F' }}>
          {heading}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#9AA6B2', marginLeft: '8px' }}>
          · {dateLabel}
        </span>
      </div>

      {empty ? (
        <p style={{ fontSize: '13px', color: '#7A8899', margin: 0 }}>
          No appointments last Saturday.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '12px', color: '#9AA6B2', lineHeight: 1.5, margin: '0 0 6px' }}>
            Receipts are ready by Tuesday. Missed appointments can be rescheduled.
          </p>
          {rows.map(r => {
          const pill = PILL[r.outcome]
          return (
            <div key={r.id} className="fa-dash-lastsat-row" style={{ borderTop: '1px solid #F3F0EA' }}>
              <div style={{ minWidth: 0 }}>
                <a href={`/referrals/${r.id}`} style={{ display: 'block', textDecoration: 'none', fontSize: '14px', fontWeight: 600, color: '#2A7F6F', overflowWrap: 'anywhere' }}>
                  {r.clientName}
                </a>
                <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px', overflowWrap: 'anywhere' }}>
                  {r.addressLine || '—'}
                </div>
                {r.note && (
                  <div style={{ fontSize: '12px', color: '#9AA6B2', marginTop: '3px', overflowWrap: 'anywhere' }}>
                    {r.note}
                  </div>
                )}
              </div>

              {/* Action cell — fixed column (globals.css). Always rendered, even
                  when there is no action, so the pill column stays aligned. */}
              <div className="fa-dash-lastsat-action">
                {r.outcome === 'Completed' && r.hasReceipt && r.receiptUrl && (
                  <OutlineBtn tone="doc" href={r.receiptUrl}>Client Receipt</OutlineBtn>
                )}
                {r.outcome === 'Completed' && !r.hasReceipt && (
                  <span style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.3 }}>Receipt available Tuesday</span>
                )}
                {r.outcome === 'No Show' && r.canReschedule && (
                  <OutlineBtn tone="amber" onClick={() => { setError(null); setReschedule({ open: true, id: r.id, name: r.clientName, missed: true, date: r.apptDate, time: r.apptTime }) }}>
                    Reschedule
                  </OutlineBtn>
                )}
              </div>

              {/* Pill cell — fixed column, left-aligned. */}
              <div className="fa-dash-lastsat-pill">
                <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: pill.bg, color: pill.color, whiteSpace: 'nowrap' }}>
                  {pill.label}
                </span>
              </div>
            </div>
          )
          })}
        </>
      )}

      <RescheduleModal
        modal={reschedule}
        onConfirm={submit}
        onClose={() => { setError(null); setReschedule({ open: false, id: '', name: '' }) }}
        loading={loading}
        submitError={error}
      />
    </section>
  )
}
