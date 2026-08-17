'use client'

// app/dawson/referrals/review/page.tsx
//
// Dawson's queue. Everything with Referral Review = 'Pending' lands here, and
// as of Aug 2026 that is two different asks wearing the same status:
//
//   RESCHEDULE REQUESTS  Appointment Status = 'Reschedule'. An agency has an
//     appointment already and wants it moved. Approve/Reject is the wrong pair
//     of buttons for these — the decision is "the date they asked for" or "a
//     different one".
//
//   NEW REFERRAL REQUESTS  everything else. Unchanged: Approve or Reject.
//
// Both routes out of a reschedule request go through the SAME shared function,
// POST /api/dawson/referrals/[id]/reschedule → rescheduleReferral(), which is
// the one place that snapshots the original appointment, re-arms the Monday
// reminder and emails the agency with a regenerated slip. Accepting differs
// from overriding only in which date and time get posted. There is no second
// reschedule implementation here and there must not be.
//
// After a successful reschedule the review is set back to 'Approved' so the
// record leaves this queue — 'Pending' is what put it here in the first place.

import { useState, useEffect } from 'react'
import RescheduleModal, { type AvailableDate, type TimeSlot } from '@/components/internal/modals/RescheduleModal'
import { TIME_CAPS, VALID_TIMES, type TimeSlot as Slot } from '@/lib/schedule/capacity'
import { matchesSearch } from '@/lib/search'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  referralReview: string
  appointmentStatus: string
  appointmentDate: string | null
  appointmentTime: string | null
  preferredDate: string | null
  preferredTime: string | null
  schedulingFlexibility: string | null
  referredBy: string | null
  referringAgency: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

// Blue, the same token STATUS_COLORS uses for in-progress scheduling states.
// The gold accent stays with the new-referral cards it has always been on.
const RESCHEDULE_ACCENT = '#5B8DB8'
const NEW_REFERRAL_ACCENT = '#C9A84C'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "Sep 6, 2026 · 10am", or just the date when no time is set.
function formatSlot(date: string | null, time: string | null) {
  if (!date) return '—'
  return time ? `${formatDate(date)} · ${time}` : formatDate(date)
}

function bookedForSlot(d: AvailableDate | undefined, slot: Slot): number {
  if (!d) return 0
  switch (slot) {
    case '9am':  return d.slots9am  ?? 0
    case '10am': return d.slots10am ?? 0
    case '11am': return d.slots11am ?? 0
    case '12pm': return d.slots12pm ?? 0
    case '1pm':  return d.slots1pm  ?? 0
  }
}

/**
 * How full the hour the agency asked for already is.
 *
 * Accepting a request posts an explicit time, and rescheduleReferral treats an
 * explicit time as an override — per-hour caps are deliberately NOT enforced
 * for it, because that is Dawson's call to make. This is what stops it being a
 * blind one: the agency's picker only checks the day's 50, never the hour, so a
 * request can land on an hour that is already full.
 *
 * Null when there is no requested time (nothing to warn about — the allocator
 * picks an open slot) or when the date is not in the availability window.
 */
function requestedSlotLoad(referral: Referral, availableDates: AvailableDate[]) {
  const { preferredDate, preferredTime } = referral
  if (!preferredDate || !preferredTime || !VALID_TIMES.has(preferredTime)) return null
  const day = availableDates.find(d => d.date === preferredDate)
  if (!day) return null
  const slot = preferredTime as Slot
  const booked = bookedForSlot(day, slot)
  const cap = TIME_CAPS[slot]
  return { booked, cap, full: booked >= cap }
}

function ConfirmModal({ clientName, action, onConfirm, onCancel, loading }: {
  clientName: string; action: 'Approved' | 'Rejected'; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(27,43,75,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '32px', width: '380px', boxShadow: '0 8px 40px rgba(27,43,75,0.18)' }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B', marginBottom: '8px' }}>
          {action === 'Approved' ? 'Approve Referral' : 'Reject Referral'}
        </div>
        <div style={{ fontSize: '13px', color: '#7A8899', marginBottom: '24px' }}>
          Are you sure you want to <strong>{action === 'Approved' ? 'approve' : 'reject'}</strong> the referral for <strong>{clientName}</strong>?
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#7A8899', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: action === 'Approved' ? '#2A7F6F' : '#C0392B', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            {loading ? '...' : action === 'Approved' ? 'Yes, Approve' : 'Yes, Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CardError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div style={{ fontSize: '11px', color: '#C0392B', padding: '8px 20px 12px', lineHeight: 1.5 }}>
      {message}
    </div>
  )
}

