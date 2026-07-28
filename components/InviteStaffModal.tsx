// components/InviteStaffModal.tsx
// Modal-wrapped invite form for new agency staff.
// Combines the InviteStaffForm fields with a tightened "About Portal Access"
// info block so admins have everything in one focused surface.


'use client'


import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'


type Props = {
  open: boolean
  onClose: () => void
  orgId: string
  agencyId: string
  agencyName: string
  invitedByName: string
}


export default function InviteStaffModal({
  open,
  onClose,
  orgId,
  agencyId,
  agencyName,
  invitedByName,
}: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)


  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({ firstName: '', lastName: '', email: '', phone: '' })
      setError(null)
    }
  }, [open])


  // Close on Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, loading, onClose])


  if (!open) return null


  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && form.email.trim() && form.phone.trim() && !loading


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return


    setLoading(true)
    setError(null)


    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          role: 'org:member',
          phone: form.phone.trim(),
          orgId,
          agencyId,
          agencyName,
          invitedByName,
        }),
      })


      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to send invitation.')
        setLoading(false)
        return
      }


      onClose()
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }


  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '7px',
    border: '1px solid #EDE9E1',
    fontSize: '14px',
    fontFamily: 'inherit',
    background: '#FBFAF7',
    color: '#1B2B4B',
    outline: 'none',
  }


  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#2C3A4A',
    marginBottom: '6px',
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2A7F6F"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
          <h3
            style={{
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 800,
              fontSize: '18px',
              color: '#1B2B4B',
              margin: 0,
            }}
          >
            Invite Staff Member
          </h3>
        </div>
        <p style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.6, marginBottom: '22px' }}>
          They&apos;ll receive a secure magic-link email to activate their portal account.
        </p>


        <form onSubmit={handleSubmit}>
          {/* Name row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={labelStyle}>
                First Name <span style={{ color: '#C0392B' }}>*</span>
              </label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                style={inputStyle}
                placeholder="First name"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>
                Last Name <span style={{ color: '#C0392B' }}>*</span>
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                style={inputStyle}
                placeholder="Last name"
                required
              />
            </div>
          </div>


          {/* Email */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>
              Work Email <span style={{ color: '#C0392B' }}>*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={inputStyle}
              placeholder="name@organization.org"
              required
            />
            <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '4px' }}>
              Portal login link will be sent here.
            </div>
          </div>


          {/* Phone */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>
              Phone Number <span style={{ color: '#C0392B' }}>*</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 10)
                let formatted = ''
                if (raw.length >= 7) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`
                else if (raw.length >= 4) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3)}`
                else if (raw.length > 0) formatted = `(${raw}`
                setForm({ ...form, phone: formatted })
              }}
              style={inputStyle}
              placeholder="(000) 000-0000"
              required
            />
            <div style={{ fontSize: '11px', color: '#7A8899', marginTop: '4px' }}>
              Direct work number for this staff member.
            </div>
          </div>


          {/* Tightened Portal Access info */}
          <div
            style={{
              background: 'rgba(42,127,111,0.05)',
              border: '1px solid rgba(42,127,111,0.15)',
              borderRadius: '10px',
              padding: '14px 16px',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: '#2A7F6F',
                marginBottom: '8px',
              }}
            >
              About Portal Access
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                'Magic-link email — no password required',
                'Staff see only referrals they submit',
                'Admins manage the team and view all referrals',
                'Invites expire after 30 days',
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: '12.5px',
                    color: '#2C3A4A',
                    lineHeight: 1.5,
                    paddingLeft: '14px',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      color: '#2A7F6F',
                      fontWeight: 700,
                    }}
                  >
                    •
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>


          {error && (
            <div
              style={{
                background: '#FDF0EE',
                border: '1px solid #E8B5AE',
                color: '#C0392B',
                borderRadius: '7px',
                padding: '10px 12px',
                fontSize: '13px',
                marginBottom: '14px',
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}


          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '10px 20px',
                borderRadius: '7px',
                border: '1px solid #EDE9E1',
                background: 'white',
                color: '#2C3A4A',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '10px 20px',
                borderRadius: '7px',
                border: 'none',
                background: '#2A7F6F',
                color: 'white',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {loading ? 'Sending...' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
