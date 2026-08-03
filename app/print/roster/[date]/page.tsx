'use client'

import { useState, useEffect, use } from 'react'

/* ============================================================
   Roster print page  —  /print/roster/[date]

   A one-page check-in list for the volunteer at the door: who is
   coming, when, and which agency sent them. Deliberately NOT the
   Saturday sheet packet (that is /print/schedule/[date]) — this is
   the quick reference, one line per client.

   Read-only by design. Unlike the sheet packet, printing a roster
   does NOT mark the mail merge complete, because the roster gets
   reprinted whenever the list changes and that must not look like
   the packet went out.
   ============================================================ */

type Client = {
  id: string
  firstName: string
  lastName: string
  clientName: string
  phone: string | null
  appointmentDate: string | null
  appointmentTime: string | null
  referredBy: string | null
  referringAgency: string | null
}

// Slot display order. Anything the API returns that is not in this
// list (or is null) falls into the trailing "No Time Assigned" group
// rather than being silently dropped — an unscheduled client still
// has to be accounted for at the door.
const SLOT_ORDER = ['9am', '10am', '11am', '12pm', '1pm']

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const MUTED = '#7A8899'
const BORDER = '#EDE9E1'

function formatLongDate(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function byName(a: Client, b: Client) {
  const lastCmp = (a.lastName ?? '').localeCompare(b.lastName ?? '')
  if (lastCmp !== 0) return lastCmp
  return (a.firstName ?? '').localeCompare(b.firstName ?? '')
}

function groupByTime(clients: Client[]) {
  const groups = new Map<string, Client[]>()
  for (const slot of SLOT_ORDER) groups.set(slot, [])

  const unassigned: Client[] = []
  for (const c of clients) {
    const t = (c.appointmentTime ?? '').trim()
    if (t && groups.has(t)) groups.get(t)!.push(c)
    else unassigned.push(c)
  }

  const out = SLOT_ORDER
    .map(slot => ({ slot, clients: groups.get(slot)!.sort(byName) }))
    .filter(g => g.clients.length > 0)

  if (unassigned.length > 0) {
    out.push({ slot: 'No Time Assigned', clients: unassigned.sort(byName) })
  }
  return out
}

function TimeGroup({ slot, clients }: { slot: string; clients: Client[] }) {
  return (
    // breakInside avoids a group being split across two sheets of paper
    // when it can be helped; large groups will still split, which is fine.
    <section style={{ marginBottom: '22px', breakInside: 'avoid' }}>

      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '10px',
        borderBottom: `2px solid ${NAVY}`, paddingBottom: '5px', marginBottom: '2px',
      }}>
        <h2 style={{
          margin: 0, fontWeight: 800, fontSize: '17px', color: NAVY,
          letterSpacing: '0.02em',
        }}>
          {slot}
        </h2>
        <span style={{ fontSize: '12px', color: MUTED, fontWeight: 600 }}>
          {clients.length} {clients.length === 1 ? 'client' : 'clients'}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            {['Client', 'Agency', 'Agency Contact'].map((h, i) => (
              <th key={h} style={{
                textAlign: 'left', padding: '6px 6px 5px',
                fontSize: '9.5px', fontWeight: 800, color: MUTED,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                width: i === 0 ? '34%' : '33%',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clients.map(c => (
            <tr key={c.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ padding: '7px 6px', color: '#1a1a1a', fontWeight: 700 }}>
                {c.lastName}, {c.firstName}
              </td>
              <td style={{ padding: '7px 6px', color: '#1a1a1a' }}>
                {c.referringAgency || '—'}
              </td>
              <td style={{ padding: '7px 6px', color: '#1a1a1a' }}>
                {c.referredBy || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default function RosterPrintPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params)

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/dawson/schedule/${date}/clients`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        if (Array.isArray(data)) setClients(data)
        else setError(data?.error ?? 'Failed to load clients')
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clients')
      })
      // .finally so a failed fetch cannot leave the page spinning forever.
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [date])

  const groups = groupByTime(clients)

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }}>
      <style>{`
        @page { size: letter portrait; margin: 0.5in; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
        }
      `}</style>

      {/* Toolbar — screen only */}
      <div className="no-print" style={{
        background: 'white', borderBottom: `1px solid ${BORDER}`,
        padding: '0 32px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontWeight: 800, fontSize: '16px', color: NAVY }}>
          Roster — {formatLongDate(date)}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a href="/dawson/schedule" style={{
            padding: '9px 16px', borderRadius: '8px', border: `1px solid ${BORDER}`,
            background: 'white', fontSize: '13px', fontWeight: 700, color: MUTED,
            textDecoration: 'none',
          }}>
            Back to Schedule
          </a>
          <button
            onClick={() => window.print()}
            disabled={loading || !!error || clients.length === 0}
            style={{
              padding: '10px 22px', borderRadius: '8px', border: 'none',
              background: TEAL, color: 'white', fontSize: '14px', fontWeight: 700,
              cursor: loading || error || clients.length === 0 ? 'not-allowed' : 'pointer',
              opacity: loading || error || clients.length === 0 ? 0.5 : 1,
              fontFamily: 'inherit',
            }}>
            Print Roster
          </button>
        </div>
      </div>

      <div style={{ padding: '28px 32px' }}>
        <div className="sheet" style={{
          background: 'white', borderRadius: '10px', padding: '36px 40px',
          maxWidth: '8.5in', margin: '0 auto',
          boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        }}>

          {/* Printed header */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
            borderBottom: `3px solid ${NAVY}`, paddingBottom: '10px', marginBottom: '22px',
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '22px', color: NAVY, lineHeight: 1.2 }}>
                Saturday Roster
              </div>
              <div style={{ fontSize: '13px', color: MUTED, marginTop: '3px' }}>
                {formatLongDate(date)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontSize: '26px', color: NAVY, lineHeight: 1 }}>
                {clients.length}
              </div>
              <div style={{
                fontSize: '9.5px', color: MUTED, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: '3px',
              }}>
                Total Clients
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: MUTED }}>
              Loading roster…
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '48px' }}>
              <div style={{ fontWeight: 700, color: '#C0392B', marginBottom: '8px' }}>
                Could not load the roster
              </div>
              <div style={{ fontSize: '13px', color: MUTED, marginBottom: '20px' }}>{error}</div>
              <button onClick={() => window.location.reload()} style={{
                padding: '9px 18px', borderRadius: '8px', border: `1px solid ${BORDER}`,
                background: 'white', fontSize: '13px', fontWeight: 700, color: TEAL,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Try Again
              </button>
            </div>
          ) : clients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: MUTED, fontSize: '14px' }}>
              No appointments scheduled for this date.
            </div>
          ) : (
            groups.map(g => <TimeGroup key={g.slot} slot={g.slot} clients={g.clients} />)
          )}

        </div>
      </div>
    </div>
  )
}
