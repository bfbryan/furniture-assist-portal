'use client'

// app/dawson/needs-action/page.tsx
//
// "What needs me today." Five cards, each rendered only when it has rows; when
// all are empty Dawson is caught up and the page says so. Absorbs the old
// /dawson/referrals/review (Awaiting Review) and /dawson/agencies/pending —
// both retired and redirected here.
//
// Card structure mirrors the agency Active page's GroupCard: the accent is a
// 3px left bar on the card, the title sits INSIDE it, column headers beneath
// the title, rows below. No heading floating above the card, no per-card
// count (the nav badge carries the total).
//
// Left column: the cards, priority order. Right rail: the shared
// SaturdayCapacityGrid, mode="readonly" (never a place a misclick books), and
// non-dense so the numbers are legible — it's the reference for every
// decision. Two columns above 1440px viewport, stacked below (globals.css,
// .fa-needs-action-grid).
//
// The reschedule flow is carried over from the review page: "Accept" and
// "Pick another" both go through applyReschedule() → POST
// /api/dawson/referrals/[id]/reschedule, the one path that snapshots the
// original appointment, re-arms the reminder and emails the agency. The
// withheld-notice banner (the only on-screen signal that a reschedule
// succeeded without the agency being emailed) renders at the top of the left
// column and stays until the page is left.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addDaysISO, differenceInDaysISO, easternTodayISO, formatDateOnly } from '@/lib/dates'
import { isAwaitingOutcome } from '@/lib/referrals/no-show-window'
import { TIME_CAPS, VALID_TIMES, type TimeSlot } from '@/lib/schedule/capacity'
import SaturdayCapacityGrid from '@/components/internal/SaturdayCapacityGrid'
import PickSlotModal from '@/components/internal/modals/PickSlotModal'
import type { AvailableDate } from '@/components/internal/modals/RescheduleModal'

// ---------------------------------------------------------------- shapes

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  preferredDate: string | null
  preferredTime: string | null
  schedulingFlexibility: string | null
  rescheduleRequestedAt: string | null
  referredBy: string | null
  referringAgency: string | null
  phone: string | null
  city: string | null
  state: string | null
}

type Agency = {
  id: string
  name: string
  officeName: string | null
  ein: string | null
  website: string | null
  city: string | null
  state: string | null
  contactName: string
  email: string | null
  source: string | null
  registrationDate: string | null
  possibleDuplicate: boolean
}

// Mirror the agency GroupCard accent tokens exactly.
const ACCENT = {
  gold: { bar: '#C9A84C', heading: '#8B7724' },
  grey: { bar: '#9AA6B2', heading: '#7A8899' },
} as const
type AccentKind = keyof typeof ACCENT

const GREY = '#7A8899'
const NAVY = '#1B2B4B'

// client / details / actions. Both side columns are fixed; the middle takes
// all the slack. Col 1 is deliberately tight — a client name over an agency
// name, truncating past ~24 chars (the name is a link to the full record).
// Col 3 holds a secondary + primary button on ONE line — Pick another · Accept,
// or Cancel · Confirm accept when the two-step arms — right-aligned; row height
// is set by the info block, not the buttons. Widest line ≈ 203px (armed), so
// col 3 at 240 keeps ~37px of slack. The divider was moved left (rail 552 →
// 600) to unclamp the rail; col 3 dropping from 312 (it lost the Reject button)
// funds most of that and leaves col2 at ~247px — comfortably over the longest
// info line, "Requested: Flexible — no date given" (~215px).
const ROW_GRID = '200px minmax(0, 1fr) 240px'

const SECTION_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontSize: '13px', fontWeight: 800,
  letterSpacing: '0.10em', textTransform: 'uppercase',
}
const COL_HEADER: React.CSSProperties = {
  fontSize: '10px', fontWeight: 500, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#9AA6B2',
}

