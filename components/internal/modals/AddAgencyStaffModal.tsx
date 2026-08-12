// components/internal/modals/AddAgencyStaffModal.tsx
//
// Opened from the new-referral form when a staff search comes up empty.
//
// Two cases, one modal:
//   1. New person at an agency we already have  -> pick the agency,
//      fill in the person
//   2. New agency entirely                      -> type the agency name
//      and email, fill in the person
//
// The agency field is a combobox over the already-loaded agency list
// rather than a plain text input. That is deliberate: the most common
// reason a staff search fails is a NEW PERSON AT A KNOWN AGENCY, and a
// free-text box would quietly create "Union County SS" alongside the
// existing "Union County Social Services".
//
// This modal does not write to Airtable. It hands a payload back to the
// form, which submits it with the referral so agency/staff creation and
// the referral write stay in one transaction (see
// lib/referrals/create.ts).

'use client'

import { useEffect, useRef, useState } from 'react'

export type Agency = {
  id: string
  name: string
  email: string | null
  contactName: string
  status: string
}

export type NewStaffDraft = {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export type AddStaffResult =
  | {
      mode: 'existingAgency'
      agency: Agency
      staff: NewStaffDraft
    }
  | {
      mode: 'newAgency'
      newAgency: { name: string; email: string }
      staff: NewStaffDraft
    }

type Props = {
  agencies: Agency[]
  /** Prefills the agency box or the staff name, depending on what was typed. */
  initialQuery?: string
  /** Preselects an agency when the form already had one chosen. */
  initialAgency?: Agency | null
  onClose: () => void
  onSave: (result: AddStaffResult) => void
}

const LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 700,
  fontSize: '11px',
  color: '#7A8899',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '6px',
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '7px',
  border: '1px solid #EDE9E1',
  fontSize: '13px',
  color: '#2C3A4A',
  fontFamily: 'var(--font-montserrat)',
  background: 'white',
  outline: 'none',
}

