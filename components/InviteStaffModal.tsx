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
  /** The signed-in admin's own email. Its domain is what a new invite is compared against. */
  inviterEmail: string
}


export default function InviteStaffModal({
  open,
  onClose,
  orgId,
  agencyId,
  agencyName,
  invitedByName,
  inviterEmail,
}: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'Staff' as 'Staff' | 'Admin',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the staff member WAS created but Resend didn't take the email
  // (route returns 200 { emailSent: false }). Not an error — a caveat on a
  // success — so the modal switches to a confirmation state rather than
  // re-showing the form.
  const [notice, setNotice] = useState<string | null>(null)


  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({ firstName: '', lastName: '', email: '', phone: '', role: 'Staff' })
      setError(null)
      setNotice(null)
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


  // Ben asked for a check on the invited address's domain against the
  // inviting admin's own. He did not say what should happen when they differ,
  // and this WARNS rather than blocks — a decision taken in his absence and
  // recorded in the PR. Plenty of agency staff legitimately use a personal
  // address (a caseworker on gmail, a contractor on their own firm's domain),
  // and a hard block would stop those invites dead with the admin unable to
  // override it. A warning they have to read and then knowingly send past is
  // the version that cannot cost anybody an invite. Flipping it to a block is
  // one line: gate `canSubmit` on `!domainMismatch`.
  const domain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? ''
  const inviterDomain = domain(inviterEmail)
  const inviteeDomain = domain(form.email)

  // An address still being typed is not a mismatch, it is unfinished, and a
  // warning that appears and disappears while somebody types their colleague's
  // address is worse than no warning at all. Two guards, both about typing
  // rather than about the rule:
  //   - the domain has to look finished (a dot and a two-letter-plus tail), so
  //     "@catholic" says nothing;
  //   - and a domain that is still a prefix of the admin's own is somebody
  //     part-way through typing it, not a different organization.
  const looksComplete = /\.[a-z]{2,}$/.test(inviteeDomain)
  const stillTypingOwnDomain =
    Boolean(inviteeDomain) && inviterDomain.startsWith(inviteeDomain)
  const domainMismatch =
    Boolean(inviterDomain) &&
    looksComplete &&
    !stillTypingOwnDomain &&
    inviterDomain !== inviteeDomain


  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())

  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && emailValid && form.phone.trim() && !loading


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
          role: form.role === 'Admin' ? 'org:admin' : 'org:member',
          phone: form.phone.trim(),
          orgId,
          agencyId,
          agencyName,
          invitedByName,
        }),
      })


      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // `detail` carries the underlying Clerk / Airtable message on the
        // 500s — worth showing on this admin-only surface so a failed invite
        // can be diagnosed without opening the network tab.
        setError(
          [data.error || 'Failed to send invitation.', data.detail]
            .filter(Boolean)
            .join(' — '),
        )
        setLoading(false)
        return
      }


      // Row + Clerk user created, but the email did not go. Keep the modal
      // open on a confirmation state that says so; refresh the list behind it.
      if (data.emailSent === false) {
        setNotice(
          'Staff member added, but the invite email didn’t send. Use Resend Invite, or contact Furniture Assist if it keeps failing.',
        )
        setLoading(false)
        router.refresh()
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
        {notice ? (
          <>
            <div
              style={{
                background: '#FEF9EC',
                border: '1px solid #E6D3A3',
                borderRadius: '10px',
                padding: '14px 16px',
                fontSize: '13px',
                color: '#6B5518',
                lineHeight: 1.55,
                fontWeight: 600,
                marginBottom: '20px',
              }}
            >
              {notice}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 20px',
                  borderRadius: '7px',
                  border: 'none',
                  background: '#2A7F6F',
                  color: 'white',
                  fontFamily: 'var(--font-montserrat)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </>
        ) : (
        <>
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


          {/* Role — Staff by default. Admin can manage the team and see every
              referral; Staff see only their own. */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Role</label>
            <div style={{ display: 'inline-flex', border: '1px solid #EDE9E1', borderRadius: '8px', overflow: 'hidden' }}>
              {(['Staff', 'Admin'] as const).map((r) => {
                const on = form.role === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm({ ...form, role: r })}
                    style={{
                      padding: '8px 18px',
                      border: 'none',
                      background: on ? '#2A7F6F' : 'white',
                      color: on ? 'white' : '#2C3A4A',
                      fontFamily: 'var(--font-montserrat)',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                )
              })}
            </div>
          </div>


          {/* Domain mismatch — warn, never block. Amber rather than the red
              the error box below uses, because nothing has gone wrong: this is
              a "did you mean to?" and the Send button stays live beside it. */}
          {domainMismatch && (
            <div
              role="status"
              style={{
                background: '#FEF9EC',
                border: '1px solid #E6D3A3',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '18px',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8912F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div style={{ fontSize: '12.5px', color: '#6B5518', lineHeight: 1.5 }}>
                <strong style={{ fontWeight: 700 }}>
                  This address is outside your organization.
                </strong>
                <br />
                You are inviting <strong>@{inviteeDomain}</strong>, and your own
                address is <strong>@{inviterDomain}</strong>. That is fine if this
                person uses a personal or partner email. Check the spelling
                before you send; you will still be able to remove them later.
              </div>
            </div>
          )}


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
        </>
        )}
      </div>
    </div>
  )
}