// ---------------------------------------------------------------- helpers

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return formatDateOnly(iso.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtSlot(date: string | null, time: string | null): string {
  if (!date) return '—'
  return time ? `${fmtDate(date)} · ${time}` : fmtDate(date)
}

function daysAgo(iso: string | null, todayISO: string): number | null {
  if (!iso) return null
  return differenceInDaysISO(iso.slice(0, 10), todayISO)
}
// "requested 6 days ago" / "requested today" / "requested, date unknown"
function agePhrase(days: number | null, verb: string): string {
  if (days === null) return `${verb}, date unknown`
  if (days <= 0) return `${verb} today`
  if (days === 1) return `${verb} yesterday`
  return `${verb} ${days} days ago`
}

function bookedForSlot(d: AvailableDate | undefined, slot: TimeSlot): number {
  if (!d) return 0
  switch (slot) {
    case '9am':  return d.slots9am  ?? 0
    case '10am': return d.slots10am ?? 0
    case '11am': return d.slots11am ?? 0
    case '12pm': return d.slots12pm ?? 0
    case '1pm':  return d.slots1pm  ?? 0
  }
}
// How full the exact hour the agency asked for already is — what the Accept
// decision turns on. Null when there's no requested time or the date isn't in
// the availability window.
function requestedSlotLoad(r: Referral, availableDates: AvailableDate[]) {
  if (!r.preferredDate || !r.preferredTime || !VALID_TIMES.has(r.preferredTime)) return null
  const day = availableDates.find((d) => d.date === r.preferredDate)
  if (!day) return null
  const slot = r.preferredTime as TimeSlot
  const booked = bookedForSlot(day, slot)
  const cap = TIME_CAPS[slot]
  return { booked, cap, full: booked >= cap }
}

// ---------------------------------------------------------------- card shell

function CardSection({
  title, accent, columns, children,
}: {
  title: string
  accent: AccentKind
  columns: [string, string, string]
  children: React.ReactNode
}) {
  const a = ACCENT[accent]
  return (
    <section style={{
      background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
      marginBottom: '20px', padding: '14px 18px 14px 15px', borderLeft: `3px solid ${a.bar}`,
    }}>
      <div style={{ marginBottom: '4px' }}>
        <span style={{ ...SECTION_TITLE, color: a.heading }}>{title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: '16px', padding: '6px 0' }}>
        {columns.map((c, i) => <div key={i} style={COL_HEADER}>{c}</div>)}
      </div>
      {children}
    </section>
  )
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: ROW_GRID, gap: '16px', alignItems: 'start',
      borderTop: '1px solid #F3F0EA', padding: '12px 0',
    }}>
      {children}
    </div>
  )
}

