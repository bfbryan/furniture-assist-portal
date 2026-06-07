'use client'

import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'

type Client = {
  id: string
  firstName: string
  lastName: string
  clientName: string
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  dob: string | null
  language: string | null
  hhSize: string | null
  children: string | null
  items: string | null
  appointmentDate: string | null
  appointmentTime: string | null
  referredBy: string | null
  referringAgency: string | null
  externalNotes: string | null
}

const LEFT_CATEGORIES = [
  {
    name: 'Living Room Furniture',
    items: [
      'Bookcase/Storage',
      'Chair',
      'Coffee Table',
      'Couch/Loveseat/Futon',
      'End Table/TV Stand',
      'Lamp',
      'Picture/Other Decor',
      'Rug',
      'Student Desk',
      'TV/Electronics',
    ],
  },
  {
    name: 'Bedroom Furniture',
    items: [
      'Bedframe',
      'Dresser',
      'Mattress/Boxspring',
      'Nightstand',
    ],
  },
  {
    name: 'Dining Room Furniture',
    items: [
      'Chair',
      'Dining Table',
    ],
  },
]

const RIGHT_CATEGORIES = [
  {
    name: 'Kitchen/Household',
    items: [
      'Bathroom',
      'Cookbook (# boxes)',
      'Dishes (# boxes)',
      'General Household',
      'Home Office',
      'Linen (# bags)',
      'Pots/Pans/Utensils',
      'Small Appliance',
    ],
  },
  {
    name: 'Clothes',
    items: [
      'Clothes (# bags)',
      'Shoes (# bags)',
    ],
  },
  {
    name: 'Baby/Kids',
    items: [
      'Baby Clothes (# bags)',
      'Crib/Bassinet',
      'General Baby',
      'Toys/Books/School',
    ],
  },
]

function formatDateNoWeekday(dateStr: string | null) {
  if (!dateStr) return '—'
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}T12:00:00`)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}T12:00:00`)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatSaturdayDate(dateStr: string) {
  const [year, month, day] = dateStr.split('-')
  const d = new Date(`${year}-${month}-${day}T12:00:00`)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function QRCodeImage({ value, size = 64 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  }, [value, size])

  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}

