'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

const TRACKING_CATEGORIES = [
  {
    name: 'Bedroom Furniture',
    items: [
      'Mattress/Boxspring',
      'Bedframe',
      'Dresser',
      'Nightstand',
    ],
  },
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
    name: 'Dining Room Furniture',
    items: [
      'Chair',
      'Dining Table',
    ],
  },
  {
    name: 'Kitchen/Household',
    items: [
      'Bathroom',
      'Cookbook (# of boxes)',
      'Dishes (# of boxes)',
      'General Household',
      'Home Office',
      'Linen (# of bags)',
      'Pots/Pans/Utensils (# of boxes)',
      'Small Appliance',
    ],
  },
  {
    name: 'Baby/Kids',
    items: [
      'Baby Clothes (# of bags)',
      'Crib/Bassinet',
      'General Baby',
      'Toys/Books/School (# of boxes)',
    ],
  },
  {
    name: 'Clothes',
    items: [
      'Clothes (# of bags)',
      'Shoes (# of bags)',
    ],
  },
]

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  // Handle M/D/YYYY format from AT
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
      padding: '20px 24px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '11px',
      color: '#1a1a1a',
      maxWidth: '780px',
      margin: '0 auto',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '3px solid #1B2B4B', paddingBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#1B2B4B', letterSpacing: '-0.02em' }}>
            {client.lastName}, {client.firstName}
          </div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
            {client.address}{client.address2 ? `, ${client.address2}` : ''}{client.city ? `, ${client.city}` : ''}{client.state ? `, ${client.state}` : ''} {client.zip ?? ''}
          </div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>
            {client.phone ?? '—'} {client.language && client.language !== 'English' ? `· ${client.language}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#2A7F6F' }}>
            {client.appointmentTime ?? '—'}
          </div>
          <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
            {formatDate(client.appointmentDate)}
          </div>
          <div style={{ fontSize: '10px', color: '#555', marginTop: '1px' }}>
            HH: {client.hhSize ?? '—'} · Children: {client.children ?? '—'}
          </div>
        </div>
      </div>

      {/* Agency + Notes row */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '10px', color: '#555' }}>
        <div><strong>Agency:</strong> {client.referringAgency ?? '—'} / {client.referredBy ?? '—'}</div>
        {client.externalNotes && (
          <div style={{ flex: 1, borderLeft: '2px solid #C9A84C', paddingLeft: '8px', color: '#8a6800' }}>
            <strong>Notes:</strong> {client.externalNotes}
          </div>
        )}
      </div>

      {/* Items Requested */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1B2B4B', marginBottom: '4px' }}>Items Requested</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {requestedItems.length > 0 ? requestedItems.map((item, i) => (
            <span key={i} style={{ background: '#EAF4F2', color: '#2A7F6F', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
              {item}
            </span>
          )) : (
            <span style={{ color: '#999', fontSize: '10px' }}>None specified</span>
          )}
        </div>
      </div>

      {/* Tracking Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {TRACKING_CATEGORIES.map(cat => (
          <div key={cat.name} style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            {/* Category header */}
            <div style={{ background: '#1B2B4B', color: 'white', padding: '3px 8px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {cat.name}
            </div>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 40px', background: '#f5f5f5', borderBottom: '1px solid #ddd', padding: '2px 6px' }}>
              <div style={{ fontSize: '8px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Item</div>
              <div style={{ fontSize: '8px', fontWeight: 700, color: '#555', textTransform: 'uppercase', textAlign: 'center' }}>Hash Marks</div>
              <div style={{ fontSize: '8px', fontWeight: 700, color: '#555', textTransform: 'uppercase', textAlign: 'center' }}>Total</div>
            </div>
            {/* Items */}
            {cat.items.map((item, i) => {
              const requested = isRequested(item)
              return (
                <div key={item} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 52px 40px',
                  borderBottom: i < cat.items.length - 1 ? '1px solid #eee' : 'none',
                  background: requested ? '#fffbe6' : 'white',
                  minHeight: '18px',
                }}>
                  <div style={{ padding: '2px 6px', fontSize: '9px', color: '#1a1a1a', fontWeight: requested ? 700 : 400, display: 'flex', alignItems: 'center' }}>
                    {requested && <span style={{ color: '#2A7F6F', marginRight: '3px', fontSize: '8px' }}>★</span>}
                    {item}
                  </div>
                  <div style={{ borderLeft: '1px solid #eee', borderRight: '1px solid #eee' }} />
                  <div style={{ borderRight: 'none' }} />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Volunteer signature line */}
      <div style={{ marginTop: '10px', display: 'flex', gap: '24px', borderTop: '1px solid #ddd', paddingTop: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '9px', color: '#999', marginBottom: '12px' }}>Volunteer Initials</div>
          <div style={{ borderBottom: '1px solid #999', width: '80px' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '9px', color: '#999', marginBottom: '12px' }}>Check-out Time</div>
          <div style={{ borderBottom: '1px solid #999', width: '80px' }} />
        </div>
        <div style={{ flex: 2 }}>
          <div style={{ fontSize: '9px', color: '#999', marginBottom: '12px' }}>Additional Notes</div>
          <div style={{ borderBottom: '1px solid #999' }} />
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
  const [printed, setPrinted] = useState(false)

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
    // Mark mail merge complete in AT
    await fetch(`/api/dawson/schedule/${date}/merge`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    })
    setPrinted(true)
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
      {/* Print controls — hidden when printing */}
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

      {/* Spacer for fixed header */}
      <div className="no-print" style={{ height: '56px' }} />

      {/* Client sheets */}
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
          @page { margin: 0.5in; size: letter portrait; }
        }
      `}</style>
    </>
  )
}
