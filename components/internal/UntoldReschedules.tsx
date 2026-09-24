'use client'

// components/internal/UntoldReschedules.tsx
//
// "Booked, agency not told" — referrals that are on the books, whose agency
// asked for the move, and whose Reschedule Notice either never sent or last
// sent BEFORE the request. Rendered at the foot of /dawson/admin.
//
// WHY IT IS HERE AND NOT ON NEEDS ACTION. Ben's call: this is a system fault,
// not scheduling work. Every card on Needs Action is a decision Dawson has to
// take; this is a decision he believes he has already taken, and putting it in
// his queue would make him responsible for a bug he has no way to act on
// differently. Ben owns it, so it sits on the page only Ben opens.
//
// A CLIENT COMPONENT inside a server page. /dawson/admin is otherwise entirely
// server-rendered and has no client code at all; keeping this separate means
// the three links above it stay that way rather than the whole page turning
// into a client bundle for the sake of one button's armed/loading state.
//
// ALWAYS RENDERS ITS HEADING, including when there is nothing to show. The
// opposite of the hide-when-empty rule every Needs Action card follows, and
// deliberately so: that page is a queue, where an absent card means "no work".
// This page is one Ben opens to CHECK something, and there a section that
// vanishes when empty cannot be told apart from one that was never built or
// one that silently failed to load. "Nothing outstanding" is a different
// statement from nothing at all.
//
// The filter is server-side — getAllReferrals({ rescheduleNoticeMissing }) in
// lib/airtable/referrals.ts, exposed as ?rescheduleNoticeMissing=true. See
// that condition for why it needs no Email Log join: {Reschedule Email Sent
// At} is written only on a successful send, so a stale value is itself the
// signal.

import { useCallback, useEffect, useState } from 'react'
import { formatDateOnly } from '@/lib/dates'

type Row = {
  id: string
  clientName: string
  appointmentDate: string | null
  appointmentTime: string | null
  rescheduleRequestedAt: string | null
  rescheduleEmailSentAt: string | null
  referringAgency: string | null
}

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 8px rgba(27,43,75,0.06)',
  maxWidth: '760px',
  overflow: 'hidden',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return formatDateOnly(iso.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtSlot(date: string | null, time: string | null): string {
  if (!date) return '—'
  return time ? `${fmtDate(date)}, ${time}` : fmtDate(date)
}

function ResendButton({
  row, onDone,
}: {
  row: Row
  onDone: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function click() {
    if (!armed) { setArmed(true); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dawson/referrals/${row.id}/resend-reschedule-notice`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Resend failed (${res.status})`)
        setArmed(false)
        return
      }

      // NOT a 200 check. The route returns 200 whenever it REACHED the notice;
      // the notice reports its own outcome in `result`. Treating the status
      // alone as success would have this button report a send that never
      // happened — which is the exact failure this whole section exists to
      // surface, reproduced one level up.
      const result = body?.result
      if (result && !result.sent) {
        const why = result.message
          ?? (result.skipped ? `not sent (${result.reason})` : `failed — ${result.error}`)
        setError(`Notice ${why}`)
        setArmed(false)
        return
      }

      setSent(true)
      onDone()
    } catch {
      setError('Network error — please try again.')
      setArmed(false)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#2A7F6F', whiteSpace: 'nowrap' }}>
        ✓ Sent
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {armed && (
          <button
            type="button"
            onClick={() => { setArmed(false); setError(null) }}
            disabled={loading}
            style={{
              padding: '7px 12px', borderRadius: '7px', border: 'none', background: '#F0F0F0',
              color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700,
              fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={click}
          disabled={loading}
          title="Re-send the reschedule notice. Does not re-book or change the appointment."
          style={{
            padding: '7px 12px', borderRadius: '7px', border: 'none',
            background: loading ? '#EDEBE7' : '#2A7F6F',
            color: loading ? '#B8C1CC' : 'white',
            fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
            cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {loading ? '…' : armed ? 'Confirm resend' : 'Resend'}
        </button>
      </div>
      {armed && !error && (
        <div style={{ fontSize: '11.5px', color: '#7A8899', lineHeight: 1.5, textAlign: 'right' }}>
          Emails {row.referringAgency ?? 'the agency'}. Nothing on the record changes.
        </div>
      )}
      {error && (
        <div style={{ fontSize: '11.5px', color: '#C0392B', lineHeight: 1.5, textAlign: 'right' }}>
          {error}
        </div>
      )}
    </div>
  )
}

export default function UntoldReschedules() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    fetch('/api/dawson/referrals?rescheduleNoticeMissing=true', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((d) => { setRows(Array.isArray(d) ? d : []); setFailed(false) })
      // A failed load must not render as "Nothing outstanding" — that is the
      // same class of lie as a 200 meaning a send happened.
      .catch(() => { setRows([]); setFailed(true) })
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ marginTop: '28px' }}>
      <div style={{
        fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '14px',
        color: '#1B2B4B', marginBottom: '4px',
      }}>
        Booked, agency not told
      </div>
      <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6, marginBottom: '12px', maxWidth: '760px' }}>
        Appointments that were moved without the reschedule notice reaching the
        agency. Resend sends the email again — it does not re-book anything or
        change the appointment.
      </div>

      <div style={CARD}>
        {rows === null ? (
          <div style={{ padding: '18px 24px', fontSize: '13px', color: '#7A8899' }}>Loading…</div>
        ) : failed ? (
          <div style={{ padding: '18px 24px', fontSize: '13px', color: '#C0392B', lineHeight: 1.5 }}>
            Could not load this list. It is not safe to read that as “nothing
            outstanding” — reload the page.
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '18px 24px', fontSize: '13px', color: '#7A8899' }}>
            Nothing outstanding.
          </div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                padding: '18px 24px',
                borderTop: i === 0 ? 'none' : '1px solid #EDE9E1',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                <a
                  href={`/dawson/referrals/${r.id}`}
                  style={{
                    display: 'inline-block', textDecoration: 'none', fontSize: '14px',
                    fontWeight: 600, color: '#2A7F6F', marginBottom: '4px',
                  }}
                >
                  {r.clientName}
                </a>
                <div style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.5 }}>
                  {r.referringAgency ?? 'Agency unknown'}
                </div>
                {/* Dates never truncate here — same rule as the Needs Action
                    rows: a date with its tail cut off is worse than a wrapped
                    one. */}
                <div style={{ fontSize: '13px', color: '#1B2B4B', lineHeight: 1.5, marginTop: '4px' }}>
                  Booked {fmtSlot(r.appointmentDate, r.appointmentTime)}
                </div>
                <div style={{ fontSize: '12.5px', color: '#8B7724', fontWeight: 600, lineHeight: 1.5 }}>
                  {r.rescheduleEmailSentAt
                    ? `Last notice ${fmtDate(r.rescheduleEmailSentAt)} — before the request`
                    : 'No reschedule notice ever sent'}
                </div>
                <div style={{ fontSize: '12px', color: '#9AA6B2', lineHeight: 1.5 }}>
                  Requested {fmtDate(r.rescheduleRequestedAt)}
                </div>
              </div>

              <div style={{ flexShrink: 0 }}>
                <ResendButton row={r} onDone={load} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
