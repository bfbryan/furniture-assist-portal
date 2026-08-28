// lib/contact.ts
//
// Shared, client-safe copy for pointing an agency at Furniture Assist by email.
//
// The address is the same one the notification modules fall back to
// (REMINDER_REPLY_TO_ADDRESS in lib/notifications/*), but that is a server-only
// env lookup meant as an email Reply-To. This constant is for UI that renders in
// the browser — currently the agency referral detail page's terminal-state
// guidance line.
//
// app/(public)/inactive/page.tsx still inlines the same address in a mailto and
// could import this instead.

/** Where an agency writes for anything the portal can't do itself yet. */
export const AGENCY_CONTACT_EMAIL = 'agencies@furnitureassist.com'

/**
 * Tacked onto the "email us to restart this" guidance while agency-side
 * referral submission is not yet live. Delete the phrase (and this constant)
 * once it ships.
 */
export const ONLINE_SUBMISSION_COMING_SOON = 'Online submission is coming soon.'
