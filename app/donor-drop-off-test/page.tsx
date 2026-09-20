'use client'

// app/donor-drop-off-test/page.tsx
//
// A TEST HARNESS for POST /api/donations/drop-off — not the real form.
// The real form lives on WordPress (furnitureassist.com/drop-off-form/)
// and won't post here until Ben switches it over. This page exists so
// the route can be exercised end to end, through a browser, against the
// LIVE donor base, before that switch happens.
//
// This is deliberate: a submission through this page writes a real
// Pending In Kind Donations record, which means the real automations
// fire — the match-or-create against Donors, the Zip/county lookup, and
// the QR code + confirmation email send to whatever address is entered.
// That's the point (see the PR description) — a route that only "looks"
// right in isolation isn't verified; a route whose write triggers the
// exact same downstream behaviour as a Zap-written row is. Submit with
// an address you control, not a placeholder.
//
// Not linked from anywhere in the app's own navigation. Reachable only
// by URL, and allowlisted as public in proxy.ts the same way
// /api/donations/drop-off itself is — no Clerk session gates either one.
//
// The one thing this page is actually testing, beyond the write itself:
// the success screen only ever shows after the route returns 2xx. The
// bug this migration fixes is the old JotForm/Zapier path showing
// success unconditionally, whether or not the Zap run actually
// succeeded — so a failed submission here has to visibly fail, not
// silently render the same "thank you" a real success would.

import { useState } from 'react'
import { DROP_OFF_CATALOG } from '@/lib/donors/drop-off-catalog'
import { FIELD_BORDER_STYLE } from '@/lib/ui/field-border'

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const GOLD = '#C9A84C'
const RED = '#C0392B'
const GREY = '#7A8899'
const CREAM = '#F7F5F1'

type Quantities = Record<string, number>

type Result =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; id: string; overCap: boolean }
  | { kind: 'error'; message: string }