// Col 1 — name (link) + a muted sub-line, both truncating rather than wrapping.
function NameCell({ href, name, sub, extra }: {
  href: string; name: string; sub?: string | null; extra?: React.ReactNode
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <a
        href={href}
        style={{
          display: 'block', textDecoration: 'none', fontFamily: 'var(--font-montserrat)',
          fontWeight: 700, fontSize: '14px', color: '#2A7F6F',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {name}
      </a>
      {sub && (
        <div
          title={sub}
          style={{ fontSize: '12px', color: GREY, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {sub}
        </div>
      )}
      {extra}
    </div>
  )
}

const VAL: React.CSSProperties = {
  fontSize: '12px', lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const SUBLINE: React.CSSProperties = { fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const AGE: React.CSSProperties = { ...SUBLINE, fontStyle: 'italic', color: '#9AA6B2', marginTop: '2px' }

// Col 3 — one horizontal line, flush to the column's right edge: secondary
// action (Pick another / Cancel) on the left, primary (Accept / Confirm accept
// / Review) on the right. Every card now has one primary + at most one
// secondary, so the primary's right edge lands at the same x on every row —
// his eye doesn't move between rows. Buttons size to their label; ROW_GRID's
// col 3 is sized to the widest line.
function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '8px', alignItems: 'center', justifyContent: 'flex-end' }}>
      {children}
    </div>
  )
}
function ActionBtn({ label, tone, onClick, disabled, title }: {
  label: string
  tone: 'accept' | 'gold' | 'red' | 'cancel'
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  const c =
    disabled ? { bg: '#EDEBE7', fg: '#B8C1CC' }
    : tone === 'accept' ? { bg: '#2A7F6F', fg: 'white' }
    : tone === 'red' ? { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B' }
    : tone === 'cancel' ? { bg: '#F0F0F0', fg: '#7A8899' }
    : { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' }
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{
        flexShrink: 0,
        padding: '8px 12px', borderRadius: '7px', border: 'none',
        background: c.bg, color: c.fg, fontFamily: 'var(--font-montserrat)', fontWeight: 700,
        fontSize: '12px', whiteSpace: 'nowrap', cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------- rows

function RescheduleRow({ r, availableDates, todayISO, onAccept, onPick }: {
  r: Referral
  availableDates: AvailableDate[]
  todayISO: string
  onAccept: (r: Referral) => Promise<{ ok: false; message: string } | { ok: true }>
  onPick: (r: Referral) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline two-step confirm — Accept is heavy here (it reschedules, regenerates
  // the slip and emails the agency; undoing means another reschedule + email).
  // Same pattern as the agency detail page's Invite button: first click arms,
  // second fires, a Cancel sits alongside. Pick another needs no confirm — its
  // modal IS the confirm.
  const [armed, setArmed] = useState(false)
  const load = requestedSlotLoad(r, availableDates)
  const canAccept = !!r.preferredDate

  async function acceptClick() {
    if (!armed) { setArmed(true); setError(null); return }
    setLoading(true)
    setError(null)
    const res = await onAccept(r)
    if (!res.ok) { setError(res.message); setArmed(false) }
    setLoading(false)
  }

  return (
    <div>
      <RowShell>
        <NameCell href={`/dawson/referrals/${r.id}`} name={r.clientName} sub={r.referringAgency} />

        <div style={{ minWidth: 0 }}>
          <div style={{ ...VAL, color: NAVY }}>
            Currently: {fmtSlot(r.appointmentDate, r.appointmentTime)}
          </div>
          <div style={{ ...VAL, color: '#8B7724', fontWeight: 600, fontStyle: canAccept ? 'normal' : 'italic' }}>
            {canAccept ? `Requested: ${fmtSlot(r.preferredDate, r.preferredTime)}` : 'Requested: Flexible — no date given'}
          </div>
          {load && (
            <div style={{ ...SUBLINE, color: load.full ? '#C0392B' : GREY, fontWeight: load.full ? 700 : 400 }}>
              {load.booked} / {load.cap} booked{load.full ? ' · full' : ''}
            </div>
          )}
          {/* Age line only when the request was timestamped. Pre-field rows
              (Reschedule Requested At empty) drop it rather than show a caveat
              next to a visible requested date — the date is what he acts on. */}
          {r.rescheduleRequestedAt && (
            <div style={AGE}>{agePhrase(daysAgo(r.rescheduleRequestedAt, todayISO), 'requested')}</div>
          )}
        </div>

        <Actions>
          {armed ? (
            <ActionBtn label="Cancel" tone="cancel" onClick={() => setArmed(false)} disabled={loading} />
          ) : (
            <ActionBtn label="Pick another" tone="gold" onClick={() => onPick(r)} disabled={loading} />
          )}
          <ActionBtn
            label={loading ? '…' : armed ? 'Confirm accept' : 'Accept'}
            tone="accept"
            onClick={acceptClick}
            disabled={loading || !canAccept}
            title={canAccept ? 'Schedule the date and time the agency asked for' : 'The agency did not name a date'}
          />
        </Actions>
      </RowShell>
      {armed && !error && (
        <div style={{ fontSize: '11px', color: GREY, padding: '0 0 8px', lineHeight: 1.5 }}>
          → {fmtSlot(r.preferredDate, r.preferredTime)} · {r.referringAgency ?? 'the agency'} will be emailed.
        </div>
      )}
      {error && (
        <div style={{ fontSize: '11px', color: '#C0392B', padding: '0 0 8px' }}>{error}</div>
      )}
    </div>
  )
}

// New referrals = agency-submitted, Referral Review 'Pending'. The only actions
// here are Accept (approve + book) and Pick another (approve + book a chosen
// slot) — both benign. There is NO Reject: rejecting a legitimate referral is
// rare and consequential, so it goes through the detail page, same reasoning
// as approving an agency.
//
// FUTURE (recorded, not built): a separate card may filter new referrals into a
// review queue by rules — referring agency, whether the client was seen in the
// last six months, and similar. Those referrals are likelier to be rejected, so
// a Reject action may return on THAT card. It does not belong on this one.
function NewReferralRow({ r, availableDates, todayISO, onApprove, onPick }: {
  r: Referral
  availableDates: AvailableDate[]
  todayISO: string
  onApprove: (r: Referral) => Promise<{ ok: false; message: string } | { ok: true }>
  onPick: (r: Referral) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline two-step, same as the reschedule card — Accept books an appointment
  // and (via the Wednesday cron) emails the agency; it isn't a status-only write.
  const [armed, setArmed] = useState(false)
  const load = requestedSlotLoad(r, availableDates)
  const hasDate = !!r.preferredDate
  const isFlexible = r.schedulingFlexibility === 'Flexible' || !r.preferredDate

  // Accept = approve AND book, via the page's approveReferral() → POST
  // /approve. "Pick another" is the same call with a slot chosen in the modal
  // instead of the requested one; it skips this arm step because its modal is
  // the confirm.
  async function approveClick() {
    if (!armed) { setArmed(true); setError(null); return }
    setLoading(true)
    setError(null)
    const res = await onApprove(r)
    if (!res.ok) { setError(res.message); setArmed(false) }
    setLoading(false)
  }

  return (
    <div>
      <RowShell>
        <NameCell href={`/dawson/referrals/${r.id}`} name={r.clientName} sub={r.referringAgency} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...VAL, color: '#8B7724', fontWeight: 600, fontStyle: hasDate ? 'normal' : 'italic' }}>
            {hasDate ? `Requested: ${fmtSlot(r.preferredDate, r.preferredTime)}` : 'Requested: Flexible — no date given'}
          </div>
          {load && (
            <div style={{ ...SUBLINE, color: load.full ? '#C0392B' : GREY, fontWeight: load.full ? 700 : 400 }}>
              {load.booked} / {load.cap} booked{load.full ? ' · full' : ''}
            </div>
          )}
          <div style={AGE}>{agePhrase(daysAgo(r.referralDate, todayISO), 'submitted')}</div>
        </div>
        {/* One line, right-aligned: Pick another · Accept (Cancel · Confirm
            accept when the two-step arms). Same shape and x-position as the
            reschedule row above it; row height doesn't change when it arms. */}
        <Actions>
          {armed ? (
            <ActionBtn label="Cancel" tone="cancel" onClick={() => setArmed(false)} disabled={loading} />
          ) : (
            <ActionBtn label="Pick another" tone="gold" onClick={() => onPick(r)} disabled={loading} />
          )}
          <ActionBtn
            label={loading ? '…' : armed ? 'Confirm accept' : 'Accept'}
            tone="accept"
            onClick={approveClick}
            disabled={loading}
          />
        </Actions>
      </RowShell>
      {armed && !error && (
        <div style={{ fontSize: '11px', color: GREY, padding: '0 0 8px', lineHeight: 1.5 }}>
          → {isFlexible ? 'next available Saturday' : fmtSlot(r.preferredDate, r.preferredTime)}
          {' · '}{r.referringAgency ?? 'the agency'} will be emailed the confirmation.
        </div>
      )}
      {error && (
        <div style={{ fontSize: '11px', color: '#C0392B', padding: '0 0 8px' }}>{error}</div>
      )}
    </div>
  )
}

function AwaitingOutcomeRow({ r, todayISO }: { r: Referral; todayISO: string }) {
  return (
    <RowShell>
      <NameCell href={`/dawson/referrals/${r.id}`} name={r.clientName} sub={r.referringAgency} />
      <div style={{ minWidth: 0 }}>
        <div style={{ ...VAL, color: NAVY }}>Appointment: {fmtSlot(r.appointmentDate, r.appointmentTime)}</div>
        <div style={AGE}>{agePhrase(daysAgo(r.appointmentDate, todayISO), 'Saturday was')}</div>
      </div>
      <div style={{ fontSize: '11px', color: GREY, fontStyle: 'italic', lineHeight: 1.4 }}>
        Run the OCR scan to record the outcome
      </div>
    </RowShell>
  )
}

// Approving an agency is the one decision on this page that needs research —
// verifying a real organization is asking — not a glance. So this card
// triages and routes: a single "Review" button to the agency
// detail page, where the approve/reject decision is made.
//
// DEPENDENCY (recorded, not actioned here): the agency [id] detail page needs
// to properly support the approve decision now that this card is its entry
// point. Ben is reviewing all three detail pages in a separate branch; the
// agency one picks up this requirement there. Do not add approve/reject back
// onto this card.
function AgencyRow({ a, todayISO }: { a: Agency; todayISO: string }) {
  const router = useRouter()
  const href = `/dawson/agencies/${a.id}?from=needs-action`

  // Stored with or without a scheme; normalise for the href, strip it for display.
  const webHref = a.website
    ? (/^https?:\/\//i.test(a.website) ? a.website : `https://${a.website}`)
    : null
  const webLabel = a.website ? a.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : null

  const contactLine = [a.contactName || null, a.email].filter(Boolean).join(' · ')
  const locality = a.city && a.state ? `${a.city}, ${a.state}` : null

  return (
    <RowShell>
      <NameCell
        href={href}
        name={a.name}
        sub={a.officeName}
        extra={a.possibleDuplicate && (
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#C0392B', marginTop: '3px' }}>⚠ Possible duplicate</div>
        )}
      />

      <div style={{ minWidth: 0 }}>
        {contactLine && (
          <div style={{ ...VAL, color: NAVY }} title={contactLine}>{contactLine}</div>
        )}

        {webHref ? (
          <div style={VAL}>
            <a href={webHref} target="_blank" rel="noreferrer" style={{ color: '#2A7F6F', textDecoration: 'none' }}>
              {webLabel}
            </a>
          </div>
        ) : (
          <div style={{ ...SUBLINE, color: GREY, fontStyle: 'italic' }}>No website on file</div>
        )}

        {a.ein ? (
          <div style={{ ...VAL, color: NAVY }}>EIN {a.ein}</div>
        ) : (
          <div style={{ ...SUBLINE, color: GREY, fontStyle: 'italic' }}>No EIN on file</div>
        )}

        {locality && <div style={{ ...SUBLINE, color: GREY }}>{locality}</div>}

        <div style={AGE}>
          {[a.source, agePhrase(daysAgo(a.registrationDate, todayISO), 'applied')].filter(Boolean).join(' · ')}
        </div>
      </div>

      <Actions>
        <ActionBtn label="Review" tone="accept" onClick={() => router.push(href)} />
      </Actions>
    </RowShell>
  )
}

// Card 5 shell. Cross-agency referral de-dup (same client name + DOB + address
// submitted by two agencies) is not built; when it is, this fills from that
// check. Query returns [] so the card is hidden today.
type FlaggedDuplicate = { id: string; clientName: string; agencies: string[] }
function FlaggedDuplicateRow({ d }: { d: FlaggedDuplicate }) {
  return (
    <RowShell>
      <NameCell href={`/dawson/referrals/${d.id}`} name={d.clientName} />
      <div style={{ ...VAL, color: NAVY }}>{d.agencies.join(' · ')}</div>
      <div style={{ fontSize: '11px', color: GREY, fontStyle: 'italic' }}>Compare and merge</div>
    </RowShell>
  )
}
function getFlaggedDuplicates(): FlaggedDuplicate[] {
  return []
}

// ---------------------------------------------------------------- empty state

function CaughtUp() {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(42,127,111,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: NAVY, marginBottom: '6px' }}>
        You&rsquo;re all caught up
      </div>
      <div style={{ fontSize: '13px', color: GREY, lineHeight: 1.6, maxWidth: '360px', margin: '0 auto' }}>
        Nothing needs a decision right now. New referrals, reschedule requests
        and agency applications land here.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function NeedsActionPage() {
  const todayISO = easternTodayISO()
  const yesterdayISO = addDaysISO(todayISO, -1)

  const [reschedules, setReschedules] = useState<Referral[]>([])
  const [newReferrals, setNewReferrals] = useState<Referral[]>([])
  const [awaiting, setAwaiting] = useState<Referral[]>([])
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [loading, setLoading] = useState(true)

  // `kind` routes the confirm: 'reschedule' → applyReschedule (agency email +
  // snapshot); 'approve' → approveReferral with the picked slot as an override.
  const [pickModal, setPickModal] = useState<{ open: boolean; id: string; name: string; kind: 'reschedule' | 'approve' }>(
    { open: false, id: '', name: '', kind: 'reschedule' },
  )
  const [pickLoading, setPickLoading] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  // Bumped after any action that books an appointment (Accept, Pick another)
  // and on window focus/visible, so the read-only capacity
  // rail — what the NEXT decision is judged against — never goes stale. The
  // grid swaps its data in place, so no remount and no loading flash.
  const [gridRefresh, setGridRefresh] = useState(0)
  const bumpGrid = useCallback(() => setGridRefresh((n) => n + 1), [])

  // Reschedules that went through but whose agency email was withheld by the
  // confirmation guard. Page-level, not auto-dismissed — the row is gone by
  // the time this shows, so it's the only thing left saying the agency was
  // not emailed. Also on the record's Email Log. Carried over from the review
  // page verbatim.
  const [withheldNotices, setWithheldNotices] = useState<string[]>([])

  // The four card queries + the slot-hint availability, one call. Sets state in
  // place — never flips `loading` back to true — so a focus refetch updates the
  // cards without blanking them.
  const loadCards = useCallback(() => {
    Promise.all([
      fetch('/api/dawson/referrals?status=Reschedule', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch('/api/dawson/referrals?review=Pending', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch(`/api/dawson/referrals?status=Scheduled&appointmentDateTo=${yesterdayISO}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch('/api/dawson/agencies?status=Pending', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
    ])
      .then(([resch, pending, scheduledPast, pendingAgencies]) => {
        setReschedules(Array.isArray(resch) ? resch : [])
        setNewReferrals(
          (Array.isArray(pending) ? pending : []).filter((r: Referral) => r.appointmentStatus !== 'Reschedule'),
        )
        setAwaiting(
          (Array.isArray(scheduledPast) ? scheduledPast : []).filter((r: Referral) =>
            isAwaitingOutcome(r.appointmentStatus, r.appointmentDate, todayISO),
          ),
        )
        setAgencies(Array.isArray(pendingAgencies) ? pendingAgencies : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))

    fetch('/api/dawson/schedule/available?weeks=8&leadDays=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setAvailableDates(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [todayISO, yesterdayISO])

  useEffect(() => { loadCards() }, [loadCards])

  // Focus / tab-visible: the OCR reconciliation pass and the detail-page round
  // trip both leave this list behind. Refetch the cards and the rail when he
  // comes back.
  useEffect(() => {
    const onActive = () => {
      if (document.visibilityState === 'visible') { loadCards(); bumpGrid() }
    }
    window.addEventListener('focus', onActive)
    document.addEventListener('visibilitychange', onActive)
    return () => {
      window.removeEventListener('focus', onActive)
      document.removeEventListener('visibilitychange', onActive)
    }
  }, [loadCards, bumpGrid])

  // THE reschedule call — "Accept" and "Pick another" both land here.
  async function applyReschedule(
    id: string,
    name: string,
    preferredDate: string,
    appointmentTime: string | null,
  ): Promise<{ ok: false; message: string } | { ok: true }> {
    try {
      const res = await fetch(`/api/dawson/referrals/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, appointmentTime }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, message: body.error || `Reschedule failed (${res.status})` }
      }
      const body = await res.json().catch(() => ({}))
      const notice = body?.rescheduleNotice
      if (notice && notice.skipped && notice.message) {
        setWithheldNotices((prev) => [...prev, `${name}: ${notice.message}`])
      }
      setReschedules((prev) => prev.filter((r) => r.id !== id))
      bumpGrid() // this Saturday's counts just changed
      return { ok: true }
    } catch {
      return { ok: false, message: 'Network error — please try again.' }
    }
  }

  const acceptDate = (r: Referral) =>
    applyReschedule(r.id, r.clientName, r.preferredDate as string, r.preferredTime)

  // Approve AND book, in one write — the funnel for the New referrals card's
  // Approve and "Pick another". POST /approve → rescheduleReferral with
  // review:'Approved'. `flexible` (or a null date) routes to
  // findNextFlexibleSlot; an explicit date/time books that slot, overriding
  // what the referral asked for — that's how "Pick another" reslots with no
  // route change. Drops the row and refreshes the rail on success.
  async function approveReferral(
    id: string,
    body: { preferredDate?: string | null; preferredTime?: string | null; flexible: boolean },
  ): Promise<{ ok: false; message: string } | { ok: true }> {
    try {
      const res = await fetch(`/api/dawson/referrals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        return { ok: false, message: b.error || `Approve failed (${res.status})` }
      }
      setNewReferrals((prev) => prev.filter((x) => x.id !== id))
      bumpGrid() // the picked/requested Saturday's counts just changed
      return { ok: true }
    } catch {
      return { ok: false, message: 'Network error — please try again.' }
    }
  }

  // Inline "Approve" — book the slot the agency requested, or the next flexible
  // Saturday when they gave no date.
  const approveRequested = (r: Referral) =>
    approveReferral(r.id, {
      preferredDate: r.preferredDate,
      preferredTime: r.preferredTime,
      flexible: r.schedulingFlexibility === 'Flexible' || !r.preferredDate,
    })

  // Confirm from PickSlotModal — routed by which card opened it.
  async function handlePickConfirm(date: string, time: string) {
    setPickLoading(true)
    setPickError(null)
    const res =
      pickModal.kind === 'approve'
        ? await approveReferral(pickModal.id, { preferredDate: date, preferredTime: time, flexible: false })
        : await applyReschedule(pickModal.id, pickModal.name, date, time)
    setPickLoading(false)
    if (!res.ok) { setPickError(res.message); return }
    setPickModal({ open: false, id: '', name: '', kind: 'reschedule' })
  }

  // Oldest first in every card — the most-aged item rises to the top, because
  // a sitting request holds two Saturdays' capacity at once.
  const sorted = useMemo(() => {
    const byAge = <T,>(list: T[], key: (t: T) => string | null) =>
      [...list].sort((a, b) => (key(a) ?? '9999').localeCompare(key(b) ?? '9999'))
    return {
      reschedules: byAge(reschedules, (r) => r.rescheduleRequestedAt),
      newReferrals: byAge(newReferrals, (r) => r.referralDate),
      awaiting: byAge(awaiting, (r) => r.appointmentDate),
      agencies: byAge(agencies, (a) => a.registrationDate),
    }
  }, [reschedules, newReferrals, awaiting, agencies])

  const flagged = getFlaggedDuplicates()
  const total =
    sorted.reschedules.length + sorted.newReferrals.length +
    sorted.awaiting.length + sorted.agencies.length + flagged.length

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <PickSlotModal
        key={pickModal.id || 'none'}
        open={pickModal.open}
        name={pickModal.name}
        referralId={pickModal.id}
        loading={pickLoading}
        error={pickError}
        intent={pickModal.kind}
        onConfirm={handlePickConfirm}
        onClose={() => { setPickModal({ open: false, id: '', name: '', kind: 'reschedule' }); setPickError(null) }}
      />

      <div style={{ padding: '36px 32px', maxWidth: '1440px', margin: '0 auto' }}>
        <div className="fa-needs-action-grid">
          {/* LEFT — the cards */}
          <div style={{ minWidth: 0 }}>
            {withheldNotices.map((n, i) => (
              <div key={i} style={{
                background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.35)',
                borderRadius: '8px', padding: '10px 14px', marginBottom: '10px',
                fontSize: '12.5px', color: '#7A6A28', lineHeight: 1.6,
              }}>
                {n}
              </div>
            ))}

            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px', color: GREY }}>Loading…</div>
            ) : total === 0 ? (
              <CaughtUp />
            ) : (
              <>
                {sorted.reschedules.length > 0 && (
                  <CardSection title="Reschedule requested" accent="gold" columns={['Client', 'Currently / Requested', '']}>
                    {sorted.reschedules.map((r) => (
                      <RescheduleRow
                        key={r.id}
                        r={r}
                        availableDates={availableDates}
                        todayISO={todayISO}
                        onAccept={acceptDate}
                        onPick={(ref) => { setPickError(null); setPickModal({ open: true, id: ref.id, name: ref.clientName, kind: 'reschedule' }) }}
                      />
                    ))}
                  </CardSection>
                )}

                {sorted.newReferrals.length > 0 && (
                  <CardSection title="New referrals" accent="gold" columns={['Client', 'Requested', '']}>
                    {sorted.newReferrals.map((r) => (
                      <NewReferralRow
                        key={r.id}
                        r={r}
                        availableDates={availableDates}
                        todayISO={todayISO}
                        onApprove={approveRequested}
                        onPick={(ref) => { setPickError(null); setPickModal({ open: true, id: ref.id, name: ref.clientName, kind: 'approve' }) }}
                      />
                    ))}
                  </CardSection>
                )}

                {sorted.awaiting.length > 0 && (
                  <CardSection title="Awaiting outcome" accent="grey" columns={['Client', 'Appointment', '']}>
                    {sorted.awaiting.map((r) => (
                      <AwaitingOutcomeRow key={r.id} r={r} todayISO={todayISO} />
                    ))}
                  </CardSection>
                )}

                {sorted.agencies.length > 0 && (
                  <CardSection title="Agencies to review" accent="gold" columns={['Agency', 'Application', '']}>
                    {sorted.agencies.map((a) => (
                      <AgencyRow key={a.id} a={a} todayISO={todayISO} />
                    ))}
                  </CardSection>
                )}

                {flagged.length > 0 && (
                  <CardSection title="Flagged duplicates" accent="gold" columns={['Client', 'Submitted by', '']}>
                    {flagged.map((d) => <FlaggedDuplicateRow key={d.id} d={d} />)}
                  </CardSection>
                )}
              </>
            )}
          </div>

          {/* RIGHT — capacity rail. Read-only: a rail that also acts is
              ambiguous, and a misclick there books an appointment. */}
          <div style={{
            background: 'white', borderRadius: '12px', border: '1px solid #EDE9E1',
            padding: '16px', maxWidth: '600px',
          }}>
            <div style={{
              fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px',
              letterSpacing: '0.06em', textTransform: 'uppercase', color: GREY, marginBottom: '10px',
            }}>
              Next 4 Saturdays
            </div>
            <SaturdayCapacityGrid mode="readonly" weeks={4} refreshToken={gridRefresh} />
          </div>
        </div>
      </div>
    </div>
  )
}
