'use client'

// components/agency/ReferralConflictNotice.tsx
//
// The one banner the agency New Referral form shows when the pre-submit
// duplicate check (POST /api/agency/referrals/check-duplicate) comes back with
// anything other than `proceed`. Inline, above the Address section — the same
// place Dawson's DuplicateClientModal sits, but a much smaller thing: the
// agency never sees history, never sees another agency's name, and has at most
// one action.
//
// The privacy rule is already applied server-side (the endpoint emits only the
// fields an outcome needs — a cross-agency conflict is `{ scope: 'cross' }` and
// nothing else). This component only renders what it is given, and every string
// below is sayable without naming or implying another organisation.

import { formatDateOnly } from '@/lib/dates'

export const AGENCY_CONTACT_EMAIL = 'agencies@furnitureassist.com'

// Mirrors CheckDuplicateResult in app/api/agency/referrals/check-duplicate.
// Re-declared (not imported) so this 'use client' file doesn't pull a route
// module — same reason DuplicateClientModal re-declares its wire types.
export type ConvertPrefill = {
  address: string
  address2: string
  city: string
  state: string
  zip: string
  phone: string
  language: string
  hhSize: string
  children: string
  items: string[]
}

export type CheckDuplicateResult =
  | { outcome: 'proceed' }
  | { outcome: 'dns' }
  | { outcome: 'blocked-active'; scope: 'same'; referralId: string; date: string | null; time: string | null; prefill: ConvertPrefill }
  | { outcome: 'blocked-active'; scope: 'cross' }
  | { outcome: 'convert-noshow'; referralId: string; prefill: ConvertPrefill }
  | { outcome: 'convert-inflight'; referralId: string; prefill: ConvertPrefill }

type Props = {
  result: CheckDuplicateResult | null
  /** blocked-active/same: has the agency clicked "Request a new date"? */
  armed: boolean
  onArm: () => void
  onDisarm: () => void
}

const CARD: React.CSSProperties = {
  borderRadius: '10px',
  padding: '16px 18px',
  marginBottom: '22px',
  fontSize: '13px',
  lineHeight: 1.6,
}
const TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 800,
  fontSize: '13.5px',
  marginBottom: '5px',
}
const TONE = {
  red: { background: '#FDEDEC', border: '1px solid #E7B7B1', color: '#C0392B' },
  amber: { background: '#FEF9EC', border: '1px solid #C9A84C', color: '#8A6A00' },
  neutral: { background: '#F7F5F1', border: '1px solid #EDE9E1', color: '#2C3A4A' },
  teal: { background: '#EAF4F2', border: '1px solid #B9DDD5', color: '#2A7F6F' },
} as const

function MailLink({ color }: { color: string }) {
  return (
    <a href={`mailto:${AGENCY_CONTACT_EMAIL}`} style={{ color, fontWeight: 700, textDecoration: 'underline' }}>
      {AGENCY_CONTACT_EMAIL}
    </a>
  )
}

export default function ReferralConflictNotice({ result, armed, onArm, onDisarm }: Props) {
  if (!result || result.outcome === 'proceed') return null

  if (result.outcome === 'dns') {
    return (
      <div style={{ ...CARD, ...TONE.red }}>
        <div style={TITLE}>We can&rsquo;t accept this referral</div>
        Please contact us at <MailLink color={TONE.red.color} /> and we&rsquo;ll help.
      </div>
    )
  }

  if (result.outcome === 'blocked-active' && result.scope === 'cross') {
    return (
      <div style={{ ...CARD, ...TONE.neutral }}>
        <div style={{ ...TITLE, color: '#1B2B4B' }}>This client already has an appointment scheduled</div>
        We can&rsquo;t take a second referral for them right now. If you think that&rsquo;s a mistake,
        contact us at <MailLink color="#2A7F6F" />.
      </div>
    )
  }

  if (result.outcome === 'blocked-active' && result.scope === 'same') {
    if (!armed) {
      const when = result.date
        ? `${formatDateOnly(result.date, { month: 'short', day: 'numeric', year: 'numeric' })}${result.time ? ` at ${result.time}` : ''}`
        : null
      return (
        <div style={{ ...CARD, ...TONE.amber }}>
          <div style={TITLE}>This client already has an appointment</div>
          {when
            ? <>It&rsquo;s scheduled for <strong>{when}</strong>. You can request a new date for it instead of creating a second referral.</>
            : <>You can request a new date for it instead of creating a second referral.</>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={onArm}
              style={{
                padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#2A7F6F',
                color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
              }}
            >
              Request a new date
            </button>
            <a
              href={`mailto:${AGENCY_CONTACT_EMAIL}`}
              style={{ fontSize: '12.5px', color: '#8A6A00', fontWeight: 600, textDecoration: 'underline' }}
            >
              That&rsquo;s not right — contact us
            </a>
          </div>
        </div>
      )
    }
    // armed → the form is now in convert mode; no longer a block.
    return (
      <div style={{ ...CARD, ...TONE.teal }}>
        <div style={{ ...TITLE, color: '#2A7F6F' }}>Requesting a new date</div>
        We&rsquo;ll update the existing appointment rather than create a second referral. Pick a
        Saturday below; anything you change on this form replaces what&rsquo;s on file.
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            onClick={onDisarm}
            style={{ background: 'none', border: 'none', padding: 0, color: '#2A7F6F', fontWeight: 700, fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (result.outcome === 'convert-noshow') {
    // "had", not "has": the appointment is in the past (missed). "has" would
    // clash with the blocked-active notice, where they genuinely still have one.
    return (
      <div style={{ ...CARD, ...TONE.teal }}>
        <div style={{ ...TITLE, color: '#2A7F6F' }}>This client had an appointment we can pick back up</div>
        We&rsquo;ll update the existing referral with your new date rather than create a second one.
        Anything you change on this form replaces what&rsquo;s on file.
      </div>
    )
  }

  // convert-inflight
  return (
    <div style={{ ...CARD, ...TONE.neutral }}>
      <div style={{ ...TITLE, color: '#1B2B4B' }}>A reschedule is already with our scheduler</div>
      We&rsquo;ll update that request to your new date and time instead of adding another.
    </div>
  )
}
