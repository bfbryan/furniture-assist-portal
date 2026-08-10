// app/api/cron/appointment-reminders/route.ts
//
// Vercel Cron hits this route every hour (see vercel.json). It checks the
// Email Automations "Appointment Reminder" row to see whether the configured
// Send Day/Send Time matches right now — if so, it pulls due records from
// the existing Airtable view, sends via Resend, and logs each send.
//
// This indirection (hourly cron + a settings check) is what lets the send
// day/time be changed from the admin page later without redeploying.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getAutomationSettings,
  getDueReminders,
  markReminderSent,
  logEmailSend,
} from "@/lib/airtable-reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/reminder-template";

// Aug 2026: without this, Next.js can serve a cached response for this GET
// route instead of actually invoking the function on every cron call --
// Vercel's own cron troubleshooting docs call this out specifically. Forces
// a fresh execution (and therefore a logged invocation) every single time.
export const dynamic = "force-dynamic";

const AUTOMATION_NAME = "Appointment Reminder"; // must match the row's primary field value
const TIMEZONE = process.env.REMINDER_TIMEZONE || "America/New_York";
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev"; // set in Vercel now that mail.furnitureassist.com is verified

// Aug 2026: same Reply-To addition as reschedule-notice.ts / cancellation-notice.ts
// — replies from agencies should land in the real shared mailbox, not the
// sending domain (mail.furnitureassist.com isn't a monitored inbox).
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

// Created on first use rather than at import. The Resend constructor throws
// when the key is falsy, so building this module must not require a runtime
// secret. Still one instance per module, just deferred until a send happens.
let _resend: Resend | null = null;
const getResend = () => (_resend ??= new Resend(process.env.RESEND_API_KEY));

function currentDayAndHour(timeZone: string) {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(now);
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return { day, hour: hour.padStart(2, "0") };
}

export async function GET(req: NextRequest) {
  // Verify this request actually came from Vercel Cron.
  // Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
  // when a CRON_SECRET env var is set on the project.
  const authHeader = req.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const automation = await getAutomationSettings(AUTOMATION_NAME);

  if (!automation) {
    return NextResponse.json(
      { error: `No "${AUTOMATION_NAME}" row found in Email Automations` },
      { status: 500 }
    );
  }

  if (!automation.fields.Enabled) {
    return NextResponse.json({ skipped: "disabled" });
  }

  const { day, hour } = currentDayAndHour(TIMEZONE);
  const sendDay = automation.fields["Send Day"];
  const sendHour = (automation.fields["Send Time"] || "").slice(0, 2); // "08:00" -> "08"

  if (day !== sendDay || hour !== sendHour) {
    return NextResponse.json({ skipped: "not scheduled time", day, hour });
  }

  let dueRecords = await getDueReminders();

  // Optional safety valve for manual testing: pass ?testRecordId=recXXXXXXXX
  // to process exactly one record instead of everyone in the view.
  const testRecordId = req.nextUrl.searchParams.get("testRecordId");
  if (testRecordId) {
    dueRecords = dueRecords.filter((r) => r.id === testRecordId);
    if (dueRecords.length === 0) {
      return NextResponse.json(
        { error: `Record ${testRecordId} not found in the due-reminders view` },
        { status: 404 }
      );
    }
  }

  if (dueRecords.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const template = automation.fields.Template || "";
  const subject = automation.fields["Subject Line"] || "Appointment Reminder";

  const results: { recordId: string; status: string; error?: string }[] = [];

  for (const record of dueRecords) {
    const f = record.fields;

    // "Agency Email" is a lookup field, so Airtable's API returns it as an
    // array even though there's normally just one address in it.
    const rawAgencyEmail = f["Agency Email"];
    const toList = Array.isArray(rawAgencyEmail)
      ? rawAgencyEmail.filter(Boolean)
      : rawAgencyEmail
      ? [rawAgencyEmail]
      : [];

    if (toList.length === 0) {
      results.push({
        recordId: record.id,
        status: "skipped",
        error: "No Agency Email on record",
      });
      continue;
    }

    const to = toList.join(", "); // used for the Email Log's single-line Email field

    // "Appointment Date" is also a lookup field, so it comes back as an array.
    const rawApptDate = f["Appointment Date"];
    const apptDateStr = Array.isArray(rawApptDate) ? rawApptDate[0] : rawApptDate;

    const html = fillTemplate(template, {
      ReferringStaff: toTokenValue(f["Referring Staff"]),
      ApptDate: apptDateStr ? formatApptDate(apptDateStr) : "",
      ApptTime: toTokenValue(f["Appointment Time"]),
      ClientFirstName: toTokenValue(f["First Name"]),
      ClientLastName: toTokenValue(f["Last Name"]),
      ClientAddress: toTokenValue(f["Full Address"]),
      ClientPhone: toTokenValue(f["Phone"]),
      HouseholdSize: toTokenValue(f["# in HH"]),
      NumChildren: toTokenValue(f["# Children"]),
      ItemsRequested: toTokenValue(f["Items Requested"]),
    });

    try {
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

      // Log first. This is the record of the send actually having happened —
      // if the checkbox write below fails for any reason, we still don't
      // lose visibility into the fact that the email went out.
      await logEmailSend({
        automationRecordId: automation.id,
        clientReferralRecordId: record.id,
        recipientEmail: to,
        resendMessageId: data?.id,
        status: "Sent",
      });

      // Best-effort: mark the record as reminded. If this throws (e.g. a
      // field name mismatch), it no longer eats the log entry above — it
      // just means this record may reappear in the due-reminders view next
      // cycle, so surface it loudly rather than swallowing it.
      try {
        await markReminderSent(record.id);
      } catch (markErr) {
        console.error(`Failed to mark ${record.id} as reminded:`, markErr);
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

  return NextResponse.json({ sent: results.filter((r) => r.status === "sent").length, results });
}
