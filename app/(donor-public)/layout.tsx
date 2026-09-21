// app/(donor-public)/layout.tsx
//
// A sibling to app/(donor)/, deliberately NOT the same group. (donor)
// carries a real guard — Clerk sign-in as a provisioned donor-checkin
// device — because /checkin and /desk are kiosk surfaces meant to run
// on hardware Ben has provisioned. Nothing under (donor-public) is that;
// it's public-facing, unauthenticated, donor-base-adjacent pages —
// starting with the drop-off intake test harness, and likely to grow as
// more of the JotForm/Zapier migration lands here (the real intake
// route itself, at app/api/donations/drop-off, is already public for
// the same reason).
//
// This layout exists to say that plainly rather than leave "no
// layout.tsx" as something a future reader has to notice and interpret
// correctly. No auth check here is not an oversight — matching pages
// still need adding to proxy.ts's isPublicRoute allowlist individually
// (route groups don't affect the URL or Clerk's middleware matching),
// this file doesn't do that for them.

export default function DonorPublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
