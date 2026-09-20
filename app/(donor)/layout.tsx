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
// /donor/desk. Nothing in proxy.ts names either path for THIS reason:
// they were never added to isPublicRoute (Clerk's middleware protects
// them by default). It does now carry the failure destination below.
//
// TWO GATES, not one, matching app/(agency)/layout.tsx's own shape:
//   1. !userId -> /sign-in. Genuinely no session.
//   2. signed in, not a donor-checkin device -> a page that RENDERS,
//      not another redirect() through /sign-in. That distinction is the
//      whole fix here: redirect('/sign-in') for an ALREADY-signed-in
//      visitor doesn't show the sign-in page at all — proxy.ts's own
//      middleware intercepts any signed-in visit to /sign-in and sends
//      it to /redirect, which sends a Dawson user straight to /dawson
//      "by design" (its own comment says so), ignoring everything else.
//      A Dawson admin testing /checkin locally landed on the Dawson
//      dashboard, not an error, because of exactly this collapse.
//      /donor-checkin-unauthorized is in isPublicRoute for the same
//      reason /inactive is: so visiting it doesn't itself get caught by
//      auth.protect() if it's ever reached without a session already
//      established (in practice it never is, on this app's own flows,
//      but /inactive carries the same defensive listing).
//
// app/dawson/layout.tsx has the identical single-redirect('/sign-in')
// shape and the identical exposure — it has only ever escaped this
// because every signed-in account in this app has been either Dawson or
// agency until now, and /redirect's own priority chain sends both of
// those somewhere that happens to be correct for THEM. An agency user
// guessing their way to /dawson would hit the same silent bounce to
// their own dashboard instead of a page saying they don't have access.
// Not fixed here — flagged, since it wasn't part of what broke.

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { isDonorCheckinDevice } from '@/lib/auth/donor-checkin-access'

export default async function DonorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  if (!isDonorCheckinDevice(userId)) redirect('/donor-checkin-unauthorized')

  return <>{children}</>
}
