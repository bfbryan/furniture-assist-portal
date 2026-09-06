// lib/notifications/portal-account-email.ts
//
// One send path for the account-lifecycle emails that used to go out through
// Zapier webhooks: the agency admin welcome, the staff portal invite, and the
// agency inactive / reinstate notices. Same event-driven pattern as
// cancellation-notice.ts — look the automation up in Email Automations by its
// primary field, honor the Enabled toggle, fill the stored Template, send via
// Resend, and write an Email Log row. The log row links to the Agency (not a
// Client Referral — these emails don't have one).
//
// The templates for all four live in Airtable and still use Zapier's
// {{=gives["step"]["key"]}} placeholders; fillTemplate understands that
// dialect, keyed on the inner name. The keys each template expects:
//
//   "Agency Welcome to Portal - Claimed":     Admin First Name, Agency Name, token
//   "Agency Staff Welcome to Portal - Invite": First Name, Agency Name, magicLink
//   "Agency Inactive Notice":                  contactFirstName, agencyName
//   "Agency Reinstate Notice":                 contactFirstName, agencyName
//
// Keys are matched by fillTemplate EXACTLY. There's no single naming
// convention across the four (the welcome pair uses "First Name" / "Agency
// Name"; the notice pair uses camelCase) — each is right for its own
// template. The staff invite used to pass firstName / agencyName and rendered
// a blank greeting; corrected to match the template's "First Name" / "Agency
// Name" placeholders.
//
// Both are built from a RAW Clerk sign-in token, and both end up pointing at
// the portal. They just differ in WHERE the portal URL is written down:
//
//   "token"     the welcome template hard-codes
//               https://portal.furnitureassist.com/sign-in?__clerk_ticket={{token}}
//               around it, in Airtable.
//   "magicLink" a complete URL, assembled in code by portalSignInLink().
//
// "magicLink" used to be Clerk's ready-made tokenData.url, which pointed at
// the Clerk instance rather than at us and landed invited staff on a
// Clerk-hosted sign-in page. See lib/auth/portal-sign-in-link.ts.
//
// All four automations ship with Enabled unchecked; Ben ticks them at
// go-live. Until then every call lands in { skipped: true, reason:
// "disabled" } — that is the designed behavior, not a failure, and callers
// must treat it as success.

import { Resend } from "resend";
import {
  getAutomationSettings,
  logAgencyEmailSend,
} from "@/lib/airtable/reminders";
import { fillTemplateReport } from "@/lib/notifications/template";

const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev";
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

// Deferred construction, same as the other notification modules — the Resend
// constructor throws on a falsy key, and importing this module must not
// require a runtime secret.
let _resend: Resend | null = null;
const getResend = () => (_resend ??= new Resend(process.env.RESEND_API_KEY));

export type PortalAccountEmailResult =
  | { skipped: true; reason: string }
  | { skipped: false; sent: true }
  | { skipped: false; sent: false; error: string };

export async function sendPortalAccountEmail(params: {
  automationName: string;
  to: string;
  tokens: Record<string, string>;
  /** Agency record id for the Email Log link; null if genuinely unknown. */
  agencyRecordId: string | null;
}): Promise<PortalAccountEmailResult> {
  const { automationName, to, tokens, agencyRecordId } = params;
  // Hoisted so the outer catch can still write the "Failed" audit row when the
  // throw happened after the automation was resolved (the common case: the
  // Resend constructor throwing on a missing key, or emails.send() throwing).
  let automation: Awaited<ReturnType<typeof getAutomationSettings>> = null;
  try {
    automation = await getAutomationSettings(automationName);
    if (!automation) {
      console.error(
        `${automationName}: no matching row found in Email Automations`
      );
      return { skipped: true, reason: "no automation row" };
    }
    if (!automation.fields.Enabled) {
      return { skipped: true, reason: "disabled" };
    }

    const template = automation.fields.Template || "";
    const subject = (automation.fields["Subject Line"] || automationName).trim();
    const { html, unresolved } = fillTemplateReport(template, tokens);

    // Guardrail for a mistake this codebase has shipped silently four times:
    // code and an Airtable template that each look right on their own but
    // disagree on a name, so the send succeeds with a hole in it.
    //   - a staff invite greeted "Dear ," — route passed `firstName`, template
    //     wanted `First Name`
    //   - a Send Day multi-select would have stalled three crons with no error
    //   - getAllReferrals filtered on a field that empties, hiding twenty
    //     cancelled referrals
    //   - the agency admin invite link rendered as about:blank — route passed
    //     `token`, template wanted `magicLink`
    // Every one rendered as "" and reported success. The four templates this
    // function sends all expect every placeholder to be filled (no
    // ChangeUrl/ChangeLabel-style pass-ahead tokens, unlike the crons), so any
    // unresolved key here is a real route/template drift. Log it — loudly, but
    // still send: a partly-filled account email beats a blocked invite, and the
    // failure mode is cosmetic, not a bounce.
    if (unresolved.length > 0) {
      console.error(
        `${automationName}: template placeholder(s) rendered empty — no value passed for ${unresolved
          .map((k) => `"${k}"`)
          .join(", ")}. Email sent anyway. The route and the Airtable template ` +
          `disagree on a token name; align them.`
      );
    }

    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: [to],
      replyTo: REPLY_TO_ADDRESS,
      subject,
      html,
    });

    if (error) {
      await logAgencyEmailSend({
        automationRecordId: automation.id,
        agencyRecordId,
        recipientEmail: to,
        status: "Failed",
        bounceReason: error.message,
      }).catch((logErr) =>
        console.error(`${automationName}: send failed AND the Email Log row could not be written:`, logErr)
      );
      return { skipped: false, sent: false, error: error.message };
    }

    // The log write is deliberately not allowed to change the verdict. Resend
    // has accepted the message by this point, so a failed Email Log create is
    // a lost paper trail, not a lost email — and letting it throw to the outer
    // catch reported a delivered invite as { sent: false }, which invites
    // someone to resend and burn a second sign-in link.
    //
    // Status stays "Sent" — the email went out. When placeholders were
    // unresolved, the note goes in Bounce Reason: it's the only free-text field
    // on Email Log, and a "Sent" row that carries one is unusual enough to draw
    // the eye without a schema change. A dedicated "Render Warnings" field would
    // be cleaner — flagged for Ben, my call to use Bounce Reason meanwhile.
    await logAgencyEmailSend({
      automationRecordId: automation.id,
      agencyRecordId,
      recipientEmail: to,
      resendMessageId: data?.id,
      status: "Sent",
      bounceReason: unresolved.length
        ? `Sent, but ${unresolved.length} template placeholder(s) rendered empty: ${unresolved.join(", ")}`
        : undefined,
    }).catch((logErr) =>
      console.error(`${automationName}: sent, but the Email Log row could not be written:`, logErr)
    );

    return { skipped: false, sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${automationName} send failed:`, err);
    // A THROWN send (Resend constructor with no key, a network error, an SDK
    // throw) lands here instead of the `if (error)` branch above, and used to
    // leave no trace but this log line — not even the Email Log "Failed" row
    // that a returned error gets. Write that row too, whenever we got far
    // enough to know which automation it was.
    if (automation?.id) {
      await logAgencyEmailSend({
        automationRecordId: automation.id,
        agencyRecordId,
        recipientEmail: to,
        status: "Failed",
        bounceReason: message,
      }).catch((logErr) =>
        console.error(`${automationName}: thrown send AND the Email Log row could not be written:`, logErr)
      );
    }
    return { skipped: false, sent: false, error: message };
  }
}
