'use client'

// app/dawson/staff/wrong-agency/page.tsx
//
// Staff an agency admin has flagged as belonging to a different agency.
//
// Flagging somebody already did three things and surfaced none of them: their
// Clerk org membership is deleted, Portal Invite Status is set to 'Wrong
// Agency' in Airtable, and the agency's own Team page filters them out. So the
// person vanished from the agency that flagged them and appeared nowhere on
// this side — Ben had no way to see who had been flagged, let alone move them.
// This page is the missing end of that flow.
//
// Deliberately read-only and deliberately plain, built to the same shape as
// the four agency lists next to it: sticky white header with a count pill, one
// search box, column headings, one card per row.
//
// ON THE "WHEN" COLUMN. There is no field on Agency Users that records when
// the flag was raised, so nothing can honestly print that date. Invited and
// Added are the two real dates the row carries and they are labelled as
// themselves rather than dressed up as the flag date. A 'Wrong Agency Flagged
// On' field in Airtable would let this page show the real thing; that is one
// field and one line in PATCH /api/admin/staff/[id]/status.

import { useState, useEffect } from 'react'
import { matchesSearch } from '@/lib/search'
import { formatDateOnly, formatEasternTimestamp } from '@/lib/dates'

type FlaggedStaff = {
  id: string
  firstName: string
  lastName: string
  name: string
  email: string | null
  phone: string | null
  agencyId: string | null
  agencyName: string | null
  status: string | null
  invitedDate: string | null
  invitedBy: string | null
  addedDate: string | null
}

const NAME_COL_WIDTH = '300px'
const AGENCY_COL_WIDTH = '280px'

// Two date fields, two different kinds of value, so two different helpers —
// see the header of lib/dates.ts. Invited Date is a dateTime (a real instant,
// read in Eastern); Record Creation Date arrives as a plain 'YYYY-MM-DD'.
function formatInstant(value: string | null) {
  if (!value) return '—'
  return formatEasternTimestamp(value, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDay(value: string | null) {
  if (!value) return '—'
  return formatDateOnly(value, { month: 'short', day: 'numeric', year: 'numeric' })
}

const HEADER_CELL: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#1B2B4B',
  fontFamily: 'var(--font-montserrat)',
  paddingRight: '20px',
  flexShrink: 0,
}

function FlaggedCard({ staff }: { staff: FlaggedStaff }) {
  // Plenty of these rows are name-only import placeholders, so the display
  // name can fall back to the email. When it does, the email sub-line below
  // would just repeat it.
  const displayName = staff.name || staff.email || 'Unnamed staff record'
  const showEmailLine = Boolean(staff.email) && staff.email !== displayName

  return (
    <div
      style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Amber, the colour this portal already uses for "needs a look" rather
          than the red it uses for rejected or cancelled. Nothing is broken
          here; somebody is in the wrong place. */}
      <div style={{ width: '4px', alignSelf: 'stretch', background: '#C9A84C', flexShrink: 0 }} />

      <div style={{ width: NAME_COL_WIDTH, flexShrink: 0, padding: '14px 20px', minWidth: 0 }}>
        <a href={`/dawson/staff/${staff.id}`} style={{ textDecoration: 'none' }}>
          <div
            style={{
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 700,
              fontSize: '15px',
              color: '#2A7F6F',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayName}
          </div>
        </a>
        {showEmailLine && (
          <div style={{ fontSize: '11px', color: '#7A8899', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {staff.email}
          </div>
        )}
        {staff.phone && (
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{staff.phone}</div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px', minWidth: 0 }}>
        <div style={{ width: AGENCY_COL_WIDTH, flexShrink: 0, padding: '0 20px 14px 0', minWidth: 0 }}>
          {staff.agencyId ? (
            <a href={`/dawson/agencies/${staff.agencyId}`} style={{ textDecoration: 'none' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1B2B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {staff.agencyName || 'Unnamed agency'}
              </div>
            </a>
          ) : (
            // A staff row with no Agency link at all. Rare, and always an
            // import placeholder — the sub-line below is omitted because there
            // is no agency to have done the flagging.
            <div style={{ fontSize: '13px', color: '#A0A9B5', fontStyle: 'italic' }}>
              No agency linked
            </div>
          )}
          {staff.agencyId && (
            <div style={{ fontSize: '11px', color: '#7A8899' }}>flagged this person</div>
          )}
        </div>

        <div style={{ width: '160px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>
            {formatInstant(staff.invitedDate)}
          </div>
          {staff.invitedBy && (
            <div style={{ fontSize: '10px', color: '#A0A9B5' }}>by {staff.invitedBy}</div>
          )}
        </div>

        <div style={{ width: '140px', flexShrink: 0, padding: '0 20px 14px 0' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#7A8899' }}>
            {formatDay(staff.addedDate)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function WrongAgencyStaffPage() {
  const [staff, setStaff] = useState<FlaggedStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/dawson/staff/wrong-agency')
      .then(async r => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then(data => {
        setStaff(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => {
        setError('That list could not be loaded. Please refresh.')
        setLoading(false)
      })
  }, [])

  // matchesSearch treats a missing field as "does not match" rather than
  // crashing — most of these rows are name-only import placeholders.
  const filtered = staff.filter(s =>
    matchesSearch(search, s.name, s.email, s.agencyName)
  )

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header
        style={{
          background: 'white',
          borderBottom: '1px solid #EDE9E1',
          padding: '0 32px',
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
            Flagged Wrong Agency
          </div>
          {!loading && !error && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.18)', color: '#B8912F' }}>
              {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.6, marginBottom: '16px', maxWidth: '760px' }}>
          An agency admin flagged each of these people as belonging to a different
          agency. Their portal access has already been revoked and they no longer
          appear on their agency&apos;s team list. Moving somebody to the right
          agency is still an Airtable edit: change the Agency link and clear
          Portal Invite Status.
        </div>

        <input
          type="text"
          placeholder="Search people or agencies..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '260px', outline: 'none', marginBottom: '16px', display: 'block', background: 'white' }}
        />

        {!loading && !error && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '4px', marginBottom: '6px' }}>
            <div style={{ width: '4px', flexShrink: 0 }} />
            <div style={{ ...HEADER_CELL, width: NAME_COL_WIDTH, paddingLeft: '20px' }}>Staff Member</div>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ ...HEADER_CELL, width: AGENCY_COL_WIDTH }}>Agency</div>
              <div style={{ ...HEADER_CELL, width: '160px' }}>Invited</div>
              <div style={{ ...HEADER_CELL, width: '140px' }}>Added</div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#C0392B', fontSize: '14px' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>
            {search
              ? 'Nobody here matches your search.'
              : 'Nobody has been flagged as being at the wrong agency.'}
          </div>
        ) : (
          filtered.map(s => <FlaggedCard key={s.id} staff={s} />)
        )}
      </div>
    </div>
  )
}
