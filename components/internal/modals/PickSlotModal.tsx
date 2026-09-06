'use client'

// components/internal/modals/PickSlotModal.tsx
//
// The one internal "pick a Saturday for this referral" modal: a thin shell
// (overlay + white panel) around the shared SaturdayCapacityGrid in select
// mode. It absorbed the old RescheduleModal (Nov 2026) — that modal did the
// same job with a bespoke dropdown + time-pill UI, and keeping two was how the
// three booking implementations happened.
//
// `intent` picks the wording and the confirm path:
//   - 'reschedule' (default) — moving a referral to a new Saturday.
//       • Needs Action "Pick another" on a Reschedule row → applyReschedule()
//       • Referrals list row menu → "Reschedule"
//       • referral detail page action bar → "Reschedule"
//     All three POST /api/dawson/referrals/[id]/reschedule (snapshot + agency
//     email + withheld-notice handling). excludeReferralId is the referral
//     being moved: its held slot reads "Current" and nets out of that cell's
//     count, and its own pending request drops from the soft tally.
//   - 'approve' — a New referrals row's "Pick another". The referral holds no
//     slot, so nothing nets out; excludeReferralId only drops its own pending
//     request from the soft tally. Confirm → approveReferral() with the picked
//     slot as an explicit override → POST /api/dawson/referrals/[id]/approve.
//
// On confirm this hands (date, time) back to the caller. Parents pass a `key`
// tied to the referral id so a fresh referral (or close→reopen) remounts it
// and `sel` starts empty — there is no reset effect.

import { useState } from 'react'
import SaturdayCapacityGrid, { type SlotSelection } from '@/components/internal/SaturdayCapacityGrid'

type Props = {
  open: boolean
  name: string
  referralId: string
  loading: boolean
  error: string | null
  intent?: 'reschedule' | 'approve'
  onConfirm: (date: string, time: string) => void
  onClose: () => void
}

export default function PickSlotModal({
  open, name, referralId, loading, error, intent = 'reschedule', onConfirm, onClose,
}: Props) {
  const [sel, setSel] = useState<SlotSelection | null>(null)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '620px',
          width: '94%',
          maxHeight: '86vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '18px',
            color: '#1B2B4B', marginBottom: '4px',
          }}
        >
          {intent === 'approve' ? 'Book' : 'Reschedule'} {name}
        </h3>
        <p style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.6, marginBottom: '18px' }}>
          {intent === 'approve'
            ? "Pick a slot for this referral. Its own pending request is left out of the counts."
            : "Pick a slot. The client's current slot is marked, and their own pending request is left out of the counts."}
        </p>

        <SaturdayCapacityGrid
          mode="select"
          weeks={4}
          leadDays={1}
          excludeReferralId={referralId}
          value={sel}
          onChange={setSel}
        />

        {error && (
          <div
            style={{
              marginTop: '14px', padding: '10px 12px', borderRadius: '8px',
              background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)',
              fontSize: '12.5px', color: '#C0392B',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px', borderRadius: '7px', border: '1px solid #EDE9E1',
              background: 'white', color: '#2C3A4A',
              fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            onClick={() => sel && onConfirm(sel.date, sel.time)}
            disabled={!sel || loading}
            style={{
              padding: '10px 20px', borderRadius: '7px', border: 'none',
              background: '#2A7F6F', color: 'white',
              fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
              cursor: !sel || loading ? 'not-allowed' : 'pointer',
              opacity: !sel || loading ? 0.5 : 1,
            }}
          >
            {loading
              ? '…'
              : !sel
                ? 'Pick a slot'
                : intent === 'approve'
                  ? `Book ${sel.date} · ${sel.time}`
                  : `Reschedule to ${sel.date} · ${sel.time}`}
          </button>
        </div>
      </div>
    </div>
  )
}
