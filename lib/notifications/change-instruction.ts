// lib/notifications/change-instruction.ts
//
// TEMPORARY — hybrid-rollout scaffolding. Delete this module (and its callers
// in reschedule-notice.ts / cancellation-notice.ts, plus the inline copies in
// app/api/cron/appointment-reminders/route.ts and appointment-slip-notice/
// route.ts) once every partner agency is on the portal and every one of these
// emails can point at the portal unconditionally.
//
// Resolves the {{ChangeUrl}} / {{ChangeLabel}} pair that all four agency
// emails (appointment reminder, appointment confirmation, reschedule notice,
// cancellation notice) use for their "if this needs to change" line. A
// recipient whose Agency Users row is Active + Claimed is pointed at their
// referral in the portal; everyone else is pointed at the shared mailbox.
//
// The two cron routes do this inline against a once-per-run
// getPortalReadyEmails() Set because they process a batch. These two notices
// are event-fired to a single recipient, so they do one targeted lookup here
// instead of querying the whole Agency Users table.

import { PORTAL_ORIGIN } from '@/lib/auth/portal-sign-in-link'
import { getAgencyUserByEmail } from '@/lib/airtable/agency-users'

// Same literals as app/api/cron/appointment-reminders/route.ts and
// appointment-slip-notice/route.ts, so all four emails read identically.
const CHANGE_FALLBACK_URL = 'mailto:agencies@furnitureassist.com'
const CHANGE_FALLBACK_LABEL = 'email agencies@furnitureassist.com'
const PORTAL_CHANGE_LABEL = 'cancel or reschedule it in the Agency Portal'

export type ChangeInstruction = {
  variant: 'portal' | 'mailto'
  changeUrl: string
  changeLabel: string
}

/**
 * Decide whether `recipientEmail` can be pointed at the portal to change the
 * appointment on referral `referralRecordId`, or should be pointed at the
 * shared mailbox.
 *
 * Ready = the recipient's Agency Users row has Status = "Active" AND
 * Portal Invite Status = "Claimed".
 *
 * `logContext` is the caller's name, used in the console.error on a failed or
 * empty lookup. A lookup that throws or finds no user falls back to the mailto
 * variant — it must never stop the notice from sending.
 */
export async function resolveChangeInstruction(
  recipientEmail: string,
  referralRecordId: string,
  logContext: string,
): Promise<ChangeInstruction> {
  const mailto: ChangeInstruction = {
    variant: 'mailto',
    changeUrl: CHANGE_FALLBACK_URL,
    changeLabel: CHANGE_FALLBACK_LABEL,
  }

  let user: Awaited<ReturnType<typeof getAgencyUserByEmail>>
  try {
    user = await getAgencyUserByEmail(recipientEmail)
  } catch (err) {
    console.error(
      `${logContext}: portal-readiness lookup failed for ${recipientEmail} — using the email-us variant:`,
      err,
    )
    return mailto
  }

  if (!user) {
    console.error(
      `${logContext}: no Agency Users row for ${recipientEmail} — using the email-us variant`,
    )
    return mailto
  }

  // Found but not on the portal yet: the ordinary hybrid-rollout case, no log.
  if (user.status !== 'Active' || user.portalInviteStatus !== 'Claimed') {
    return mailto
  }

  return {
    variant: 'portal',
    changeUrl: `${PORTAL_ORIGIN}/referrals/${referralRecordId}`,
    changeLabel: PORTAL_CHANGE_LABEL,
  }
}
