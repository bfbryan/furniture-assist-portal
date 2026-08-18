// app/(agency)/referrals/history/HistoryClient.tsx
// Agency history — search and filter chips over a flat list of ClientCard-style
// rows (same visual as Active/Dashboard), most recent first.
//
// Ordered by appointment date, falling back to the referral date for rejected
// referrals, which never get an appointment.

'use client'

import { useState, useMemo } from 'react'
import { addDaysISO, easternTodayISO } from '@/lib/dates'
import { matchesSearch } from '@/lib/search'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  appointmentTime: string | null
  referralReview: string
  appointmentStatus: string
  appointmentSlipUrl: string
  clientReceiptUrl: string | null
  dataPageUrl: string
  referredBy: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
}

type StatusFilter = 'all' | 'completed' | 'missed' | 'cancelled' | 'rejected' | 'withdrawn'
type DateRange = '30' | '60' | '90' | '180' | 'all'

// ---------- helpers ----------

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// The date a referral is filed under: when the appointment happened, or when it
// was submitted if it never got one (rejected referrals have no appointment).
function activityDate(r: Referral): string {
  return r.appointmentDate ?? r.referralDate ?? ''
}

function outcomeOf(r: Referral): 'completed' | 'missed' | 'cancelled' | 'rejected' | 'withdrawn' | 'other' {
  if (r.referralReview === 'Rejected') return 'rejected'
  // Withdrawn is the agency's own doing, not a refusal. Without its own
  // outcome it fell through to 'other', which OUTCOME_META resolves to the
  // Cancelled styling and label — so a referral the agency withdrew read back
  // to them as "Cancelled", i.e. as something Furniture Assist did.
  if (r.referralReview === 'Withdrawn') return 'withdrawn'
  if (r.appointmentStatus === 'Completed') return 'completed'
  if (r.appointmentStatus === 'No Show') return 'missed'
  if (r.appointmentStatus === 'Cancelled') return 'cancelled'
  return 'other'
}

const OUTCOME_META: Record<
  string,
  { label: string; accent: string; pillBg: string; pillText: string }
> = {
  completed: { label: 'Completed',          accent: '#2A7F6F', pillBg: '#EAF4F2', pillText: '#2A7F6F' },
  missed:    { label: 'Missed appointment', accent: '#C9A84C', pillBg: '#FEF6E7', pillText: '#B98A29' },
  cancelled: { label: 'Cancelled',          accent: '#C0392B', pillBg: '#FDEDEC', pillText: '#C0392B' },
  rejected:  { label: 'Rejected',           accent: '#C0392B', pillBg: '#FDEDEC', pillText: '#C0392B' },
  withdrawn: { label: 'Withdrawn',          accent: '#7A8899', pillBg: '#F0F0F0', pillText: '#7A8899' },
}

const STATUS_CHIPS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all',       label: 'ALL' },
  { key: 'completed', label: 'COMPLETED' },
  { key: 'missed',    label: 'MISSED APPOINTMENT' },
  { key: 'cancelled', label: 'CANCELLED' },
  { key: 'rejected',  label: 'REJECTED' },
  { key: 'withdrawn', label: 'WITHDRAWN' },
]

// Shared by all three filter selects so they read as one set of controls.
const FILTER_SELECT: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '7px',
  border: '1px solid #EDE9E1',
  fontSize: '13px',
  color: '#2C3A4A',
  background: 'white',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const DATE_CHIPS: Array<{ key: DateRange; label: string }> = [
  { key: '30',  label: 'Last 30 days' },
  { key: '60',  label: 'Last 60 days' },
  { key: '90',  label: 'Last 90 days' },
  { key: '180', label: 'Last 6 months' },
  { key: 'all', label: 'All time' },
]

// ---------- receipt icon ----------
function ReceiptIcon({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="View Receipt"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        borderRadius: '6px',
        background: '#EAF4F2',
        color: '#2A7F6F',
        textDecoration: 'none',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    </a>
  )
}

