// app/api/cron/client-receipt/route.ts
//
// Tuesday batch, two independent sends off the same trigger:
//   1. Client Receipt — completed appointments, existing "Ready to Send
//      Post Appt Email" view (Gemini-OCR + manual "Ready for Post-Appt
//      Email" checkbox), PDF receipt attached.
//   2. Client No Show — missed appointments, a separate view
//      (lib/notifications/no-show-notice.ts), no attachment.
//
// The two are independently gated: each reads its OWN Email Automations
// row (Enabled / Send Day / Send Time), so one being disabled,
// unscheduled, or even missing its row entirely can never block the
// other. They used to be a single early-return chain; split into two
// blocks specifically so that stays true.
//
// The two sends do NOT share a "sent" marker. Client Receipt sets "Post
// Appt Email Sent" / "Post Appt Email Sent At"; Client No Show sets its
// own "No Show Email Sent At" and clears "Ready for Post-Appt Email".
// See lib/notifications/no-show-notice.ts's header for why they have to
// stay separate: a no-show can reach Completed without ever passing
// through rescheduleReferral() (Ben corrects the status directly in
// Airtable after the no-show email asks the agency to confirm), and a
// shared marker would leave that referral permanently excluded from the
// Completed view.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAutomationSettings, getPortalReadyEmails, logEmailSend } from "@/lib/airtable/reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/notifications/template";
import {
  getReceiptPending,
  generateAndStoreReceipt,
  markPostApptEmailSent,
} from "@/lib/notifications/client-receipt";
import { getNoShowPending, markNoShowEmailSent } from "@/lib/notifications/no-show-notice";
import { PORTAL_ORIGIN } from "@/lib/auth/portal-sign-in-link";

// Aug 2026: same fix as the other two cron routes -- without this, Next.js
// can serve a cached response for this GET route instead of invoking the
// function on every cron call, which shows up as zero logged invocations
// in Vercel's Cron Jobs tab even though the schedule is firing.
export const dynamic = "force-dynamic";

const RECEIPT_AUTOMATION_NAME = "Client Receipt"; // must match the row's primary field value in Email Automations
const NO_SHOW_AUTOMATION_NAME = "Client No Show"; // ditto — record recKwmryoII7rIlgA
const TIMEZONE = process.env.REMINDER_TIMEZONE || "America/New_York";
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev"; // set in Vercel now that mail.furnitureassist.com is verified

// Aug 2026: same Reply-To addition across every send site — replies from
// agencies should land in the real shared mailbox, not the sending domain
// (mail.furnitureassist.com isn't a monitored inbox).
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

// Hybrid-rollout fallback for a no-show recipient without portal access —
// same literal/reasoning as appointment-reminders/route.ts and
// appointment-slip-notice/route.ts: a literal, not REPLY_TO_ADDRESS (an
// env var could otherwise make the sentence in the email disagree with
// itself). Remove alongside getPortalReadyEmails() once every agency is on
// the portal.
const CHANGE_FALLBACK_URL = "mailto:agencies@furnitureassist.com";
// This email's OWN label strings, not the reminder's cancel-or-reschedule
// phrase — a missed appointment can't be cancelled, and the button text
// has to read correctly on its own. Per the Client No Show template's own
// header comment (Email Automations, recKwmryoII7rIlgA).
const NO_SHOW_CHANGE_LABEL_PORTAL = "Reschedule in the Portal";
const NO_SHOW_CHANGE_LABEL_FALLBACK = "Email Us to Reschedule";

// Created on first use rather than at import. The Resend constructor throws
// when the key is falsy, so building this module must not require a runtime
// secret. Still one instance per module, just deferred until a send happens.
let _resend: Resend | null = null;
const getResend = () => (_resend ??= new Resend(process.env.RESEND_API_KEY));

function currentDayAndHour(timeZone: string) {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return { day, hour: hour.padStart(2, "0") };
}

/** Send Day tolerates both shapes: a string today, a multi-select array once
 *  the Airtable field is converted. Reduces to `day === sendDay` while it's
 *  a string, so this is a no-op until the field flips. Shared by both
 *  automations below. */
function scheduleMatches(
  automation: { fields: Record<string, unknown> },
  day: string,
  hour: string
): boolean {
  const sendDay = automation.fields["Send Day"];
  const sendHour = String(automation.fields["Send Time"] || "").slice(0, 2);
  const dayMatches = Array.isArray(sendDay) ? sendDay.includes(day) : day === sendDay;
  return dayMatches && hour === sendHour;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { day, hour } = currentDayAndHour(TIMEZONE);

  const receipt = await runClientReceipt(req, day, hour);
  const noShow = await runClientNoShow(req, day, hour);

  return NextResponse.json({ receipt, noShow });
}

