// app/(agency)/profile/ProfileClient.tsx
// Two-column body: Agency (left, admin-editable) + My Profile (below Agency)
// / Primary Admin (right).

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cityStateZip } from '@/lib/address'
import { formatEIN, isCompleteEIN } from '@/lib/ein'

// Optional Airtable fields are string | null — Airtable omits blank fields,
// so anything not guaranteed present must not be typed as a bare string.
type Agency = {
  id: string
  name: string
  officeName: string | null
  ein: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  website: string | null
  contactName: string
  adminEmail: string | null
  adminPhone: string | null
  status: string
}

type AgencyUser = {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  phone: string | null
  role: string
  status: string
}

// ============ helpers ============

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('')
}

// Split a display name into first / last for the update payload.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// ============ shared styles ============

// Card header accents, so each section on this page stands out as its own box
// rather than the three running together as one white column — Ben's ask, the
// same one answered on the agency referral detail page.
//
// Structure and both colours are taken from that page's Card component: a 4px
// bar of colour across the top, teal where the card can be edited and muted
// grey where it is read-only. `overflow: hidden` is what clips the bar to the
// card's rounded top corners.
//
// The 22px/24px padding that used to sit on CARD has moved to CARD_BODY
// unchanged — it has to come off the outer box or the accent bar would be
// inset from the card's edges instead of spanning them. Every other value
// here is exactly what it was.
const EDIT_ACCENT = '#2A7F6F'  // teal — editable card
const READ_ACCENT = '#7A8899'  // muted grey — read-only card

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 1px 4px rgba(27,43,75,0.06)',
  overflow: 'hidden',
  marginBottom: '18px',
}
const CARD_BODY: React.CSSProperties = {
  padding: '22px 24px',
}

function CardShell({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div style={CARD}>
      <div style={{ background: accent, height: '4px' }} />
      <div style={CARD_BODY}>{children}</div>
    </div>
  )
}
const CARD_HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '18px',
  paddingBottom: '14px',
  borderBottom: '1px solid #EDE9E1',
}
const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '15px',
  color: '#1B2B4B',
}
// Column tracks live in globals.css (.fa-profile-row) so they can stack below
// 1280px — every element using ROW / ROW_LAST carries that class.
const ROW: React.CSSProperties = {
  display: 'grid',
  alignItems: 'start',
  padding: '10px 0',
  borderBottom: '1px solid #F5F1EA',
}
const ROW_LAST: React.CSSProperties = { ...ROW, borderBottom: 'none' }
const LABEL: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#7A8899',
  paddingTop: '3px',
}
const VALUE: React.CSSProperties = {
  fontSize: '13px',
  color: '#2C3A4A',
}
const VALUE_MUTED: React.CSSProperties = {
  fontSize: '13px',
  color: '#A0A9B5',
  fontStyle: 'italic',
}
const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: '6px',
  border: '1px solid #EDE9E1',
  fontSize: '13px',
  color: '#2C3A4A',
  background: 'white',
  outline: 'none',
  fontFamily: 'inherit',
}
const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: '7px',
  border: 'none',
  background: '#2A7F6F',
  color: 'white',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const BTN_SECONDARY: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: '7px',
  border: '1px solid #EDE9E1',
  background: 'white',
  color: '#2C3A4A',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const EDIT_LINK: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#2A7F6F',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

// ============ AGENCY CARD ============

