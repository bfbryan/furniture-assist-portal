// lib/auth/portal-sign-in-link.ts
//
// The one place that turns a Clerk sign-in token into a link an invited person
// can actually follow.
//
// THE BUG THIS EXISTS TO CLOSE. Every invite path asks Clerk for a sign-in
// token and gets back the same response — a raw `token` plus a ready-made
// `url`. Both agency welcome templates (admin and staff) want a `magicLink`
// placeholder: a COMPLETE portal sign-in URL, dropped straight into the CTA
// buttons' href. This helper builds it. The ways it went wrong:
//
//   Staff invites (POST /api/admin/invite, POST /api/admin/staff/[id]/invite)
//       sent Clerk's own `tokenData.url`. That URL points at the Clerk
//       INSTANCE, not at us — on the instance this project is wired to it
//       resolves to https://obliging-bobcat-27.accounts.dev/sign-in?... — so
//       staff were dropped onto a Clerk-hosted page instead of the portal.
//       That is exactly what Ben reported. Fixed to portalSignInLink(token).
//
//   Agency admin welcome (POST /api/dawson/agencies/[id]/invite)
//       passed the raw token under the key `token`. The template has no
//       {{token}} placeholder — its href is `{{magicLink}}` — so fillTemplate
//       resolved the unknown key to "", both CTA buttons rendered href="",
//       and the link opened about:blank. Fixed to portalSignInLink(token)
//       under the key `magicLink`, matching the staff routes.
//
// WHY THIS IS NOT BUILT FROM AN ENVIRONMENT VARIABLE. It used to be, out of
// NEXT_PUBLIC_APP_URL, which has never been set in any environment: every
// invite went out with a link beginning "undefined/sign-in?...". Switching to
// Clerk's URL is what fixed THAT, and it traded one wrong host for another.
// The origin below is a constant because the portal has exactly one address,
// an invite email is read long after the deploy that sent it, and a preview
// deploy must not mail out links to itself. One constant, one place to change
// it.
//
// The query parameter is Clerk's own: `__clerk_ticket` is what
// app/(public)/sign-in consumes to complete a ticket sign-in.

/** Where invite emails send people — the portal's one public origin. */
export const PORTAL_ORIGIN = 'https://portal.furnitureassist.com'

/**
 * Build the portal sign-in link for a raw Clerk sign-in token.
 *
 * Pass `tokenData.token`, never `tokenData.url` — the point of this helper is
 * that the origin is ours rather than Clerk's.
 */
export function portalSignInLink(signInToken: string): string {
  return `${PORTAL_ORIGIN}/sign-in?__clerk_ticket=${encodeURIComponent(signInToken)}`
}
