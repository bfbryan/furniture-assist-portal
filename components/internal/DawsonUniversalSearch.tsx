'use client'

// components/internal/DawsonUniversalSearch.tsx
//
// The one search box in the internal page bar, on every route. Dawson's lookup
// tasks don't map to pages ("which agency is Maria at", "is this client
// do-not-serve") — per-page search made him guess the page first and a wrong
// guess reads as "not found". This searches clients, agencies and staff at
// once and jumps to the record.
//
// The fetch (/api/dawson/search) is debounced + 3-char-min and does the
// Airtable work. RANKING and grouping are here: each group is scored, sorted,
// trimmed to 6. Groups render in a fixed order — Clients, Agencies, Staff —
// never relevance-shuffled, because Dawson's queries are type-shaped and a
// stable layout scans faster. The keyboard cursor starts on a lone strong hit
// (exact name / full email / full phone) so Enter takes it straight there.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  DawsonSearchResponse,
  ClientHit,
  AgencyHit,
  StaffHit,
} from '@/app/api/dawson/search/route'

const MIN_QUERY = 3
const DEBOUNCE_MS = 250
const PER_GROUP = 6
const STRONG = 5

const EMPTY_RESPONSE: DawsonSearchResponse = { clients: [], agencies: [], staff: [] }

// ---- scoring ---------------------------------------------------------------

function tokenize(q: string): string[] {
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 5)
}

/** '1971-02-09' -> '2/9/1971' — the same shape the server's DOB SEARCH used. */
function dobMdy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''
}

function scoreClient(c: ClientHit, tokens: string[]): number {
  const full = `${c.firstName} ${c.lastName}`.toLowerCase()
  const last = c.lastName.toLowerCase()
  const phone = c.phone.replace(/\D/g, '')
  const mdy = dobMdy(c.dob)
  const mdyDigits = mdy.replace(/\D/g, '')
  let s = 0
  for (const t of tokens) {
    const td = t.replace(/\D/g, '')
    if (full.startsWith(t)) s += 5
    else if (last.startsWith(t)) s += 4
    else if (full.includes(t)) s += 3
    if (td.length >= 3 && phone) s += phone === td ? 6 : phone.includes(td) ? 3 : 0
    if (mdy && (mdy.includes(t) || (td.length >= 4 && mdyDigits.includes(td)))) s += 4
  }
  return s
}

function scoreAgency(a: AgencyHit, tokens: string[]): number {
  const name = a.name.toLowerCase()
  const office = a.officeName.toLowerCase()
  const city = a.city.toLowerCase()
  let s = a.domainMatch ? 1 : 0
  for (const t of tokens) {
    if (name.startsWith(t)) s += 5
    else if (name.includes(t)) s += 3
    if (office && office.includes(t)) s += 2
    if (city && city.includes(t)) s += 1
  }
  return s
}

function scoreStaff(st: StaffHit, tokens: string[]): number {
  const name = st.name.toLowerCase()
  const email = st.email.toLowerCase()
  const localPart = email.split('@')[0] ?? ''
  let s = 0
  for (const t of tokens) {
    if (name.startsWith(t)) s += 5
    else if (name.includes(t)) s += 3
    if (email) s += email === t ? 6 : localPart.includes(t) ? 3 : email.includes(t) ? 1 : 0
  }
  return s
}

type Row =
  | { kind: 'client'; score: number; c: ClientHit }
  | { kind: 'agency'; score: number; a: AgencyHit }
  | { kind: 'staff'; score: number; s: StaffHit }

function rank(data: DawsonSearchResponse, tokens: string[]): {
  clients: Row[]
  agencies: Row[]
  staff: Row[]
  flat: Row[]
} {
  // Score once, sort by score desc (alphabetical tiebreak), keep the top 6.
  const trim = (rows: Row[]) =>
    rows
      .sort((a, b) => b.score - a.score || labelOf(a).localeCompare(labelOf(b)))
      .slice(0, PER_GROUP)

  const clients = trim(data.clients.map((c): Row => ({ kind: 'client', score: scoreClient(c, tokens), c })))
  const agencies = trim(data.agencies.map((a): Row => ({ kind: 'agency', score: scoreAgency(a, tokens), a })))
  const staff = trim(data.staff.map((s): Row => ({ kind: 'staff', score: scoreStaff(s, tokens), s })))
  return { clients, agencies, staff, flat: [...clients, ...agencies, ...staff] }
}