function AgencyCard({ agency, canEdit }: { agency: Agency; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: agency.name ?? '',
    officeName: agency.officeName ?? '',
    address: agency.address ?? '',
    address2: agency.address2 ?? '',
    city: agency.city ?? '',
    state: agency.state ?? '',
    zip: agency.zip ?? '',
    phone: agency.phone ?? '',
    website: agency.website ?? '',
    // Seeded through formatEIN so an existing value that was stored before this
    // field was formatted opens in the right shape rather than only correcting
    // itself once somebody types into it.
    ein: formatEIN(agency.ein ?? ''),
  })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/agency/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      // A PATCH that is bounced to the sign-in page comes back as a followed
      // redirect: 200, with HTML in it. `res.ok` is true, so both cards used to
      // close the editor and report success while nothing had been written.
      // That is reachable whenever the session is not recognised on this
      // request — which is exactly the state the portal is in on a phone today
      // (see the note on this in the PR). Saying so beats a silent no-op.
      if (res.redirected) {
        throw new Error('Your session has expired. Please sign in again.')
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message ?? 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setForm({
      name: agency.name ?? '',
      officeName: agency.officeName ?? '',
      address: agency.address ?? '',
      address2: agency.address2 ?? '',
      city: agency.city ?? '',
      state: agency.state ?? '',
      zip: agency.zip ?? '',
      phone: agency.phone ?? '',
      website: agency.website ?? '',
      ein: formatEIN(agency.ein ?? ''),
    })
    setError(null)
    setEditing(false)
  }

  const locality = cityStateZip(agency.city, agency.state, agency.zip)

  return (
    <CardShell accent={EDIT_ACCENT}>
      <div style={CARD_HEADER}>
        <div style={CARD_TITLE}>Agency Information</div>
        {canEdit && !editing && (
          <button style={EDIT_LINK} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Agency Name</div>
            <div style={VALUE}>{agency.name}</div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Office Name</div>
            <div style={agency.officeName ? VALUE : VALUE_MUTED}>
              {agency.officeName ?? 'Not set'}
            </div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Address</div>
            <div style={agency.address || locality ? VALUE : VALUE_MUTED}>
              {agency.address}
              {agency.address2 ? (
                <>
                  <br />
                  {agency.address2}
                </>
              ) : null}
              {locality ? (
                <>
                  {agency.address ? <br /> : null}
                  {locality}
                </>
              ) : null}
              {!agency.address && !locality ? 'Not set' : null}
            </div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Main Phone</div>
            <div style={VALUE}>{agency.phone || '—'}</div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Website</div>
            <div style={agency.website ? VALUE : VALUE_MUTED}>
              {agency.website ? (
                <a
                  href={agency.website.startsWith('http') ? agency.website : `https://${agency.website}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#2A7F6F' }}
                >
                  {agency.website}
                </a>
              ) : (
                'Not set'
              )}
            </div>
          </div>
          <div className="fa-profile-row" style={ROW_LAST}>
            <div style={LABEL}>EIN</div>
            <div style={agency.ein ? VALUE : VALUE_MUTED}>{agency.ein ?? 'Not set'}</div>
          </div>
        </div>
      ) : (
        <div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Agency Name</div>
            <input style={INPUT} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Office Name</div>
            <input style={INPUT} value={form.officeName} onChange={e => setForm({ ...form, officeName: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Address</div>
            <input style={INPUT} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Street" />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Address 2</div>
            <input style={INPUT} value={form.address2} onChange={e => setForm({ ...form, address2: e.target.value })} placeholder="Apt / Suite / Unit" />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>City / State / Zip</div>
            <div className="fa-profile-citystatezip" style={{ display: 'grid', gap: '6px' }}>
              <input style={INPUT} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
              <input style={INPUT} value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="ST" maxLength={2} />
              <input style={INPUT} value={form.zip} onChange={e => setForm({ ...form, zip: e.target.value })} placeholder="Zip" />
            </div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Main Phone</div>
            <input style={INPUT} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Website</div>
            <input style={INPUT} value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="reagan.com" />
          </div>
          {/* EIN. Was a free-text box with a placeholder and nothing else, so
              the same nine digits could be stored a dozen ways. formatEIN is
              the claim form's own masker, now shared — see lib/ein.ts.
              inputMode 'numeric' brings up the number pad on a phone; the
              maxLength of 10 is nine digits plus the hyphen it inserts. */}
          <div className="fa-profile-row" style={ROW_LAST}>
            <div style={LABEL}>EIN</div>
            <div>
              <input
                style={INPUT}
                value={form.ein}
                onChange={e => setForm({ ...form, ein: formatEIN(e.target.value) })}
                placeholder="12-3456789"
                inputMode="numeric"
                maxLength={10}
              />
              {/* Warned, not blocked: EIN is optional on this record, so a
                  half-typed one must not be able to trap somebody who came here
                  to change their phone number. */}
              <div style={{ fontSize: '11px', color: form.ein && !isCompleteEIN(form.ein) ? '#C9A84C' : '#7A8899', marginTop: '4px' }}>
                {form.ein && !isCompleteEIN(form.ein)
                  ? 'An EIN is nine digits, formatted 12-3456789. This one is incomplete.'
                  : 'Nine digits, formatted as 12-3456789. Optional.'}
              </div>
            </div>
          </div>

          {error && (
            <div style={{ background: '#FDEDEC', color: '#C0392B', fontSize: '12px', padding: '8px 12px', borderRadius: '6px', marginTop: '14px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button style={BTN_SECONDARY} onClick={cancel} disabled={saving}>Cancel</button>
            <button style={BTN_PRIMARY} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </CardShell>
  )
}

// ============ MY PROFILE CARD ============

function MyProfileCard({ user }: { user: AgencyUser }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = splitName(user.name)
  const [form, setForm] = useState({
    firstName: user.firstName ?? initial.firstName,
    lastName: user.lastName ?? initial.lastName,
    phone: user.phone ?? '',
  })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/agency/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      // A PATCH that is bounced to the sign-in page comes back as a followed
      // redirect: 200, with HTML in it. `res.ok` is true, so both cards used to
      // close the editor and report success while nothing had been written.
      // That is reachable whenever the session is not recognised on this
      // request — which is exactly the state the portal is in on a phone today
      // (see the note on this in the PR). Saying so beats a silent no-op.
      if (res.redirected) {
        throw new Error('Your session has expired. Please sign in again.')
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message ?? 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    const i = splitName(user.name)
    setForm({
      firstName: user.firstName ?? i.firstName,
      lastName: user.lastName ?? i.lastName,
      phone: user.phone ?? '',
    })
    setError(null)
    setEditing(false)
  }

  return (
    <CardShell accent={EDIT_ACCENT}>
      <div style={CARD_HEADER}>
        <div style={CARD_TITLE}>My Profile</div>
        {!editing && (
          <button style={EDIT_LINK} onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>

      {!editing ? (
        <div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Name</div>
            <div style={VALUE}>{user.name}</div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Email</div>
            <div style={VALUE}>{user.email}</div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Phone</div>
            <div style={user.phone ? VALUE : VALUE_MUTED}>{user.phone ?? 'Not set'}</div>
          </div>
          <div className="fa-profile-row" style={ROW_LAST}>
            <div style={LABEL}>Role</div>
            <div style={VALUE}>{user.role}</div>
          </div>
        </div>
      ) : (
        <div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>First Name</div>
            <input style={INPUT} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Last Name</div>
            <input style={INPUT} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Email</div>
            <div style={{ ...VALUE_MUTED, paddingTop: '3px' }}>{user.email} (managed by Clerk)</div>
          </div>
          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Phone</div>
            <input style={INPUT} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="fa-profile-row" style={ROW_LAST}>
            <div style={LABEL}>Role</div>
            <div style={{ ...VALUE_MUTED, paddingTop: '3px' }}>{user.role} (assigned by admin)</div>
          </div>

          {error && (
            <div style={{ background: '#FDEDEC', color: '#C0392B', fontSize: '12px', padding: '8px 12px', borderRadius: '6px', marginTop: '14px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button style={BTN_SECONDARY} onClick={cancel} disabled={saving}>Cancel</button>
            <button style={BTN_PRIMARY} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </CardShell>
  )
}

// ============ ADMIN CONTACT CARD ============

function AdminCard({ agency, isAdmin }: { agency: Agency; isAdmin: boolean }) {
  const hasAdmin = Boolean(agency.contactName)

  return (
    <CardShell accent={READ_ACCENT}>
      <div style={CARD_HEADER}>
        <div style={CARD_TITLE}>Primary Admin</div>
      </div>

      {hasAdmin ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '10px',
                background: '#2A7F6F',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 700,
                fontSize: '18px',
              }}
            >
              {initials(agency.contactName)}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#1B2B4B' }}>
                {agency.contactName}
              </div>
              <div style={{ fontSize: '12px', color: '#7A8899', marginTop: '2px' }}>
                Primary Administrator
              </div>
            </div>
          </div>

          <div className="fa-profile-row" style={ROW}>
            <div style={LABEL}>Email</div>
            <div style={VALUE}>
              {agency.adminEmail ? (
                <a href={`mailto:${agency.adminEmail}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>
                  {agency.adminEmail}
                </a>
              ) : (
                <span style={{ color: '#A0A9B5', fontStyle: 'italic' }}>Not set</span>
              )}
            </div>
          </div>
          <div className="fa-profile-row" style={ROW_LAST}>
            <div style={LABEL}>Phone</div>
            <div style={VALUE}>
              {agency.adminPhone ? (
                <a href={`tel:${agency.adminPhone}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>
                  {agency.adminPhone}
                </a>
              ) : (
                <span style={{ color: '#A0A9B5', fontStyle: 'italic' }}>Not set</span>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: '18px',
              padding: '10px 14px',
              background: isAdmin ? '#EAF4F2' : '#F5F1EA',
              borderRadius: '8px',
              fontSize: '12px',
              color: isAdmin ? '#2A7F6F' : '#5A6577',
              lineHeight: 1.5,
            }}
          >
            {isAdmin
              ? 'You are the primary administrator for this agency.'
              : 'Contact your primary administrator for portal help or role changes.'}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: '#7A8899', padding: '10px 0' }}>
          No primary administrator has been assigned yet. Contact Furniture Assist to set one.
        </div>
      )}
    </CardShell>
  )
}

// ============ MAIN ============

export default function ProfileClient({
  agency,
  agencyUser,
  isAdmin,
}: {
  agency: Agency
  agencyUser: AgencyUser
  isAdmin: boolean
}) {
  // Column tracks live in globals.css (.fa-profile-grid) so they can stack below 1280px.
  return (
    <div
      className="fa-profile-grid"
      style={{
        display: 'grid',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      {/* Left column — Agency + My Profile stacked */}
      <div>
        <AgencyCard agency={agency} canEdit={isAdmin} />
        <MyProfileCard user={agencyUser} />
      </div>

      {/* Right column — Admin */}
      <div>
        <AdminCard agency={agency} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
