import { UserButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById, getReferralsByStaffName, getReferralsByAgencyId } from '@/lib/airtable'
import ReferralTable from '@/components/ReferralTable'
import { clerkClient } from '@clerk/nextjs/server'

export default async function DashboardPage() {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')

    if (orgId) {
  const client = await clerkClient()
  const org = await client.organizations.getOrganization({ organizationId: orgId })
  if (org.publicMetadata?.status === 'Inactive') {
    redirect('/inactive')
  }
}
  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) {
    return (
      <main className="p-8">
        <p className="text-red-600">
          Your account is not linked to an agency yet. Please contact Furniture Assist.
        </p>
      </main>
    )
  }

  const agency = await getAgencyById(agencyUser.agencyId!)

const referrals = agencyUser.role === 'Admin'
  ? await getReferralsByAgencyId(agency.name)
  : await getReferralsByStaffName(agency.name, agencyUser.name)

const scheduled = referrals.filter((r: any) => r.appointmentStatus === 'Scheduled').length
const pending = referrals.filter((r: any) => r.referralReview === 'Pending').length

  
  
  return (
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* Top nav bar */}
     <header className="bg-[#1B2B4B] h-16 flex items-center justify-between px-8 sticky top-0 z-50 shadow-lg">
  <a className="font-montserrat font-extrabold text-sm text-white tracking-wide flex items-center gap-2">
    Furniture Assist <span className="text-[#3AA08D]">| Agency Portal</span>
  </a>
  <div className="flex items-center gap-6">
    {agencyUser.role === 'Admin' && (
      <a href="/admin" style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>
        Team Management
      </a>
    )}
    <UserButton />
  </div>
</header>

  {/* Hero */}
<div className="bg-gradient-to-br from-[#1B2B4B] to-[#253F6A] border-b-4 border-[#2A7F6F] px-8 py-9">
  <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">

    {/* Left — Agency + Staff info blocks */}
    <div className="flex gap-10 flex-wrap">

      {/* Agency block */}
      <div>
        <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
          Agency Partner
        </span>
        <h1 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
          {agency.name}
        </h1>
        <p className="text-sm text-white/50 font-light">
          {agency.address}{agency.address2 ? `, ${agency.address2}` : ''}, {agency.city}, {agency.state} {agency.zip}
        </p>
        <p className="text-sm text-white/50 font-light">{agency.phone}</p>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', background: 'rgba(255,255,255,0.12)', alignSelf: 'stretch' }} />

      {/* Staff block */}
      <div>
        <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
          Logged In As
        </span>
        <h2 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
          {agencyUser.name}
        </h2>
        <p className="text-sm text-white/50 font-light">{agencyUser.phone ?? 'No phone on file'}</p>
        <p className="text-sm text-white/50 font-light">{agencyUser.role}</p>
      </div>

    </div>

    {/* Right — Stats + CTA */}
    <div className="flex items-center gap-4 flex-wrap">
      <div className="bg-white/8 border border-white/12 rounded-xl px-5 py-3 text-center min-w-[80px]">
        <div className="font-montserrat font-extrabold text-2xl text-white leading-none mb-1">
          {referrals.length}
        </div>
        <div className="text-xs font-bold uppercase tracking-wider text-white/45">Total</div>
      </div>
      <div className="bg-white/8 border border-[rgba(58,160,141,0.4)] rounded-xl px-5 py-3 text-center min-w-[80px]">
        <div className="font-montserrat font-extrabold text-2xl text-[#3AA08D] leading-none mb-1">
          {scheduled}
        </div>
        <div className="text-xs font-bold uppercase tracking-wider text-white/45">Scheduled</div>
      </div>
      <div className="bg-white/8 border border-white/12 rounded-xl px-5 py-3 text-center min-w-[80px]">
        <div className="font-montserrat font-extrabold text-2xl text-white leading-none mb-1">
          {pending}
        </div>
        <div className="text-xs font-bold uppercase tracking-wider text-white/45">Pending</div>
      </div>

      <a href="/referrals/new"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: '#2A7F6F',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          fontFamily: 'var(--font-montserrat)',
          fontWeight: 700,
          fontSize: '13px',
          textDecoration: 'none',
          boxShadow: '0 4px 14px rgba(42,127,111,0.35)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Referral
      </a>
    </div>

  </div>
</div>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-8 py-9">
        <ReferralTable referrals={referrals} 
        isAdmin={agencyUser.role === 'Admin'} />
      
      </main>
    </div>
  )
}