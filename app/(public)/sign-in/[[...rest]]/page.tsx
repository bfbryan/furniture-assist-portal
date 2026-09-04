import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-[#F7F5F1] flex flex-col items-center justify-center px-4 py-12">
      {/* Brand + context above the Clerk card. Kept minimal — the card does the
          work. Styling INSIDE the card (button colour, fonts) is Clerk
          dashboard configuration, not this file. */}
      <div className="flex flex-col items-center text-center mb-8">
        {/* Plain <img>, same remote asset the portal shell and print sheet use.
            Not next/image — no images config, and this is a one-off. */}
        <img
          src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
          alt="Furniture Assist"
          className="w-16 h-16 object-contain mb-4"
        />
        <div className="font-montserrat font-extrabold text-xl text-[#1B2B4B]">
          Furniture <span className="text-[#2A7F6F]">Assist</span>
        </div>
        <p className="text-sm text-[#7A8899] mt-2 max-w-xs leading-relaxed">
          Agency Portal — sign in to submit and manage client referrals.
        </p>
      </div>

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
