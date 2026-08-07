// lib/cancellation-notice.ts
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
// A first-time Unscheduled -> Cancelled transition (never had a real
// appointment to report) is NOT what this is for — the caller only invokes
// sendCancellationNotice() when `wasScheduled` was true (see the cancel
// route), same guard as the reschedule flow.

import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable-reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/reminder-template";

const AUTOMATION_NAME = "Cancellation Notice"; // must match the row's primary field value in Email Automations
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev";

// Aug 2026: same Reply-To addition as reschedule-notice.ts — replies from
// agencies should land in the real shared mailbox, not the sending domain.
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
  try {
    const automation = await getAutomationSettings(AUTOMATION_NAME);
    if (!automation) {
      console.error(`Cancellation Notice: no "${AUTOMATION_NAME}" row found in Email Automations`);
      return { skipped: true, reason: "no automation row" };
    }
    if (!automation.fields.Enabled) {
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
      return { skipped: true, reason: "no agency email" };
    }

    const template = automation.fields.Template || "";
    const subject =
      automation.fields["Subject Line"] || "Appointment Cancellation Confirmed";

    const html = fillTemplate(template, {
      ReferringStaff: toTokenValue(f["Referring Staff"]),
      ReferringAgency: toTokenValue(f["Referring Agency"]),
      OriginalDate: originalApptDate ? formatApptDate(originalApptDate) : "—",
      OriginalTime: originalApptTime ? toTokenValue(originalApptTime) : "—",
      ClientFirstName: toTokenValue(f["First Name"]),
      ClientLastName: toTokenValue(f["Last Name"]),
      ItemsRequested: toTokenValue(f["Items Requested"]),
    });

    const to = toList.join(", ");

    const { data, error } = await resend.emails.send({
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
    console.error("Cancellation Notice failed:", err);
    return {
      skipped: false,
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
