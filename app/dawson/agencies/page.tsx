'use client'

// app/dawson/agencies/page.tsx
//
// The one Agencies list. Replaces the four status-specific pages
// (active / pending / unclaimed / inactive) — same task on different records,
// so one screen with a status filter rather than four destinations. Pending
// Approval is NOT here: it's a decision queue, not a browse list, and folds
// into a Needs Action page later. /dawson/agencies/pending stays a working,
// unlinked route until then.
//
// Structure mirrors the referral history page: shell-bar title, search,
// filter pills with counts, then cards. Consistency between Dawson's two list
// pages matters more than optimising either.
//
//   Card 1 — Active + Unclaimed, one alphabetical list (not sub-grouped;
//            status lives in the pill). His task is finding an agency.
//   Card 2 — Inactive & rejected, collapsed by default.
//
// No row actions. The whole row links to /dawson/agencies/[id]; invite,
// deactivate, reinstate and reconsider all live there.

import { useState, useEffect } from 'react'
import { matchesSearch } from '@/lib/search'
import { useAgencyStaffSearch } from '@/components/internal/useAgencyStaffSearch'
import StaffMatchHint from '@/components/internal/StaffMatchHint'

// Only the fields this list shows. GET /api/dawson/agencies (getAllAgencies
// with no status arg) returns the whole table, already sorted by Agency Name.
type Agency = {
  id: string
  name: string
  officeName: string | null
  city: string | null
  contactName: string
  status: string
}

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
  overflow: 'hidden',
}

// Column widths shared by the header and every row so they line up.
//
// Layout: [Agency] [spacerL] [Town][Primary admin][Staff] [spacerR] [Status].
// spacerR is twice spacerL, so the Town/admin/Staff group sits left of centre
// — grouped with the agency name — and Status stands alone on the right with
// clear air before it. Staff is a narrow, LEFT-aligned column: values run 0–16,
// so digit alignment buys nothing, and a wide right-aligned column left dead
// space that pushed the number toward Status.
const COL = {
  agency: { flex: '0 1 380px', minWidth: 0 } as React.CSSProperties,
  town: { width: '140px', flexShrink: 0 } as React.CSSProperties,
  admin: { width: '180px', flexShrink: 0 } as React.CSSProperties,
  staff: { width: '32px', flexShrink: 0 } as React.CSSProperties,
  spacerL: { flex: 1, minWidth: '16px' } as React.CSSProperties,
  spacerR: { flex: 2, minWidth: '32px' } as React.CSSProperties,
  status: { width: '120px', flexShrink: 0 } as React.CSSProperties,
}

const MUTED_CELL: React.CSSProperties = {
  fontSize: '13px',
  color: '#7A8899',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  Approved: { bg: 'rgba(42,127,111,0.12)', color: '#2A7F6F', label: 'Active' },
  Unclaimed: { bg: 'rgba(201,168,76,0.15)', color: '#B8912F', label: 'Unclaimed' },
  Invited: { bg: 'rgba(201,168,76,0.15)', color: '#B8912F', label: 'Invited' },
  Inactive: { bg: '#F0F0F0', color: '#7A8899', label: 'Inactive' },
  Rejected: { bg: 'rgba(192,57,43,0.1)', color: '#C0392B', label: 'Rejected' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] ?? { bg: '#F0F0F0', color: '#7A8899', label: status || '—' }
  return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function FilterPill({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  // Zero-count pill: muted and inert, never an alarm colour.
  const zero = count === 0
  return (
    <button
      onClick={zero ? undefined : onClick}
      disabled={zero}
      style={{
        padding: '5px 12px', borderRadius: '20px', border: '1px solid',
        borderColor: active ? '#2A7F6F' : '#EDE9E1',
        background: active ? '#2A7F6F' : 'white',
        color: active ? 'white' : zero ? '#B8C1CC' : '#7A8899',
        fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-montserrat)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        cursor: zero ? 'default' : 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.75 }}>{count}</span>
    </button>
  )
}

function ColumnHead() {
  // Sentence case at 12px rather than 10px uppercase — on Dawson's side the
  // words are meant to be read, not act as chrome. Flip textTransform back to
  // 'uppercase' + letterSpacing '0.08em' for the old look.
  const cell: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, letterSpacing: '0.01em', color: '#9AA6B2',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '8px 20px', borderTop: '1px solid #F3F0EA' }}>
      <div style={{ ...cell, ...COL.agency }}>Agency</div>
      <div style={COL.spacerL} />
      <div style={{ ...cell, ...COL.town }}>Town</div>
      <div style={{ ...cell, ...COL.admin }}>Primary admin</div>
      <div style={{ ...cell, ...COL.staff }}>Staff</div>
      <div style={COL.spacerR} />
      <div style={{ ...cell, ...COL.status }}>Status</div>
    </div>
  )
}

