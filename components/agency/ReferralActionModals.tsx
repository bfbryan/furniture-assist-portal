'use client'

// components/agency/ReferralActionModals.tsx
//
// The agency portal's cancel / withdraw / reschedule dialogs.
//
// Lifted out of ReferralTable so the referral detail page can offer the same
// actions without a second copy. Both dialogs name the client and, where there
// is one, the appointment date + time in bold navy — the facts someone checks
// before confirming.
//
// These are deliberately NOT the modals in components/internal/modals/. Those
// let Dawson pick an exact time slot and book it, because he owns the
// schedule. An agency asks: it proposes a Saturday and Furniture Assist
// confirms by email. Same two buttons, different authority, so the agency
// keeps its own wording and its own shape.
//
// The reschedule picker is the shared SaturdayCapacityGrid in its agency
// (binary Open/Full) config — the same one the New Referral form uses. There
// is no "I'm flexible": auto-assignment takes next-available, which is the
// earliest, which is 9am and its cap of five — a client who can't get a ride
// before 10am gets booked at 9am and doesn't show. The escape hatch is a
// mailto, a human path.
//
// Used by ReferralTable, the referral detail page, HistoryClient and
// DashboardLastSaturday.

import { useEffect, useState } from 'react'
import { addDaysISO, formatDateOnly } from '@/lib/dates'
import { formatSlot } from '@/lib/referrals/slot-display'
import { NO_SHOW_RESCHEDULE_WINDOW_DAYS } from '@/lib/referrals/no-show-window'
import SaturdayCapacityGrid, { type SlotSelection } from '@/components/internal/SaturdayCapacityGrid'

// The facts the reader verifies before confirming — client name, appointment
// date, time — are bold navy against the muted body text.
const SUBJECT: React.CSSProperties = { color: '#1B2B4B', fontWeight: 700 }

// "Sep 26, 2026 at 10am" — same phrasing the detail page and Active list use
// (formatSlot), with the date formatted UTC-anchored like everywhere else.
function slotPhrase(date?: string | null, time?: string | null): string | null {
  if (!date) return null
  return formatSlot(date, time ?? null, iso =>
    formatDateOnly(iso, { month: 'short', day: 'numeric', year: 'numeric' }),
  )
}

// ---------- CANCEL / WITHDRAW MODAL ----------
export type ConfirmModalState = {
  open: boolean
  type: 'cancel' | 'withdraw' | null
  id: string
  name: string
  /** The appointment being cancelled, when there is one (a Scheduling /
      awaiting-date cancel has neither, and withdraw never does). */
  date?: string | null
  time?: string | null
}

