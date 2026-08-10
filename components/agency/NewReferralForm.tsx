'use client'

import { useState } from 'react'
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

export default function NewReferralForm({ agencyName, staffName }: { agencyName: string; staffName: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const res = await fetch('/api/referrals/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
      <div className="bg-white rounded-xl shadow-sm p-9 text-center">
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
            ⚠️ This client may already be in our system. Our team will review before processing.
          </div>
        )}
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '28px' }}>
          Thank you. The referral for {form.firstName} {form.lastName} has been submitted and will be reviewed by our team.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button onClick={() => { setSubmitted(false); setForm({ firstName: '', lastName: '', address: '', address2: '', city: '', state: 'NJ', zip: '', phone: '', hhSize: '', children: '', dob: '', language: 'English', items: [], notes: '' }) }}
            style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Submit Another
          </button>
          <button onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            Back to Portal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-8">

      {/* Submitting as */}
      <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '12px 16px', marginBottom: '28px', fontSize: '13px', color: '#7A8899' }}>
        Submitting as <strong style={{ color: '#1B2B4B' }}>{staffName}</strong> · {agencyName}
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
          <label style={LABEL}>Preferred Language *</label>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 160px', gap: '16px', marginBottom: '16px' }}>
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

      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{ width: '100%', padding: '14px', borderRadius: '8px', border: 'none', background: loading ? '#7A8899' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.02em' }}>
        {loading ? 'Submitting...' : 'Submit Referral'}
      </button>

    </div>
  )
}
