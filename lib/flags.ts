// lib/flags.ts
//
// Build-time feature gates. Read server-side only (server components and route
// handlers) — deliberately NOT NEXT_PUBLIC_, so neither the flag nor its value
// reaches the browser bundle.

/**
 * Agency-side referral submission — the page at /referrals/new and
 * POST /api/referrals/submit (both the create path and the reschedule-request
 * convert branch). CLOSED in production until Phase 1 launch; OPEN everywhere
 * else so the form can still be built and tested.
 *
 * VERCEL_ENV is injected by Vercel ('production' | 'preview' | 'development');
 * NODE_ENV is 'development' under a bare `next dev`. The check is written to
 * fail CLOSED — anything not demonstrably preview or local dev is treated as
 * production.
 *
 *   production ........................... closed
 *   preview deploy ....................... open
 *   `next dev` on localhost ............... open
 *   production w/ VERCEL_ENV missing ..... closed (fail-closed)
 *   local `next start` on a prod build ... closed (set VERCEL_ENV=preview to test)
 *
 * TO LAUNCH: change the body to `true`, or delete this constant and its call
 * sites (the page redirect and the route's 403). One reviewed commit — no
 * Vercel dashboard change.
 */
export const AGENCY_SUBMISSION_ENABLED =
  process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development'
