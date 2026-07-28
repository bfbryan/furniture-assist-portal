'use client'


import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import CancelModal from '@/components/dawson/modals/CancelModal'
import RescheduleModal, { type AvailableDate } from '@/components/dawson/modals/RescheduleModal'


type ItemsDisbursed = {
  livingRoom: { name: string; qty: string | number }[]
  bedroom: { name: string; qty: string | number }[]
  diningRoom: { name: string; qty: string | number }[]
  kitchen: { name: string; qty: string | number }[]
  linens: { name: string; qty: string | number }[]
  misc: { name: string; qty: string | number }[]
  volunteerInitials: string | null   // legacy — removed from sheet redesign July 2026
  checkInTime: string | null
  checkoutTime: string | null
  otherItems: string | null
  distributionNotes: string | null
}


type Referral = {
  id: string
  clientId: string | null                    // NEW: rec ID of the linked Client — needed for PATCH
  clientName: string
  firstName: string
  lastName: string
  dob: string | null
  phone: string | null
  language: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  hhSize: string | null
  children: string | null
  items: string | null
  externalNotes: string | null
  internalNotes: string | null
  referralDate: string
  referralReview: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  appointmentSlipUrl: string | null
  dataPageUrl: string | null
  // June 2026: these four are LOOKUPS through Referring Staff Link.
  // All four will be null when the referral was imported without a usable
  // staff identity (Excel Branch c — no email, no name).
  referredBy: string | null
  referringAgency: string | null
  referringAgencyId: string | null           // NEW: for link to Agency detail page
  referredByPhone: string | null
  agencyEmail: string | null
  referringStaffLinkId: string | null        // link to Agency User — for future Staff ID deep-link
  possibleDuplicate: boolean
  itemsDisbursed: ItemsDisbursed | null
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


// The 6 canonical Items Requested categories. MUST stay in sync with
// dawson-import-referrals-page.tsx CATEGORIES constant AND the agency
// submission form. Any change here needs to be mirrored there.
const ITEM_CATEGORIES = [
  'Bedroom Furniture',
  'Living Room Furniture',
  'Dining Room Furniture',
  'Clothes',
  'Household Items (including kitchen & linens)',
  'Baby Items',
]


// NJ counties. Dawson works exclusively in NJ; if the org expands out-of-
// state, add "Other" or convert this to a free-text field.
const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May', 'Cumberland',
  'Essex', 'Gloucester', 'Hudson', 'Hunterdon', 'Mercer', 'Middlesex',
  'Monmouth', 'Morris', 'Ocean', 'Passaic', 'Salem', 'Somerset',
  'Sussex', 'Union', 'Warren',
]


const LANGUAGES = ['English', 'Spanish', 'Haitian Creole', 'French', 'Arabic', 'Portuguese', 'Other']


const STATES = ['NJ', 'NY', 'PA', 'CT', 'DE']


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}


// DOB comes from AT in "M/D/YYYY" format (created by our toMDY helper).
// The native <input type="date"> needs YYYY-MM-DD. These two convert both ways.
function dobToInputValue(dob: string | null): string {
  if (!dob) return ''
  // Try MDY first (our storage format), then fall back to native Date parse
  const mdy = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(dob)
  if (isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}
function inputValueToMDY(input: string): string {
  if (!input) return ''
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return input
  const [, y, m, d] = iso
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}


// Format phone as (XXX) XXX-XXXX on blur. Strips non-digits.
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return raw // leave as-typed if not exactly 10
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}


function getPortalStatus(review: string, status: string) {
  if (review === 'Rejected') return 'Rejected'
  if (review === 'Withdrawn') return 'Withdrawn'
  if (status === 'Cancelled') return 'Cancelled'
  if (status === 'Completed') return 'Completed'
  if (review === 'Pending') return 'Submitted'
  if (status === 'Pending Schedule') return 'Scheduling'
  if (status === 'Scheduled') return 'Scheduled'
  return status
}


