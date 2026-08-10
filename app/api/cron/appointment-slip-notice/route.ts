// app/api/cron/appointment-slip-notice/route.ts
//
// Wednesday batch: covers referrals booked/confirmed over the prior week.
// Same hourly-cron + settings-check pattern as the reminder route, but reads
// a different view (Confirm Email Pending) and a different Email Automations
// row ("Appointment Slip Notice"), and attaches the generated PDF slip.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAutomationSettings, logEmailSend } from "@/lib/airtable-reminders";
import { fillTemplate, formatApptDate, toTokenValue } from "@/lib/reminder-template";
import {
  getConfirmEmailPending,
  generateAndStoreSlip,
  markConfirmEmailSent,
} from "@/lib/appointment-slip";

// Aug 2026: same fix as appointment-reminders/route.ts -- without this,
// Next.js can serve a cached response for this GET route instead of
// invoking the function on every cron call, which shows up as zero logged
// invocations in Vercel's Cron Jobs tab even though the schedule is firing.
export const dynamic = "force-dynamic";

const AUTOMATION_NAME = "Appointment Confirmation"; // must match the row's primary field value in Email Automations
const TIMEZONE = process.env.REMINDER_TIMEZONE || "America/New_York";
const FROM_ADDRESS =
  process.env.REMINDER_FROM_ADDRESS || "onboarding@resend.dev"; // set in Vercel now that mail.furnitureassist.com is verified

// Aug 2026: same Reply-To addition across every send site — replies from
// agencies should land in the real shared mailbox, not the sending domain
// (mail.furnitureassist.com isn't a monitored inbox).
const REPLY_TO_ADDRESS =
  process.env.REMINDER_REPLY_TO_ADDRESS || "agencies@furnitureassist.com";

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

  let pending = await getConfirmEmailPending();

  // Same manual-test safety valve as the reminder route: ?testRecordId=recXXXXXXXX
  const testRecordId = req.nextUrl.searchParams.get("testRecordId");
  if (testRecordId) {
    pending = pending.filter((r) => r.id === testRecordId);
    if (pending.length === 0) {
      return NextResponse.json(
        { error: `Record ${testRecordId} not found in the Confirm Email Pending view` },
        { status: 404 }
      );
    }
  }

  if (pending.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const template = automation.fields.Template || "";
  const subject = automation.fields["Subject Line"] || "Appointment Confirmed";

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
      // Generate the slip PDF, upload to Blob, and attach it in Airtable.
      const { buffer } = await generateAndStoreSlip(record.id, f);

      const html = fillTemplate(template, {
        ReferringStaff: toTokenValue(f["Referring Staff"]),
        ReferringAgency: toTokenValue(f["Referring Agency"]),
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

      const clientLastName = toTokenValue(f["Last Name"]) || record.id;

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

      // Log first, same reasoning as the reminder route — this is the
      // actual record that the send happened, independent of whether the
      // checkbox write below succeeds.
      await logEmailSend({
        automationRecordId: automation.id,
        clientReferralRecordId: record.id,
        recipientEmail: to,
        resendMessageId: data?.id,
        status: "Sent",
      });

      // Best-effort: mark the record as confirmed. If this throws, it no
      // longer eats the log entry above — surface it loudly instead of
      // swallowing it, since a failure here means this record could
      // reappear in Confirm Email Pending next cycle.
      try {
        await markConfirmEmailSent(record.id);
      } catch (markErr) {
        console.error(`Failed to mark ${record.id} as confirmed:`, markErr);
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
