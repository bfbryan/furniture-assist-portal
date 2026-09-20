// app/(donor)/layout.tsx
//
// The shared guard for both donor-checkin surfaces — the phone kiosk
// (checkin/) and the Chromebook (desk/). One layout, not two, now that
// both use the identical device-session mechanic: any volunteer operates
// the Chromebook, same as the phones, so there was never a second auth
// story to keep separate. Mirrors app/(agency)/layout.tsx's own shape —
// the auth check lives directly in the route-group layout, same pattern,
// no shell/chrome wrapper here though: a kiosk's "nothing else on screen"
// requirement means this layout does the guard and nothing more.
//
// Route groups don't appear in the URL — app/(donor)/checkin/page.tsx is
// /checkin, app/(donor)/desk/page.tsx is /desk, not /donor/checkin or
// /donor/desk. Nothing in proxy.ts names either path: they were never
// added to isPublicRoute (Clerk's middleware protects them by default),
// so nothing there needed to change when these moved.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isDonorCheckinDevice } from '@/lib/auth/donor-checkin-access'

export default async function DonorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!isDonorCheckinDevice(userId)) redirect('/sign-in')

  return <>{children}</>
}
