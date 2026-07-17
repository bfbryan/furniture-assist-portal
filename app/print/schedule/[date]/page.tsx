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


/* ============================================================
   CategoryBlock — header row now contains HASH + QTY column labels
   (separate Item/Hash/Qty header row removed to save 3 lines)
   Hash column is now wider (90px vs 60px). Item rows have darker borders.
   ============================================================ */
function CategoryBlock({ cat }: { cat: { name: string; items: string[] } }) {
  return (
    <div style={{ border: '1.5px solid #333', borderRadius: '3px', overflow: 'hidden', marginBottom: '5px' }}>
      {/* Combined section header: name + HASH + QTY labels */}
      <div style={{
        background: '#1B2B4B', color: '#ffffff', padding: '3px 7px',
        display: 'grid', gridTemplateColumns: '1fr 65px 65px',
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        <div style={{ color: '#ffffff' }}>{cat.name}</div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#ffffff' }}>Hash</div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#ffffff' }}>Qty</div>
      </div>
      {cat.items.map((item, i) => (
        <div key={item} style={{
          display: 'grid',
          gridTemplateColumns: '1fr 65px 65px',
          borderBottom: i < cat.items.length - 1 ? '1px solid #555' : 'none',
          background: 'white',
          minHeight: '23px',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        } as React.CSSProperties}>
          <div style={{ padding: '2px 5px', fontSize: '12px', color: '#1a1a1a', fontWeight: 400, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {item}
          </div>
          <div style={{ borderLeft: '1px solid #555', borderRight: '1px solid #555' }} />
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


/* ============================================================
   Reusable outcome control box (No Show / Cancelled / Reschedule)
   ============================================================ */
function OutcomeBox({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      border: `3px solid ${color}`, borderRadius: '6px', padding: '6px 10px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '5px',
      minWidth: '90px',
      WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
    } as React.CSSProperties}>
      <div style={{ fontSize: '10.5px', fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', lineHeight: 1.1 }}>
        {label}
      </div>
      <div style={{
        width: '36px', height: '36px', border: `3px solid ${color}`, borderRadius: '4px',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties} />
    </div>
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


      {/* TOP BANNER: Logo+title (wrapped) | [flex spacer] | No Show | Cancelled | Reschedule | [flex spacer] | Client# */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        marginBottom: '18px', paddingBottom: '10px',
        borderBottom: '3px solid #1B2B4B',
        gap: '10px',
      }}>


        {/* Logo + title (Furniture / Assist wrapped on 2 lines) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
          <img src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg" alt="Furniture Assist" style={{ width: '72px', height: '72px', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1 }}>Furniture</div>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1, marginTop: '2px' }}>Assist</div>
            <div style={{ fontSize: '10.5px', color: '#7A8899', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '5px', fontWeight: 700 }}>Client Pickup Sheet</div>
          </div>
        </div>


        {/* Flex spacer pushes outcome boxes toward center */}
        <div style={{ flex: 1 }} />


        {/* Outcome boxes — centered as a group */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', flexShrink: 0 }}>
          <OutcomeBox label="No Show" color="#6A1B9A" />
          <OutcomeBox label="Cancelled" color="#C0392B" />
          <OutcomeBox label="Reschedule" color="#C9A84C" />
        </div>


        {/* Flex spacer pushes Client# to right */}
        <div style={{ flex: 1 }} />


        {/* Client/Car # box — right-justified */}
        <div style={{
          border: '3px solid #1B2B4B', borderRadius: '8px', padding: '6px 10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px',
          flexShrink: 0, minWidth: '105px',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 900, color: '#1B2B4B', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', lineHeight: 1.1 }}>
            Client / Car #
          </div>
          <div style={{ fontSize: '30px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1, minHeight: '36px', minWidth: '65px' }}>&nbsp;</div>
        </div>
      </div>


      {/* CLIENT INFO CARD — Notes removed (now lives in bottom Notes box) */}
      <div style={{ border: '1.5px solid #333', borderRadius: '6px', padding: '12px 16px', background: 'white', marginBottom: '18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'center' }}>


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


          {/* RIGHT: ID / Agency / Household + Items (External notes removed from here) */}
          <div style={{ fontSize: '11.5px', lineHeight: 1.55, textAlign: 'right', alignSelf: 'center' }}>
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
      </div>


      {/* ITEMS TABLE — maximum space (no Item/Hash/Qty subheader row; labels are in section header) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
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


      {/* BOTTOM STRIP: Initials | Checkout Time | Notes (darker borders, label cue for reschedule date) */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 130px 1fr', gap: '10px' }}>


        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '105px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>Initials</div>
          <div style={{ flex: 1 }} />
        </div>


        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '105px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-out Time</div>
          <div style={{ flex: 1 }} />
        </div>


        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '6px 9px', background: 'white', height: '105px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>
            Notes <span style={{ color: '#888', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(if reschedule, write new date here)</span>
          </div>
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
  const [merging, setMerging] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)


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
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Failed to load clients')
          setLoading(false)
        })
    })
  }, [params])


  // Shared merge-flag call used by both Print and Save-as-PDF flows.
  // Returns true if the caller should proceed (either the merge succeeded,
  // or the user chose to proceed anyway after a failure).
  async function markMergeAndConfirm(actionLabel: string): Promise<boolean> {
    setMerging(true)
    try {
      const res = await fetch(`/api/dawson/schedule/${date}/merge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        // Read the error body but don't let a parse failure block the flow.
        let msg = `${res.status} ${res.statusText}`
        try {
          const body = await res.json()
          if (body?.error) msg = body.error
        } catch {}
        return window.confirm(
          `Mail Merge Complete flag failed to update: ${msg}\n\n${actionLabel} anyway?`
        )
      }
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      return window.confirm(
        `Mail Merge Complete flag failed to update: ${msg}\n\n${actionLabel} anyway?`
      )
    } finally {
      setMerging(false)
    }
  }


  async function handlePrint() {
    const proceed = await markMergeAndConfirm('Print')
    if (!proceed) return
    window.print()
  }


  // Lazy-load html2canvas + jsPDF from CDN on first click.
  // Cached on window so subsequent clicks are instant.
  async function loadPdfLibs(): Promise<{ html2canvas: any; jsPDF: any }> {
    const w = window as any
    if (w.__pdfLibs) return w.__pdfLibs

    function loadScript(src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src
        s.onload = () => resolve()
        s.onerror = () => reject(new Error(`Failed to load ${src}`))
        document.head.appendChild(s)
      })
    }

    if (!w.html2canvas) {
      await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
    }
    if (!w.jspdf) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
    }

    w.__pdfLibs = { html2canvas: w.html2canvas, jsPDF: w.jspdf.jsPDF }
    return w.__pdfLibs
  }


  // Fetch a cross-origin image and convert to a base64 data URL.
  // html2canvas can't rasterize remote images without CORS headers,
  // but data URLs always work (same-origin by definition).
  async function fetchImageAsDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    } catch (e) {
      // If we can't fetch (CORS block, network, etc.), skip — sheet still generates without logo.
      // eslint-disable-next-line no-console
      console.warn('Logo prefetch failed:', e)
      return null
    }
  }

  async function handleSavePdf() {
    const proceed = await markMergeAndConfirm('Save PDF')
    if (!proceed) return

    setGeneratingPdf(true)

    // Letter @ 96 DPI = 816 × 1056 px. Every page renders at this exact size
    // so all pages share identical aspect ratio and scale in the final PDF.
    const LETTER_W_PX = 816
    const LETTER_H_PX = 1056

    // Off-screen staging container. We clone each sheet into here at a
    // fixed letter size before rasterizing, so on-screen layout variations
    // (Items text wrapping to 1 vs 2 lines, etc.) don't affect scale.
    const stage = document.createElement('div')
    stage.style.position = 'fixed'
    stage.style.top = '0'
    stage.style.left = '-10000px' // off-screen but rendered
    stage.style.width = `${LETTER_W_PX}px`
    stage.style.height = `${LETTER_H_PX}px`
    stage.style.background = '#ffffff'
    stage.style.overflow = 'hidden'
    stage.style.zIndex = '-1'
    document.body.appendChild(stage)

    // Pre-fetch the logo once so every cloned page can use the data URL.
    const LOGO_URL = 'https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg'
    const logoDataUrl = await fetchImageAsDataUrl(LOGO_URL)

    try {
      const { html2canvas, jsPDF } = await loadPdfLibs()

      const wrapper = document.querySelector('.print-sheet-wrapper') as HTMLElement | null
      if (!wrapper) throw new Error('Could not find sheet wrapper')

      const pages = Array.from(wrapper.children) as HTMLElement[]
      if (pages.length === 0) throw new Error('No pages to render')

      // Letter portrait, points (72 pt/in) — matches @page { size: letter portrait }.
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const pageWidth = pdf.internal.pageSize.getWidth()   // 612
      const pageHeight = pdf.internal.pageSize.getHeight() // 792

      for (let i = 0; i < pages.length; i++) {
        // Deep clone the page into the fixed-size stage.
        const clone = pages[i].cloneNode(true) as HTMLElement
        clone.style.width = `${LETTER_W_PX}px`
        clone.style.height = `${LETTER_H_PX}px`
        clone.style.margin = '0'
        clone.style.padding = clone.style.padding || '48px'
        clone.style.boxSizing = 'border-box'
        clone.style.pageBreakAfter = 'auto'
        clone.style.breakAfter = 'auto'
        clone.style.transform = 'none'

        // Swap remote logo src → data URL so html2canvas can rasterize it.
        if (logoDataUrl) {
          const imgs = clone.querySelectorAll('img')
          imgs.forEach((img) => {
            if (img.src && img.src.includes('furnitureassist.com')) {
              img.src = logoDataUrl
            }
          })
        }

        stage.innerHTML = ''
        stage.appendChild(clone)

        // Wait for any images inside the clone to actually finish decoding.
        // Without this, html2canvas can snapshot before the data URL image paints.
        const cloneImgs = Array.from(clone.querySelectorAll('img'))
        await Promise.all(cloneImgs.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve()
          return new Promise<void>((resolve) => {
            img.onload = () => resolve()
            img.onerror = () => resolve()
            // Safety timeout so we never hang.
            setTimeout(() => resolve(), 1500)
          })
        }))

        // Render at 2x scale for crisper text.
        const canvas = await html2canvas(clone, {
          scale: 2,
          width: LETTER_W_PX,
          height: LETTER_H_PX,
          windowWidth: LETTER_W_PX,
          windowHeight: LETTER_H_PX,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        })

        // Canvas is now guaranteed to be LETTER_W_PX*2 × LETTER_H_PX*2 —
        // exact letter aspect ratio. Fill the page edge-to-edge.
        if (i > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight)
      }

      const filename = `FurnitureAssist-${date}-sheets.pdf`
      pdf.save(filename)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      window.alert(`PDF generation failed: ${msg}`)
    } finally {
      // Always clean up the staging node.
      if (stage.parentNode) stage.parentNode.removeChild(stage)
      setGeneratingPdf(false)
    }
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
          <button onClick={handleSavePdf} disabled={merging || generatingPdf}
            style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.35)', background: (merging || generatingPdf) ? 'rgba(255,255,255,0.08)' : 'transparent', color: 'white', fontSize: '13px', fontWeight: 700, cursor: (merging || generatingPdf) ? 'wait' : 'pointer', fontFamily: 'var(--font-montserrat)' }}>
            {generatingPdf ? 'Generating PDF…' : merging ? 'Marking merge…' : `📄 Save as PDF`}
          </button>
          <button onClick={handlePrint} disabled={merging || generatingPdf}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', background: (merging || generatingPdf) ? '#5A8577' : '#2A7F6F', color: 'white', fontSize: '13px', fontWeight: 700, cursor: (merging || generatingPdf) ? 'wait' : 'pointer', fontFamily: 'var(--font-montserrat)' }}>
            {merging ? 'Marking merge…' : `🖨 Print Roster + ${clients.length} sheets`}
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
          /* Force each direct child (roster + client sheets) onto its own physical page.
             Belt-and-suspenders: page-break-after + break-after covers old + modern engines,
             and the empty ::after spacer defeats printer-driver duplex defaults by ensuring
             the next sheet cannot back-print onto the previous. */
          .print-sheet-wrapper > div {
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .print-sheet-wrapper > div:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
            margin-bottom: 0 !important;
          }
          @page { margin: 0.4in; size: letter portrait; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </>
  )
}