// ---------------------------------------------------------------- new referral

function ReferralCard({ referral, onAction }: { referral: Referral; onAction: (id: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<'Approved' | 'Rejected' | null>(null)

  async function handleConfirm() {
    if (!modal) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dawson/referrals/${referral.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: modal }),
      })
      if (res.ok) { onAction(referral.id); setModal(null) }
    } finally { setLoading(false) }
  }

  return (
    <>
      {modal && (
        <ConfirmModal
          clientName={referral.clientName}
          action={modal}
          onConfirm={handleConfirm}
          onCancel={() => setModal(null)}
          loading={loading}
        />
      )}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: NEW_REFERRAL_ACCENT, flexShrink: 0 }} />

        {/* Client info */}
        <div style={{ width: '220px', flexShrink: 0, padding: '14px 20px' }}>
          <a href={`/dawson/referrals/${referral.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#2A7F6F', marginBottom: '2px' }}>{referral.clientName}</div>
          </a>
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.phone ?? '—'}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>

          {/* Address */}
          <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Address</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.address ?? '—'}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.city}, {referral.state} {referral.zip}</div>
          </div>

          {/* Agency */}
          <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Agency</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>{referral.referringAgency ?? '—'}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.referredBy ?? '—'}</div>
          </div>

          {/* Date */}
          <div style={{ width: '130px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Submitted</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>{formatDate(referral.referralDate)}</div>
          </div>

        </div>

        {/* Actions */}
        <div style={{ paddingRight: '20px', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setModal('Approved')} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'rgba(42,127,111,0.1)', color: '#2A7F6F', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Approve
          </button>
          <button onClick={() => setModal('Rejected')} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'rgba(192,57,43,0.08)', color: '#C0392B', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
            Reject
          </button>
        </div>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ reschedule

function RescheduleRequestCard({ referral, availableDates, onAction, onOverride, busy }: {
  referral: Referral
  availableDates: AvailableDate[]
  onAction: (
    id: string,
    name: string,
    preferredDate: string,
    appointmentTime: string | null,
  ) => Promise<{ ok: false; message: string } | { ok: true; notice: string | null }>
  onOverride: (referral: Referral) => void
  busy: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = requestedSlotLoad(referral, availableDates)

  // A flexible request carries no date, so there is nothing to accept as-is —
  // picking one is the only route out of it.
  const canAccept = !!referral.preferredDate

  async function accept() {
    if (!referral.preferredDate) return
    setLoading(true)
    setError(null)
    // On success the parent removes this card and, if a notice was withheld,
    // surfaces it on the page — this card is gone by then.
    const result = await onAction(referral.id, referral.clientName, referral.preferredDate, referral.preferredTime)
    if (!result.ok) setError(result.message)
    setLoading(false)
  }

  const disabled = loading || busy

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '4px', alignSelf: 'stretch', background: RESCHEDULE_ACCENT, flexShrink: 0 }} />

        {/* Client info */}
        <div style={{ width: '220px', flexShrink: 0, padding: '14px 20px' }}>
          <a href={`/dawson/referrals/${referral.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '15px', color: '#2A7F6F', marginBottom: '2px' }}>{referral.clientName}</div>
          </a>
          <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.phone ?? '—'}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, paddingTop: '14px' }}>

          {/* What they have now */}
          <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Currently</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>
              {formatSlot(referral.appointmentDate, referral.appointmentTime)}
            </div>
          </div>

          {/* What they asked for */}
          <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Requested</div>
            {canAccept ? (
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1B2B4B' }}>
                {formatSlot(referral.preferredDate, referral.preferredTime)}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#7A8899', fontStyle: 'italic' }}>
                Flexible — no date given
              </div>
            )}
            {canAccept && !referral.preferredTime && (
              <div style={{ fontSize: '11px', color: '#7A8899' }}>Any time</div>
            )}
            {load && (
              <div style={{ fontSize: '11px', fontWeight: load.full ? 700 : 400, color: load.full ? '#C0392B' : '#7A8899' }}>
                {load.booked}/{load.cap} booked{load.full ? ' · full' : ''}
              </div>
            )}
          </div>

          {/* Agency */}
          <div style={{ width: '200px', flexShrink: 0, padding: '0 20px 14px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '3px' }}>Agency</div>
            <div style={{ fontSize: '12px', color: '#7A8899' }}>{referral.referringAgency ?? '—'}</div>
            <div style={{ fontSize: '11px', color: '#7A8899' }}>{referral.referredBy ?? '—'}</div>
          </div>

        </div>

        {/* Actions */}
        <div style={{ paddingRight: '20px', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={accept} disabled={disabled || !canAccept}
            title={
              !canAccept ? 'The agency did not name a date'
              : load?.full ? `Schedule as requested — note ${referral.preferredTime} is already at capacity (${load.booked}/${load.cap})`
              : 'Schedule the date and time the agency asked for'
            }
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none',
              background: canAccept ? 'rgba(42,127,111,0.1)' : 'rgba(122,136,153,0.10)',
              color: canAccept ? '#2A7F6F' : '#B8C3CC',
              fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px',
              cursor: canAccept && !disabled ? 'pointer' : 'not-allowed',
              opacity: loading ? 0.6 : 1,
            }}>
            {loading ? '...' : 'Accept Date'}
          </button>
          <button onClick={() => onOverride(referral)} disabled={disabled}
            style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'rgba(201,168,76,0.15)', color: '#8B7724', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '11px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            Pick Another
          </button>
        </div>
      </div>
      <CardError message={error} />
    </div>
  )
}