// Staff phones may carry an extension -- the Airtable phone field accepts one
// after the number. Everything before an extension marker is formatted as
// (000) 000-0000; the digits after it are kept and re-emitted as ' x<digits>'.
//
// formatPhone runs on its own output on every keystroke (controlled input), so
// it MUST be idempotent: formatPhone(formatPhone(v)) === formatPhone(v).
// The marker is only honoured once the 10-digit number is complete, which is
// what keeps a stray letter typed mid-number being dropped as it always was.
const EXT_MARKER = /\s*(?:extension|ext\.?|x|#)\s*/i
const MAX_EXT_DIGITS = 8

function formatPhone(value: string): string {
  const marker = EXT_MARKER.exec(value)
  let beforeMarker = value
  let afterMarker = ''
  if (marker) {
    beforeMarker = value.slice(0, marker.index)
    afterMarker = value.slice(marker.index + marker[0].length)
  }

  const digits = beforeMarker.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`

  const main = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (!marker || digits.length < 10) return main

  // Emitted even when empty so that typing 'x' leaves somewhere to type into
  // rather than being swallowed on the same keystroke.
  const ext = afterMarker.replace(/\D/g, '').slice(0, MAX_EXT_DIGITS)
  return `${main} x${ext}`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Looks like a person's name rather than an organisation. */
function looksLikePersonName(q: string): boolean {
  const t = q.trim()
  if (!t || t.includes('@')) return false
  const words = t.split(/\s+/)
  if (words.length > 3) return false
  return !/\b(agency|services|county|center|centre|inc|llc|dept|department|housing|social|community|shelter|foundation|ministr|coalition|authority)\b/i.test(
    t
  )
}

export default function AddAgencyStaffModal({
  agencies,
  initialQuery = '',
  initialAgency = null,
  onClose,
  onSave,
}: Props) {
  // If Dawson typed something that reads like a person's name, seed the
  // staff fields with it. If it reads like an organisation, seed the
  // agency box instead. Saves retyping either way.
  const seedIsPerson = looksLikePersonName(initialQuery)
  const seedWords = initialQuery.trim().split(/\s+/)

  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(initialAgency)
  const [agencyQuery, setAgencyQuery] = useState(
    initialAgency?.name ?? (seedIsPerson ? '' : initialQuery.trim())
  )
  const [agencyDropdownOpen, setAgencyDropdownOpen] = useState(false)
  const [newAgencyEmail, setNewAgencyEmail] = useState('')

  const [staff, setStaff] = useState<NewStaffDraft>({
    firstName: seedIsPerson ? seedWords[0] ?? '' : '',
    lastName: seedIsPerson ? seedWords.slice(1).join(' ') : '',
    email: initialQuery.includes('@') ? initialQuery.trim() : '',
    phone: '',
  })

  const [error, setError] = useState('')
  const comboRef = useRef<HTMLDivElement>(null)

  // Close the agency dropdown on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setAgencyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Escape closes the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmedAgencyQuery = agencyQuery.trim()

  const filteredAgencies = trimmedAgencyQuery
    ? agencies.filter(a => a.name.toLowerCase().includes(trimmedAgencyQuery.toLowerCase()))
    : agencies

  const exactAgencyMatch = agencies.find(
    a => a.name.toLowerCase() === trimmedAgencyQuery.toLowerCase()
  )

  // Creating a new agency = text typed, nothing selected, no exact match.
  const isNewAgency = !selectedAgency && !!trimmedAgencyQuery && !exactAgencyMatch

  function pickAgency(agency: Agency) {
    setSelectedAgency(agency)
    setAgencyQuery(agency.name)
    setAgencyDropdownOpen(false)
    setNewAgencyEmail('')
    setError('')
  }

  function clearAgency() {
    setSelectedAgency(null)
    setAgencyQuery('')
    setNewAgencyEmail('')
  }

  function handleSave() {
    if (!selectedAgency && !trimmedAgencyQuery) {
      setError('Pick an existing agency or type a new agency name.')
      return
    }
    if (isNewAgency && !newAgencyEmail.trim()) {
      setError('New agencies need an agency email.')
      return
    }
    if (isNewAgency && !EMAIL_RE.test(newAgencyEmail.trim())) {
      setError('That agency email does not look valid.')
      return
    }
    if (!staff.firstName.trim()) {
      setError('Staff first name is required.')
      return
    }
    if (!staff.lastName.trim()) {
      setError('Staff last name is required.')
      return
    }
    if (!staff.email.trim()) {
      setError('Staff email is required.')
      return
    }
    if (!EMAIL_RE.test(staff.email.trim())) {
      setError('That staff email does not look valid.')
      return
    }

    const cleanStaff: NewStaffDraft = {
      firstName: staff.firstName.trim(),
      lastName: staff.lastName.trim(),
      email: staff.email.trim(),
      phone: staff.phone.trim(),
    }

    const agency = selectedAgency ?? exactAgencyMatch

    if (agency) {
      onSave({ mode: 'existingAgency', agency, staff: cleanStaff })
    } else {
      onSave({
        mode: 'newAgency',
        newAgency: { name: trimmedAgencyQuery, email: newAgencyEmail.trim() },
        staff: cleanStaff,
      })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '36px',
          maxWidth: '560px',
          width: '92%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-montserrat)',
            fontWeight: 800,
            fontSize: '18px',
            color: '#1B2B4B',
            marginBottom: '6px',
          }}
        >
          Add Staff Member
        </h3>
        <p style={{ fontSize: '13px', color: '#7A8899', marginBottom: '22px', lineHeight: 1.5 }}>
          Search the agency first — most new referrers work somewhere we already
          have on file.
        </p>

        {/* Agency combobox */}
        <div style={{ marginBottom: '18px' }}>
          <label style={LABEL}>Agency *</label>
          <div ref={comboRef} style={{ position: 'relative' }}>
            <input
              style={INPUT}
              value={agencyQuery}
              onChange={e => {
                setAgencyQuery(e.target.value)
                setAgencyDropdownOpen(true)
                if (selectedAgency && e.target.value !== selectedAgency.name) {
                  setSelectedAgency(null)
                }
                setError('')
              }}
              onFocus={() => setAgencyDropdownOpen(true)}
              placeholder="Type to search agencies, or enter a new one..."
            />
            {(selectedAgency || agencyQuery) && (
              <button
                type="button"
                onClick={clearAgency}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#7A8899',
                  fontSize: '18px',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            )}

            {agencyDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'white',
                  border: '1px solid #EDE9E1',
                  borderRadius: '7px',
                  marginTop: '4px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  zIndex: 120,
                  boxShadow: '0 4px 12px rgba(27,43,75,0.08)',
                }}
              >
                {filteredAgencies.length === 0 && !trimmedAgencyQuery && (
                  <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>
                    No agencies
                  </div>
                )}
                {filteredAgencies.slice(0, 50).map(a => (
                  <div
                    key={a.id}
                    onClick={() => pickAgency(a)}
                    style={{
                      padding: '10px 14px',
                      fontSize: '13px',
                      color: '#2C3A4A',
                      cursor: 'pointer',
                      borderBottom: '1px solid #F7F5F1',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAF8F4')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                  >
                    {a.name}
                    {a.status === 'Unclaimed' && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '10px',
                          background: 'rgba(122,136,153,0.15)',
                          color: '#7A8899',
                          letterSpacing: '0.04em',
                        }}
                      >
                        UNCLAIMED
                      </span>
                    )}
                  </div>
                ))}
                {isNewAgency && (
                  <div
                    onClick={() => setAgencyDropdownOpen(false)}
                    style={{
                      padding: '10px 14px',
                      fontSize: '13px',
                      color: '#2A7F6F',
                      cursor: 'pointer',
                      fontWeight: 600,
                      background: '#EAF4F2',
                      borderTop: filteredAgencies.length > 0 ? '1px solid #EDE9E1' : 'none',
                    }}
                  >
                    + Create new agency: "{trimmedAgencyQuery}"
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedAgency && (
            <div style={{ marginTop: '7px', fontSize: '12px', color: '#2A7F6F', fontWeight: 600 }}>
              Existing agency — only the staff member will be created.
            </div>
          )}
        </div>

        {/* New agency email, only when actually creating one */}
        {isNewAgency && (
          <div
            style={{
              background: '#FAF8F4',
              border: '1px solid #EDE9E1',
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '18px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#2A7F6F',
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              New Agency
            </div>
            <label style={LABEL}>Agency Email *</label>
            <input
              style={INPUT}
              type="email"
              value={newAgencyEmail}
              onChange={e => {
                setNewAgencyEmail(e.target.value)
                setError('')
              }}
              placeholder="agency@example.com"
            />
            <div style={{ marginTop: '7px', fontSize: '12px', color: '#7A8899', lineHeight: 1.5 }}>
              General inbox for the agency. The staff email below is the person
              who made this referral.
            </div>
          </div>
        )}

        {/* Staff fields */}
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: '#2A7F6F',
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Staff Member
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={LABEL}>First Name *</label>
            <input
              style={INPUT}
              value={staff.firstName}
              onChange={e => {
                setStaff({ ...staff, firstName: e.target.value })
                setError('')
              }}
            />
          </div>
          <div>
            <label style={LABEL}>Last Name *</label>
            <input
              style={INPUT}
              value={staff.lastName}
              onChange={e => {
                setStaff({ ...staff, lastName: e.target.value })
                setError('')
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          <div>
            <label style={LABEL}>Staff Email *</label>
            <input
              style={INPUT}
              type="email"
              value={staff.email}
              onChange={e => {
                setStaff({ ...staff, email: e.target.value })
                setError('')
              }}
              placeholder="staff@example.com"
            />
          </div>
          <div>
            <label style={LABEL}>Staff Phone</label>
            <input
              style={INPUT}
              value={staff.phone}
              onChange={e => setStaff({ ...staff, phone: formatPhone(e.target.value) })}
              placeholder="(000) 000-0000 x000"
            />
          </div>
        </div>

        {error && (
          <div
            style={{
              background: '#FDF2F2',
              border: '1px solid #F5C6C6',
              borderRadius: '7px',
              padding: '10px 12px',
              fontSize: '13px',
              color: '#A12C2C',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

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
            Cancel
          </button>
          <button
            onClick={handleSave}
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
            Use This Staff Member
          </button>
        </div>
      </div>
    </div>
  )
}
