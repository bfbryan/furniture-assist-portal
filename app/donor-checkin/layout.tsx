// app/donor-checkin/layout.tsx
//
// The phone kiosk. Guard only — no shared chrome, no nav, nothing but the
// scan state, matching "nothing else on screen." Sibling to
// app/donor-checkin-desk, not nested under it and not sharing a layout
// with it — they share the device-session auth mechanism (see
// lib/auth/donor-checkin-access.ts), not a layout file. Same pattern
// app/dawson/layout.tsx uses for its own guard-then-redirect.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isDonorCheckinDevice } from '@/lib/auth/donor-checkin-access'

export default async function DonorCheckinLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!isDonorCheckinDevice(userId)) redirect('/sign-in')

  return <>{children}</>
}