// ---------------------------------------------------------------- Client Receipt

async function runClientReceipt(req: NextRequest, day: string, hour: string) {
  const automation = await getAutomationSettings(RECEIPT_AUTOMATION_NAME);

  if (!automation) {
    return { error: `No "${RECEIPT_AUTOMATION_NAME}" row found in Email Automations` };
  }
  if (!automation.fields.Enabled) {
    return { skipped: "disabled" };
  }
  if (!scheduleMatches(automation, day, hour)) {
    return { skipped: "not scheduled time", day, hour };
  }

  let pending = await getReceiptPending();

  // Same manual-test safety valve as the other cron routes: ?testRecordId=recXXXXXXXX
  const testRecordId = req.nextUrl.searchParams.get("testRecordId");
  if (testRecordId) {
    pending = pending.filter((r) => r.id === testRecordId);
    if (pending.length === 0) {
      return { error: `Record ${testRecordId} not found in the Ready to Send Post Appt Email view` };
    }
  }

  if (pending.length === 0) {
    return { sent: 0 };
  }

  const template = automation.fields.Template || "";
  const subject = automation.fields["Subject Line"] || "Your Client Receipt";

  const results: { recordId: string; status: string; error?: string }[] = [];

  for (const record of pending) {
    const f = record.fields;

    const rawAgencyEmail = f["Agency Email"];
    const toList = Array.isArray(rawAgencyEmail)
      ? rawAgencyEmail.filter(Boolean)
      : rawAgencyEmail
      ? [rawAgencyEmail]
      : [];

    if (toList.length === 0) {
      results.push({ recordId: record.id, status: "skipped", error: "No Agency Email on record" });
      continue;
    }

    const to = toList.join(", ");

    const rawApptDate = f["Appointment Date"];
    const apptDateStr = Array.isArray(rawApptDate) ? rawApptDate[0] : rawApptDate;

    try {
      // Generate the receipt PDF, upload to Blob, and attach it in Airtable.
      const { buffer, filename } = await generateAndStoreReceipt(record.id, f);

      const html = fillTemplate(template, {
        ReferringStaff: toTokenValue(f["Referring Staff"]),
        ReferringAgency: toTokenValue(f["Referring Agency"]),
        DateCompleted: apptDateStr ? formatApptDate(apptDateStr) : "",
        ClientFirstName: toTokenValue(f["First Name"]),
        ClientLastName: toTokenValue(f["Last Name"]),
        ClientAddress: toTokenValue(f["Full Address"]),
        ClientPhone: toTokenValue(f["Phone"]),
      });

      const { data, error } = await getResend().emails.send({
        from: FROM_ADDRESS,
        to: toList,
        replyTo: REPLY_TO_ADDRESS,
        subject,
        html,
        attachments: [
          {
            filename,
            content: buffer,
          },
        ],
      });

      if (error) {
        results.push({ recordId: record.id, status: "failed", error: error.message });
        await logEmailSend({
          automationRecordId: automation.id,
          clientReferralRecordId: record.id,
          recipientEmail: to,
          status: "Failed",
          bounceReason: error.message,
        });
        continue;
      }

      // Log first, mark second (best-effort) — same reasoning as the
      // other routes: a checkbox-write failure shouldn't be able to eat
      // the record of the send having actually happened.
      await logEmailSend({
        automationRecordId: automation.id,
        clientReferralRecordId: record.id,
        recipientEmail: to,
        resendMessageId: data?.id,
        status: "Sent",
      });

      try {
        await markPostApptEmailSent(record.id);
      } catch (markErr) {
        console.error(`Failed to mark ${record.id} as receipt-sent:`, markErr);
      }

      results.push({ recordId: record.id, status: "sent" });
    } catch (err) {
      results.push({
        recordId: record.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent: results.filter((r) => r.status === "sent").length, results };
}

// ---------------------------------------------------------------- Client No Show

async function runClientNoShow(req: NextRequest, day: string, hour: string) {
  const automation = await getAutomationSettings(NO_SHOW_AUTOMATION_NAME);

  if (!automation) {
    return { error: `No "${NO_SHOW_AUTOMATION_NAME}" row found in Email Automations` };
  }
  if (!automation.fields.Enabled) {
    return { skipped: "disabled" };
  }
  if (!scheduleMatches(automation, day, hour)) {
    return { skipped: "not scheduled time", day, hour };
  }

  let pending = await getNoShowPending();

  // Same safety valve as the receipt loop, a distinct param so a live test
  // of one send can never accidentally scope the other's batch.
  const testRecordId = req.nextUrl.searchParams.get("testNoShowRecordId");
  if (testRecordId) {
    pending = pending.filter((r) => r.id === testRecordId);
    if (pending.length === 0) {
      return { error: `Record ${testRecordId} not found in the Ready to Send Post Appt Email - No Show view` };
    }
  }

  if (pending.length === 0) {
    return { sent: 0 };
  }

  // Re-checked per record, not trusted from the view alone — the view's
  // own filter formula isn't readable from here (Airtable's Meta API
  // doesn't expose it), and this is the one send whose marker is brand
  // new, so a stale row slipping through would write real state.
  pending = pending.filter((r) => {
    const f = r.fields;
    return (
      f["Appointment Status"] === "No Show" &&
      f["Ready for Post-Appt Email"] === true &&
      !f["No Show Email Sent At"]
    );
  });

  if (pending.length === 0) {
    return { sent: 0 };
  }

  const template = automation.fields.Template || "";
  const subject = automation.fields["Subject Line"] || "Furniture Assist - Missed Appointment";

  // One fetch for the whole batch, same pattern the reminder cron already
  // uses — not per-recipient (that's resolveChangeInstruction's job, for
  // the two event-fired single-send notices, not this one).
  let portalReadyEmails: Set<string>;
  try {
    portalReadyEmails = await getPortalReadyEmails();
  } catch (err) {
    console.error(
      "client-no-show: getPortalReadyEmails() failed — every send this run will use the email-us variant:",
      err
    );
    portalReadyEmails = new Set();
  }

  const results: { recordId: string; status: string; error?: string }[] = [];

  for (const record of pending) {
    const f = record.fields;

    const rawAgencyEmail = f["Agency Email"];
    const toList = Array.isArray(rawAgencyEmail)
      ? rawAgencyEmail.filter(Boolean)
      : rawAgencyEmail
      ? [rawAgencyEmail]
      : [];

    if (toList.length === 0) {
      results.push({ recordId: record.id, status: "skipped", error: "No Agency Email on record" });
      continue;
    }

    const to = toList.join(", ");

    const recipientsReady =
      toList.length > 0 &&
      toList.every((addr) => portalReadyEmails.has(String(addr).trim().toLowerCase()));
    const changeUrl = recipientsReady ? `${PORTAL_ORIGIN}/referrals/${record.id}` : CHANGE_FALLBACK_URL;
    const changeLabel = recipientsReady ? NO_SHOW_CHANGE_LABEL_PORTAL : NO_SHOW_CHANGE_LABEL_FALLBACK;

    const rawApptDate = f["Appointment Date"];
    const apptDateStr = Array.isArray(rawApptDate) ? rawApptDate[0] : rawApptDate;

    try {
      const html = fillTemplate(template, {
        ReferringStaff: toTokenValue(f["Referring Staff"]),
        ReferringAgency: toTokenValue(f["Referring Agency"]),
        ClientFirstName: toTokenValue(f["First Name"]),
        ClientLastName: toTokenValue(f["Last Name"]),
        ClientPhone: toTokenValue(f["Phone"]),
        ApptDate: apptDateStr ? formatApptDate(apptDateStr) : "",
        ApptTime: toTokenValue(f["Appointment Time"]),
        ChangeUrl: toTokenValue(changeUrl),
        ChangeLabel: toTokenValue(changeLabel),
      });

      const { data, error } = await getResend().emails.send({
        from: FROM_ADDRESS,
        to: toList,
        replyTo: REPLY_TO_ADDRESS,
        subject,
        html,
      });

      if (error) {
        results.push({ recordId: record.id, status: "failed", error: error.message });
        await logEmailSend({
          automationRecordId: automation.id,
          clientReferralRecordId: record.id,
          recipientEmail: to,
          status: "Failed",
          bounceReason: error.message,
        });
        continue;
      }

      await logEmailSend({
        automationRecordId: automation.id,
        clientReferralRecordId: record.id,
        recipientEmail: to,
        resendMessageId: data?.id,
        status: "Sent",
      });

      try {
        await markNoShowEmailSent(record.id);
      } catch (markErr) {
        console.error(`Failed to mark ${record.id} as no-show-sent:`, markErr);
      }

      results.push({ recordId: record.id, status: "sent" });
    } catch (err) {
      results.push({
        recordId: record.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent: results.filter((r) => r.status === "sent").length, results };
}
