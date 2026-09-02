// lib/notifications/reschedule-notice.ts
//
// Immediate (non-cron) Reschedule Notice. Called directly from
// app/api/dawson/referrals/[id]/reschedule/route.ts right after a referral
// that was ALREADY Scheduled gets moved to a new Saturday Schedule /
// Appointment Time. Regenerates the slip PDF for the new date, overwrites
// it in Blob + Airtable (same path, allowOverwrite: true), and emails the
// referring agency with both the new and previous appointment details.
//
// Unlike the Monday/Wednesday cron routes, this does NOT check Send Day /
// Send Time on the Email Automations row — it's event-driven, not polled —
// it only checks Enabled, so it can still be switched off from Airtable
// without a redeploy.
//
// A Pending Schedule -> Scheduled transition (first-time scheduling) is NOT a
// reschedule and should not call this — that's covered by the Wednesday
// Appointment Confirmation flow instead. The caller decides that by only
// invoking sendRescheduleNotice() when there was a previous appointment to
// report (see the `shouldSnapshot` check in the reschedule route).
//
// Aug 2026 — THE CONFIRMATION GUARD. This function will not email an agency
// about a rescheduled appointment unless that agency was told about the
// original appointment first, i.e. unless "Confirm Email Sent" is ticked on the
// referral. See the block marked THE GUARD below for why it lives here and not
// in lib/referrals/reschedule.ts. A withheld notice writes a Withheld row to
// the Email Log so the decision is visible on the record; the reschedule
// itself is untouched, and so is the regenerated appointment slip.

import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable/reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/notifications/template";
import { generateAndStoreSlip } from "@/lib/notifications/appointment-slip";
import { resolveChangeInstruction } from "@/lib/notifications/change-instruction";

const AUTOMATION_NAME = "Reschedule Notice"; // must match the row's primary field value in Email Automations
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev";

// Aug 2026: replies from agencies should land in the real shared mailbox,
// not the mail.furnitureassist.com sending address (not a monitored inbox).
// Same "env var with a sane fallback" pattern as FROM_ADDRESS above — this
// one and its four siblings (appointment-slip-notice, client-receipt,
// appointment-reminders crons + cancellation-notice) all need the identical
// addition since none of them set Reply-To today.
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

// Created on first use rather than at import. The Resend constructor throws
// when the key is falsy, so building this module must not require a runtime
// secret. Still one instance per module, just deferred until a send happens.
let _resend: Resend | null = null;
const getResend = () => (_resend ??= new Resend(process.env.RESEND_API_KEY));

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

async function getFullReferral(id: string): Promise<{ fields: Record<string, any> } | null> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) return null;
  return await res.json();
}

