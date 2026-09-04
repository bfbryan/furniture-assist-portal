'use client'

// components/agency/NewReferralForm.tsx
//
// Agency New Referral form. One column, six sections, sits on the Pass A
// contracts:
//
//   • POST /api/agency/referrals/check-duplicate — debounced pre-submit check
//     once first name / last name / DOB are all filled. Returns ONE outcome,
//     privacy already applied server-side. Rendered by ReferralConflictNotice.
//   • SaturdayCapacityGrid, agency config — binary Open/Full, hard cap, 14-day
//     lead, /api/agency/schedule. No flexible option; the escape hatch is a
//     mailto, not a hidden code path.
//   • POST /api/referrals/submit — a preferred slot on a normal submission, or
//     `rescheduleReferralId` + edited details on a convert (no-show pick-up,
//     active → new date, reschedule-in-flight). The form's values win.
//
// Not linked from the nav. Reached by URL only until agencies are onboarded.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FIELD_BORDER_STYLE } from '@/lib/ui/field-border'
import { formatDateOnly } from '@/lib/dates'
import SaturdayCapacityGrid, { type SlotSelection } from '@/components/internal/SaturdayCapacityGrid'
import ReferralConflictNotice, {
  AGENCY_CONTACT_EMAIL,
  type CheckDuplicateResult,
  type ConvertPrefill,
} from '@/components/agency/ReferralConflictNotice'

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
const OPTIONAL: React.CSSProperties = { color: '#7A8899', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: '7px',
  border: FIELD_BORDER_STYLE, fontSize: '14px', color: '#2C3A4A',
  background: 'white', outline: 'none',
}

const SECTION: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px',
  color: '#2A7F6F', textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: '16px', marginTop: '32px',
}

const BLANK = {
  firstName: '', lastName: '', dob: '', phone: '', language: 'English',
  address: '', address2: '', city: '', state: 'NJ', zip: '',
  hhSize: '', children: '',
  items: [] as string[],
  notes: '',
  slot: null as SlotSelection | null,
}

