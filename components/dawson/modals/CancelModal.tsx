// components/dawson/modals/CancelModal.tsx
//
// Confirmation modal for cancelling a scheduled referral.
//
// Used by:
//   - app/dawson/referrals/[id]/page.tsx  (detail page action bar)
//   - app/dawson/referrals/scheduled/page.tsx  (row action)
//
// Both call sites POST to /api/dawson/referrals/:id/cancel on confirm.


'use client'


type Props = {
  open: boolean
  name: string
  onConfirm: () => void
  onClose: () => void
  loading: boolean
}


export default function CancelModal({ open, name, onConfirm, onClose, loading }: Props) {
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
          padding: '36px',
          maxWidth: '440px',
          width: '90%',
          boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-montserrat)',
            fontWeight: 800,
            fontSize: '18px',
            color: '#1B2B4B',
            marginBottom: '10px',
          }}
        >
          Cancel Appointment
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: '#7A8899',
            lineHeight: 1.7,
            marginBottom: '24px',
          }}
        >
          Cancel the appointment for {name}? The slot will be freed up and all referral data is preserved.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '7px',
              border: '1px solid #EDE9E1',
              background: 'white',
              color: '#2C3A4A',
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '10px 20px',
              borderRadius: '7px',
              border: 'none',
              background: '#C0392B',
              color: 'white',
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? '...' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