// Overwritten on every send (a referral can be rescheduled more than once) —
// same "overwrite every time" policy as Original Appointment Date/Time.
// Non-empty = notified at least once; the value = the most recent send.
//
// Field name must exactly match the Date field on Client Referrals —
// "Reschedule Email Sent At", matching the Reminder/Confirm naming
// convention (Reminder Email Sent At, Confirm Email Sent At). typecast
// does NOT create missing fields — a name mismatch here fails with a 422,
// so this now surfaces that instead of swallowing it silently.
async function markRescheduleNoticeSent(id: string): Promise<void> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: { "Reschedule Email Sent At": new Date().toISOString() },
      typecast: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Reschedule Notice: failed to set "Reschedule Email Sent At" (${res.status}): ${text}`);
  }
}

/**
 * 'unconfirmed' is the deliberate guard added Aug 2026 — see THE GUARD below.
 * The rest are the pre-existing skip cases and their strings are unchanged.
 */
export type RescheduleNoticeSkipReason =
  | "no automation row"
  | "disabled"
  | "referral not found"
  | "no agency email"
  | "unconfirmed";

export type RescheduleNoticeResult =
  | {
      skipped: true;
      reason: RescheduleNoticeSkipReason;
      /** Operator-facing sentence. Set for 'unconfirmed'; safe to show in UI. */
      message?: string;
    }
  | { skipped: false; sent: true }
  | { skipped: false; sent: false; error: string };

/** Shown to Dawson/Ben wherever a withheld notice surfaces. One wording. */
export const UNCONFIRMED_WITHHELD_MESSAGE =
  "Reschedule notice withheld: this referral's appointment confirmation was never sent, so the agency has never been told about the original appointment. The reschedule itself went through. The confirmation email will go out on the next Wednesday run and will carry the new date.";

export async function sendRescheduleNotice(
  recordId: string,
  previousApptDate: string | null,
  previousApptTime: string | null
): Promise<RescheduleNoticeResult> {
  try {
    const automation = await getAutomationSettings(AUTOMATION_NAME);
    if (!automation) {
      console.error(`Reschedule Notice: no "${AUTOMATION_NAME}" row found in Email Automations`);
      return { skipped: true, reason: "no automation row" };
    }
    if (!automation.fields.Enabled) {
      return { skipped: true, reason: "disabled" };
    }

    const record = await getFullReferral(recordId);
    if (!record) {
      console.error(`Reschedule Notice: referral ${recordId} not found`);
      return { skipped: true, reason: "referral not found" };
    }
    const f = record.fields;

    const rawAgencyEmail = f["Agency Email"];
    const toList = Array.isArray(rawAgencyEmail)
      ? rawAgencyEmail.filter(Boolean)
      : rawAgencyEmail
      ? [rawAgencyEmail]
      : [];

    if (toList.length === 0) {
      console.error(`Reschedule Notice: no Agency Email on ${recordId}`);
      return { skipped: true, reason: "no agency email" };
    }

    // Regenerate the slip for the new date/time; overwrites the same Blob
    // path and the same Airtable attachment (allowOverwrite: true).
    // generateAndStoreSlip only returns { buffer, blobUrl } -- no filename --
    // so build the attachment filename here the same way
    // appointment-slip-notice/route.ts does for its own slip attachment.
    //
    // This deliberately runs BEFORE the confirmation guard below, i.e. the slip
    // is regenerated even when the email is withheld. The slip is a record
    // artefact, not a notification: it is the attachment on the referral that
    // Dawson, the warehouse, and the agency portal's "View Appointment Slip"
    // link all read. Leaving it alone on a withheld reschedule would leave a
    // PDF on the record showing an appointment date that is no longer true,
    // which is a quieter version of the same bug this guard exists to fix.
    // Nothing is emailed from here when the guard trips, so regenerating it
    // cannot reach the agency early.
    const { buffer } = await generateAndStoreSlip(recordId, f);

    // ---- THE GUARD (Aug 2026) ------------------------------------------
    // Do not tell an agency their client's appointment MOVED if we never told
    // them it EXISTED.
    //
    // Reported live by Ben: a referral whose Wednesday confirmation had never
    // gone out was rescheduled by hand onto the right date, and the agency got
    // "your client's appointment has been changed" for an appointment they had
    // never heard of.
    //
    // The check lives here rather than in lib/referrals/reschedule.ts because
    // rescheduleReferral() is not actually the common ancestor: POST
    // /api/dawson/referrals/submit reschedules an existing referral through its
    // own rescheduleExistingReferral() and calls this function directly. This
    // function is the one choke point every path reaches, so the guard covers
    // all four rather than three.
    //
    // "Confirm Email Sent" is the checkbox the Wednesday cron sets via
    // markConfirmEmailSent(), alongside "Confirm Email Sent At". Unchecked
    // boxes come back from Airtable as undefined rather than false, hence the
    // truthiness check rather than === false.
    //
    // The reschedule itself is already committed by the time this runs — the
    // caller wrote the dates, status and reminder re-arming before calling in.
    // Nothing here can undo any of it; only the email is withheld.
    if (!f["Confirm Email Sent"]) {
      // On the record, not just in a console log nobody reads. Written with the
      // recipient it WOULD have gone to, so the row reads the same as a real
      // send in the Email History card and in Airtable.
      //
      // In its own try/catch: this is the reporting of a decision that has
      // already been made, and it must not be able to change that decision.
      // Without this, a failed write would throw to the outer catch and come
      // back as { sent: false, error } — reporting a deliberate suppression as
      // an email failure. The email is withheld either way; only the paper
      // trail is lost, and "Reschedule Email Sent At" staying blank still shows
      // as "Not sent" on the Email History card.
      try {
        await logEmailSend({
          automationRecordId: automation.id,
          clientReferralRecordId: recordId,
          recipientEmail: toList.join(", "),
          status: "Withheld",
          bounceReason: UNCONFIRMED_WITHHELD_MESSAGE,
        });
      } catch (logErr) {
        console.error(
          `Reschedule Notice: withheld for ${recordId} (confirmation never sent), ` +
          `but the Email Log row could not be written:`,
          logErr
        );
      }

      // Deliberately NOT calling markRescheduleNoticeSent: no notice went out,
      // so "Reschedule Email Sent At" must stay empty. That blank is itself
      // part of the signal.
      return {
        skipped: true,
        reason: "unconfirmed",
        message: UNCONFIRMED_WITHHELD_MESSAGE,
      };
    }
    // --------------------------------------------------------------------

    const rawNewApptDate = f["Appointment Date"];
    const newApptDateStr = Array.isArray(rawNewApptDate) ? rawNewApptDate[0] : rawNewApptDate;

    const template = automation.fields.Template || "";
    const subject = automation.fields["Subject Line"] || "Appointment Rescheduled";

    // Hybrid rollout: portal deep link if this recipient is Active + Claimed,
    // else the shared mailbox. Single targeted lookup — this is event-fired to
    // one recipient, not a batch. Never throws; a failed lookup returns the
    // mailto variant. The Airtable template hard-codes the <a> around these two
    // tokens; until it does, fillTemplate ignores them and this is a no-op.
    const change = await resolveChangeInstruction(toList[0], recordId, "Reschedule Notice");

    const html = fillTemplate(template, {
      ReferringStaff: toTokenValue(f["Referring Staff"]),
      ReferringAgency: toTokenValue(f["Referring Agency"]),
      NewApptDate: newApptDateStr ? formatApptDate(newApptDateStr) : "",
      NewApptTime: toTokenValue(f["Appointment Time"]),
      PreviousApptDate: previousApptDate ? formatApptDate(previousApptDate) : "—",
      PreviousApptTime: previousApptTime ? toTokenValue(previousApptTime) : "—",
      ClientFirstName: toTokenValue(f["First Name"]),
      ClientLastName: toTokenValue(f["Last Name"]),
      ClientAddress: toTokenValue(f["Full Address"]),
      ItemsRequested: toTokenValue(f["Items Requested"]),
      ChangeUrl: toTokenValue(change.changeUrl),
      ChangeLabel: toTokenValue(change.changeLabel),
    });

    const to = toList.join(", ");
    const clientLastName = toTokenValue(f["Last Name"]) || recordId;

    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: toList,
      replyTo: REPLY_TO_ADDRESS,
      subject,
      html,
      attachments: [
        {
          filename: `appointment-slip-${clientLastName}.pdf`,
          content: buffer,
        },
      ],
    });

    if (error) {
      await logEmailSend({
        automationRecordId: automation.id,
        clientReferralRecordId: recordId,
        recipientEmail: to,
        status: "Failed",
        bounceReason: error.message,
      });
      return { skipped: false, sent: false, error: error.message };
    }

    await logEmailSend({
      automationRecordId: automation.id,
      clientReferralRecordId: recordId,
      recipientEmail: to,
      resendMessageId: data?.id,
      status: "Sent",
    });

    await markRescheduleNoticeSent(recordId);

    return { skipped: false, sent: true };
  } catch (err) {
    // Never let a PDF/email failure surface as a failed reschedule — by the
    // time this runs, the Airtable write (the part that actually matters
    // operationally) has already succeeded.
    console.error("Reschedule Notice failed:", err);
    return {
      skipped: false,
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
