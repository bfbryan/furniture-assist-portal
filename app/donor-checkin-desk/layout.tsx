// app/donor-checkin-desk/layout.tsx
//
// The Chromebook. Same device-session guard as the phone kiosk
// (lib/auth/donor-checkin-access.ts) — any volunteer operates it, same as
// the phones, confirmed. Sibling to app/donor-checkin, not nested under
// it: they share the auth mechanism, not a layout.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isDonorCheckinDevice } from '@/lib/auth/donor-checkin-access'

export default async function DonorCheckinDeskLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!isDonorCheckinDevice(userId)) redirect('/sign-in')

  return <>{children}</>
}