export function ConfirmModal({ modal, onConfirm, onClose, loading, error }: {
  modal: ConfirmModalState
  onConfirm: () => void
  onClose: () => void
  loading: boolean
  /** Set when the action came back non-OK. The modal stays open and says so. */
  error?: string | null
}) {
  // Close on Esc — same as InviteStaffModal.
  useEffect(() => {
    if (!modal.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal.open, loading, onClose])

  if (!modal.open) return null
  const isCancel = modal.type === 'cancel'
  const isWithdraw = modal.type === 'withdraw'
  const slot = slotPhrase(modal.date, modal.time)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '440px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          {isWithdraw ? 'Withdraw Referral' : 'Cancel Appointment'}
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '24px' }}>
          {isWithdraw ? (
            <>Withdraw the referral for <strong style={SUBJECT}>{modal.name}</strong>? It will be removed from the review queue. This can&apos;t be undone.</>
          ) : slot ? (
            <>
              Cancel the appointment for <strong style={SUBJECT}>{modal.name}</strong> on <strong style={SUBJECT}>{slotPhrase(modal.date, null)}</strong>
              {modal.time ? <> at <strong style={SUBJECT}>{modal.time}</strong></> : null}?
              {' '}Furniture Assist will be notified and you&apos;ll receive a confirmation by email. This can&apos;t be undone.
            </>
          ) : (
            <>Cancel this referral for <strong style={SUBJECT}>{modal.name}</strong>? Furniture Assist will be notified. This can&apos;t be undone.</>
          )}
        </p>
        {error && (
          <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#C0392B' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={onConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: isCancel ? '#C0392B' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : isWithdraw ? 'Withdraw Referral' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- RESCHEDULE MODAL (binary Saturday grid) ----------
export type RescheduleModalState = {
  open: boolean
  id: string
  name: string
  /** The appointment being moved, shown above the picker for context. */
  date?: string | null
  time?: string | null
  /** No-show reschedule: there's nothing to move, so the line reads
      "Missed:" not "Currently:". */
  missed?: boolean
}

export function RescheduleModal({ modal, onConfirm, onClose, loading, submitError }: {
  modal: RescheduleModalState
  onConfirm: (preferredDate: string, preferredTime: string | null) => void
  onClose: () => void
  loading: boolean
  /** Set when the request came back non-OK. Shown in the same slot as the
      local validation error, and the modal stays open. */
  submitError?: string | null
}) {
  const [sel, setSel] = useState<SlotSelection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (modal.open) { setSel(null); setError(null) }
  }, [modal.open])

  // Close on Esc — same as InviteStaffModal.
  useEffect(() => {
    if (!modal.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal.open, loading, onClose])

  if (!modal.open) return null

  const shortDate = (iso: string) =>
    formatDateOnly(iso, { month: 'short', day: 'numeric', year: 'numeric' })
  const slot = slotPhrase(modal.date, modal.time)
  // Same cutoff the detail page shows: appointmentDate + the window constant.
  const deadline = modal.missed && modal.date
    ? shortDate(addDaysISO(modal.date, NO_SHOW_RESCHEDULE_WINDOW_DAYS))
    : null
  const contextLine = modal.missed ? deadline : slot

  const handleConfirm = () => {
    setError(null)
    if (!sel) { setError('Pick a Saturday below.'); return }
    onConfirm(sel.date, sel.time)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          Reschedule Appointment
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: contextLine ? '10px' : '20px' }}>
          {modal.missed ? (
            <>
              Request a new date for <strong style={SUBJECT}>{modal.name}</strong>
              {slotPhrase(modal.date, null) && <>, who missed their appointment on <strong style={SUBJECT}>{slotPhrase(modal.date, null)}</strong></>}.
              {' '}Furniture Assist will confirm by email.
            </>
          ) : (
            <>
              Request a new date for <strong style={SUBJECT}>{modal.name}</strong>. Furniture Assist will confirm the change by email — the current appointment stands until then.
            </>
          )}
        </p>
        {contextLine && (
          <p style={{ fontSize: '13px', color: '#1B2B4B', margin: '0 0 18px' }}>
            {modal.missed
              ? <>Reschedule available until <strong style={SUBJECT}>{deadline}</strong>.</>
              : <>Currently: <strong style={SUBJECT}>{slot}</strong></>}
          </p>
        )}

        {/* excludeReferralId nets this referral's held slot out of the grid it's
            shown against and marks that cell "Current" — without it a client
            being moved off a full hour sees their own slot as Full.
            /api/agency/schedule checks the caller's agency owns the id; an
            empty or past slot (a missed appointment) is a no-op. */}
        <SaturdayCapacityGrid
          mode="select"
          capacityDisplay="binary"
          enforceCap
          leadDays={14}
          weeks={4}
          showSoft={false}
          endpoint="/api/agency/schedule"
          excludeReferralId={modal.id}
          value={sel}
          onChange={setSel}
        />

        <p style={{ fontSize: '12.5px', color: '#7A8899', marginTop: '12px', lineHeight: 1.6 }}>
          Can&rsquo;t find a date that works? Email us at{' '}
          <a href="mailto:agencies@furnitureassist.com" style={{ color: '#2A7F6F', fontWeight: 700 }}>agencies@furnitureassist.com</a>{' '}
          and we&rsquo;ll find one with you.
        </p>

        {(error || submitError) && (
          <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '10px 14px', margin: '16px 0', fontSize: '13px', color: '#C0392B' }}>
            {error || submitError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: (error || submitError) ? 0 : '20px' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={handleConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