export default function DropOffTestPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [cellNumber, setCellNumber] = useState('')
  const [streetAddress, setStreetAddress] = useState('')
  const [streetAddress2, setStreetAddress2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [formDate, setFormDate] = useState('')
  const [notes, setNotes] = useState('')
  const [quantities, setQuantities] = useState<Quantities>({})
  const [hp, setHp] = useState('') // honeypot — a real visitor never sees or fills this
  const [result, setResult] = useState<Result>({ kind: 'idle' })

  function setQty(key: string, value: string) {
    const n = Number(value)
    setQuantities(prev => {
      const next = { ...prev }
      if (n > 0) next[key] = n
      else delete next[key]
      return next
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult({ kind: 'submitting' })
    try {
      const res = await fetch('/api/donations/drop-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, lastName, email, cellNumber, streetAddress, streetAddress2,
          city, state, zip, formDate, notes, items: quantities, hp,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setResult({ kind: 'success', id: data.id, overCap: !!data.overCap })
      } else {
        setResult({ kind: 'error', message: data.error || `Request failed (${res.status}).` })
      }
    } catch {
      setResult({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' })
    }
  }

  if (result.kind === 'success') {
    return (
      <Banner bg={TEAL}>
        <div style={{ fontSize: '28px', fontWeight: 800, color: 'white' }}>Donation recorded</div>
        <div style={{ marginTop: '10px', fontSize: '16px', color: 'rgba(255,255,255,0.85)' }}>
          Record id: {result.id}
        </div>
        {result.overCap && (
          <div style={{ marginTop: '10px', fontSize: '15px', color: GOLD, fontWeight: 700 }}>
            One or more items were over the advisory cap — flagged in Notes on the record.
          </div>
        )}
        <div style={{ marginTop: '24px', fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
          This is a test harness — this record is real and live in the donor base.
        </div>
        <button onClick={() => location.reload()} style={buttonStyle(CREAM, NAVY)}>Submit another</button>
      </Banner>
    )
  }

  if (result.kind === 'error') {
    return (
      <Banner bg={RED}>
        <div style={{ fontSize: '26px', fontWeight: 800, color: 'white' }}>Submission failed</div>
        <div style={{ marginTop: '10px', fontSize: '16px', color: 'rgba(255,255,255,0.9)' }}>{result.message}</div>
        <div style={{ marginTop: '24px', fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
          Nothing was written — a failed request here never shows success.
        </div>
        <button onClick={() => setResult({ kind: 'idle' })} style={buttonStyle(CREAM, NAVY)}>Back to form</button>
      </Banner>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: CREAM, fontFamily: 'var(--font-montserrat), Arial, sans-serif' }}>
      <div style={{ background: NAVY, borderBottom: `4px solid ${TEAL}`, padding: '20px 24px' }}>
        <div style={{ color: 'white', fontWeight: 800, fontSize: '18px' }}>Drop-Off Intake — Test Harness</div>
        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '13px', marginTop: '4px' }}>
          Not the real form. Writes live to the donor base — real QR email, possible new Donor row, six-week clock start.
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 24px' }}>
        <Section title="Donor">
          <Field label="First name *"><input required value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} /></Field>
          <Field label="Last name *"><input required value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} /></Field>
          <Field label="Email *"><input required type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} /></Field>
          <Field label="Cell number"><input value={cellNumber} onChange={e => setCellNumber(e.target.value)} style={inputStyle} /></Field>
          <Field label="Street address"><input value={streetAddress} onChange={e => setStreetAddress(e.target.value)} style={inputStyle} /></Field>
          <Field label="Street address 2"><input value={streetAddress2} onChange={e => setStreetAddress2(e.target.value)} style={inputStyle} /></Field>
          <Field label="City"><input value={city} onChange={e => setCity(e.target.value)} style={inputStyle} /></Field>
          <Field label="State"><input value={state} onChange={e => setState(e.target.value)} style={inputStyle} /></Field>
          <Field label="Zip"><input value={zip} onChange={e => setZip(e.target.value)} style={inputStyle} /></Field>
          <Field label="Donation date *"><input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} style={inputStyle} /></Field>
          <Field label="Notes (what you're donating)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' as const }} />
          </Field>
        </Section>

        {DROP_OFF_CATALOG.map(group => (
          <Section key={group.key} title={group.title}>
            {group.items.map(item => (
              <Field key={item.key} label={item.label}>
                <select
                  value={quantities[item.key] ?? 0}
                  onChange={e => setQty(item.key, e.target.value)}
                  style={inputStyle}
                >
                  {Array.from({ length: item.cap + 1 }, (_, n) => n).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {/* Above-cap options — the dropdown is a courtesy, not
                      the enforcement; the route accepts and flags an
                      over-cap value regardless of what this select
                      offers, which is why this list goes a few past the
                      cap rather than hard-stopping there. */}
                  {[item.cap + 1, item.cap + 2, item.cap + 3].map(n => (
                    <option key={n} value={n}>{n} (over cap of {item.cap})</option>
                  ))}
                </select>
              </Field>
            ))}
          </Section>
        ))}

        {/* Honeypot — off-screen, never shown to a real visitor. A filled
            value here makes the route report success without writing
            anything, same as agency/register's own hp field. */}
        <input
          type="text"
          value={hp}
          onChange={e => setHp(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
        />

        <button
          type="submit"
          disabled={result.kind === 'submitting'}
          style={{
            marginTop: '24px', padding: '16px 32px', borderRadius: '10px', border: 'none',
            background: TEAL, color: 'white', fontWeight: 800, fontSize: '17px',
            cursor: result.kind === 'submitting' ? 'default' : 'pointer',
            opacity: result.kind === 'submitting' ? 0.7 : 1,
          }}
        >
          {result.kind === 'submitting' ? 'Submitting…' : 'Submit donation'}
        </button>
      </form>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(27,43,75,0.08)' }}>
      <div style={{ fontSize: '15px', fontWeight: 800, color: NAVY, marginBottom: '14px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: GREY, fontWeight: 700 }}>
      {label}
      {children}
    </label>
  )
}

function Banner({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px', fontFamily: 'var(--font-montserrat), Arial, sans-serif' }}>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: '7px',
  border: FIELD_BORDER_STYLE, fontSize: '14px', color: '#2C3A4A', background: 'white', outline: 'none',
}

function buttonStyle(bg: string, color: string): React.CSSProperties {
  return {
    marginTop: '24px', padding: '14px 28px', borderRadius: '10px', border: 'none',
    background: bg, color, fontWeight: 800, fontSize: '15px', cursor: 'pointer',
  }
}