// ---------- one card row ----------
function HistoryCard({ r }: { r: Referral }) {
  const outcome = outcomeOf(r)
  const meta = OUTCOME_META[outcome] ?? OUTCOME_META.cancelled
  const addressLine1 = [r.address, r.address2].filter(Boolean).join(', ')
  const addressLine2 = [r.city, r.state, r.zip].filter(Boolean).join(' ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr',
        background: 'white',
        borderRadius: '10px',
        boxShadow: '0 1px 4px rgba(27,43,75,0.05)',
        marginBottom: '8px',
      }}
    >
      <div style={{ background: meta.accent, borderTopLeftRadius: '10px', borderBottomLeftRadius: '10px' }} />
      {/* Column tracks live in globals.css (.fa-history-card-grid) so they can stack below 1280px. */}
      <div
        className="fa-history-card-grid"
        style={{
          display: 'grid',
          alignItems: 'start',
          gap: '10px',
          padding: '14px 16px',
        }}
      >
        {/* CLIENT NAME */}
        <div>
          <div style={labelStyle}>Client Name</div>
          <a href={`/referrals/${r.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 600, fontSize: '13px', color: '#2A7F6F' }}>
              {r.clientName}
            </div>
          </a>
          {r.phone && (
            <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '2px' }}>{r.phone}</div>
          )}
        </div>

        {/* ADDRESS */}
        <div>
          <div style={labelStyle}>Address</div>
          {addressLine1 && <div style={valueStyle}>{addressLine1}</div>}
          {addressLine2 && <div style={valueStyle}>{addressLine2}</div>}
          {!addressLine1 && !addressLine2 && <div style={valueStyle}>—</div>}
        </div>

        {/* REFERRED BY */}
        <div>
          <div style={labelStyle}>Referred By</div>
          <div style={valueStyle}>{r.referredBy ?? '—'}</div>
        </div>

        {/* SUBMITTED */}
        <div>
          <div style={labelStyle}>Submitted</div>
          <div style={valueStyle}>{formatShortDate(r.referralDate)}</div>
        </div>

        {/* APPOINTMENT */}
        <div>
          <div style={labelStyle}>Appointment</div>
          <div style={valueStyle}>{r.appointmentDate ? formatShortDate(r.appointmentDate) : '—'}</div>
        </div>

        {/* OUTCOME */}
        <div>
          <div style={labelStyle}>Outcome</div>
          <span
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: '12px',
              background: meta.pillBg,
              color: meta.pillText,
            }}
          >
            {meta.label}
          </span>
        </div>

        {/* ACTION — Receipt */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: '14px' }}>
          {outcome === 'completed' && r.clientReceiptUrl && <ReceiptIcon url={r.clientReceiptUrl} />}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#1B2B4B',
  marginBottom: '6px',
}
const valueStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#7A8899',
}

// ---------- main ----------
export default function HistoryClient({
  referrals,
  isAdmin,
}: {
  referrals: Referral[]
  isAdmin: boolean
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange>('60')
  const [search, setSearch] = useState('')
  const [staffFilter, setStaffFilter] = useState<string>('all')

  const staffNames = useMemo(
    () => Array.from(new Set(referrals.map(r => r.referredBy).filter(Boolean))) as string[],
    [referrals]
  )

  // Apply search + status + staff + date range.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Cutoff as an Eastern calendar date. It used to be a wall-clock instant on
    // the ambient zone, which both put the boundary in the wrong place on
    // Vercel and made the oldest day fall in or out depending on the time of
    // day you happened to look.
    const cutoffISO =
      dateRange === 'all' ? null : addDaysISO(easternTodayISO(), -parseInt(dateRange, 10))
    return referrals.filter(r => {
      if (!matchesSearch(q, r.clientName)) return false
      if (staffFilter !== 'all' && r.referredBy !== staffFilter) return false
      const o = outcomeOf(r)
      if (statusFilter !== 'all' && o !== statusFilter) return false

      // date range checks appointment date (or referral date for rejected).
      if (cutoffISO) {
        const dateStr = r.appointmentDate ?? r.referralDate
        if (dateStr && dateStr.slice(0, 10) < cutoffISO) return false
      }
      return true
    })
  }, [referrals, search, staffFilter, statusFilter, dateRange])

  // Flat list, most recent first. History is a lookup ("when did we refer this
  // person, and what came of it"), not a schedule, so grouping by Saturday —
  // which is how Dawson works week to week — buried each card under a header
  // and, with only one or two referrals per Saturday, made the page mostly
  // chrome. Recency plus the search box above answers both jobs directly.
  const ordered = useMemo(() => {
    return [...visible].sort((a, b) => {
      const da = activityDate(a)
      const db = activityDate(b)
      if (da !== db) return da < db ? 1 : -1
      return a.clientName.localeCompare(b.clientName)
    })
  }, [visible])

  return (
    <>
      {/* Staff filter — own line, admin only */}
      {isAdmin && staffNames.length > 0 && (
        <div style={{ marginBottom: '18px' }}>
          <label
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: '#7A8899',
              marginRight: '10px',
            }}
          >
            Filter by staff:
          </label>
          {/* Width lives in globals.css (.fa-history-staff-select): the label
              plus a 200px select overflows a phone, so below 1280px the select
              takes its own full-width line. */}
          <select
            className="fa-history-staff-select"
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            style={FILTER_SELECT}
          >
            <option value="all">All Staff</option>
            {staffNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Row 1 — search + date range chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '10px',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px', maxWidth: '340px' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#7A8899"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by client name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 34px',
              borderRadius: '7px',
              border: '1px solid #EDE9E1',
              fontSize: '13px',
              color: '#2C3A4A',
              background: 'white',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {/* Wrapping lives in globals.css (.fa-history-chips): below 1280px both
            chip rows become one-line horizontal strips instead of wrapping to
            two rows each and pushing the results off screen. */}
        <div className="fa-history-chips" style={{ gap: '6px' }}>
          {DATE_CHIPS.map(c => {
            const active = dateRange === c.key
            return (
              <button
                key={c.key}
                onClick={() => setDateRange(c.key)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '999px',
                  border: `1px solid ${active ? '#1B2B4B' : '#EDE9E1'}`,
                  background: active ? '#1B2B4B' : '#F5F1EA',
                  color: active ? 'white' : '#2C3A4A',
                  fontSize: '12px',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Below 1280px the two chip rows are replaced by these — same state, so
          the desktop chips are untouched. Ten chips wrapped to four rows owned
          most of the screen; as one-line strips they were compact but clipped
          at the right edge, which read as broken. Two selects are compact and
          complete, and match the staff filter directly above them. Their
          options are self-labelling, so no extra label rows are needed. */}
      <div className="fa-history-selects" style={{ gap: '8px', marginBottom: '22px' }}>
        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value as DateRange)}
          style={FILTER_SELECT}
        >
          {DATE_CHIPS.map(c => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          style={FILTER_SELECT}
        >
          {STATUS_CHIPS.map(c => (
            <option key={c.key} value={c.key}>
              {c.key === 'all' ? 'All outcomes' : c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Row 2 — status chips */}
      <div className="fa-history-chips" style={{ gap: '6px', marginBottom: '22px' }}>
        {STATUS_CHIPS.map(c => {
          const active = statusFilter === c.key
          return (
            <button
              key={c.key}
              onClick={() => setStatusFilter(c.key)}
              style={{
                padding: '7px 14px',
                borderRadius: '999px',
                border: 'none',
                background: active ? '#2A7F6F' : 'transparent',
                color: active ? 'white' : '#7A8899',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {ordered.length === 0 ? (
        <div
          style={{
            background: 'white',
            borderRadius: '12px',
            padding: '36px',
            textAlign: 'center',
            color: '#7A8899',
            fontSize: '14px',
          }}
        >
          No referrals match your filters.
        </div>
      ) : (
        ordered.map(r => <HistoryCard key={r.id} r={r} />)
      )}
    </>
  )
}