// ----------------------------------------------------------------- group shell

function Section({ title, accent, count, children }: {
  title: string
  accent: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontFamily: 'var(--font-montserrat)', fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent }}>
          {title}
        </span>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {count} {count === 1 ? 'client' : 'clients'}
        </span>
      </div>
      {children}
    </div>
  )
}

// ------------------------------------------------------------------------ page

export default function AwaitingReviewPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [overrideModal, setOverrideModal] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' })
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  // Reschedules that went through but whose notice was withheld by the
  // confirmation guard. Kept at page level and not auto-dismissed: the card is
  // removed from the queue on success, so this is the only thing left on screen
  // saying the agency was not emailed. Also on the record's Email Log.
  const [withheldNotices, setWithheldNotices] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/dawson/referrals?review=Pending')
      .then(r => r.json())
      .then(data => { setReferrals(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))

    // Saturdays for the "Pick Another" modal. leadDays=1 matches the internal
    // detail page, so a reschedule can still land on the coming Saturday.
    fetch('/api/dawson/schedule/available?weeks=8&leadDays=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  function handleAction(id: string) {
    setReferrals(prev => prev.filter(r => r.id !== id))
  }

  /**
   * THE reschedule call, used by both routes out of a request.
   *
   * Posts to Dawson's own reschedule endpoint, which is a thin wrapper over
   * rescheduleReferral() — so accepting a requested date does exactly what a
   * manual reschedule does, including preserving the original appointment,
   * re-arming the reminder and emailing the agency a regenerated slip.
   *
   * Then clears the record out of this queue by setting the review back to
   * 'Approved'.
   *
   * Returns an error to show on the card, or — on success — an optional notice
   * to show on the page. The success notice exists for the confirmation guard:
   * when a referral's appointment confirmation was never sent, the reschedule
   * still happens but the agency is NOT emailed about it, and the card is gone
   * from the queue a moment later, so this is the only chance to tell Dawson
   * at the moment he acts. It is also written to the record's Email Log.
   */
  async function applyReschedule(
    id: string,
    name: string,
    preferredDate: string,
    appointmentTime: string | null,
  ): Promise<{ ok: false; message: string } | { ok: true; notice: string | null }> {
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
      const withheld: string | null =
        notice && notice.skipped && notice.message ? `${name}: ${notice.message}` : null

      // The reschedule has committed at this point. If this second call fails
      // the appointment IS moved and any notice has already gone — the record
      // just stays in the queue, which is the safe way round.
      const reviewRes = await fetch(`/api/dawson/referrals/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: 'Approved' }),
      })
      if (!reviewRes.ok) {
        return {
          ok: false,
          message: 'Rescheduled, but this record could not be cleared from the queue. Reload and approve it by hand.',
        }
      }

      handleAction(id)
      // Surfaced HERE rather than in each caller. Both routes out of a
      // reschedule request land in this function, but only "Pick Another" was
      // reading the returned notice — so accepting the agency's date, which is
      // the primary green button, committed the reschedule, withheld the
      // agency email, removed the card, and said nothing at all. Two buttons,
      // identical data, different honesty.
      if (withheld) setWithheldNotices(prev => [...prev, withheld])
      return { ok: true, notice: withheld }
    } catch {
      return { ok: false, message: 'Network error — please try again.' }
    }
  }

  async function handleOverrideConfirm(preferredDate: string, appointmentTime: TimeSlot | null) {
    setOverrideLoading(true)
    setOverrideError(null)
    const result = await applyReschedule(overrideModal.id, overrideModal.name, preferredDate, appointmentTime)
    setOverrideLoading(false)
    if (!result.ok) { setOverrideError(result.message); return }
    setOverrideModal({ open: false, id: '', name: '' })
  }

  const filtered = referrals.filter(r =>
    matchesSearch(search, r.clientName, r.referringAgency, r.referredBy)
  )

  // The one thing that tells the two apart. An agency reschedule request sets
  // Appointment Status = 'Reschedule' alongside Referral Review = 'Pending';
  // a brand-new referral only ever sets the latter.
  const rescheduleRequests = filtered.filter(r => r.appointmentStatus === 'Reschedule')
  const newRequests = filtered.filter(r => r.appointmentStatus !== 'Reschedule')

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <RescheduleModal
        open={overrideModal.open}
        name={overrideModal.name}
        availableDates={availableDates}
        loading={overrideLoading}
        onClose={() => { setOverrideModal({ open: false, id: '', name: '' }); setOverrideError(null) }}
        onConfirm={handleOverrideConfirm}
      />

      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>Awaiting Review</div>
          {!loading && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
              {filtered.length} referral{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px' }}>
        <input type="text" placeholder="Search by client, agency, or staff..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #EDE9E1', fontSize: '13px', color: '#2C3A4A', width: '320px', outline: 'none', marginBottom: '20px', display: 'block', background: 'white' }} />

        {overrideError && !overrideModal.open && (
          <div style={{ background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12.5px', color: '#C0392B' }}>
            {overrideError}
          </div>
        )}

        {/* Gold, not red: the reschedule worked. What did not happen is the
            email, on purpose. Stays until the page is left. */}
        {withheldNotices.map((n, i) => (
          <div key={i} style={{ background: 'rgba(201,168,76,0.10)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', fontSize: '12.5px', color: '#7A6A28', lineHeight: 1.6 }}>
            {n}
          </div>
        ))}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#7A8899', fontSize: '14px' }}>No referrals awaiting review 🎉</div>
        ) : (
          <>
            <Section title="Reschedule Requests" accent={RESCHEDULE_ACCENT} count={rescheduleRequests.length}>
              {rescheduleRequests.map(r => (
                <RescheduleRequestCard
                  key={r.id}
                  referral={r}
                  availableDates={availableDates}
                  onAction={applyReschedule}
                  onOverride={ref => { setOverrideError(null); setOverrideModal({ open: true, id: ref.id, name: ref.clientName }) }}
                  busy={overrideLoading}
                />
              ))}
            </Section>

            <Section title="New Referral Requests" accent={NEW_REFERRAL_ACCENT} count={newRequests.length}>
              {newRequests.map(r => <ReferralCard key={r.id} referral={r} onAction={handleAction} />)}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
