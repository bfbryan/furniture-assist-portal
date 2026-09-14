// app/(agency)/help/page.tsx
// Agency Help page — approved copy from agency-faq-copy.md (Aug 2026).
//
// Four sections. Three are accordions (HelpAccordion, collapsed by default,
// nothing auto-opens). "What to tell your client" is not an accordion — it
// renders open, one icon per point, content shared with the Dashboard card
// via lib/content/client-guidelines.tsx.
//
// Text below is Ben's approved copy verbatim, with two normalizations only:
//   1. Bold spans ("**word**" in the source markdown) became <strong>.
//   2. The source file's em dashes and apostrophes came through as mangled
//      "â" bytes (a mojibake artifact, not real content) — restored to
//      plain — and ' here. No word was added, removed, or reordered.
//
// Ben's correction (branch writeup, Sept 2026): the approved copy originally
// read "Request reschedule" in "How do I cancel or move an appointment?" —
// that button doesn't exist; the UI reads "Reschedule". Fixed here, in the
// copy, not the UI. The next sentence ("A reschedule is a request, not a
// change") is unchanged — that's the point the wrong label was reaching for.

import HelpAccordion, { type HelpItem } from '@/components/agency/HelpAccordion'
import { CLIENT_GUIDELINES, CLIENT_GUIDELINES_INTRO } from '@/lib/content/client-guidelines'
import { AGENCY_CONTACT_EMAIL } from '@/lib/contact'

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
  padding: '20px 20px 22px',
}

const B: React.CSSProperties = { fontWeight: 700 }

function MailLink() {
  return (
    <a href={`mailto:${AGENCY_CONTACT_EMAIL}`} style={{ color: '#2A7F6F', fontWeight: 700, textDecoration: 'none' }}>
      {AGENCY_CONTACT_EMAIL}
    </a>
  )
}

const GETTING_STARTED: HelpItem[] = [
  {
    id: 'confirm-team',
    question: 'Why do I have to confirm my team before I see anything?',
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          Your team list came from referrals we&apos;ve received over the years, so it may
          include people who&apos;ve moved on or who work at another office. Referrals only
          appear once you&apos;ve confirmed the person who submitted them.
        </p>
        <p style={{ margin: 0 }}>Confirming is how you tell us who genuinely works at your office.</p>
      </>
    ),
  },
  {
    id: 'confirm-vs-invite',
    question: "What's the difference between confirming someone and inviting them?",
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          Confirming says a person works at your office. That makes their referrals visible
          to you. Inviting sends them a sign-in link so they can use the portal themselves.
        </p>
        <p style={{ margin: 0 }}>
          Most of the time you&apos;ll want both, which is why <span style={B}>Confirm &amp; Invite</span> is one action.
        </p>
      </>
    ),
  },
  {
    id: 'not-on-list',
    question: "Someone at my office isn't on the list",
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          Use <span style={B}>Add Staff Member</span> on the Team page. That creates their
          record and sends them a sign-in link in one step.
        </p>
        <p style={{ margin: 0 }}>
          Check the list first — people already in our records are there under the name we
          have for them, which may not be the one you&apos;d expect.
        </p>
      </>
    ),
  },
  {
    id: 'left-or-never-here',
    question: 'Someone on my list has left, or was never here',
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>Two different answers, and the difference matters.</p>
        <p style={{ margin: '0 0 10px' }}>
          If they worked at your office and have since left, choose{' '}
          <span style={B}>Worked here, has left</span>. Their past referrals stay visible to
          you — your office keeps its own client history — and their portal access is
          removed.
        </p>
        <p style={{ margin: 0 }}>
          If they never worked at your office, choose <span style={B}>Not at this office</span>.
          That hides their referrals from your view, because they aren&apos;t yours.
          We&apos;ll correct our records. You can undo it by confirming them again.
        </p>
      </>
    ),
  },
]

