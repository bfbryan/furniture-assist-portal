// lib/airtable-reminders.ts
//
// Airtable access for the appointment reminder automation.
// If you already have an Airtable client set up elsewhere in the app,
// reuse that instead of creating a second `base()` connection here —
// just point the table/view name constants below at your existing setup.

import Airtable from "airtable";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID!
);

// ---- UPDATE THESE to match your exact Airtable table/view names ----
export const CLIENT_REFERRAL_TABLE = "Client Referrals";
export const EMAIL_AUTOMATIONS_TABLE = "Email Automations";
export const EMAIL_LOG_TABLE = "Email Log";

// The existing view that already filters:
// Status = Scheduled, Reminder Email Sent = blank, Appt Date within 5 days
export const REMINDER_DUE_VIEW = "Reminder Email Pending";
// ----------------------------------------------------------------------

export type ClientReferralRecord = {
  id: string;
  fields: {
    "Referring Staff"?: string;
    "Agency Email"?: string | string[]; // lookup field — Airtable API returns this as an array
    "Appointment Date"?: string | string[]; // lookup field — Airtable API returns this as an array
    "Appointment Time"?: string;
    "First Name"?: string;
    "Last Name"?: string;
    "Full Address"?: string;
    Phone?: string;
    "# in HH"?: number;
    "# Children"?: number;
    "Items Requested"?: string;
    "Reminder Email Sent"?: boolean;
    "Reminder Sent At"?: string;
  };
};

export type EmailAutomationRecord = {
  id: string;
  fields: {
    "Email Type": string; // primary field, e.g. "Appointment Reminder"
    Enabled?: boolean;
    "Send Day"?: string; // e.g. "Monday"
    "Send Time"?: string; // e.g. "08:00"
    "Subject Line"?: string;
    Template?: string;
  };
};

/** Fetch the settings row for a given automation by its primary field value. */
export async function getAutomationSettings(
  automationName: string
): Promise<EmailAutomationRecord | null> {
  const records = await base(EMAIL_AUTOMATIONS_TABLE)
    .select({
      filterByFormula: `{Email Type} = "${automationName}"`,
      maxRecords: 1,
    })
    .firstPage();

  if (records.length === 0) return null;

  return {
    id: records[0].id,
    fields: records[0].fields as EmailAutomationRecord["fields"],
  };
}

/** Fetch all Client Referral records currently sitting in the "reminder due" view. */
export async function getDueReminders(): Promise<ClientReferralRecord[]> {
  const records = await base(CLIENT_REFERRAL_TABLE)
    .select({ view: REMINDER_DUE_VIEW })
    .all();

  return records.map((r) => ({
    id: r.id,
    fields: r.fields as ClientReferralRecord["fields"],
  }));
}

/** Mark a Client Referral record as reminded. */
export async function markReminderSent(recordId: string): Promise<void> {
  await base(CLIENT_REFERRAL_TABLE).update(recordId, {
    "Reminder Email Sent": true,
    "Reminder Sent At": new Date().toISOString(),
  });
}

/** Create one Email Log row for a send attempt. */
export async function logEmailSend(params: {
  automationRecordId: string;
  clientReferralRecordId: string;
  recipientEmail: string;
  resendMessageId?: string;
  status: "Sent" | "Delivered" | "Bounced" | "Complained" | "Failed";
  bounceReason?: string;
}): Promise<void> {
  // typecast: true matters here specifically for `Status` — it's a single
  // select field, and without typecast, a write whose value isn't an
  // exact-match existing option gets rejected outright (the whole create()
  // call fails, no row gets written, no error surfaces anywhere visible).
  // typecast also auto-creates the missing option going forward.
  await base(EMAIL_LOG_TABLE).create(
    {
      "Email Type": [params.automationRecordId],
      "Agency User Email": params.recipientEmail,
      "Sent At": new Date().toISOString(),
      "Resend Message ID": params.resendMessageId ?? "",
      Status: params.status,
      "Bounce Reason": params.bounceReason ?? "",
      "Client Referrals": [params.clientReferralRecordId],
    },
    { typecast: true }
  );
}
