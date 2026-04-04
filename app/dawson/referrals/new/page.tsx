'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const ITEMS = [
  'Bedroom Furniture',
  'Living Room Furniture',
  'Dining Room Furniture',
  'Household Items (including kitchen & linens)',
  'Baby Items',
  'Clothes',
]

const LABEL: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: '#1B2B4B', marginBottom: '6px', display: 'block',
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: '7px',
  border: '1px solid #EDE9E1', fontSize: '14px', color: '#2C3A4A',
  background: 'white', outline: 'none',
}

const SECTION: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px',
  color: '#2A7F6F', textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: '16px', marginTop: '8px',
}

type Agency = {
  id: string
  name: string
  email: string
  contactName: string
}

type StaffMember = {
  id: string
  name: string
  email: string
  phone: string | null
}

export default function DawsonAddReferralPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [agencies, setAgencies] = useState<Agency[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [agenciesLoading, setAgenciesLoading] = useState(true)
  const [staffLoading, setStaffLoading] = useState(false)

  const [form, setForm] = useState({
    firstName: '', lastName: '',
    address: '', address2: '', city: '', state: 'NJ', zip: '',
    phone: '',
    hhSize: '', children: '',
    dob: '',
    language: 'English',
    items: [] as string[],
    notes: '',
  })

  // Load active agencies
  useEffect(() => {
    fetch('/api/dawson/agencies?status=Approved')
      .then(r => r.json())
      .then(data => { setAgencies(data); setAgenciesLoading(false) })
  }, [])

  // Load staff when agency is selected
  useEffect(() => {
    if (!selectedAgency) { setStaffMembers([]); setSelectedStaff(null); return }
    setStaffLoading(true)
    setSelectedStaff(null)
    fetch(`/api/dawson/agencies/${selectedAgency.id}/staff`)
      .then(r => r.json())
      .then(data => { setStaffMembers(data); setStaffLoading(false) })
  }, [selectedAgency])

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))

  const toggleItem = (item: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.includes(item)
        ? prev.items.filter(i => i !== item)
        : [...prev.items, item],
    }))
  }

  const handleSubmit = async () => {
    setError(null)

    if (!selectedAgency) { setError('Please select an agency.'); return }
    if (!selectedStaff) { setError('Please select a staff member.'); return }

    const required = ['firstName', 'lastName', 'address', 'city', 'state', 'zip', 'phone', 'hhSize', 'children', 'dob']
    for (const f of required) {
      if (!form[f as keyof typeof form]) {
        setError('Please fill in all required fields.')
        return
      }
    }
    if (form.items.length === 0) {
      setError('Please select at least one item.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/dawson/referrals/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          agencyName: selectedAgency.name,
          agencyEmail: selectedAgency.email,
          staffName: selectedStaff.name,
          staffPhone: selectedStaff.phone,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setIsDuplicate(data.duplicate)
      setSubmitted(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', borderRadius: '12px', padding: '48px', textAlign: 'center', maxWidth: '480px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)' }}>
          <div style={{ width: '56px', height: '56px', background: '#EAF4F2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', marginBottom: '10px' }}>
            Referral Submitted
          </h2>
          {isDuplicate && (
            <div style={{ background: '#FEF9EC', border: '1px solid #C9A84C', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#2C3A4A' }}>
              ⚠️ This client may already be in our system. Review before processing.
            </div>
          )}
          <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '28px' }}>
            Referral for {form.firstName} {form.lastName} has been submitted successfully.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button onClick={() => {
              setSubmitted(false)
              setSelectedAgency(null)
              setSelectedStaff(null)
              setForm({ firstName: '', lastName: '', address: '', address2: '', city: '', state: 'NJ', zip: '', phone: '', hhSize: '', children: '', dob: '', language: 'English', items: [], notes: '' })
            }}
              style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              Add Another
            </button>
            <button onClick={() => router.push('/dawson/referrals/review')}
              style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              View Referrals
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
          Add Referral
        </div>
      </header>

      <div style={{ maxWidth: '780px', margin: '0 auto', padding: '32px' }}>
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '32px' }}>

          {/* Agency + Staff Selection */}
          <div style={SECTION}>Agency & Staff</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '28px' }}>
            <div>
              <label style={LABEL}>Agency *</label>
              <select style={INPUT} value={selectedAgency?.id ?? ''} onChange={e => {
                const agency = agencies.find(a => a.id === e.target.value) ?? null
                setSelectedAgency(agency)
              }}>
                <option value="">Select agency...</option>
                {agencies.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL}>Staff Member *</label>
              <select style={INPUT} value={selectedStaff?.id ?? ''} onChange={e => {
                const staff = staffMembers.find(s => s.id === e.target.value) ?? null
                setSelectedStaff(staff)
              }} disabled={!selectedAgency || staffLoading}>
                <option value="">{staffLoading ? 'Loading...' : !selectedAgency ? 'Select agency first' : 'Select staff member...'}</option>
                {staffMembers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Client Info */}
          <div style={SECTION}>Client Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>First Name *</label>
              <input style={INPUT} value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" />
            </div>
            <div>
              <label style={LABEL}>Last Name *</label>
              <input style={INPUT} value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>Date of Birth *</label>
              <input style={INPUT} type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Cell Phone *</label>
              <input style={INPUT} value={form.phone} onChange={e => {
                let d = e.target.value.replace(/\D/g, '').slice(0, 10)
                if (d.length >= 7) e.target.value = `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
                else if (d.length >= 4) e.target.value = `(${d.slice(0,3)}) ${d.slice(3)}`
                else if (d.length > 0) e.target.value = `(${d}`
                set('phone', e.target.value)
              }} placeholder="(000) 000-0000" />
            </div>
            <div>
              <label style={LABEL}>Preferred Language</label>
              <select style={INPUT} value={form.language} onChange={e => set('language', e.target.value)}>
                <option>English</option>
                <option>Spanish</option>
                <option>Creole</option>
              </select>
            </div>
          </div>

          {/* Address */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Address</div>
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Street Address *</label>
            <input style={INPUT} value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main Street" />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Address Line 2</label>
            <input style={INPUT} value={form.address2} onChange={e => set('address2', e.target.value)} placeholder="Apt, Suite, Unit (optional)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>City *</label>
              <input style={INPUT} value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" />
            </div>
            <div>
              <label style={LABEL}>State *</label>
              <input style={INPUT} value={form.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Zip *</label>
              <input style={INPUT} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="07090" />
            </div>
          </div>

          {/* Household */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Household</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>Household Size *</label>
              <input style={INPUT} type="number" min="1" value={form.hhSize} onChange={e => set('hhSize', e.target.value)} placeholder="Total people in household" />
            </div>
            <div>
              <label style={LABEL}>Number of Children *</label>
              <input style={INPUT} type="number" min="0" value={form.children} onChange={e => set('children', e.target.value)} placeholder="Children under 18" />
            </div>
          </div>

          {/* Items */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Items Requested *</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
            {ITEMS.map(item => (
              <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${form.items.includes(item) ? '#2A7F6F' : '#EDE9E1'}`, background: form.items.includes(item) ? '#EAF4F2' : 'white', transition: 'all 0.15s' }}>
                <input type="checkbox" checked={form.items.includes(item)} onChange={() => toggleItem(item)} style={{ display: 'none' }} />
                <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${form.items.includes(item) ? '#2A7F6F' : '#EDE9E1'}`, background: form.items.includes(item) ? '#2A7F6F' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                  {form.items.includes(item) && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: form.items.includes(item) ? 600 : 400 }}>{item}</span>
              </label>
            ))}
          </div>

          {/* Notes */}
          <div style={{ ...SECTION, marginTop: '8px' }}>Additional Notes</div>
          <textarea
            style={{ ...INPUT, height: '90px', resize: 'vertical', marginBottom: '28px' }}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Any special circumstances or additional information..."
          />

          {error && (
            <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#C0392B' }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading}
            style={{ width: '100%', padding: '14px', borderRadius: '8px', border: 'none', background: loading ? '#7A8899' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.02em' }}>
            {loading ? 'Submitting...' : 'Submit Referral'}
          </button>

        </div>
      </div>
    </div>
  )
}
