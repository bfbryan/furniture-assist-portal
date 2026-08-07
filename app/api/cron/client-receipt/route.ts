// app/api/cron/client-receipt/route.ts
//
// Tuesday batch: sends the post-appointment client receipt. Same hourly-cron
// + settings-check pattern as the other flows, but reads the existing
// "Ready to Send Post Appt Email" view (already driven by your Gemini-OCR
// pipeline + manual "Ready for Post-Appt Email" audit checkbox) instead of
// a new view, and attaches the generated receipt PDF.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable-reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/reminder-template";
import {
  getReceiptPending,
  generateAndStoreReceipt,
  markPostApptEmailSent,
} from "@/lib/client-receipt";

const AUTOMATION_NAME = "Client Receipt"; // must match the row's primary field value in Email Automations
const TIMEZONE = process.env.REMINDER_TIMEZONE || "America/New_York";
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev"; // set in Vercel now that mail.furnitureassist.com is verified

// Aug 2026: same Reply-To addition across every send site — replies from
// agencies should land in the real shared mailbox, not the sending domain
// (mail.furnitureassist.com isn't a monitored inbox).
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

const resend = new Resend(process.env.RESEND_API_KEY);

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

export async function GET(req: NextRequest) {
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
  const sendHour = (automation.fields["Send Time"] || "").slice(0, 2);

  if (day !== sendDay || hour !== sendHour) {
    return NextResponse.json({ skipped: "not scheduled time", day, hour });
  }

  let pending = await getReceiptPending();

  // Same manual-test safety valve as the other cron routes: ?testRecordId=recXXXXXXXX
  const testRecordId = req.nextUrl.searchParams.get("testRecordId");
  if (testRecordId) {
    pending = pending.filter((r) => r.id === testRecordId);
    if (pending.length === 0) {
      return NextResponse.json(
        { error: `Record ${testRecordId} not found in the Ready to Send Post Appt Email view` },
        { status: 404 }
      );
    }
  }

  if (pending.length === 0) {
    return NextResponse.json({ sent: 0 });
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

      const { data, error } = await resend.emails.send({
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

  return NextResponse.json({ sent: results.filter((r) => r.status === "sent").length, results });
}