export default function NewReferralForm({ agencyName, staffName }: { agencyName: string; staffName: string }) {
  const router = useRouter()
  const [form, setForm] = useState({ ...BLANK })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<null | 'created' | 'converted'>(null)

  // Pre-submit duplicate check.
  const [conflict, setConflict] = useState<CheckDuplicateResult | null>(null)
  const [checkedKey, setCheckedKey] = useState('')
  // "Request a new date" is stored against the identity it was clicked for, so
  // it clears itself the moment the name or DOB changes — no effect-body reset.
  const [armedKey, setArmedKey] = useState('')

  const set = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const toggleItem = (item: string) =>
    setForm(prev => ({
      ...prev,
      items: prev.items.includes(item) ? prev.items.filter(i => i !== item) : [...prev.items, item],
    }))

  // Fill each field from the on-file referral only when the agency hasn't
  // already typed something there (state/language count as untyped at their
  // defaults). They then change only what's different.
  const applyPrefill = useCallback((p: ConvertPrefill) => {
    setForm(prev => ({
      ...prev,
      address: prev.address || p.address,
      address2: prev.address2 || p.address2,
      city: prev.city || p.city,
      state: prev.state === 'NJ' ? (p.state || 'NJ') : prev.state,
      zip: prev.zip || p.zip,
      phone: prev.phone || p.phone,
      language: prev.language === 'English' ? (p.language || 'English') : prev.language,
      hhSize: prev.hhSize || p.hhSize,
      children: prev.children || p.children,
      items: prev.items.length ? prev.items : p.items,
    }))
  }, [])

  const identityKey = `${form.firstName.trim().toLowerCase()}|${form.lastName.trim().toLowerCase()}|${form.dob}`
  const identityComplete = !!(form.firstName.trim() && form.lastName.trim() && form.dob)

  useEffect(() => {
    if (!identityComplete) return
    if (identityKey === checkedKey) return

    let cancelled = false
    const timer = setTimeout(() => {
      fetch('/api/agency/referrals/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dob: form.dob,
        }),
      })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: CheckDuplicateResult) => {
          if (cancelled) return
          setConflict(data)
          setCheckedKey(identityKey)
          // Convert paths reschedule an existing referral of this client's —
          // its details are already on file, so fill what the agency hasn't
          // typed and let them change only what's different. blocked-active/
          // same prefills on the "Request a new date" click instead (onArm).
          if (data.outcome === 'convert-noshow' || data.outcome === 'convert-inflight') {
            applyPrefill(data.prefill)
          }
        })
        .catch(() => {
          // Fail open on the NOTICE only — the submit route still enforces DNS
          // and the active/convert rules server-side, so a check that couldn't
          // run can't wave a blocked referral through.
          if (!cancelled) {
            setConflict(null)
            setCheckedKey(identityKey)
          }
        })
    }, 600)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [identityComplete, identityKey, checkedKey, form.firstName, form.lastName, form.dob, applyPrefill])

  // Only show a conflict that matches the identity currently typed in.
  const activeConflict = identityComplete && checkedKey === identityKey ? conflict : null
  const armed = armedKey === identityKey

  const { hardBlocked, convertReferralId } = useMemo(() => {
    if (!activeConflict) return { hardBlocked: false, convertReferralId: null as string | null }
    switch (activeConflict.outcome) {
      case 'dns':
        return { hardBlocked: true, convertReferralId: null }
      case 'blocked-active':
        return activeConflict.scope === 'cross'
          ? { hardBlocked: true, convertReferralId: null }
          : armed
            ? { hardBlocked: false, convertReferralId: activeConflict.referralId }
            : { hardBlocked: true, convertReferralId: null }
      case 'convert-noshow':
      case 'convert-inflight':
        return { hardBlocked: false, convertReferralId: activeConflict.referralId }
      default:
        return { hardBlocked: false, convertReferralId: null }
    }
  }, [activeConflict, armed])

  const isConvert = !!convertReferralId

  const slotEcho = form.slot
    ? `Requesting ${formatDateOnly(form.slot.date, { month: 'short', day: 'numeric' })} · ${form.slot.time}`
    : null

  async function handleSubmit() {
    setError(null)

    // firstName / lastName / dob are always present here — the duplicate check
    // needs them, and isConvert can only be true once it has run.
    const required: (keyof typeof form)[] =
      ['firstName', 'lastName', 'dob', 'phone', 'address', 'city', 'state', 'zip', 'hhSize', 'children']
    for (const f of required) {
      if (!form[f]) { setError('Please fill in all required fields.'); return }
    }
    if (form.items.length === 0) { setError('Please add at least one item.'); return }
    if (!form.slot) { setError('Please choose a Saturday for the appointment.'); return }
    if (hardBlocked) return

    const payload: Record<string, unknown> = isConvert
      ? {
          rescheduleReferralId: convertReferralId,
          preferredDate: form.slot.date,
          preferredTime: form.slot.time,
          address: form.address, address2: form.address2, city: form.city, state: form.state, zip: form.zip,
          phone: form.phone, language: form.language,
          hhSize: form.hhSize, children: form.children, items: form.items, notes: form.notes,
        }
      : {
          firstName: form.firstName, lastName: form.lastName, dob: form.dob,
          phone: form.phone, language: form.language,
          address: form.address, address2: form.address2, city: form.city, state: form.state, zip: form.zip,
          hhSize: form.hhSize, children: form.children, items: form.items, notes: form.notes,
          preferredDate: form.slot.date, preferredTime: form.slot.time,
        }

    setLoading(true)
    try {
      const res = await fetch('/api/referrals/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      setSubmitted(data.converted ? 'converted' : 'created')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    const converted = submitted === 'converted'
    return (
      <div className="bg-white rounded-xl shadow-sm p-9 text-center">
        <div style={{ width: '56px', height: '56px', background: '#EAF4F2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', marginBottom: '10px' }}>
          {converted ? 'Reschedule requested' : 'Referral submitted'}
        </h2>
        <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '28px', maxWidth: '420px', marginInline: 'auto' }}>
          {converted
            ? 'Your scheduler will confirm the new date, usually within a few days.'
            : `The referral for ${form.firstName} ${form.lastName} is with our scheduler.`}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setForm({ ...BLANK }); setConflict(null); setCheckedKey(''); setArmedKey(''); setError(null); setSubmitted(null) }}
            style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Submit another
          </button>
          <button
            onClick={() => router.push('/referrals/active')}
            style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            View active referrals
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-8">
      <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#7A8899' }}>
        Submitting as <strong style={{ color: '#1B2B4B' }}>{staffName}</strong> · {agencyName}
      </div>
      <p style={{ fontSize: '12.5px', color: '#7A8899', marginBottom: '4px' }}>All fields required unless noted.</p>

      {/* Client */}
      <div style={{ ...SECTION, marginTop: '16px' }}>Client</div>
      <div className="fa-form-two-col" style={{ display: 'grid', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={LABEL}>First name</label>
          <input style={INPUT} value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" />
        </div>
        <div>
          <label style={LABEL}>Last name</label>
          <input style={INPUT} value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" />
        </div>
      </div>
      <div className="fa-form-three-col" style={{ display: 'grid', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={LABEL}>Date of birth</label>
          <input style={INPUT} type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
        </div>
        <div>
          <label style={LABEL}>Cell phone</label>
          <input
            style={INPUT}
            value={form.phone}
            onChange={e => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 10)
              let v = d
              if (d.length >= 7) v = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
              else if (d.length >= 4) v = `(${d.slice(0, 3)}) ${d.slice(3)}`
              else if (d.length > 0) v = `(${d}`
              set('phone', v)
            }}
            placeholder="(000) 000-0000"
          />
        </div>
        <div>
          <label style={LABEL}>Preferred language</label>
          <select style={INPUT} value={form.language} onChange={e => set('language', e.target.value)}>
            <option>English</option>
            <option>Spanish</option>
            <option>Creole</option>
          </select>
        </div>
      </div>

      <ReferralConflictNotice
        result={activeConflict}
        armed={armed}
        onArm={() => {
          setArmedKey(identityKey)
          if (activeConflict?.outcome === 'blocked-active' && activeConflict.scope === 'same') {
            applyPrefill(activeConflict.prefill)
          }
        }}
        onDisarm={() => setArmedKey('')}
      />

      {/* Address */}
      <div style={SECTION}>Address</div>
      <div style={{ marginBottom: '16px' }}>
        <label style={LABEL}>Street address</label>
        <input style={INPUT} value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main Street" />
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label style={LABEL}>Address line 2 <span style={OPTIONAL}>(optional)</span></label>
        <input style={INPUT} value={form.address2} onChange={e => set('address2', e.target.value)} placeholder="Apt, suite, unit" />
      </div>
      <div className="fa-form-three-col" style={{ display: 'grid', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={LABEL}>City</label>
          <input style={INPUT} value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" />
        </div>
        <div>
          <label style={LABEL}>State</label>
          <input style={INPUT} value={form.state} onChange={e => set('state', e.target.value)} />
        </div>
        <div>
          <label style={LABEL}>Zip</label>
          <input style={INPUT} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="07090" />
        </div>
      </div>

      {/* Household */}
      <div style={SECTION}>Household</div>
      <div className="fa-form-two-col" style={{ display: 'grid', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={LABEL}>Household size</label>
          <input style={INPUT} type="number" min="1" value={form.hhSize} onChange={e => set('hhSize', e.target.value)} placeholder="Total people in household" />
        </div>
        <div>
          <label style={LABEL}>Number of children</label>
          <input style={INPUT} type="number" min="0" value={form.children} onChange={e => set('children', e.target.value)} placeholder="Children under 18" />
        </div>
      </div>

      {/* Items requested. Chips over six checkbox rows (~100px shorter on a
          form that already scrolls). Each carries a checkbox square so the
          unselected state reads as a toggle, not a tag — a circle would imply
          single-select, and a bare pill still reads as a label to some people.
          Cool-grey border at rest: the field border is a warm tone that can
          read as "gold" here, which carries a status meaning in the palette. */}
      <div style={SECTION}>Items requested</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
        {ITEMS.map(item => {
          const on = form.items.includes(item)
          return (
            <button
              key={item}
              type="button"
              aria-pressed={on}
              onClick={() => toggleItem(item)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '7px 14px 7px 10px', borderRadius: '999px', cursor: 'pointer',
                fontFamily: 'var(--font-montserrat)', fontSize: '13px', fontWeight: on ? 700 : 500,
                border: `1px solid ${on ? '#2A7F6F' : '#C7CED6'}`,
                background: on ? '#2A7F6F' : 'white',
                color: on ? 'white' : '#2C3A4A',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '15px', height: '15px', borderRadius: '4px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid ${on ? 'rgba(255,255,255,0.9)' : '#C7CED6'}`,
                  background: on ? 'rgba(255,255,255,0.16)' : 'white',
                }}
              >
                {on && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              {item}
            </button>
          )
        })}
      </div>

      {/* Appointment */}
      <div style={SECTION}>Appointment</div>
      <SaturdayCapacityGrid
        mode="select"
        capacityDisplay="binary"
        enforceCap
        leadDays={14}
        weeks={4}
        showSoft={false}
        endpoint="/api/agency/schedule"
        value={form.slot}
        onChange={s => set('slot', s)}
      />
      <p style={{ fontSize: '12.5px', color: '#7A8899', marginTop: '12px', lineHeight: 1.6 }}>
        Can&rsquo;t find a date that works? Email us at{' '}
        <a href={`mailto:${AGENCY_CONTACT_EMAIL}`} style={{ color: '#2A7F6F', fontWeight: 700 }}>{AGENCY_CONTACT_EMAIL}</a>{' '}
        and we&rsquo;ll find one with you.
      </p>

      {/* Notes */}
      <div style={SECTION}>Notes <span style={OPTIONAL}>(optional)</span></div>
      <textarea
        style={{ ...INPUT, height: '90px', resize: 'vertical' }}
        value={form.notes}
        onChange={e => set('notes', e.target.value)}
        placeholder="Anything else we should know"
      />

      {error && (
        <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '12px 16px', marginTop: '20px', fontSize: '13px', color: '#C0392B' }}>
          {error}
        </div>
      )}

      {slotEcho && (
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', color: '#1B2B4B', marginTop: '24px' }}>
          {slotEcho}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || hardBlocked}
        style={{
          width: '100%', padding: '14px', borderRadius: '8px', border: 'none', marginTop: '12px',
          background: loading || hardBlocked ? '#B8C1CC' : '#2A7F6F',
          color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '14px',
          letterSpacing: '0.02em', cursor: loading || hardBlocked ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Submitting…' : isConvert ? 'Request the new date' : 'Submit referral'}
      </button>
    </div>
  )
}
