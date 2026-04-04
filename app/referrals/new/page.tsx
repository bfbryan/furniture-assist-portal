import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'
import { UserButton } from '@clerk/nextjs'
import NewReferralForm from '@/components/NewReferralForm'

export default async function NewReferralPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/dashboard')

  const agency = await getAgencyById(agencyUser.agencyId!)

  return (
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* Nav */}
      <header className="bg-[#1B2B4B] h-16 flex items-center justify-between px-8 sticky top-0 z-50 shadow-lg">
        <span className="font-extrabold text-sm text-white tracking-wide">
          Furniture Assist <span className="text-[#3AA08D]">| Agency Portal</span>
        </span>
        <UserButton />
      </header>

      {/* Hero */}
      <div className="bg-[#1B2B4B] border-b-4 border-[#2A7F6F] px-8 py-9">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">
          <div>
            <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
              Agency Portal
            </span>
            <h1 className="font-extrabold text-2xl text-white tracking-tight mb-1">
              Submit a Client Referral
            </h1>
            <p className="text-sm text-white/50 font-light">
              {agency.name} &nbsp;·&nbsp; {agencyUser.name}
            </p>
          </div>
          <a href="/dashboard"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.65)', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to Portal
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-8 py-9 grid gap-7" style={{ gridTemplateColumns: '1fr 300px' }}>

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
                { num: 1, title: 'Referral Received', desc: 'Your referral is submitted and added to the review queue.' },
                { num: 2, title: 'Under Review', desc: 'Our team reviews within two weeks — we are an all-volunteer organization.' },
                { num: 3, title: 'Appointment Scheduled', desc: 'Once approved, your client is contacted to schedule their pickup.' },
                { num: 4, title: 'Pickup Complete', desc: 'Your client receives their furniture. You\'ll be notified when done.' },
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