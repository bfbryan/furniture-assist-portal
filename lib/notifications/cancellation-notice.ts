// lib/notifications/cancellation-notice.ts
//
// Immediate (non-cron) Cancellation Notice. Called directly from
// app/api/dawson/referrals/[id]/cancel/route.ts right after a referral
// that was already Scheduled gets cancelled. Emails the referring agency
// confirming the cancellation, with the original appointment details.
//
// Same event-driven pattern as Reschedule Notice: only checks the
// automation's Enabled toggle, not Send Day/Send Time, since it's fired by
// the cancel action itself rather than polled by a cron job.
//
// Unlike reschedule, there's no PDF work here — the appointment slip stops
// being relevant once the appointment is cancelled, so this is email-only.
// (If you also want the "Appt Slip" attachment cleared out on cancel, that
// would be a small follow-on using the same clear-then-nothing pattern as
// attachSlipToAirtable's clear step — not built here since it wasn't asked
// for and cancellations are already rare/manual-adjacent.)
//
// A first-time Pending Schedule -> Cancelled transition (never had a real
// appointment to report) is NOT what this is for — the caller only invokes
// sendCancellationNotice() when `wasScheduled` was true (see the cancel
// route), same guard as the reschedule flow.

import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable/reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/notifications/template";
import { resolveChangeInstruction } from "@/lib/notifications/change-instruction";

const AUTOMATION_NAME = "Cancellation Notice"; // must match the row's primary field value in Email Automations
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev";

// Aug 2026: same Reply-To addition as reschedule-notice.ts — replies from
// agencies should land in the real shared mailbox, not the sending domain.
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

// Overwritten on every send, same non-throwing/best-effort policy as
// markRescheduleNoticeSent — a failure here shouldn't be able to eat the
// Email Log entry above it, and a cancellation record shouldn't normally
// get cancelled twice anyway, but if it somehow does, this just gets
// overwritten again rather than blocking anything.
async function markCancellationNoticeSent(id: string): Promise<void> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Client%20Referrals/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: { "Cancellation Email Sent At": new Date().toISOString() },
      typecast: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(
      `Cancellation Notice: failed to set "Cancellation Email Sent At" (${res.status}): ${text}`
    );
  }
}

export type CancellationNoticeResult =
  | { skipped: true; reason: string }
  | { skipped: false; sent: true }
  | { skipped: false; sent: false; error: string };

