// lib/reschedule-notice.ts
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
// An Unscheduled -> Scheduled transition (first-time scheduling) is NOT a
// reschedule and should not call this — that's covered by the Wednesday
// Appointment Confirmation flow instead. The caller decides that by only
// invoking sendRescheduleNotice() when there was a previous appointment to
// report (see the `shouldSnapshot` check in the reschedule route).

import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable-reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/reminder-template";
import { generateAndStoreSlip } from "@/lib/appointment-slip";

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

const resend = new Resend(process.env.RESEND_API_KEY);

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

export type RescheduleNoticeResult =
  | { skipped: true; reason: string }
  | { skipped: false; sent: true }
  | { skipped: false; sent: false; error: string };

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
    const { buffer } = await generateAndStoreSlip(recordId, f);

    const rawNewApptDate = f["Appointment Date"];
    const newApptDateStr = Array.isArray(rawNewApptDate) ? rawNewApptDate[0] : rawNewApptDate;

    const template = automation.fields.Template || "";
    const subject = automation.fields["Subject Line"] || "Appointment Rescheduled";

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
    });

    const to = toList.join(", ");
    const clientLastName = toTokenValue(f["Last Name"]) || recordId;

    const { data, error } = await resend.emails.send({
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