const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Submitted:  { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',   badgeText: '#C9A84C' },
  Scheduling: { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',   badgeText: '#5B8DB8' },
  Scheduled:  { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',   badgeText: '#2A7F6F' },
  Completed:  { accent: '#1B2B4B', badgeBg: 'rgba(27,43,75,0.08)',     badgeText: '#1B2B4B' },
  Cancelled:  { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',     badgeText: '#C0392B' },
  Rejected:   { accent: '#C0392B', badgeBg: 'rgba(192,57,43,0.1)',     badgeText: '#C0392B' },
}


// Card accent colors. Teal = editable surfaces (guides Dawson's eye to
// "safe to touch" zones). Muted grey = read-only. See mockup for rationale.
const EDIT_ACCENT = '#2A7F6F'  // teal — editable card
const READ_ACCENT = '#7A8899'  // muted grey — read-only card


// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------


function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '130px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || '—'}
      </div>
    </div>
  )
}


function Card({
  accent,
  title,
  headerRight,
  children,
}: {
  accent: string
  title: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden' }}>
      <div style={{ background: accent, height: '4px' }} />
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #EDE9E1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B', margin: 0 }}>{title}</h2>
        {headerRight}
      </div>
      <div style={{ padding: '12px 20px' }}>
        {children}
      </div>
    </div>
  )
}


function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
      {label}
    </button>
  )
}


