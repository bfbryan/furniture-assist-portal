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
  // Set only on the two synthetic blank sheets appended for walk-ups (see
  // BLANK_CLIENTS below). Every real record fetched from the API omits this
  // key entirely, so it's undefined — falsy — and every conditional keyed on
  // it renders exactly as it did before this field existed.
  synthetic?: boolean
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
        background: '#1B2B4B', color: '#ffffff', padding: '3px 0',
        display: 'grid', gridTemplateColumns: '1fr 65px 65px',
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        <div style={{ color: '#ffffff', padding: '0 7px' }}>{cat.name}</div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#ffffff' }}>Hash</div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#ffffff' }}>Qty</div>
      </div>
      {cat.items.map((item, i) => (
        <div key={item} style={{
          display: 'grid',
          gridTemplateColumns: '1fr 65px 65px',
          borderBottom: i < cat.items.length - 1 ? '1px solid #555' : 'none',
          background: 'white',
          minHeight: '22px',
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
   OtherFreeformBox — full-width freeform text box for items not
   in the 30 predefined categories. OCR reads the text and dumps
   into Airtable `Other Items` (long text). Placed under Baby/Kids
   to use the whitespace at the bottom of the right column.
   ============================================================ */
function OtherFreeformBox() {
  return (
    <div style={{ border: '1.5px solid #333', borderRadius: '3px', overflow: 'hidden', marginBottom: '0' }}>
      <div style={{
        background: '#1B2B4B', color: '#ffffff', padding: '3px 7px',
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as React.CSSProperties}>
        Other
      </div>
      <div style={{ background: 'white', minHeight: '56px', padding: '4px 6px' }} />
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
   RescheduleBox — wider box; no inner checkbox. Handwritten date
   inside is the trigger. OCR reads any date/text present here and
   flags the sheet as a reschedule with that preferred date.
   ============================================================ */
function RescheduleBox() {
  return (
    <div style={{
      border: `3px solid #C0392B`, borderRadius: '6px', padding: '6px 10px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '4px',
      width: '120px', height: '82px', boxSizing: 'border-box',
      WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
    } as React.CSSProperties}>
      <div style={{ fontSize: '10.5px', fontWeight: 900, color: '#C0392B', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', lineHeight: 1.1 }}>
        Resch / Date
      </div>
      <div style={{ flex: 1, width: '100%' }} />
    </div>
  )
}



// Shared by WriteInLine and WriteInLinePair below, so a label/rule pair
// looks identical whether it's alone on its row or sharing one with
// another pair — same font, same rule weight, same fixed-width box logic.
function writeInLabelStyle(width: number): React.CSSProperties {
  return {
    display: 'inline-block', width: `${width}px`, flexShrink: 0, textAlign: 'right',
    fontSize: '10px', fontWeight: 800, color: '#7A8899',
    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  }
}
function writeInRuleStyle(width: number): React.CSSProperties {
  return {
    display: 'inline-block', width: `${width}px`, flexShrink: 0,
    borderBottom: '1.5px solid #333', height: '13px',
  }
}

/* ============================================================
   WriteInLine — a small uppercase label beside a blank rule, for the
   CLIENT INFO CARD on synthetic (blank walk-up) sheets only. A volunteer
   writes directly on the rule; '—' would read as "no data" rather than
   "write here" (see ClientSheet's info card).

   Fixed label width + fixed rule width, laid out with flexbox rather than
   inline text: a variable-length label followed by a fixed-width rule
   still puts the rule at a different x per row (short label = rule starts
   early). A fixed-width label box, with its text right-aligned inside
   that box, fixes both the label's right edge and the rule's left edge —
   every row in a column shares one gutter, so the rules form a clean
   vertical stripe instead of stepping in and out with label length.

   `align="right"` (RIGHT column) mirrors the pattern already used by the
   card's real fields there (Label: value, right-aligned) — same
   [label, rule] child order either way, just which end of the row is
   pinned (flex-start for LEFT, flex-end for RIGHT), so the rule's END is
   what lines up, not its start.

   `labelWidth`/`ruleWidth` default per column, sized to the column's own
   longest remaining single-row label measured in a real browser (this
   exact font/weight/letter-spacing) — LEFT's is "Date of birth" (88.2px,
   with room to spare in the 124px box); RIGHT's is "Items requested"
   (108.5px). RIGHT's rule is now 210px, not just enough to clear
   wrapping — Agency/Referring staff/Items requested had the most spare
   column width of anything on the sheet, so they got widened, not just
   kept wrap-safe. One shared width per column, not a per-row override,
   so every plain row's rule ends at the same x as its neighbors.
   Appointment date/time and Household size/Children are NOT part of this
   shared width — they pair up on one row each via WriteInLinePair below,
   with their own (smaller) widths, since two short fields together don't
   need — and don't have room for — a full single-row rule apiece.

   `first` drops the row's top margin, for whichever line opens its block.
   ============================================================ */
function WriteInLine({
  label, align = 'left', first = false,
  labelWidth = align === 'right' ? 116 : 124,
  ruleWidth = align === 'right' ? 210 : 190,
}: {
  label: string
  align?: 'left' | 'right'
  first?: boolean
  labelWidth?: number
  ruleWidth?: number
}) {
  return (
    <div style={{
      marginTop: first ? 0 : '9px',
      display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      alignItems: 'baseline', gap: '6px',
    }}>
      <span style={writeInLabelStyle(labelWidth)}>{label}:</span>
      <span style={writeInRuleStyle(ruleWidth)} />
    </div>
  )
}

/* ============================================================
   WriteInLinePair — two label+rule pairs on ONE row, for fields that are
   really one fact (appointment date/time) or individually short enough
   that a full single-row rule would be wasted space (household size,
   children). Recovers a row versus giving each its own WriteInLine.

   Deliberately its OWN labelWidth/ruleWidth, not the column's shared
   WriteInLine defaults — those are sized for a single label alone on a
   full-width row; cramming two of them onto one row wouldn't fit, and
   these fields don't need that much room each anyway. The two pairs
   mirror each other (same labelWidth/ruleWidth for both), so the row
   reads as one balanced unit rather than two mismatched halves — this
   row's internal symmetry is a separate concern from the column-wide
   "every rule ends at the same x" alignment WriteInLine rows keep; nothing
   else on the sheet shares this row's shape, so nothing needs to line up
   with it beyond its own two ends.
   ============================================================ */
function WriteInLinePair({
  leftLabel, rightLabel, align = 'left', first = false,
  labelWidth, ruleWidth, pairGap = 16,
}: {
  leftLabel: string
  rightLabel: string
  align?: 'left' | 'right'
  first?: boolean
  labelWidth: number
  ruleWidth: number
  pairGap?: number
}) {
  return (
    <div style={{
      marginTop: first ? 0 : '9px',
      display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      gap: `${pairGap}px`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={writeInLabelStyle(labelWidth)}>{leftLabel}:</span>
        <span style={writeInRuleStyle(ruleWidth)} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={writeInLabelStyle(labelWidth)}>{rightLabel}:</span>
        <span style={writeInRuleStyle(ruleWidth)} />
      </div>
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
      padding: '10px 18px 6px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '11px',
      color: '#1a1a1a',
      maxWidth: '780px',
      margin: '0 auto',
      position: 'relative',
      boxSizing: 'border-box',
    }}>



      {/* TOP BANNER: Logo + title (single line) | [flex spacer] | Reschedule/Date | Client# */}
      <div style={{
        display: 'flex', alignItems: 'center',
        marginBottom: '12px', paddingBottom: '8px',
        borderBottom: '3px solid #1B2B4B',
        gap: '10px',
      }}>



        {/* Logo + title (Furniture Assist on one line, caption below) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <img src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg" alt="Furniture Assist" style={{ width: '92px', height: '92px', objectFit: 'contain' }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '34px', fontWeight: 900, color: '#1B2B4B', lineHeight: 1, whiteSpace: 'nowrap' }}>Furniture Assist</div>
            <div style={{ fontSize: '11.5px', color: '#7A8899', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: '7px', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {client.synthetic ? 'Manual entry — do not scan.' : 'Client Pickup Sheet'}
            </div>
          </div>
        </div>



        {/* Flex spacer pushes reviewer boxes to the right */}
        <div style={{ flex: 1 }} />



        {/* Reviewer action group: Reschedule/Date + Client/Car # (both 82px tall for consistent proportion) */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexShrink: 0 }}>
          <RescheduleBox />



        {/* Client/Car # box — right-justified. Label top-aligned + open area
            below to match Resch/Date box exactly. */}
        <div style={{
          border: '3px solid #1B2B4B', borderRadius: '8px', padding: '6px 10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '4px',
          flexShrink: 0, width: '120px', height: '82px', boxSizing: 'border-box',
        }}>
          <div style={{ fontSize: '10.5px', fontWeight: 900, color: '#1B2B4B', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', lineHeight: 1.1 }}>
            Client / Car #
          </div>
          <div style={{ flex: 1, width: '100%' }} />
        </div>
        </div>
      </div>



      {/* CLIENT INFO CARD — Notes removed (now lives in bottom Notes box) */}
      <div style={{ border: '1.5px solid #333', borderRadius: '6px', padding: '10px 16px', background: 'white', marginBottom: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'center' }}>



          {/* LEFT: Name / Time · Date / Address / Phone / Language.
              Synthetic (blank walk-up sheets) swaps this whole block for
              labelled write-in lines instead. Appointment date and time
              share ONE row — they're one fact, not two, and a full row
              each was more space than this column can spare. Short labels
              ("Appt date"/"Appt time") rather than "Appointment date" in
              full: this row already carries two of them side by side, and
              "Date of birth" two rows down keeps "date" unambiguous even
              abbreviated. That row leads, matching where the real sheet's
              own Time · Date line sits — right after the name would be,
              which is why Name comes second here, not first.

              Language was on Add Referral's own field list but is dropped
              here — it doesn't cost anything a duplicate check or the
              rest of intake needs, and this column had no row to spare
              for it. Everything else (name, DOB, address, phone) still
              gets its own line, matching Add Referral's remaining fields. */}
          {client.synthetic ? (
            <div>
              <WriteInLinePair leftLabel="Appt date" rightLabel="Appt time" labelWidth={70} ruleWidth={80} first />
              <WriteInLine label="Name" />
              <WriteInLine label="Date of birth" />
              <WriteInLine label="Address" />
              <WriteInLine label="Phone" />
            </div>
          ) : (
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
          )}



          {/* RIGHT: ID / Agency / Household + Items (External notes removed from here).
              ID stays the MANUAL ENTRY marker either way (set on the synthetic
              client itself, not branched here). On synthetic sheets, Agency,
              Referring staff and Items requested are full-row write-in
              lines — Ben's field list has Agency and Referring staff
              alongside the others Add Referral collects, and "None
              specified" for Items is a true statement about a real client
              but a false one on a blank, so it needs a line too, not a
              fallback. Those three got WIDER rules this round, not just
              wide enough to avoid wrapping — this column had the most
              spare width on the sheet once Household size/Children moved
              off their own two rows (below).

              Household size and Children pair onto ONE row instead —
              unlike Agency/Referring staff/Items, both are short answers
              (a number, maybe two), so a full-width rule each would be
              mostly unused space, and the row saved matters more here
              than it would for a field that's actually written out. */}
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
            {client.synthetic ? (
              <>
                <WriteInLine label="Agency" align="right" first />
                <WriteInLine label="Referring staff" align="right" />
              </>
            ) : (
              <div>
                <span style={{ color: '#7A8899', fontWeight: 700 }}>Agency: </span>
                <span style={{ color: '#1B2B4B' }}>{client.referringAgency ?? '—'}{client.referredBy ? ` / ${client.referredBy}` : ''}</span>
              </div>
            )}
            <div>&nbsp;</div>
            {client.synthetic ? (
              <>
                <WriteInLinePair leftLabel="Household" rightLabel="Children" align="right" labelWidth={78} ruleWidth={75} first />
                <WriteInLine label="Items requested" align="right" />
              </>
            ) : (
              <>
                <div>
                  <span style={{ color: '#7A8899', fontWeight: 700 }}>Household: </span>
                  <span style={{ color: '#1B2B4B' }}>{client.hhSize ?? '—'}{client.children ? ` (${client.children} children)` : ''}</span>
                </div>
                <div>
                  <span style={{ color: '#7A8899', fontWeight: 700 }}>Items: </span>
                  <span style={{ color: '#1B2B4B' }}>{requestedItems.length > 0 ? requestedItems.join(' · ') : 'None specified'}</span>
                </div>
              </>
            )}
          </div>



        </div>
      </div>



      {/* ITEMS TABLE — maximum space (no Item/Hash/Qty subheader row; labels are in section header) */}
      {/* Right column also includes universal freeform "Other" box under Baby/Kids */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
        <div>
          {LEFT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} />
          ))}
        </div>
        <div>
          {RIGHT_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.name} cat={cat} />
          ))}
          <OtherFreeformBox />
        </div>
      </div>



      {/* BOTTOM STRIP: Check-in Time | Check-out Time | Internal Notes
          (Initials removed per Dawson; both time boxes same width; helper text dropped) */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px 150px 1fr', gap: '10px' }}>



        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '5px 9px', background: 'white', height: '92px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-in Time</div>
          <div style={{ flex: 1 }} />
        </div>



        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '5px 9px', background: 'white', height: '92px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-out Time</div>
          <div style={{ flex: 1 }} />
        </div>



        <div style={{ border: '1.5px solid #333', borderRadius: '4px', padding: '5px 9px', background: 'white', height: '92px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#333', letterSpacing: '0.06em', marginBottom: '4px' }}>Internal Notes</div>
          <div style={{ flex: 1 }} />
        </div>
      </div>



    </div>
  )
}



/* ============================================================
   BLANK_CLIENTS — two synthetic, Client-shaped entries appended after the
   real scheduled list, for walk-ups and same-day additions. Filled in by
   hand and entered into the portal afterwards; never scanned.

   There is no "extra blank row" in the data and there cannot be — a blank
   has no referral to query for. These are client-side-only placeholders,
   never sent to or read from Airtable.

   `id` does double duty:
     - It's what prints in the ID slot, so it needs to read as a label, not
       a broken field.
     - resolveRecordId() (lib/scanning/ocr.ts) checks
       /^rec[A-Za-z0-9]{14}$/ first; neither string matches that shape, so
       even a blank that lands in the scan pile by mistake can't resolve to
       a record by ID.

   Every other field is null, which the component already renders as '—'
   via its existing null guards — except firstName/lastName, which the name
   heading renders with no guard at all. '—' is that same "no value"
   convention this file already uses everywhere (phone, appointment time,
   etc.), not a new one.
   ============================================================ */
function blankClient(n: 1 | 2): Client {
  return {
    id: `MANUAL ENTRY ${n}`,
    // Name renders as a WriteInLine on synthetic sheets (ClientSheet's info
    // card), not from these fields — they're only non-optional on the
    // Client type. RosterPage never sees BLANK_CLIENTS at all, so there's
    // no "—, —" to read anywhere for these.
    firstName: '',
    lastName: '',
    clientName: '',
    address: null,
    address2: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    dob: null,
    language: null,
    hhSize: null,
    children: null,
    items: null,
    appointmentDate: null,
    appointmentTime: null,
    referredBy: null,
    referringAgency: null,
    externalNotes: null,
    synthetic: true,
  }
}
const BLANK_CLIENTS: Client[] = [blankClient(1), blankClient(2)]



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
          {clients.length === 0 ? ' scheduled' : ''} · {BLANK_CLIENTS.length} blank
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
            {merging ? 'Marking merge…' : `🖨 Print Roster + ${clients.length + BLANK_CLIENTS.length} sheets`}
          </button>
        </div>
      </div>



      <div className="no-print" style={{ height: '56px' }} />



      {/* The packet always produces the two blank walk-up sheets, even on a
          Saturday with no real scheduled clients — that is exactly the day
          a walk-up is most likely (nothing booked, warehouse still open).
          RosterPage already renders correctly at clients.length === 0 (an
          empty two-column roster under "0 appointments"), so no separate
          empty-state branch is needed here any more. */}
      <div className="print-sheet-wrapper">
        <RosterPage clients={clients} date={date} />
        {/* Roster stays real-clients-only, above. The two blank walk-up
            sheets are appended here, sheets-only, after everyone with an
            actual appointment (or, on a day with none, after nobody). */}
        {[...clients, ...BLANK_CLIENTS].map((client, i, sheetClients) => (
          <ClientSheet key={client.id} client={client} index={i} total={sheetClients.length} />
        ))}
      </div>



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