const REFERRALS_AND_APPOINTMENTS: HelpItem[] = [
  {
    id: 'submit-referral',
    question: 'How do I submit a referral?',
    answer: (
      <p style={{ margin: 0 }}>
        For now, keep sending referrals the way you do today. Submitting through the portal
        is coming, and we&apos;ll tell you when your office can use it.
      </p>
    ),
  },
  {
    id: 'when-pickups',
    question: 'When are pickups?',
    answer: (
      <p style={{ margin: 0 }}>
        Saturdays, between 9am and 1pm. Your client is given a specific time slot, not a
        window. Arriving at the right hour matters — the warehouse works through
        appointments in order.
      </p>
    ),
  },
  {
    id: 'cancel-or-move',
    question: 'How do I cancel or move an appointment?',
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          Open the referral and use <span style={B}>Cancel</span> or{' '}
          <span style={B}>Reschedule</span>.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          A reschedule is a request, not a change. The current appointment stands until
          Furniture Assist confirms the new one by email.
        </p>
        <p style={{ margin: 0 }}>
          You can&apos;t file a second reschedule request while one is already pending. If
          you need to change what you asked for, email us.
        </p>
      </>
    ),
  },
  {
    id: 'buttons-disappeared',
    question: 'Why have the Cancel and Reschedule buttons disappeared?',
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          If your client&apos;s appointment date has passed and we haven&apos;t recorded
          what happened yet, both actions are held until we do. Outcomes are recorded the
          Tuesday after each Saturday. The referral will show as{' '}
          <span style={B}>Awaiting outcome</span> until then.
        </p>
        <p style={{ margin: 0 }}>
          If it needs to change during that window, email <MailLink /> and we&apos;ll sort
          it out.
        </p>
      </>
    ),
  },
  {
    id: 'missed-appointment',
    question: 'What happens if my client misses their appointment?',
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          You can rebook them yourself for up to 25 days after the missed appointment. Open
          the referral and use <span style={B}>Reschedule</span> — the deadline date is
          shown on the page.
        </p>
        <p style={{ margin: 0 }}>
          After 25 days, submit a new referral instead. The old one stays in your history as
          a missed appointment.
        </p>
      </>
    ),
  },
  {
    id: 'withdraw',
    question: "Can I withdraw a referral I've already submitted?",
    answer: (
      <p style={{ margin: 0 }}>
        Yes, before we&apos;ve approved it. Once a referral has been approved and an
        appointment is being arranged, use <span style={B}>Cancel</span> instead.
      </p>
    ),
  },
]

const ACCESS_AND_ACCOUNTS: HelpItem[] = [
  {
    id: 'who-sees-what',
    question: 'Who can see which referrals?',
    answer: (
      <p style={{ margin: 0 }}>
        Staff see the referrals they submitted. Admins see everything from their office,
        from every person they&apos;ve confirmed. Nobody can see another agency&apos;s
        clients.
      </p>
    ),
  },
  {
    id: 'sign-in-link',
    question: "My sign-in link doesn't work",
    answer: (
      <>
        <p style={{ margin: '0 0 10px' }}>
          Sign-in links are good for 30 days. If yours has expired, your office&apos;s admin
          can send a new one from the Team page. If you&apos;re the admin, email{' '}
          <MailLink />.
        </p>
        <p style={{ margin: 0 }}>
          Links are tied to your email address, so one sent to a colleague won&apos;t sign
          you in.
        </p>
      </>
    ),
  },
  {
    id: 'admin-left',
    question: 'Our admin has left — how do we change who it is?',
    answer: (
      <p style={{ margin: 0 }}>
        Email <MailLink /> and tell us who it should be. We&apos;ll move it over and
        nothing is lost.
      </p>
    ),
  },
  {
    id: 'agency-details-wrong',
    question: 'Our agency details are wrong',
    answer: (
      <p style={{ margin: 0 }}>
        Your admin can update your office&apos;s details on the Profile page. If the agency
        name itself is wrong, or you think we have two records for the same office, email
        us — those need sorting on our side.
      </p>
    ),
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#F7F5F1]">
      <main className="max-w-4xl mx-auto px-8 py-9" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={CARD}>
          <h1 style={{ fontFamily: 'var(--font-montserrat)', fontSize: '20px', fontWeight: 700, color: '#1B2B4B', margin: '0 0 8px' }}>
            Help
          </h1>
          <p style={{ fontSize: '13.5px', color: '#2C3A4A', lineHeight: 1.6, margin: '0 0 4px' }}>
            How the portal works, and what to tell your clients before pickup day.
          </p>
          <p style={{ fontSize: '13.5px', color: '#7A8899', lineHeight: 1.6, margin: 0 }}>
            Can&apos;t find an answer? Email <MailLink />.
          </p>
        </section>

        <HelpAccordion title="Getting started" items={GETTING_STARTED} />
        <HelpAccordion title="Referrals and appointments" items={REFERRALS_AND_APPOINTMENTS} />

        {/* Not an accordion — always open. These three are the ones that most
            often go wrong on pickup day. */}
        <section>
          <h2 style={{ fontFamily: 'var(--font-montserrat)', fontSize: '15px', fontWeight: 600, color: '#1B2B4B', margin: '0 0 10px' }}>
            What to tell your client
          </h2>
          <div style={CARD}>
            <p style={{ fontSize: '13px', color: '#7A8899', lineHeight: 1.6, margin: '0 0 18px' }}>
              {CLIENT_GUIDELINES_INTRO}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {CLIENT_GUIDELINES.map((point, i) => (
                <div
                  key={point.key}
                  style={{
                    display: 'flex',
                    gap: '14px',
                    paddingTop: i === 0 ? 0 : '18px',
                    borderTop: i === 0 ? 'none' : '1px solid #EDE9E1',
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: 'rgba(42,127,111,0.08)',
                      color: '#2A7F6F',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <point.icon />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13.5px', color: '#1B2B4B', margin: '0 0 6px' }}>
                      {point.heading}
                    </h3>
                    <div style={{ fontSize: '13px', color: '#2C3A4A', lineHeight: 1.6 }}>{point.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <HelpAccordion title="Access and accounts" items={ACCESS_AND_ACCOUNTS} />
      </main>
    </div>
  )
}
