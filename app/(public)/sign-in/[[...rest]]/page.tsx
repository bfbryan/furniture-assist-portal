import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      {/*
        routing="hash" is deliberate — don't drop it as boilerplate without
        checking first. Path routing was tried on 2026-08-31 and reverted,
        but NOT because it was proven at fault. It appeared to cause a blank
        /redirect after sign-in; that stall turned out to be pre-existing and
        dev-only — main reproduces it identically with hash routing, in both
        Chrome and Safari, after clearing .next. It's a dev-server artifact,
        not a routing problem. The revert was caution during agency
        onboarding, not a diagnosis. Worth revisiting later, verified on
        preview or production rather than localhost.
      */}
      <SignIn routing="hash" />
    </main>
  )
}
