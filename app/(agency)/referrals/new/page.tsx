import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'
import NewReferralForm from '@/components/agency/NewReferralForm'

export default async function NewReferralPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/dashboard')

  const agency = await getAgencyById(agencyUser.agencyId!)

  return (
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* No hero: AgencyPortalShell's page bar already carries "New Referral"
          and the nav, and the old navy block put ~200px between it and the
          first field. */}

      {/* Content */}
      {/* Column tracks live in globals.css (.fa-new-referral-grid) so they can stack below 1280px. */}
      <div className="fa-new-referral-grid max-w-6xl mx-auto px-8 py-9 grid gap-7">

        {/* Form */}
        <NewReferralForm agencyName={agency.name} staffName={agencyUser.name} />

        {/* Sidebar */}
        <div className="flex flex-col gap-6">

          {/* Instructions */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Before You Submit
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                'Have the client\'s full address and contact information ready',
                'Confirm which furniture items are needed',
                'Client must be aware they will be contacted to schedule a pickup',
                'If your client cannot keep their appointment, notify us immediately',
              ].map((item, i) => (
                <li key={i} style={{ fontSize: '13px', color: '#2C3A4A', lineHeight: 1.6, paddingLeft: '16px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#2A7F6F', fontWeight: 700 }}>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* What happens next */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', marginBottom: '16px' }}>
              What Happens Next
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {[
                { num: 1, title: 'Submitted', desc: 'Your request goes to our scheduler.' },
                { num: 2, title: 'Confirmed', desc: "Usually within a few days, we'll confirm your slot or offer the nearest alternative." },
                { num: 3, title: 'Appointment slip', desc: 'Emailed to you to print and give your client.' },
                { num: 4, title: 'Pickup', desc: "You'll be notified once it's complete." },
              ].map((step, i, arr) => (
                <div key={i} style={{ display: 'flex', gap: '12px', paddingBottom: i < arr.length - 1 ? '16px' : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '26px', height: '26px', background: '#2A7F6F', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '11px', flexShrink: 0 }}>
                      {step.num}
                    </div>
                    {i < arr.length - 1 && <div style={{ width: '2px', background: '#EDE9E1', flex: 1, marginTop: '4px', minHeight: '16px' }} />}
                  </div>
                  <div style={{ paddingTop: '4px' }}>
                    <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', color: '#1B2B4B', marginBottom: '2px' }}>{step.title}</div>
                    <div style={{ fontSize: '12px', color: '#7A8899', lineHeight: 1.5 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}