// Reusable input style — keeps all inputs visually consistent
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EDE9E1',
  fontSize: '13px', color: '#1B2B4B', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: 'white',
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '8px 0', alignItems: 'center' }}>
      <div style={{ width: '130px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Items Disbursed (unchanged from previous version)
// ---------------------------------------------------------------------------


function ItemsDisbursedCard({ d }: { d: ItemsDisbursed }) {
  const sortAlpha = (items: { name: string; qty: string | number }[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))


  const groups = [
    { title: 'Living Room', items: sortAlpha(d.livingRoom) },
    { title: 'Bedroom', items: sortAlpha(d.bedroom) },
    { title: 'Dining Room', items: sortAlpha(d.diningRoom) },
    { title: 'Kitchen / Household', items: sortAlpha(d.kitchen) },
    { title: 'Clothes & Shoes', items: sortAlpha(d.linens) },
    { title: 'Baby / Kids', items: sortAlpha(d.misc) },
  ].filter(g => g.items.length > 0)


  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0)


  if (totalCount === 0 && !d.distributionNotes && !d.otherItems && !d.checkInTime && !d.checkoutTime) {
    return (
      <Card accent={READ_ACCENT} title="Items Disbursed">
        <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '8px 0' }}>No items recorded yet.</div>
      </Card>
    )
  }


  // Volunteer initials no longer displayed — removed from July 2026 sheet
  // redesign; legacy data still lives in Airtable but is not shown.


  // Header right: Check-in / Check-out inline, right-justified, matched to
  // the card title's typographic weight so it reads as a peer heading.
  const headerRight = (d.checkInTime || d.checkoutTime) ? (
    <div style={{ display: 'flex', gap: '18px', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#1B2B4B' }}>
      <span>
        <span style={{ color: '#7A8899', fontWeight: 700 }}>Check-in Time </span>
        {d.checkInTime || '—'}
      </span>
      <span>
        <span style={{ color: '#7A8899', fontWeight: 700 }}>Check-out Time </span>
        {d.checkoutTime || '—'}
      </span>
    </div>
  ) : null


  return (
    <Card accent={READ_ACCENT} title="Items Disbursed" headerRight={headerRight}>
      <div style={{ columnCount: 3, columnGap: '28px', padding: '6px 0' }}>
        {groups.map((g, gi) => (
          <div key={gi} style={{ breakInside: 'avoid', marginBottom: '14px' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2A7F6F', marginBottom: '6px' }}>
              {g.title}
            </div>
            {g.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '12.5px', color: '#2C3A4A', padding: '3px 0', borderBottom: '1px dotted #EDE9E1', gap: '8px' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                <span style={{ fontWeight: 700, color: '#1B2B4B', flexShrink: 0 }}>{it.qty}</span>
              </div>
            ))}
          </div>
        ))}
      </div>


      {d.otherItems && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #EDE9E1' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2A7F6F', marginBottom: '6px' }}>
            Other Items
          </div>
          <div style={{ fontSize: '13px', color: '#2C3A4A', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {d.otherItems}
          </div>
        </div>
      )}


      {d.distributionNotes && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #EDE9E1' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7A8899', marginBottom: '6px' }}>
            Internal Notes
          </div>
          <div style={{ fontSize: '13px', color: '#2C3A4A', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {d.distributionNotes}
          </div>
        </div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Client Info — display + inline edit
// ---------------------------------------------------------------------------


type ClientEditState = {
  firstName: string
  lastName: string
  dob: string       // stored as YYYY-MM-DD for the <input>; converted to MDY on save
  phone: string
  language: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
  county: string
  hhSize: string
  children: string
}


function referralToClientEditState(r: Referral): ClientEditState {
  return {
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    dob: dobToInputValue(r.dob),
    phone: r.phone ?? '',
    language: r.language ?? '',
    address: r.address ?? '',
    address2: r.address2 ?? '',
    city: r.city ?? '',
    state: r.state ?? 'NJ',
    zip: r.zip ?? '',
    county: r.county ?? '',
    hhSize: r.hhSize ?? '',
    children: r.children ?? '',
  }
}


function ClientInfoCard({
  referral,
  onSaved,
}: {
  referral: Referral
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ClientEditState>(referralToClientEditState(referral))


  function startEdit() {
    setForm(referralToClientEditState(referral))
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }


  async function save() {
    if (!referral.clientId) {
      setError('Cannot save — no linked Client record. Contact Ben.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Identity fields land on the Clients table.
      // Convert DOB back to MDY (our AT storage format).
      // Phone is formatted on blur but we normalize once more here just in case.
      const clientPayload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dob: form.dob ? inputValueToMDY(form.dob) : '',
        phone: form.phone ? formatPhone(form.phone) : '',
        language: form.language,
        address: form.address.trim(),
        address2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state,
        zip: form.zip.replace(/\D/g, '').slice(0, 5),
        county: form.county,
      }
      // # in HH and # Children are per-visit — they live on the Client
      // Referrals row, not on the Client. Send them separately.
      const referralPayload: Record<string, string> = {}
      if (form.hhSize !== (referral.hhSize ?? '')) referralPayload.hhSize = form.hhSize
      if (form.children !== (referral.children ?? '')) referralPayload.children = form.children


      // Fire both PATCHes in parallel. If either fails we surface the error.
      const requests: Promise<Response>[] = [
        fetch(`/api/dawson/clients/${referral.clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clientPayload),
        }),
      ]
      if (Object.keys(referralPayload).length > 0) {
        requests.push(
          fetch(`/api/dawson/referrals/${referral.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(referralPayload),
          }),
        )
      }
      const results = await Promise.all(requests)
      for (const res of results) {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          const msg = typeof j?.error === 'string'
            ? j.error
            : j?.error?.message ?? `Save failed (${res.status})`
          throw new Error(msg)
        }
      }
      // Reflect the change locally without a full refetch. Referral fields on
      // Client Referrals are lookups, so the display values come from Client —
      // updating them here keeps the UI in sync until the next fetch.
      onSaved({
        firstName: clientPayload.firstName,
        lastName: clientPayload.lastName,
        clientName: `${clientPayload.firstName} ${clientPayload.lastName}`.trim(),
        dob: clientPayload.dob || null,
        phone: clientPayload.phone || null,
        language: clientPayload.language || null,
        address: clientPayload.address || null,
        address2: clientPayload.address2 || null,
        city: clientPayload.city || null,
        state: clientPayload.state || null,
        zip: clientPayload.zip || null,
        county: clientPayload.county || null,
        hhSize: form.hhSize || null,
        children: form.children || null,
      })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Client Information"
        headerRight={<EditButton onClick={startEdit} />}
      >
        <InfoRow label="Full Name" value={referral.clientName} />
        <InfoRow label="Date of Birth" value={formatDate(referral.dob)} />
        <InfoRow label="Phone" value={referral.phone} />
        <InfoRow label="Language" value={referral.language} />
        <InfoRow label="Address" value={
          referral.address ? (
            <>{referral.address}{referral.address2 ? `, ${referral.address2}` : ''}<br />
            {referral.city}, {referral.state} {referral.zip}</>
          ) : null
        } />
        <InfoRow label="County" value={referral.county} />
        <InfoRow label="Household Size" value={referral.hhSize} />
        <InfoRow label="Children" value={referral.children} />
      </Card>
    )
  }


  // Edit mode
  return (
    <Card
      accent={EDIT_ACCENT}
      title="Client Information — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <Field label="First Name">
        <input style={inputStyle} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
      </Field>
      <Field label="Last Name">
        <input style={inputStyle} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
      </Field>
      <Field label="Date of Birth">
        <input type="date" style={inputStyle} value={form.dob} onChange={e => setForm({ ...form, dob: e.target.value })} />
      </Field>
      <Field label="Phone">
        <input style={inputStyle} value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
          onBlur={e => setForm({ ...form, phone: formatPhone(e.target.value) })}
          placeholder="(555) 555-5555" />
      </Field>
      <Field label="Language">
        <select style={inputStyle} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
          <option value="">—</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Address">
        <input style={inputStyle} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Address 2">
        <input style={inputStyle} value={form.address2} onChange={e => setForm({ ...form, address2: e.target.value })} placeholder="Apt / Unit" />
      </Field>
      <Field label="City">
        <input style={inputStyle} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
      </Field>
      <Field label="State">
        <select style={inputStyle} value={form.state} onChange={e => setForm({ ...form, state: e.target.value })}>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Zip">
        <input style={inputStyle} value={form.zip}
          onChange={e => setForm({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })}
          inputMode="numeric" maxLength={5} />
      </Field>
      <Field label="County">
        <select style={inputStyle} value={form.county} onChange={e => setForm({ ...form, county: e.target.value })}>
          <option value="">—</option>
          {NJ_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Household Size">
        <input style={inputStyle} value={form.hhSize}
          onChange={e => setForm({ ...form, hhSize: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          inputMode="numeric" />
      </Field>
      <Field label="Children">
        <input style={inputStyle} value={form.children}
          onChange={e => setForm({ ...form, children: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          inputMode="numeric" />
      </Field>
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Items Requested — display + inline edit (6-category checkbox multi-select)
// ---------------------------------------------------------------------------


function parseItemsToSet(items: unknown): Set<string> {
  // Defensive: `items` should be string | null, but if the Airtable field
  // ever comes back as an array (e.g. schema drift to a lookup) we don't
  // want the whole page to crash. Coerce to a string first.
  const str = typeof items === 'string'
    ? items
    : Array.isArray(items)
      ? items.filter(x => typeof x === 'string').join(',')
      : ''
  if (!str) return new Set()
  return new Set(str.split(',').map(s => s.trim()).filter(Boolean))
}


function ItemsRequestedCard({
  referral,
  onSaved,
}: {
  referral: Referral
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(parseItemsToSet(referral.items))


  function startEdit() {
    setSelected(parseItemsToSet(referral.items))
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }
  function toggle(cat: string) {
    const next = new Set(selected)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setSelected(next)
  }
  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Preserve the canonical order of the 6 categories rather than the
      // click order Dawson happened to use. Matches how imports write them.
      // Send as string[] because Items Requested is a multi-select in AT.
      const ordered = ITEM_CATEGORIES.filter(c => selected.has(c))
      const res = await fetch(`/api/dawson/referrals/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: ordered }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        const msg = typeof j?.error === 'string'
          ? j.error
          : j?.error?.message ?? `Save failed (${res.status})`
        throw new Error(msg)
      }
      // Reflect back as a comma-string (same shape getReferralById returns).
      onSaved({ items: ordered.join(', ') })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    const current = Array.from(parseItemsToSet(referral.items))
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Items Requested"
        headerRight={<EditButton onClick={startEdit} />}
      >
        {current.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No items specified.</div>
        ) : (
          current.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
              <span style={{ color: '#2A7F6F', fontWeight: 700, flexShrink: 0 }}>•</span>
              <span style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.6 }}>{item}</span>
            </div>
          ))
        )}
      </Card>
    )
  }


  return (
    <Card
      accent={EDIT_ACCENT}
      title="Items Requested — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {ITEM_CATEGORIES.map(cat => (
        <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', cursor: 'pointer', fontSize: '14px', color: '#2C3A4A' }}>
          <input type="checkbox" checked={selected.has(cat)} onChange={() => toggle(cat)}
            style={{ width: '16px', height: '16px', accentColor: EDIT_ACCENT, cursor: 'pointer' }} />
          <span>{cat}</span>
        </label>
      ))}
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Internal Notes — display + inline edit (replaces the old modal)
// ---------------------------------------------------------------------------


function InternalNotesCard({
  referral,
  onSaved,
}: {
  referral: Referral
  onSaved: (updated: Partial<Referral>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState(referral.internalNotes ?? '')


  function startEdit() {
    setValue(referral.internalNotes ?? '')
    setError(null)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setError(null)
  }
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/dawson/referrals/${referral.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: value }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Save failed (${res.status})`)
      }
      onSaved({ internalNotes: value })
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }


  if (!editing) {
    return (
      <Card
        accent={EDIT_ACCENT}
        title="Internal Notes"
        headerRight={<EditButton onClick={startEdit} label={referral.internalNotes ? 'Edit' : '+ Add'} />}
      >
        {referral.internalNotes ? (
          <div style={{ fontSize: '13px', color: '#1B2B4B', whiteSpace: 'pre-wrap', lineHeight: 1.6, padding: '4px 0' }}>{referral.internalNotes}</div>
        ) : (
          <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No internal notes added yet.</div>
        )}
      </Card>
    )
  }


  return (
    <Card
      accent={EDIT_ACCENT}
      title="Internal Notes — Editing"
      headerRight={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={cancelEdit} disabled={saving}
            style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: EDIT_ACCENT, color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <textarea value={value} onChange={e => setValue(e.target.value)} rows={6}
        placeholder="Add internal notes about this referral..."
        style={{ ...inputStyle, resize: 'vertical', fontSize: '13px', lineHeight: 1.5, padding: '10px' }} />
      {error && (
        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: '6px', fontSize: '12px', color: '#C0392B' }}>{error}</div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------


export default function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [referral, setReferral] = useState<Referral | null>(null)
  const [loading, setLoading] = useState(true)
  const [referralId, setReferralId] = useState<string>('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])


  useEffect(() => {
    params.then(({ id }) => {
      setReferralId(id)
      fetch(`/api/dawson/referrals/${id}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(data => { setReferral(data); setLoading(false) })
    })
    // Availability powers the Reschedule modal's Saturday picker.
    fetch('/api/dawson/schedule/available?weeks=8', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [params])


  // Refetch the referral after a successful mutation (cancel/reschedule) so
  // the header status badge, appointment date/time, and action buttons all
  // reflect the new state without a full page reload.
  const refetchReferral = () => {
    if (!referralId) return
    fetch(`/api/dawson/referrals/${referralId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setReferral(data))
      .catch(() => {})
  }


  async function handleCancelConfirm() {
    setActionLoading(true)
    try {
      await fetch(`/api/dawson/referrals/${cancelModal.id}/cancel`, { method: 'POST' })
      setCancelModal({ open: false, id: '', name: '' })
      refetchReferral()
    } finally {
      setActionLoading(false)
    }
  }


  async function handleRescheduleConfirm(
    preferredDate: string,
    appointmentTime: string | null,
  ) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, appointmentTime }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Reschedule failed')
        return
      }
      setRescheduleModal({ open: false, id: '', name: '' })
      refetchReferral()
    } finally {
      setActionLoading(false)
    }
  }


  async function handleReview(review: string) {
    if (confirm !== review) { setConfirm(review); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referralId}/review`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review }),
      })
      if (res.ok && referral) { setReferral({ ...referral, referralReview: review }); setConfirm(null) }
    } finally { setActionLoading(false) }
  }


  // Local mutator — components pass partial updates back up so the UI stays
  // in sync without a full refetch.
  function applyUpdate(u: Partial<Referral>) {
    setReferral(prev => prev ? { ...prev, ...u } : prev)
  }


  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>Loading referral...</div>
  )
  if (!referral) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>Referral not found.</div>
  )


  const status = getPortalStatus(referral.referralReview, referral.appointmentStatus)
  const colors = STATUS_COLORS[status] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }
  // Items Disbursed card is Completed-only. Cancelled + No Show mean
  // nothing was ever handed out, so the empty card was just visual noise.
  const showItemsDisbursed = status === 'Completed'


  // Days-since counter for No Show. Uses appointmentDate as the anchor
  // (that's the date the client didn't show up on). Falls back to null
  // silently if the date is missing/malformed.
  const daysSinceNoShow = (() => {
    if (referral.appointmentStatus !== 'No Show' || !referral.appointmentDate) return null
    const appt = new Date(referral.appointmentDate + 'T12:00:00')
    if (isNaN(appt.getTime())) return null
    const diffMs = Date.now() - appt.getTime()
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
  })()


  // Agency link: only render as link if we have an ID; otherwise plain text.
  // Staff link: only render as link if we have a link ID; otherwise plain
  // text (or the "No staff linked" callout if the referral was imported
  // without any staff identity at all).
  const agencyDisplay = referral.referringAgency
    ? (referral.referringAgencyId
        ? <a href={`/dawson/agencies/${referral.referringAgencyId}`} style={{ color: '#2A7F6F', textDecoration: 'none', fontWeight: 600 }}>{referral.referringAgency}</a>
        : referral.referringAgency)
    : null


  const staffDisplay = referral.referredBy
    ? (referral.referringStaffLinkId
        ? <a href={`/dawson/staff/${referral.referringStaffLinkId}`} style={{ color: '#2A7F6F', textDecoration: 'none', fontWeight: 600 }}>{referral.referredBy}</a>
        : referral.referredBy)
    : (!referral.referringStaffLinkId
        ? <span style={{ color: '#C9A84C', fontStyle: 'italic' }}>No staff linked — fix at agency claim</span>
        : null)


  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>


      {/* Top bar */}
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/dawson/referrals/review')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>{referral.clientName}</div>
          {referral.possibleDuplicate && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>⚠ Possible Duplicate</span>
          )}
        </div>


        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: colors.badgeBg, color: colors.badgeText }}>{status}</span>


          {status === 'Submitted' && (
            <>
              <button onClick={() => handleReview('Approved')} disabled={actionLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Approved' ? '#2A7F6F' : 'rgba(42,127,111,0.1)', color: confirm === 'Approved' ? 'white' : '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {actionLoading && confirm === 'Approved' ? '...' : confirm === 'Approved' ? 'Confirm Approve' : 'Approve'}
              </button>
              <button onClick={() => handleReview('Rejected')} disabled={actionLoading}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: confirm === 'Rejected' ? '#C0392B' : 'rgba(192,57,43,0.08)', color: confirm === 'Rejected' ? 'white' : '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {actionLoading && confirm === 'Rejected' ? '...' : confirm === 'Rejected' ? 'Confirm Reject' : 'Reject'}
              </button>
            </>
          )}


          {referral.appointmentSlipUrl && (
            <a href={referral.appointmentSlipUrl} target="_blank" rel="noreferrer"
              style={{ padding: '8px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Appt Slip
            </a>
          )}


          {referral.dataPageUrl && (
            <a href={referral.dataPageUrl} target="_blank" rel="noreferrer"
              style={{ padding: '8px 18px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#5B8DB8', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>
              Data Page
            </a>
          )}


          {confirm && (
            <button onClick={() => setConfirm(null)}
              style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
          )}
        </div>
      </header>


      {/* 3-column body */}
      <div style={{ padding: '28px 32px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', alignItems: 'start' }}>


        {/* LEFT: Client Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ClientInfoCard referral={referral} onSaved={applyUpdate} />
        </div>


        {/* MIDDLE: Items Requested + Internal Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ItemsRequestedCard referral={referral} onSaved={applyUpdate} />
          <InternalNotesCard referral={referral} onSaved={applyUpdate} />
        </div>


        {/* RIGHT: Appointment + Referral Details + Agency Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>


          <Card accent={READ_ACCENT} title="Appointment">
            <InfoRow label="Status" value={<span style={{ fontWeight: 700, color: colors.badgeText }}>{referral.appointmentStatus || '—'}</span>} />
            <InfoRow label="Date" value={referral.appointmentDate ? formatDate(referral.appointmentDate) : '—'} />
            <InfoRow label="Time" value={referral.appointmentTime || '—'} />
            {referral.appointmentSlipUrl && (
              <div style={{ paddingTop: '12px' }}>
                <a href={referral.appointmentSlipUrl} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#2A7F6F', textDecoration: 'none' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  View Appointment Slip
                </a>
              </div>
            )}
            {daysSinceNoShow !== null && (
              <div style={{ paddingTop: '4px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#C9A84C', letterSpacing: '0.03em' }}>
                  {daysSinceNoShow === 0 ? 'No-show today' : `${daysSinceNoShow} day${daysSinceNoShow === 1 ? '' : 's'} since no-show`}
                </div>
              </div>
            )}
            {/* Appointment actions — mirror the Scheduled page action widget.
                Opens the shared Cancel + Reschedule modals below.
                No Show is included: Dawson often learns days later whether
                a no-show should become a reschedule or a cancel. */}
            {(status === 'Scheduled' || status === 'No Show' || referral.referralReview === 'Approved') && status !== 'Completed' && status !== 'Cancelled' && (
              <div style={{ display: 'flex', gap: '8px', paddingTop: '14px', marginTop: '4px', borderTop: '1px solid #EDE9E1' }}>
                <button
                  type="button"
                  onClick={() => setRescheduleModal({ open: true, id: referral.id, name: referral.clientName })}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '7px', border: '1px solid rgba(201,168,76,0.35)', background: 'rgba(201,168,76,0.1)', color: '#8A6D14', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  onClick={() => setCancelModal({ open: true, id: referral.id, name: referral.clientName })}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '7px', border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </Card>


          <Card accent={READ_ACCENT} title="Referral Details">
            <InfoRow label="Submitted" value={formatDate(referral.referralDate)} />
            <InfoRow label="Agency" value={agencyDisplay} />
            <InfoRow label="Staff" value={staffDisplay} />
            <InfoRow label="Staff Phone" value={referral.referredByPhone} />
            <InfoRow label="Agency Email" value={referral.agencyEmail ? <a href={`mailto:${referral.agencyEmail}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{referral.agencyEmail}</a> : null} />
            <InfoRow label="Review Status" value={
              <span style={{ fontWeight: 700, color: referral.referralReview === 'Approved' ? '#2A7F6F' : referral.referralReview === 'Rejected' ? '#C0392B' : '#C9A84C' }}>
                {referral.referralReview}
              </span>
            } />
          </Card>


          <Card accent={READ_ACCENT} title="Agency Notes">
            {referral.externalNotes ? (
              <div style={{ fontSize: '14px', color: '#2C3A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '4px 0' }}>{referral.externalNotes}</div>
            ) : (
              <div style={{ fontSize: '13px', color: '#7A8899', fontStyle: 'italic', padding: '4px 0' }}>No notes submitted by agency.</div>
            )}
          </Card>


          {referral.possibleDuplicate && (
            <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px', color: '#C0392B', marginBottom: '6px' }}>⚠ Possible Duplicate</div>
              <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6 }}>This client may already be in the system. Review before approving.</div>
            </div>
          )}
        </div>
      </div>


      {/* Items Disbursed spans the two left columns below when appointment
          is Completed or Cancelled. Placed right under the 3-column grid so
          it visually pushes up under Client Info + Internal Notes. */}
      {showItemsDisbursed && referral.itemsDisbursed && (
        <div style={{ padding: '0 32px 32px' }}>
          <div style={{ maxWidth: 'calc(66.67% - 10px)' }}>
            <ItemsDisbursedCard d={referral.itemsDisbursed} />
          </div>
        </div>
      )}


      <CancelModal
        open={cancelModal.open}
        name={cancelModal.name}
        loading={actionLoading}
        onClose={() => setCancelModal({ open: false, id: '', name: '' })}
        onConfirm={handleCancelConfirm}
      />
      <RescheduleModal
        open={rescheduleModal.open}
        name={rescheduleModal.name}
        availableDates={availableDates}
        loading={actionLoading}
        onClose={() => setRescheduleModal({ open: false, id: '', name: '' })}
        onConfirm={handleRescheduleConfirm}
      />


    </div>
  )
}
