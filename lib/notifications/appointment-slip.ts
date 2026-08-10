// lib/notifications/appointment-slip.ts
//
// Generates the appointment slip PDF for a Client Referral record, stores it
// in a Private Vercel Blob, and populates the Airtable "Appt Slip" attachment
// field. Shared by both the Wednesday batch cron and the immediate reschedule
// flow — reschedule just calls generateAndStoreSlip() again to replace it.

import Airtable from "airtable";
import { put, del } from "@vercel/blob";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  AppointmentSlipDocument,
  AppointmentSlipData,
} from "@/components/pdf/AppointmentSlipDocument";
import { toTokenValue } from "@/lib/notifications/template";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID!
);

// ---- UPDATE if these don't match your exact Airtable names ----
const CLIENT_REFERRAL_TABLE = "Client Referrals";
const CONFIRM_EMAIL_PENDING_VIEW = "Confirm Email Pending";
// -----------------------------------------------------------------

export type ClientReferralSlipRecord = {
  id: string;
  fields: Record<string, unknown>;
};

/** Records currently sitting in the Confirm Email Pending view. */
export async function getConfirmEmailPending(): Promise<ClientReferralSlipRecord[]> {
  const records = await base(CLIENT_REFERRAL_TABLE)
    .select({ view: CONFIRM_EMAIL_PENDING_VIEW })
    .all();

  return records.map((r) => ({ id: r.id, fields: r.fields }));
}

/** Same date-parsing fix as the reminder email — avoids the UTC-midnight/timezone rollback bug. */
function formatSimpleDate(dateStr: string): string {
  const datePart = dateStr.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatApptDate(dateStr: string): string {
  const datePart = dateStr.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : "";
  return value !== undefined && value !== null ? String(value) : "";
}

/** Maps a raw Airtable record into the shape AppointmentSlipDocument expects. */
export function buildSlipData(fields: Record<string, unknown>): AppointmentSlipData {
  const apptDateRaw = firstValue(fields["Appointment Date"]);
  const dobRaw = firstValue(fields["DOB"]);

  return {
    appointmentDate: apptDateRaw ? formatApptDate(apptDateRaw) : "",
    appointmentTime: toTokenValue(fields["Appointment Time"]),
    clientFirstName: toTokenValue(fields["First Name"]),
    clientLastName: toTokenValue(fields["Last Name"]),
    clientDOB: dobRaw ? formatSimpleDate(dobRaw) : "",
    clientAddress: toTokenValue(fields["Full Address"]),
    clientPhone: toTokenValue(fields["Phone"]),
    language: toTokenValue(fields["Preferred Language"]),
    householdMembers: toTokenValue(fields["# in HH"]),
    numChildren: toTokenValue(fields["# Children"]),
    itemsRequested: toTokenValue(fields["Items Requested"]),
    notes: toTokenValue(fields["External Notes"]),
    referringAgency: toTokenValue(fields["Referring Agency"]),
    referringStaff: toTokenValue(fields["Referring Staff"]),
  };
}

/** Renders the PDF for a given record's data. */
export async function generateSlipPdf(data: AppointmentSlipData): Promise<Buffer> {
  return renderToBuffer(AppointmentSlipDocument({ data }));
}

/** Uploads the PDF to Private Vercel Blob, replacing any existing file at the same path. */
export async function uploadSlipToBlob(
  recordId: string,
  buffer: Buffer
): Promise<{ url: string; pathname: string }> {
  const pathname = `appointment-slips/${recordId}.pdf`;
  const blob = await put(pathname, buffer, {
    access: "private",
    contentType: "application/pdf",
    allowOverwrite: true, // reschedules regenerate + replace the same file
    token: process.env.SLIPS_READ_WRITE_TOKEN,
  });
  return { url: blob.url, pathname: blob.pathname };
}

/** Deletes a previously stored slip (used on reschedule before uploading the new one, or on retention cleanup). */
export async function deleteSlipFromBlob(pathnameOrUrl: string): Promise<void> {
  await del(pathnameOrUrl, { token: process.env.SLIPS_READ_WRITE_TOKEN });
}

/**
 * Pushes the PDF into the Airtable "Appt Slip" attachment field via the
 * direct upload endpoint.
 *
 * The content API's uploadAttachment endpoint only APPENDS to an
 * attachment field — it never replaces what's already there (confirmed in
 * Airtable's own docs). So on a reschedule, calling it a second time was
 * leaving both the old and new slip sitting in the field. To get true
 * "replace" behavior we first clear the field with a normal record PATCH
 * (setting it to []), then upload the new file.
 */
export async function attachSlipToAirtable(
  recordId: string,
  buffer: Buffer,
  filename: string
): Promise<void> {
  // 1. Clear any existing attachment(s) first.
  const clearRes = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${CLIENT_REFERRAL_TABLE.replace(
      / /g,
      "%20"
    )}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { "Appt Slip": [] } }),
    }
  );

  if (!clearRes.ok) {
    const text = await clearRes.text();
    throw new Error(`Airtable clear "Appt Slip" failed (${clearRes.status}): ${text}`);
  }

  // 2. Upload the new file.
  const url = `https://content.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(
    "Appt Slip"
  )}/uploadAttachment`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: "application/pdf",
      file: buffer.toString("base64"),
      filename,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable uploadAttachment failed (${res.status}): ${text}`);
  }
}

/** Marks a record as confirmed/notified. */
export async function markConfirmEmailSent(recordId: string): Promise<void> {
  await base(CLIENT_REFERRAL_TABLE).update(recordId, {
    "Confirm Email Sent": true,
    "Confirm Email Sent At": new Date().toISOString(),
  });
}

/**
 * Full generate + store pipeline for one record: builds the PDF, uploads it
 * to Blob (replacing any prior version), and attaches it in Airtable.
 * Does NOT send the email or mark Confirm Email Sent — callers (the
 * Wednesday cron, or the reschedule handler) do that afterward.
 */
export async function generateAndStoreSlip(
  recordId: string,
  fields: Record<string, unknown>
): Promise<{ buffer: Buffer; blobUrl: string }> {
  const data = buildSlipData(fields);
  const buffer = await generateSlipPdf(data);

  const filename = `appointment-slip-${data.clientLastName || recordId}.pdf`;

  const { url } = await uploadSlipToBlob(recordId, buffer);
  await attachSlipToAirtable(recordId, buffer, filename);

  return { buffer, blobUrl: url };
}
