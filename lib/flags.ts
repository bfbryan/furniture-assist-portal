// lib/flags.ts
//
// Build-time feature gates. Read server-side only (server components and route
// handlers) — deliberately NOT NEXT_PUBLIC_, so neither the flag nor its value
// reaches the browser bundle.

/**
 * Agency-side referral submission, GLOBAL half — the page at /referrals/new
 * and POST /api/referrals/submit (both the create path and the
 * reschedule-request convert branch).
 *
 * Sep 2026, live-referrals-foundation: this used to be the ONLY gate —
 * closed everywhere in production, open on preview/dev, so the form could be
 * built without being exposed. That job is now done by the per-agency `Live
 * Referrals` field defaulting to unchecked (see canAgencySubmit below), which
 * is more granular than this ever was. This flag is kept anyway, recast: it
 * is the emergency override. `Live Referrals` lives in Airtable — if Airtable
 * is unreachable, wrong, or fifty agencies need turning off at once because a
 * bug surfaced in production, this is the lever that doesn't depend on any of
 * that. Flip it false and every agency is closed regardless of what their own
 * checkbox says, in one reviewed commit, no Vercel dashboard change, no bulk
 * Airtable edit.
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
 * Do not read this directly at a call site — go through canAgencySubmit()
 * below, which is the only place the AND with the per-agency field is meant
 * to happen. Every surface computing that composition on its own is exactly
 * how two gates start disagreeing.
 */
export const AGENCY_SUBMISSION_ENABLED =
  process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development'

/**
 * The one place the global flag and the per-agency `Live Referrals` field are
 * composed. AND, not OR: the global flag off closes every agency regardless
 * of its own field, which is the entire point of keeping it (see
 * AGENCY_SUBMISSION_ENABLED above). Every surface that gates on "can this
 * agency submit a referral" — the nav item, the page bar button, the two
 * routes, and (on later branches) the dashboard notice and the Help page FAQ
 * — calls this rather than re-checking both flags itself.
 *
 * Takes anything with a `liveReferrals` boolean so callers can pass the
 * result of getAgencyById() (or any future agency read that carries the same
 * field) without a shared nominal type between this file and lib/airtable.
 */
export function canAgencySubmit(agency: { liveReferrals: boolean }): boolean {
  return AGENCY_SUBMISSION_ENABLED && agency.liveReferrals
}
