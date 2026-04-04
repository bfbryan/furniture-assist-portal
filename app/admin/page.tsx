import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAgencyUserByClerkId, getAgencyById } from '@/lib/airtable'
import { UserButton } from '@clerk/nextjs'
import { clerkClient } from '@clerk/nextjs/server'
import StaffList from '@/components/StaffList'
import InviteStaffForm from '@/components/InviteStaffForm'

export default async function AdminPage() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) redirect('/sign-in')

  // Only org:admin can access this page
  if (orgRole !== 'org:admin') redirect('/dashboard')

  const agencyUser = await getAgencyUserByClerkId(userId)
  if (!agencyUser) redirect('/dashboard')

  const agency = await getAgencyById(agencyUser.agencyId!)

  // Fetch all org memberships from Clerk
  const client = await clerkClient()
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId!,
  })

  const members = await Promise.all(memberships.data.map(async (m) => {
  const user = await client.users.getUser(m.publicUserData?.userId ?? '')
  return {
    clerkUserId: m.publicUserData?.userId ?? '',
    firstName: m.publicUserData?.firstName ?? '',
    lastName: m.publicUserData?.lastName ?? '',
    email: m.publicUserData?.identifier ?? '',
    role: m.role,
    createdAt: m.createdAt,
    imageUrl: m.publicUserData?.imageUrl ?? '',
    lastSignInAt: user.lastSignInAt,
  }
}))

  return (
    <div className="min-h-screen bg-[#F7F5F1]">

      {/* Nav */}
      <header className="bg-[#1B2B4B] h-16 flex items-center justify-between px-8 sticky top-0 z-50 shadow-lg">
  <span className="font-montserrat font-extrabold text-sm text-white tracking-wide flex items-center gap-2">
    Furniture Assist <span className="text-[#3AA08D]">| Agency Portal</span>
  </span>
  <div className="flex items-center gap-6">
    <a href="/dashboard" style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>
      Back to Portal
    </a>
    <UserButton />
  </div>
</header>

      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1B2B4B] to-[#253F6A] border-b-4 border-[#2A7F6F] px-8 py-9">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">
          <div>
            <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
              Team Management
            </span>
            <h1 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
              {agency.name}
            </h1>
            <p className="text-sm text-white/50 font-light">
              Manage your agency&apos;s portal staff and access
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {/* Staff count stats */}
            <div className="bg-white/8 border border-white/12 rounded-xl px-5 py-3 text-center min-w-[80px]">
              <div className="font-montserrat font-extrabold text-2xl text-white leading-none mb-1">
                {members.filter(m => m.role === 'org:admin' || m.role === 'org:member').length}
              </div>
              <div className="text-xs font-bold uppercase tracking-wider text-white/45">Total Staff</div>
            </div>
            <div className="bg-white/8 border border-[rgba(58,160,141,0.4)] rounded-xl px-5 py-3 text-center min-w-[80px]">
              <div className="font-montserrat font-extrabold text-2xl text-[#3AA08D] leading-none mb-1">
                {members.filter(m => m.role === 'org:admin').length}
              </div>
              <div className="text-xs font-bold uppercase tracking-wider text-white/45">Admins</div>
            </div>
            
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-8 py-9 grid gap-7" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>

        {/* Staff list */}
        <StaffList
          members={members}
          currentUserId={userId}
          orgId={orgId!}
        />

        {/* Sidebar — invite form */}
        <div className="flex flex-col gap-6">
          <InviteStaffForm
            orgId={orgId!}
            agencyId={agencyUser.agencyId!}
            agencyName={agency.name}
            invitedByName={agencyUser.name}
          />

          {/* Info box */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '15px', color: '#1B2B4B', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              About Portal Access
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                'Invited staff receive a secure email link to activate their account — no password required.',
                'Staff members can only see referrals they personally submitted.',
                'Admins can manage team members and view all agency referrals.',
                'Remove a staff member immediately if they leave your organization.',
              ].map((item, i) => (
                <li key={i} style={{ fontSize: '13px', color: '#2C3A4A', lineHeight: 1.6, paddingLeft: '16px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#2A7F6F', fontWeight: 700 }}>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

      </main>
    </div>
  )
}