function CategoryBlock({ cat }: { cat: { name: string; items: string[] } }) {
  return (
    <div style={{ border: '1px solid #999', borderRadius: '3px', overflow: 'hidden', marginBottom: '5px' }}>
      <div style={{
        background: '#1B2B4B', color: 'white', padding: '3px 7px',
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        {cat.name}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 60px 38px',
        background: '#e8e8e8', borderBottom: '1px solid #999', padding: '2px 5px',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase' }}>Item</div>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase', textAlign: 'center' }}>Hash</div>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase', textAlign: 'center' }}>Qty</div>
      </div>
      {cat.items.map((item, i) => (
        <div key={item} style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 38px',
          borderBottom: i < cat.items.length - 1 ? '1px solid #e0e0e0' : 'none',
          background: 'white',
          minHeight: '20px',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        } as React.CSSProperties}>
          <div style={{ padding: '2px 5px', fontSize: '12px', color: '#1a1a1a', fontWeight: 400, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {item}
          </div>
          <div style={{ borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd' }} />
          <div />
        </div>
      ))}
    </div>
  )
}

/* ============================================================
   ROSTER PAGE — alphabetical roster, prints as page 1
   ============================================================ */
function RosterPage({ clients, date }: { clients: Client[]; date: string }) {
  const half = Math.ceil(clients.length / 2)
  const col1 = clients.slice(0, half)
  const col2 = clients.slice(half)

  return (
    <div style={{
      pageBreakAfter: 'always',
      pageBreakInside: 'avoid',
      padding: '24px 28px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      color: '#1a1a1a',
      maxWidth: '780px',
      margin: '0 auto',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '14px',
        paddingBottom: '10px', borderBottom: '3px solid #1B2B4B', marginBottom: '16px',
      }}>
        <img
          src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
          alt="Furniture Assist"
          style={{ width: '64px', height: '64px', objectFit: 'contain' }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '26px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>
            Saturday Appointment Roster
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#2A7F6F', marginTop: '4px' }}>
            {formatSaturdayDate(date)}
          </div>
        </div>
        <div style={{
          fontSize: '13px', color: '#7A8899', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {clients.length} appointment{clients.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Two-column roster */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <RosterColumn clients={col1} />
        <RosterColumn clients={col2} />
      </div>
    </div>
  )
}

function RosterColumn({ clients }: { clients: Client[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #1B2B4B' }}>
          <th style={{
            textAlign: 'left', padding: '6px 4px',
            color: '#1B2B4B', fontSize: '10px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>Client</th>
          <th style={{
            textAlign: 'right', padding: '6px 4px', width: '70px',
            color: '#1B2B4B', fontSize: '10px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {clients.map((c) => (
          <tr key={c.id} style={{ borderBottom: '1px solid #e8e8e8' }}>
            <td style={{ padding: '5px 4px', color: '#1a1a1a' }}>
              {c.lastName}, {c.firstName}
            </td>
            <td style={{
              padding: '5px 4px', textAlign: 'right',
              fontVariantNumeric: 'tabular-nums', color: '#1B2B4B', fontWeight: 700,
            }}>
              {c.appointmentTime ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ClientSheet({ client, index, total }: { client: Client; index: number; total: number }) {
  const requestedItems = client.items
  ? (Array.isArray(client.items) ? client.items : client.items.split(','))
      .map((i: string) => i.trim().toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim())
      .filter(Boolean)
  : []

  return (
    <div style={{
      pageBreakAfter: index < total - 1 ? 'always' : 'avoid',
      pageBreakInside: 'avoid',
      padding: '14px 18px 28px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '11px',
      color: '#1a1a1a',
      maxWidth: '780px',
      margin: '0 auto',
      position: 'relative',
      boxSizing: 'border-box',
    }}>

      {/* TOP BANNER: Logo | No Show | Client # */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px', gap: '10px', marginBottom: '10px', paddingBottom: '8px', borderBottom: '3px solid #1B2B4B' }}>

        {/* Logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg" alt="Furniture Assist" style={{ width: '78px', height: '78px', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>Furniture Assist</div>
            <div style={{ fontSize: '11px', color: '#7A8899', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '5px', fontWeight: 700 }}>Client Pickup Sheet</div>
          </div>
        </div>

        {/* No Show box */}
        <div style={{
          border: '3px solid #C0392B', borderRadius: '8px', padding: '8px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        } as React.CSSProperties}>
          <div style={{ fontSize: '10px', fontWeight: 900, color: '#C0392B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            No Show
          </div>
          <div style={{
            width: '38px', height: '38px', border: '2.5px solid #C0392B', borderRadius: '4px',
            WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
          } as React.CSSProperties} />
        </div>

        {/* Client # box */}
        <div style={{
          border: '3px solid #1B2B4B', borderRadius: '8px', padding: '8px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 900, color: '#1B2B4B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Client #
          </div>
          <div style={{ fontSize: '32px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1, minHeight: '38px', minWidth: '70px' }}>&nbsp;</div>
        </div>
      </div>

      {/* CLIENT INFO CARD — full width */}
      <div style={{ border: '1px solid #dcdcdc', borderRadius: '6px', padding: '12px 16px', background: '#F5F5F5', marginBottom: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

          {/* LEFT: Name / Time · Date / Address / Phone / Language */}
          <div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#1B2B4B', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {client.lastName}, {client.firstName}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#2A7F6F', lineHeight: 1.1, marginTop: '4px' }}>
              {client.appointmentTime ?? '—'} · {formatDateNoWeekday(client.appointmentDate)}
            </div>
            <div style={{ fontSize: '11.5px', color: '#1B2B4B', lineHeight: 1.55, marginTop: '10px' }}>
              <div>
                {client.address}{client.address2 ? `, ${client.address2}` : ''}{client.city ? `, ${client.city}` : ''}{client.state ? `, ${client.state}` : ''} {client.zip ?? ''}
              </div>
              <div>{client.phone ?? '—'}</div>
              <div>{client.language ?? '—'}</div>
            </div>
          </div>

          {/* RIGHT: ID / Agency / Household + Items */}
          <div style={{ fontSize: '11.5px', lineHeight: 1.55, textAlign: 'right' }}>
            <div>
              <span style={{ color: '#7A8899', fontWeight: 700 }}>ID: </span>
              <span style={{
                fontFamily: 'var(--font-roboto-mono), "Courier New", monospace',
                fontSize: '13px',
                fontWeight: 600,
                color: '#000',
                letterSpacing: '0.15em',
              }}>
                {client.id}
              </span>
            </div>
            <div>&nbsp;</div>
            <div>
              <span style={{ color: '#7A8899', fontWeight: 700 }}>Agency: </span>
              <span style={{ color: '#1B2B4B' }}>{client.referringAgency ?? '—'}{client.referredBy ? ` / ${client.referredBy}` : ''}</span>
            </div>
            <div>&nbsp;</div>
            <div>
              <span style={{ color: '#7A8899', fontWeight: 700 }}>Household: </span>
              <span style={{ color: '#1B2B4B' }}>{client.hhSize ?? '—'}{client.children ? ` (${client.children} children)` : ''}</span>
            </div>
            <div>
              <span style={{ color: '#7A8899', fontWeight: 700 }}>Items: </span>
              <span style={{ color: '#1B2B4B' }}>{requestedItems.length > 0 ? requestedItems.join(' · ') : 'None specified'}</span>
            </div>
          </div>

        </div>

        {/* External notes warning, if any */}
        {client.externalNotes && (
          <div style={{ marginTop: '8px', fontSize: '10.5px', color: '#8a6800', borderLeft: '3px solid #C9A84C', paddingLeft: '8px', lineHeight: 1.4 }}>
            {client.externalNotes}
          </div>
        )}
      </div>

      {/* ITEMS TABLE — maximum space */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <div>
          {LEFT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} />
          ))}
        </div>
        <div>
          {RIGHT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} />
          ))}
        </div>
      </div>

      {/* BOTTOM STRIP: Initials | Time | Notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 130px 1fr', gap: '10px' }}>

        <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '78px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Initials</div>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '78px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-out Time</div>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '78px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Additional Notes</div>
          <div style={{ flex: 1 }} />
        </div>
      </div>

    </div>
  )
}

export default function PrintPage({ params }: { params: Promise<{ date: string }> }) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string>('')

  useEffect(() => {
    params.then(({ date }) => {
      setDate(date)
      fetch(`/api/dawson/schedule/${date}/clients`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            const sorted = [...data].sort((a, b) => {
              const lastCmp = (a.lastName ?? '').localeCompare(b.lastName ?? '')
              if (lastCmp !== 0) return lastCmp
              return (a.firstName ?? '').localeCompare(b.firstName ?? '')
            })
            setClients(sorted)
          } else {
            setError(data.error ?? 'Failed to load clients')
          }
          setLoading(false)
        })
    })
  }, [params])

  async function handlePrint() {
    await fetch(`/api/dawson/schedule/${date}/merge`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    })
    window.print()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#7A8899', fontFamily: 'Arial' }}>
      Loading client sheets...
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#C0392B', fontFamily: 'Arial' }}>
      {error}
    </div>
  )

  return (
    <>
      <div className="no-print" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: '#1B2B4B', padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '14px' }}>
          {formatSaturdayDate(date)} · {clients.length} client{clients.length !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <a href="/dawson/schedule" style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', color: 'white', fontSize: '13px', fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--font-montserrat)' }}>
            ← Back
          </a>
          <button onClick={handlePrint}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', background: '#2A7F6F', color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-montserrat)' }}>
            🖨 Print Roster + {clients.length} sheets
          </button>
        </div>
      </div>

      <div className="no-print" style={{ height: '56px' }} />

      {clients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontFamily: 'Arial' }}>
          No scheduled clients found for this date.
        </div>
      ) : (
        <div className="print-sheet-wrapper">
          <RosterPage clients={clients} date={date} />
          {clients.map((client, i) => (
            <ClientSheet key={client.id} client={client} index={i} total={clients.length} />
          ))}
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; height: auto !important; }
          body > *:not(.print-sheet-wrapper) { display: none !important; }
          .print-sheet-wrapper { margin: 0 !important; padding: 0 !important; }
          .print-sheet-wrapper > div:last-child { 
            page-break-after: avoid !important; 
            margin-bottom: 0 !important; 
          }
          @page { margin: 0.4in; size: letter portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </>
  )
}