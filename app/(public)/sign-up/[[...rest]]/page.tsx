import { redirect } from 'next/navigation'

// Access is invite-only. This route stays in place because
// NEXT_PUBLIC_CLERK_SIGN_UP_URL points at it and the Clerk card renders a
// "Sign up" footer link — deleting the page would 404 that link. But a
// reachable sign-up form only produces Clerk accounts with no Agency Users
// record behind them, so it redirects to sign-in. Restricted sign-up mode in
// the Clerk dashboard is the real control.
export default function SignUpPage() {
  redirect('/sign-in')
}