const EMPTY_RANKED: ReturnType<typeof rank> = { clients: [], agencies: [], staff: [], flat: [] }

function labelOf(row: Row): string {
  if (row.kind === 'client') return `${row.c.lastName} ${row.c.firstName}`.toLowerCase()
  if (row.kind === 'agency') return row.a.name.toLowerCase()
  return (row.s.name || row.s.email).toLowerCase()
}

function hrefFor(row: Row): string {
  if (row.kind === 'client') {
    const ids = row.c.referralIds
    return ids.length
      ? `/dawson/referrals/${ids[ids.length - 1]}`
      : `/dawson/referrals?q=${encodeURIComponent(row.c.lastName || row.c.firstName)}`
  }
  if (row.kind === 'agency') return `/dawson/agencies/${row.a.id}`
  return `/dawson/staff/${row.s.id}`
}

// ---- component -----------------------------------------------------------

export default function DawsonUniversalSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // The last response, tagged with the query it answered. `data` below only
  // surfaces it while that tag still matches what's typed.
  const [fetched, setFetched] = useState<{ q: string; data: DawsonSearchResponse } | null>(null)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const q = query.trim()
  const tokens = useMemo(() => tokenize(query), [query])

  const data = fetched && fetched.q === q ? fetched.data : null
  const ranked = useMemo(() => (data ? rank(data, tokens) : EMPTY_RANKED), [data, tokens])
  const total = ranked.flat.length
  const loading = q.length >= MIN_QUERY && !data
  // A cursor left past the end by a previous, longer result set snaps back.
  const activeCursor = total ? Math.min(cursor, total - 1) : 0

  // Debounced fetch. Nothing is set synchronously in the effect body —
  // setFetched / setCursor fire only from the resolved callback, which keeps
  // this clear of the set-state-in-effect rule and means dropping below three
  // characters just leaves the last response in place, hidden (both `data` and
  // the dropdown gate on the current query).
  useEffect(() => {
    if (q.length < MIN_QUERY) return
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`/api/dawson/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : EMPTY_RESPONSE))
        .catch(() => EMPTY_RESPONSE)
        .then((d: DawsonSearchResponse) => {
          if (cancelled) return
          setFetched({ q, data: d })
          // Land the cursor on a lone strong hit anywhere in the flattened list
          // (so Enter takes it straight there), else the first row.
          const flat = rank(d, tokens).flat
          const strong = flat.filter(x => x.score >= STRONG)
          setCursor(strong.length === 1 ? flat.indexOf(strong[0]) : 0)
        })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, tokens])

  // Close on outside click — never clears the query.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = useCallback(
    (row: Row) => {
      setOpen(false)
      router.push(hrefFor(row))
    },
    [router],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close, keep what was typed.
      setOpen(false)
      return
    }
    if (!open || total === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      // Flattened, so the last client's next row is the first agency.
      setCursor(c => Math.min(c + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = ranked.flat[activeCursor] ?? ranked.flat[0]
      if (row) go(row)
    }
  }

  const showDropdown = open && q.length >= MIN_QUERY

  return (
    // 460px basis, no grow — the bar's flex spacer sits to the LEFT of this, so
    // the field ends up at the right end beside the avatar. Shrinks on a narrow
    // bar. The inner div is the dropdown's positioning context.
    <div style={{ flex: '0 1 460px', minWidth: 0, display: 'flex' }}>
      <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search clients, agencies, staff"
          aria-label="Search clients, agencies and staff"
          // Matches the portal's other search inputs (Referrals, Agencies):
          // white field, navy text, #EDE9E1 border.
          style={{
            width: '100%',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid #EDE9E1',
            background: 'white',
            color: '#2C3A4A',
            fontSize: '13px',
            outline: 'none',
          }}
        />

        {showDropdown && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid #EDE9E1',
              borderRadius: '9px',
              boxShadow: '0 10px 30px rgba(27,43,75,0.18)',
              maxHeight: '70vh',
              overflowY: 'auto',
              zIndex: 80,
            }}
          >
            {loading && total === 0 && (
              <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>Searching…</div>
            )}

            {!loading && total === 0 && (
              <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>
                No clients, agencies or staff match &ldquo;{q}&rdquo;.
              </div>
            )}

            {ranked.clients.length > 0 && (
              <Group label="Clients">
                {ranked.clients.map(row => {
                  const i = ranked.flat.indexOf(row)
                  return (
                    <ResultRow key={`c-${row.kind === 'client' ? row.c.id : ''}`} active={i === activeCursor} onPick={() => go(row)}>
                      <div style={rowTitle}>
                        {row.kind === 'client' && `${row.c.firstName} ${row.c.lastName}`.trim()}
                        {row.kind === 'client' && row.c.status.toUpperCase() === 'DNS' && (
                          /* Kept, unlike the WRONG AGENCY badge dropped from the
                             Add Referral picker. WRONG AGENCY meant "right person,
                             wrong office" — flagging it there invited skipping a
                             valid match. DNS means "do not book this person", and
                             search is exactly where Dawson wants that BEFORE he
                             opens the record. Different fact, different call. */
                          <span style={dnsBadge}>DO NOT SERVE</span>
                        )}
                      </div>
                      <div style={rowSub}>
                        {row.kind === 'client' && [
                          row.c.dob ? `DOB ${dobMdy(row.c.dob)}` : null,
                          row.c.phone || null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </ResultRow>
                  )
                })}
              </Group>
            )}

            {ranked.agencies.length > 0 && (
              <Group label="Agencies">
                {ranked.agencies.map(row => {
                  const i = ranked.flat.indexOf(row)
                  return (
                    <ResultRow key={`a-${row.kind === 'agency' ? row.a.id : ''}`} active={i === activeCursor} onPick={() => go(row)}>
                      <div style={rowTitle}>{row.kind === 'agency' && row.a.name}</div>
                      <div style={rowSub}>
                        {row.kind === 'agency' && [row.a.officeName || null, row.a.city || null].filter(Boolean).join(' · ')}
                      </div>
                    </ResultRow>
                  )
                })}
              </Group>
            )}

            {ranked.staff.length > 0 && (
              <Group label="Staff">
                {ranked.staff.map(row => {
                  const i = ranked.flat.indexOf(row)
                  return (
                    <ResultRow key={`s-${row.kind === 'staff' ? row.s.id : ''}`} active={i === activeCursor} onPick={() => go(row)}>
                      <div style={rowTitle}>{row.kind === 'staff' && (row.s.name || row.s.email)}</div>
                      <div style={rowSub}>
                        {row.kind === 'staff' && [
                          row.s.name && row.s.email ? row.s.email : null,
                          row.s.agencyName || 'No agency on file',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </ResultRow>
                  )
                })}
              </Group>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- presentational bits ------------------------------------------------

const rowTitle: React.CSSProperties = { fontSize: '13px', color: '#2C3A4A', fontWeight: 600 }
const rowSub: React.CSSProperties = { fontSize: '11.5px', color: '#7A8899', marginTop: '2px' }
const dnsBadge: React.CSSProperties = {
  marginLeft: '8px', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.05em',
  padding: '1px 6px', borderRadius: '10px', background: 'rgba(192,57,43,0.12)', color: '#C0392B',
  textTransform: 'uppercase',
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 1,
          padding: '7px 14px 5px', fontSize: '11px', fontWeight: 800,
          color: '#2A7F6F', textTransform: 'uppercase', letterSpacing: '0.08em',
          background: '#EAF4F2',
        }}
      >
        {label}
      </div>
      {children}
    </>
  )
}

function ResultRow({
  active, onPick, children,
}: {
  active: boolean
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <div
      onClick={onPick}
      onMouseDown={e => e.preventDefault()} // keep focus in the input
      style={{
        padding: '9px 14px', cursor: 'pointer',
        borderBottom: '1px solid #F7F5F1',
        background: active ? '#FAF8F4' : 'white',
      }}
    >
      {children}
    </div>
  )
}
