'use client'

import { useState, useEffect } from 'react'

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

function CategoryBlock({ cat, isRequested }: { cat: { name: string; items: string[] }; isRequested: (item: string) => boolean }) {
  return (
    <div style={{ border: '1px solid #999', borderRadius: '3px', overflow: 'hidden', marginBottom: '5px' }}>
      {/* Category header — force color print */}
      <div style={{
        background: '#1B2B4B', color: 'white', padding: '3px 7px',
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        {cat.name}
      </div>
      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 60px 38px',
        background: '#e8e8e8', borderBottom: '1px solid #999', padding: '2px 5px',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase' }}>Item</div>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase', textAlign: 'center' }}>Hash</div>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#333', textTransform: 'uppercase', textAlign: 'center' }}>Qty</div>
      </div>
      {/* Items */}
      {cat.items.map((item, i) => {
        const requested = isRequested(item)
        return (
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
        )
      })}
    </div>
  )
}

function ClientSheet({ client, index, total }: { client: Client; index: number; total: number }) {
  const requestedItems = client.items
    ? (Array.isArray(client.items) ? client.items : client.items.split(',')).map((i: string) => i.trim().toLowerCase())
    : []

  const isRequested = (item: string) =>
    requestedItems.some(r => r.includes(item.toLowerCase()) || item.toLowerCase().includes(r))

  return (
    <div style={{
      pageBreakAfter: index < total - 1 ? 'always' : 'auto',
      pageBreakInside: 'avoid',
      padding: '14px 18px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '11px',
      color: '#1a1a1a',
      maxWidth: '780px',
      margin: '0 auto',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '8px', borderBottom: '3px solid #1B2B4B' }}>
        {/* Logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg" alt="Furniture Assist" style={{ width: '52px', height: '52px', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '17px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>Furniture Assist</div>
            <div style={{ fontSize: '10px', color: '#7A8899', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '3px' }}>Client Pickup Sheet</div>
          </div>
        </div>

        {/* Center — Time + Date pill */}
        <div style={{
          textAlign: 'center',
          background: '#1B2B4B', color: 'white',
          padding: '8px 22px', borderRadius: '8px',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        } as React.CSSProperties}>
          <div style={{ fontSize: '28px', fontWeight: 900, color: '#3AA08D', lineHeight: 1, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>
            {client.appointmentTime ?? '—'}
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.9)', marginTop: '3px', whiteSpace: 'nowrap' }}>
            {formatDate(client.appointmentDate)}
          </div>
        </div>

        {/* Client # box */}
        <div style={{ textAlign: 'center', border: '3px solid #1B2B4B', borderRadius: '8px', padding: '6px 14px', minWidth: '75px' }}>
          <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Client #</div>
          <div style={{ fontSize: '26px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1, minWidth: '55px', minHeight: '30px' }}>&nbsp;</div>
        </div>
      </div>

      {/* Client Name + Address */}
      <div style={{ marginBottom: '7px' }}>
        <div style={{ fontSize: '21px', fontWeight: 900, color: '#1B2B4B', letterSpacing: '-0.01em', lineHeight: 1 }}>
          {client.lastName}, {client.firstName}
        </div>
        <div style={{ fontSize: '12px', color: '#444', marginTop: '3px' }}>
          {client.address}{client.address2 ? `, ${client.address2}` : ''}{client.city ? `, ${client.city}` : ''}{client.state ? `, ${client.state}` : ''} {client.zip ?? ''}
          {' · '}{client.phone ?? '—'}
          {client.language && client.language !== 'English' ? ` · ${client.language}` : ''}
        </div>
      </div>

      {/* Agency box + HH/Items box — agency smaller, items larger */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '10px', marginBottom: '15px' }}>

        {/* Agency box — narrower */}
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '6px 9px', background: '#fafafa' }}>
          <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '3px' }}>Agency / Staff</div>
          <div style={{ fontSize: '11px', color: '#1a1a1a', fontWeight: 700 }}>{client.referringAgency ?? '—'}</div>
          <div style={{ fontSize: '10px', color: '#555', marginTop: '1px' }}>{client.referredBy ?? '—'}</div>
          {client.externalNotes && (
            <div style={{ marginTop: '4px', fontSize: '9.5px', color: '#8a6800', borderLeft: '2px solid #C9A84C', paddingLeft: '5px', lineHeight: 1.4 }}>
              {client.externalNotes}
            </div>
          )}
        </div>

        {/* HH + Items box — wider */}
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '6px 9px', background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Left — Items Requested */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Items Requested</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {requestedItems.length > 0 ? requestedItems.map((item, i) => (
                  <span key={i} style={{
                    background: '#EAF4F2', color: '#2A7F6F',
                    padding: '2px 7px', borderRadius: '3px', fontSize: '9.5px', fontWeight: 700,
                    WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
                  } as React.CSSProperties}>
                    {item}
                  </span>
                )) : (
                  <span style={{ color: '#999', fontSize: '10px' }}>None specified</span>
                )}
              </div>
            </div>
            {/* Right — Household */}
            <div style={{ textAlign: 'right', flexShrink: 0, borderLeft: '1px solid #eee', paddingLeft: '10px' }}>
              <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: '#888', letterSpacing: '0.06em', marginBottom: '4px' }}>Household</div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '8px', color: '#888' }}>HH Size</div>
                  <div style={{ fontSize: '16px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>{client.hhSize ?? '—'}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '8px', color: '#888' }}>Children</div>
                  <div style={{ fontSize: '16px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>{client.children ?? '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Tracking Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
        <div>
          {LEFT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} isRequested={isRequested} />
          ))}
        </div>
        <div>
          {RIGHT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} isRequested={isRequested} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: '12px', borderTop: '2px solid #ccc', paddingTop: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '130px', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '9px', color: '#888', marginBottom: '14px' }}>Volunteer Initials</div>
            <div style={{ borderBottom: '1px solid #999', width: '70px' }} />
          </div>
          <div>
            <div style={{ fontSize: '9px', color: '#888', marginBottom: '14px' }}>Check-out Time</div>
            <div style={{ borderBottom: '1px solid #999', width: '70px' }} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '9px', color: '#888', marginBottom: '5px' }}>Additional Notes</div>
          <div style={{ border: '1px solid #ccc', borderRadius: '4px', height: '52px', background: 'white' }} />
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
            setClients(data)
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
            🖨 Print All ({clients.length} sheets)
          </button>
        </div>
      </div>

      <div className="no-print" style={{ height: '56px' }} />

      {clients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontFamily: 'Arial' }}>
          No scheduled clients found for this date.
        </div>
      ) : (
        clients.map((client, i) => (
          <ClientSheet key={client.id} client={client} index={i} total={clients.length} />
        ))
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          @page { margin: 0.4in; size: letter portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </>
  )
}
