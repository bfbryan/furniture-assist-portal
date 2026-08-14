'use client'

// components/agency/ReferralActionModals.tsx
//
// The agency portal's cancel / withdraw / reschedule dialogs.
//
// Lifted verbatim out of ReferralTable so the referral detail page can offer
// the same actions without a second copy. Behaviour, copy and styling are
// unchanged; this is a move, not a redesign.
//
// These are deliberately NOT the modals in components/internal/modals/. Those
// let Dawson pick an exact time slot and book it, because he owns the
// schedule. An agency asks: it proposes a Saturday (or says it is flexible)
// and Furniture Assist confirms by email. Same two buttons, different
// authority, so the agency keeps its own wording and its own shape.
//
// Used by:
//   - components/agency/ReferralTable.tsx        (row actions)
//   - app/(agency)/referrals/[id]/page.tsx       (detail page action bar)

import { useEffect, useState } from 'react'
import { TIME_ORDER } from '@/lib/schedule/capacity'

export type AvailableDate = {
  date: string           // 'YYYY-MM-DD'
  slotsRemaining: number
}

// ---------- CANCEL / WITHDRAW MODAL ----------
export type ConfirmModalState = {
  open: boolean
  type: 'cancel' | 'withdraw' | null
  id: string
  name: string
}

export function ConfirmModal({ modal, onConfirm, onClose, loading }: {
  modal: ConfirmModalState
  onConfirm: () => void
  onClose: () => void
  loading: boolean
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
          {isWithdraw
            ? `Are you sure you want to withdraw the referral for ${modal.name}? It will be removed from the review queue.`
            : `Are you sure you want to cancel the appointment for ${modal.name}? Furniture Assist will be notified.`}
        </p>
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

// ---------- RESCHEDULE MODAL (Flexible + Saturday picker) ----------
export type RescheduleModalState = {
  open: boolean
  id: string
  name: string
}

export function RescheduleModal({ modal, availableDates, onConfirm, onClose, loading }: {
  modal: RescheduleModalState
  availableDates: AvailableDate[]
  onConfirm: (preferredDate: string | null, flexible: boolean, preferredTime: string | null) => void
  onClose: () => void
  loading: boolean
}) {
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [flexible, setFlexible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (modal.open) { setPreferredDate(''); setPreferredTime(''); setFlexible(false); setError(null) }
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

  const handleConfirm = () => {
    setError(null)
    if (!flexible && !preferredDate) {
      setError('Pick a Saturday or check Flexible.'); return
    }
    onConfirm(
      flexible ? null : preferredDate,
      flexible,
      flexible || !preferredTime ? null : preferredTime,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '36px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(27,43,75,0.2)' }}>
        <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px', color: '#1B2B4B', marginBottom: '10px' }}>
          Reschedule Appointment
        </h3>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '20px' }}>
          Reschedule for {modal.name}. Choose a Saturday. We&apos;ll check availability and confirm by email.
        </p>

        <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#1B2B4B', marginBottom: '6px', display: 'block' }}>
          Preferred Saturday
        </label>
        <select
          value={preferredDate}
          onChange={e => setPreferredDate(e.target.value)}
          disabled={flexible}
          style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '14px', color: '#2C3A4A', background: 'white', outline: 'none', opacity: flexible ? 0.5 : 1, cursor: flexible ? 'not-allowed' : 'pointer', marginBottom: '12px' }}
        >
          <option value="">Select a Saturday...</option>
          {availableDates.map(d => {
            const dateObj = new Date(d.date + 'T00:00:00')
            const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
            return (
              <option key={d.date} value={d.date}>
                {label}
              </option>
            )
          })}
        </select>

        {/* Preferred time — optional, and deliberately a plain select rather
            than the internal modal's row of five capacity pills. Dawson picks
            from live per-slot counts because he owns the schedule; an agency is
            only stating a preference, and five pills across a phone screen is
            about 60px each. Same control as the Saturday picker above it. */}
        <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#1B2B4B', marginBottom: '6px', display: 'block' }}>
          Preferred Time (optional)
        </label>
        <select
          value={preferredTime}
          onChange={e => setPreferredTime(e.target.value)}
          disabled={flexible}
          style={{ width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #EDE9E1', fontSize: '14px', color: '#2C3A4A', background: 'white', outline: 'none', opacity: flexible ? 0.5 : 1, cursor: flexible ? 'not-allowed' : 'pointer', marginBottom: '12px' }}
        >
          <option value="">No preference</option>
          {TIME_ORDER.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '9px 14px', borderRadius: '7px', border: `1px solid ${flexible ? '#2A7F6F' : '#EDE9E1'}`, background: flexible ? '#EAF4F2' : 'white', marginBottom: '20px' }}>
          <input type="checkbox" checked={flexible} onChange={e => { setFlexible(e.target.checked); if (e.target.checked) { setPreferredDate(''); setPreferredTime('') } }} style={{ display: 'none' }} />
          <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${flexible ? '#2A7F6F' : '#EDE9E1'}`, background: flexible ? '#2A7F6F' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {flexible && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </div>
          <span style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: flexible ? 600 : 400 }}>
            I&apos;m flexible — Furniture Assist will pick the next available Saturday and email you the details.
          </span>
        </label>

        {error && (
          <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#C0392B' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={handleConfirm} disabled={loading} style={{ padding: '10px 20px', borderRadius: '7px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