function AgencyRow({ a, staffCount, matched }: {
  a: Agency; staffCount: number | null; matched: string[]
}) {
  return (
    <a
      href={`/dawson/agencies/${a.id}`}
      onMouseEnter={e => (e.currentTarget.style.background = '#FAFAF8')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'flex', alignItems: 'center', gap: '16px',
        padding: '11px 20px', textDecoration: 'none',
        borderTop: '1px solid #F3F0EA', background: 'transparent',
      }}
    >
      <div style={{ ...COL.agency }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: '#2A7F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a.name}
        </div>
        {a.officeName && (
          <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {a.officeName}
          </div>
        )}
        <StaffMatchHint names={matched} />
      </div>
      <div style={COL.spacerL} />
      <div style={{ ...MUTED_CELL, ...COL.town }}>{a.city || '—'}</div>
      <div style={{ ...MUTED_CELL, ...COL.admin }}>{a.contactName || '—'}</div>
      <div style={{ ...COL.staff, fontSize: '13px', color: '#7A8899' }}>
        {staffCount === null ? '—' : staffCount}
      </div>
      <div style={COL.spacerR} />
      <div style={{ ...COL.status }}>
        <StatusPill status={a.status} />
      </div>
    </a>
  )
}

type PillKey = 'all' | 'active' | 'unclaimed'

const isActive = (s: string) => s === 'Approved'
const isUnclaimed = (s: string) => s === 'Unclaimed' || s === 'Invited'
const isEnded = (s: string) => s === 'Inactive' || s === 'Rejected'

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pill, setPill] = useState<PillKey>('all')
  const [showEnded, setShowEnded] = useState(false)

  const { matchNames: staffMatches, count: staffCount } = useAgencyStaffSearch()

  useEffect(() => {
    fetch('/api/dawson/agencies')
      .then(r => (r.ok ? r.json() : []))
      .then((data: Agency[]) => {
        setAgencies(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // A row shows if its own fields match OR one of its people match; the hint
  // under the name only appears in the people-only case (same as the old
  // pages).
  //
  // `a.city` added when Town became a visible column — "Bridgeway in Elizabeth"
  // is how Dawson names an agency, and the old unclaimed/pending pages already
  // matched on city. My call, not spec'd; drop `a.city` here to revert.
  const fieldMatch = (a: Agency) => matchesSearch(search, a.name, a.officeName, a.city)
  const rowMatches = (a: Agency) => fieldMatch(a) || staffMatches(a.id, search).length > 0
  const hintFor = (a: Agency) => (fieldMatch(a) ? [] : staffMatches(a.id, search))

  const live = agencies.filter(a => isActive(a.status) || isUnclaimed(a.status))
  const ended = agencies.filter(a => isEnded(a.status))

  // Counts are of the whole pool, not the search-filtered view — they show
  // where reconciliation stands and must not shrink as Dawson types.
  const counts = {
    all: live.length,
    active: live.filter(a => isActive(a.status)).length,
    unclaimed: live.filter(a => isUnclaimed(a.status)).length,
  }

  const card1 = live
    .filter(a =>
      pill === 'all' ? true : pill === 'active' ? isActive(a.status) : isUnclaimed(a.status),
    )
    .filter(rowMatches)
  const card2 = ended.filter(rowMatches)

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      {/* maxWidth + margin:0 auto caps search, pills and both cards as one
          group and centres it in the main area (left of it is the 240px rail,
          via <main> in the layout). Same mechanism the agency portal uses —
          `mx-auto` on a max-width wrapper. See the note in the PR: the durable
          home for this is a shared container applied to every Dawson page at
          once, not per page. */}
      <div style={{ padding: '28px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        <input
          type="text"
          placeholder="Search by agency or staff name"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', background: 'white', display: 'block', marginBottom: '14px' }}
        />

        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
          <FilterPill label="All" count={counts.all} active={pill === 'all'} onClick={() => setPill('all')} />
          <FilterPill label="Active" count={counts.active} active={pill === 'active'} onClick={() => setPill('active')} />
          <FilterPill label="Unclaimed" count={counts.unclaimed} active={pill === 'unclaimed'} onClick={() => setPill('unclaimed')} />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading…</div>
        ) : (
          <>
            <div style={CARD}>
              <ColumnHead />
              {card1.length === 0 ? (
                <div style={{ padding: '28px 20px', textAlign: 'center', color: '#7A8899', fontSize: '13px', borderTop: '1px solid #F3F0EA' }}>
                  No agencies match.
                </div>
              ) : (
                card1.map(a => (
                  <AgencyRow key={a.id} a={a} staffCount={staffCount(a.id)} matched={hintFor(a)} />
                ))
              )}
            </div>

            {/* Hidden entirely when there's nothing ended (or the search
                matched none of them) — an empty collapsed card is a control
                that does nothing. Matches the empty-group convention on both
                portals. */}
            {card2.length > 0 && (
              <div style={{ ...CARD, marginTop: '16px' }}>
                <button
                  onClick={() => setShowEnded(v => !v)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-montserrat)', textAlign: 'left' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7A8899" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showEnded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#1B2B4B' }}>Inactive &amp; rejected</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#7A8899' }}>{card2.length}</span>
                </button>
                {showEnded && (
                  <>
                    <ColumnHead />
                    {card2.map(a => (
                      <AgencyRow key={a.id} a={a} staffCount={staffCount(a.id)} matched={hintFor(a)} />
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