export async function sendCancellationNotice(
  recordId: string,
  originalApptDate: string | null,
  originalApptTime: string | null
): Promise<CancellationNoticeResult> {
  // Captured as soon as the automation row is read so the catch at the bottom
  // can still write an Email Log row for a throw that happens much later.
  // Same shape as reschedule-notice.ts — see the note on logSkip below.
  let automationId: string | null = null;

  try {
    const automation = await getAutomationSettings(AUTOMATION_NAME);
    if (!automation) {
      console.error(`Cancellation Notice: no "${AUTOMATION_NAME}" row found in Email Automations`);
      return { skipped: true, reason: "no automation row" };
    }
    automationId = automation.id;

    // Every non-send from here down writes an Email Log row. This file had the
    // identical blind spot reschedule-notice.ts did (fixed in #104): four skip
    // branches and the outer catch all returned without recording anything, so
    // a cancellation notice that never went out looked exactly like one that
    // did — on the referral, in the Email Log, and on screen. That is what let
    // a thrown TypeError sit unnoticed for two weeks on the reschedule side.
    // This file shares the same failure mode by construction: both are
    // event-fired, both have exactly one caller, and neither has a cron or a
    // view that would notice a miss.
    if (!automation.fields.Enabled) {
      await logSkip(automation.id, recordId, null, "disabled",
        "Cancellation Notice is disabled in Email Automations, so no email was sent for this cancellation.");
      return { skipped: true, reason: "disabled" };
    }

    // Fetch fresh fields for client/agency info. By this point the cancel
    // route has already cleared Saturday Schedule + Appointment Time, so
    // "Appointment Date" will read empty on this record — that's exactly
    // why the ORIGINAL date/time come in as params (captured by the route
    // before its cancel PATCH ran), not re-derived from this fetch.
    const record = await getFullReferral(recordId);
    if (!record) {
      console.error(`Cancellation Notice: referral ${recordId} not found`);
      await logSkip(automation.id, recordId, null, "referral not found",
        "The referral could not be read back when the cancellation notice was due, so no email was sent.");
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
      console.error(`Cancellation Notice: no Agency Email on ${recordId}`);
      await logSkip(automation.id, recordId, null, "no agency email",
        "This referral has no Agency Email, so there was nobody to send the cancellation notice to.");
      return { skipped: true, reason: "no agency email" };
    }

    const template = automation.fields.Template || "";
    const subject =
      automation.fields["Subject Line"] || "Appointment Cancellation Confirmed";

    // Hybrid rollout: portal deep link if this recipient is Active + Claimed,
    // else the shared mailbox with a prefilled subject/body — see
    // lib/notifications/agency-mailto-fallback.ts. Single targeted lookup —
    // this is event-fired to one recipient, not a batch. Never throws; a
    // failed lookup returns the mailto variant. The Airtable template
    // hard-codes the <a> around these two tokens; until it does, fillTemplate
    // ignores them and this is a no-op.
    //
    // 'cancelled' — its own purpose now, not a reuse of 'upcoming'. The
    // body reads "Cancelled appointment: <date>, <time>" / "Preferred new
    // date:", not "Change needed (cancel or new date)" — that phrasing
    // was written for an appointment that still exists, and this one no
    // longer does. originalApptDate/Time are the only appointment detail
    // there is by this point (the cancel route already cleared Saturday
    // Schedule/Appointment Time on the record itself).
    const change = await resolveChangeInstruction(toList[0], recordId, "Cancellation Notice", "cancelled", {
      clientFirstName: f["First Name"],
      clientLastName: f["Last Name"],
      apptDateStr: originalApptDate,
      apptTime: originalApptTime,
    });

    const html = fillTemplate(template, {
      ReferringStaff: toTokenValue(f["Referring Staff"]),
      ReferringAgency: toTokenValue(f["Referring Agency"]),
      OriginalDate: originalApptDate ? formatApptDate(originalApptDate) : "—",
      OriginalTime: originalApptTime ? toTokenValue(originalApptTime) : "—",
      ClientFirstName: toTokenValue(f["First Name"]),
      ClientLastName: toTokenValue(f["Last Name"]),
      ItemsRequested: toTokenValue(f["Items Requested"]),
      ChangeUrl: toTokenValue(change.changeUrl),
      ChangeLabel: toTokenValue(change.changeLabel),
    });

    const to = toList.join(", ");

    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: toList,
      replyTo: REPLY_TO_ADDRESS,
      subject,
      html,
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

    await markCancellationNoticeSent(recordId);

    return { skipped: false, sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Cancellation Notice failed:", err);

    // The cancellation itself is already committed by the time this runs, so
    // nothing here can undo it — but the failure must leave a mark. This used
    // to console.error and return, writing nothing: exactly the silence that
    // hid a thrown TypeError on the reschedule side for two weeks.
    if (automationId) {
      try {
        await logEmailSend({
          automationRecordId: automationId,
          clientReferralRecordId: recordId,
          recipientEmail: "",
          status: "Failed",
          bounceReason: `Cancellation Notice threw before sending: ${message}`,
        });
      } catch (logErr) {
        console.error(
          `Cancellation Notice: could not log the failure for ${recordId}:`,
          logErr,
        );
      }
    }

    return { skipped: false, sent: false, error: message };
  }
}

/**
 * One Email Log row for a decided non-send, so the referral carries the fact.
 * Never throws: the decision has already been made and must not be changed by
 * a failure to record it.
 *
 * Deliberately a local twin of the one in reschedule-notice.ts rather than a
 * shared helper. The two differ in the automation they name and the sentences
 * they write, and a shared version would need both passed in — at which point
 * it is the same six lines with more indirection. If a third notice ever needs
 * this, extract then, with three real call sites to shape it.
 */
async function logSkip(
  automationRecordId: string,
  recordId: string,
  recipientEmail: string | null,
  reason: string,
  explanation: string,
): Promise<void> {
  try {
    await logEmailSend({
      automationRecordId,
      clientReferralRecordId: recordId,
      recipientEmail: recipientEmail ?? "",
      status: "Skipped",
      bounceReason: `${reason}: ${explanation}`,
    });
  } catch (logErr) {
    console.error(
      `Cancellation Notice: skipped (${reason}) for ${recordId}, and the log row failed too:`,
      logErr,
    );
  }
}
