'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  orgId: string
  agencyId: string
  agencyName: string
  invitedByName: string
}

export default function InviteStaffForm({ orgId, agencyId, agencyName, invitedByName }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const inputStyle = {
    width: '100%',
    padding: '10px 13px',
    border: '1.5px solid #C8C2B8',
    borderRadius: '7px',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 500,
    color: '#1A2433',
    background: '#F7F5F1',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    fontSize: '12px',
    fontWeight: 700,
    color: '#1B2B4B',
    letterSpacing: '0.02em',
    display: 'block',
    marginBottom: '5px',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          role: 'org:member',
          phone: phone.trim(),
          orgId,
          agencyId,
          agencyName,
          invitedByName,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }

      setSuccess(true)
      setFirstName('')
      setLastName('')
      setEmail('')
      setPhone('')
      router.refresh()

      setTimeout(() => setSuccess(false), 4000)

    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', marginBottom: '16px', paddingBottom: '14px', borderBottom: '2px solid #EDE9E1', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="8.5" cy="7" r="4"/>
          <line x1="20" y1="8" x2="20" y2="14"/>
          <line x1="23" y1="11" x2="17" y2="11"/>
        </svg>
        Invite Staff Member
      </h2>

      {success && (
        <div style={{ background: 'rgba(42,127,111,0.10)', border: '1px solid #2A7F6F', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#2A7F6F', fontWeight: 600 }}>
          ✓ Invitation sent! They will receive an email with a secure portal access link.
        </div>
      )}

      {error && (
        <div style={{ background: '#FDF0EE', border: '1px solid #C0392B', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#C0392B', fontWeight: 600 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>First Name <span style={{ color: '#C0392B' }}>*</span></label>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Last Name <span style={{ color: '#C0392B' }}>*</span></label>
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Last name"
              required
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Work Email <span style={{ color: '#C0392B' }}>*</span></label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@organization.org"
            required
            style={inputStyle}
          />
          <p style={{ fontSize: '11px', color: '#9AA4AE', marginTop: '4px' }}>
            Portal login link will be sent here
          </p>
        </div>

        <div>
          <label style={labelStyle}>Phone Number <span style={{ color: '#C0392B' }}>*</span></label>
          <input
            type="tel"
            value={phone}
            onChange={e => {
  const raw = e.target.value.replace(/\D/g, '').slice(0, 10)
  let formatted = ''
  if (raw.length >= 7) formatted = `(${raw.slice(0,3)}) ${raw.slice(3,6)}-${raw.slice(6)}`
  else if (raw.length >= 4) formatted = `(${raw.slice(0,3)}) ${raw.slice(3)}`
  else if (raw.length > 0) formatted = `(${raw}`
  setPhone(formatted)
}}
            placeholder="(000) 000-0000"
            required
            style={inputStyle}
          />
          <p style={{ fontSize: '11px', color: '#9AA4AE', marginTop: '4px' }}>
            Direct work number for this staff member
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting || !firstName || !lastName || !email || !phone}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            background: submitting || !firstName || !lastName || !email || !phone ? '#9AA4AE' : '#2A7F6F',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '8px',
            border: 'none',
            fontFamily: 'var(--font-montserrat)',
            fontWeight: 800,
            fontSize: '13px',
            letterSpacing: '0.04em',
            cursor: submitting || !firstName || !lastName || !email || !phone ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
            width: '100%',
          }}
        >
          {submitting ? (
            'Sending Invitation...'
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              Send Invitation
            </>
          )}
        </button>

      </form>
    </div>
  )
}