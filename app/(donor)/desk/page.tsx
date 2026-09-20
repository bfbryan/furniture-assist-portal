'use client'

// app/(donor)/desk/page.tsx — the URL is /desk, not /donor/desk; (donor)
// is a route group and doesn't appear in the path. Auth lives in
// app/(donor)/layout.tsx, shared with checkin/, not here.
//
// The Chromebook: today's live check-in list (polled — the volume, a few
// dozen a week, doesn't justify anything heavier) plus a search box for a
// donor who arrives without a usable QR code.
//
// Search is two-tier (see lib/donors/in-kind-donations.ts): scoped to
// Pending + Automatic first (~108 records, so a name search returns one or
// two results), falling back to an unscoped search only when that comes up
// empty, specifically so an already-checked-in donor reads as "already
// received at 11:42" rather than a bare "no results" — which would read as
// "not in the system," the wrong and alarming message.
//
// Result rows are deliberately narrow: name, the scheduled Form Date, and
// the last 4 digits of the phone on file — enough to tell two same-surname
// donors apart. No street address, no full phone, no email, here or after
// a result is selected. This screen sits on a desk in a warehouse and is
// reachable by any volunteer — more exposure than the phone kiosk, which
// only ever shows the one donor just scanned.
//
// Checking someone in from a search result reuses the exact same write
// path the phone's confirm tap uses (POST /api/donor-checkin with the
// record id) — one write path for the whole feature, not a second one
// for this surface. The desk has no separate "lookup" step because the
// search result the volunteer is looking at already IS the confirmation
// — there's no scan-then-wait in between, so there's nothing here for a
// lookup call to buy.

import { useCallback, useEffect, useRef, useState } from 'react'
import BrandMark from '@/components/donor/BrandMark'
import SessionPill from '@/components/donor/SessionPill'

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const GOLD = '#8B7724'
const GREY = '#7A8899'
const CREAM = '#F7F5F1'

type SearchResult = {
  id: string
  firstName: string
  lastName: string
  status: string | null
  formDate: string | null
  lastUpdated: string | null
  phoneLast4: string | null
}

type TodayEntry = {
  id: string
  firstName: string
  lastName: string
  checkedInAt: string | null
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

function formatFormDate(iso: string | null): string {
  if (!iso) return ''
  // Date-only field — anchor at UTC midnight and format in UTC so the
  // printed day matches the stored day regardless of where this runs.
  // Same reasoning as lib/dates.ts's formatDateOnly, not imported here
  // since that helper lives in the referral-base side of this codebase's
  // date handling and this is a small, self-contained read.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function DonorCheckinDeskPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [checkingInId, setCheckingInId] = useState<string | null>(null)
  const [today, setToday] = useState<TodayEntry[]>([])
  const debounceRef = useRef<number | undefined>(undefined)

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/donor-checkin/search?q=${encodeURIComponent(q)}`)
      const body = await res.json().catch(() => ({ results: [] }))
      setResults(body.results ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  function onQueryChange(v: string) {
    setQuery(v)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void runSearch(v), 250)
  }

  async function checkIn(id: string) {
    setCheckingInId(id)
    try {
      const res = await fetch('/api/donor-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        // Re-run the same search so this row's state (now Received, with
        // a fresh Last Updated) reflects the write, rather than trusting
        // a locally-guessed status.
        await runSearch(query)
        void body // response already folded into the refreshed search
      }
    } finally {
      setCheckingInId(null)
    }
  }

  // Poll today's list. 15s — a few dozen a week means this is a light
  // request, and nothing here needs sub-15-second freshness.
  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/donor-checkin/today')
        const body = await res.json().catch(() => ({ entries: [] }))
        if (!stop) setToday(body.entries ?? [])
      } catch {
        // A missed poll just means the list is stale until the next one —
        // no error state needed for a background refresh.
      }
    }
    void poll()
    const id = window.setInterval(poll, 15_000)
    return () => { stop = true; window.clearInterval(id) }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: CREAM, fontFamily: 'var(--font-montserrat), Arial, sans-serif', boxSizing: 'border-box' }}>
      {/* Same navy header treatment as the phone kiosk (logo + wordmark,
          same DawsonPageBar-matching band/rule), but the desk has the
          room the phone doesn't: a page label and the session pill sit
          in the band itself rather than needing a separate footer strip.
          Still nothing tappable here — same kiosk rule as the phone, any
          volunteer operates this too, no per-person login to log out of. */}
      <div style={{
        minHeight: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: NAVY, borderBottom: '4px solid #2A7F6F', padding: '0 32px',
      }}>
        <BrandMark />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
            Donor Check-In — Desk
          </span>
          <SessionPill />
        </div>
      </div>

      <div style={{ padding: '32px', boxSizing: 'border-box' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* Search */}
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Check in a donor</h1>
          <input
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Last name"
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: '18px',
              borderRadius: '8px', border: '1px solid #EDE9E1', outline: 'none',
            }}
          />

          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {searching && <div style={{ color: GREY, fontSize: '14px' }}>Searching…</div>}

            {results && results.length === 0 && !searching && (
              <div style={{ color: GREY, fontSize: '15px', fontStyle: 'italic' }}>No match for “{query}.”</div>
            )}

            {results?.map(r => {
              const name = `${r.firstName} ${r.lastName}`.trim()
              const already = r.status === 'Received'
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'white', borderRadius: '10px', padding: '14px 18px',
                  boxShadow: '0 1px 3px rgba(27,43,75,0.08)',
                }}>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: 700, color: NAVY }}>{name || '(no name on file)'}</div>
                    <div style={{ fontSize: '13px', color: GREY, marginTop: '2px' }}>
                      {[formatFormDate(r.formDate) ? `Scheduled ${formatFormDate(r.formDate)}` : null, r.phoneLast4 ? `…${r.phoneLast4}` : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {already ? (
                    <div style={{ fontSize: '14px', fontWeight: 700, color: GOLD, textAlign: 'right' }}>
                      Already checked in{r.lastUpdated ? ` at ${formatTime(r.lastUpdated)}` : ''}
                    </div>
                  ) : (
                    <button
                      onClick={() => checkIn(r.id)}
                      disabled={checkingInId === r.id}
                      style={{
                        padding: '10px 20px', borderRadius: '8px', border: 'none', background: TEAL,
                        color: 'white', fontFamily: 'inherit', fontWeight: 700, fontSize: '14px',
                        cursor: checkingInId === r.id ? 'default' : 'pointer',
                        opacity: checkingInId === r.id ? 0.6 : 1,
                      }}
                    >
                      {checkingInId === r.id ? 'Checking in…' : 'Check In'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Live list */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>
            Checked in today <span style={{ color: GREY, fontWeight: 600 }}>({today.length})</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '70vh', overflowY: 'auto' }}>
            {today.length === 0 && (
              <div style={{ color: GREY, fontSize: '14px', fontStyle: 'italic' }}>Nothing checked in yet today.</div>
            )}
            {today.map(e => (
              <div key={e.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'white', borderRadius: '8px', padding: '10px 14px', fontSize: '15px',
              }}>
                <span style={{ color: NAVY, fontWeight: 600 }}>{`${e.firstName} ${e.lastName}`.trim()}</span>
                <span style={{ color: GREY, fontSize: '13px' }}>{formatTime(e.checkedInAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
