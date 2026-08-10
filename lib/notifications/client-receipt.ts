// lib/notifications/client-receipt.ts
//
// Generates the post-appointment client receipt PDF, stores it in the same
// Private Vercel Blob store as the appointment slip (under a
// "client-receipts/" prefix), and populates the Airtable "Client Receipt"
// attachment field. Triggered by the Tuesday cron off the existing
// "Ready to Send Post Appt Email" view — that view + the "Ready for
// Post-Appt Email" checkbox already exist and are populated by your
// Gemini-OCR-into-Airtable process; this just adds what happens once a
// record shows up there.

import { put } from "@vercel/blob";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  ClientReceiptDocument,
  ClientReceiptData,
  ReceiptCategory,
} from "@/components/pdf/ClientReceiptDocument";
import { toTokenValue } from "@/lib/notifications/template";

const CLIENT_RECEIPT_TABLE = "Client Referrals";
// ---- UPDATE if this doesn't match your exact Airtable view name ----
// Completed-only — No Show records are deliberately excluded (see prior
// discussion: the email/PDF both assume items were actually received,
// which isn't true for a no-show).
export const CLIENT_RECEIPT_PENDING_VIEW = "Ready to Send Post Appt Email - Completed";
// -----------------------------------------------------------------

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

export type ClientReferralReceiptRecord = {
  id: string;
  fields: Record<string, any>;
};

/** Records currently sitting in the Ready to Send Post Appt Email view. */
export async function getReceiptPending(): Promise<ClientReferralReceiptRecord[]> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
    CLIENT_RECEIPT_TABLE
  )}?view=${encodeURIComponent(CLIENT_RECEIPT_PENDING_VIEW)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) {
    throw new Error(`Failed to fetch "${CLIENT_RECEIPT_PENDING_VIEW}": ${await res.text()}`);
  }
  const data = await res.json();
  return (data.records || []).map((r: any) => ({ id: r.id, fields: r.fields }));
}

/** Same date-parsing fix used everywhere else — avoids the UTC-midnight/timezone rollback bug. */
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

function num(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return num(value[0]);
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a raw Client Referrals record into the shape ClientReceiptDocument
 * expects. Field names below match exactly what's on Client Referrals
 * (confirmed against the live field list, not the older docx labels) —
 * the OCR pipeline writes directly into these.
 */
export function buildReceiptData(fields: Record<string, unknown>): ClientReceiptData {
  const apptDateRaw = firstValue(fields["Appointment Date"]);

  // Category titles and item labels match the docx template verbatim
  // (Client_Receipt_Updated-2.docx) — only the underlying field lookups
  // were updated to the current Airtable field names.
  const leftCategories: ReceiptCategory[] = [
    {
      title: "Bedroom Furniture",
      items: [
        { label: "Mattress/Boxspring", value: num(fields["BR Mattress/Boxspring"]) },
        { label: "Bed Frame", value: num(fields["BR Bedframe"]) },
        { label: "Dresser", value: num(fields["BR Dresser"]) },
        { label: "Nightstand", value: num(fields["BR Nightstand"]) },
      ],
    },
    {
      title: "Living Room Furniture",
      items: [
        { label: "Couch/Loveseat", value: num(fields["LR Couch/Loveseat/Futon"]) },
        { label: "Chair", value: num(fields["LR Chair"]) },
        { label: "Coffee Table/TV Stand", value: num(fields["LR Coffee Table"]) },
        { label: "End Table", value: num(fields["LR End Table/TV Stand"]) },
        { label: "Bookcase/Storage", value: num(fields["LR Bookcase/Storage"]) },
        { label: "Student Desk", value: num(fields["LR Student Desk"]) },
        { label: "Lamp", value: num(fields["LR Lamp"]) },
        { label: "Picture/Other Decor", value: num(fields["LR Picture/Other Decor"]) },
        { label: "Rug", value: num(fields["LR Rug"]) },
        { label: "TV/Electronics", value: num(fields["LR TV/Electronics"]) },
      ],
    },
    {
      title: "Dining Room Furniture",
      items: [
        { label: "Dining Table", value: num(fields["DR Dining Table"]) },
        { label: "Dining Chair", value: num(fields["DR Chair"]) },
      ],
    },
  ];

  const rightCategories: ReceiptCategory[] = [
    {
      title: "Kitchen/Linen",
      items: [
        { label: "Small Appliances", value: num(fields["KH Small Appliance"]) },
        { label: "Dishes (# of boxes)", value: num(fields["KH Dishes"]) },
        { label: "Cookbooks (# of boxes)", value: num(fields["KH Cookbook"]) },
        { label: "Linen (# of bags)", value: num(fields["KH Linen"]) },
        { label: "Pots/Pans/Utensils (# of boxes)", value: num(fields["KH Pots/Pans/Utensils"]) },
        { label: "General Household", value: num(fields["KH General Household"]) },
        { label: "Bathroom", value: num(fields["KH Bathroom"]) },
        { label: "Home Office", value: num(fields["KH Home Office"]) },
      ],
    },
    {
      title: "Baby/Kids",
      items: [
        { label: "Crib/Bassinet", value: num(fields["BK Crib/Bassinet"]) },
        { label: "Toys/Books/School", value: num(fields["BK Toys/Books/School"]) },
        { label: "General Baby (# of boxes)", value: num(fields["BK General Baby"]) },
        { label: "Baby Clothes (# of bags)", value: num(fields["BK Baby Clothes"]) },
      ],
    },
    {
      title: "Clothes",
      items: [
        { label: "Clothes (# of bags)", value: num(fields["CL Clothes"]) },
        { label: "Shoes (# of bags)", value: num(fields["CL Shoes"]) },
      ],
    },
  ];

  return {
    appointmentDate: apptDateRaw ? formatApptDate(apptDateRaw) : "",
    appointmentTime: toTokenValue(fields["Appointment Time"]),
    referringAgency: toTokenValue(fields["Referring Agency"]),
    referringStaff: toTokenValue(fields["Referring Staff"]),
    clientFirstName: toTokenValue(fields["First Name"]),
    clientLastName: toTokenValue(fields["Last Name"]),
    clientAddress: toTokenValue(fields["Full Address"]),
    clientPhone: toTokenValue(fields["Phone"]),
    leftCategories,
    rightCategories,
    otherItems: toTokenValue(fields["Other Items"]),
  };
}

/** Renders the PDF for a given record's data. */
export async function generateReceiptPdf(data: ClientReceiptData): Promise<Buffer> {
  return renderToBuffer(ClientReceiptDocument({ data }));
}

function formatDateSlug(dateStr: string): string {
  return dateStr.split("T")[0];
}

/** "{LastName}-{FirstName}-{YYYY-MM-DD}.pdf" */
export function buildReceiptFilename(
  fields: Record<string, unknown>,
  recordId: string
): string {
  const lastName = toTokenValue(fields["Last Name"]) || recordId;
  const firstName = toTokenValue(fields["First Name"]);
  const apptDateRaw = firstValue(fields["Appointment Date"]);
  const datePart = apptDateRaw ? formatDateSlug(apptDateRaw) : "no-date";
  const namePart = firstName ? `${lastName}-${firstName}` : lastName;
  return `${namePart}-${datePart}.pdf`;
}

/** Uploads the receipt PDF to Private Vercel Blob, under the same store as the appointment slip. */
export async function uploadReceiptToBlob(
  recordId: string,
  buffer: Buffer
): Promise<{ url: string; pathname: string }> {
  const pathname = `client-receipts/${recordId}.pdf`;
  const blob = await put(pathname, buffer, {
    access: "private",
    contentType: "application/pdf",
    allowOverwrite: true,
    token: process.env.SLIPS_READ_WRITE_TOKEN,
  });
  return { url: blob.url, pathname: blob.pathname };
}

/**
 * Pushes the PDF into the Airtable "Client Receipt" attachment field.
 * Same clear-then-upload pattern as attachSlipToAirtable — the content
 * API's uploadAttachment endpoint only appends, so we clear first to get
 * true "replace" behavior (matters if this ever needs to be regenerated).
 */
export async function attachReceiptToAirtable(
  recordId: string,
  buffer: Buffer,
  filename: string
): Promise<void> {
  const clearRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENT_RECEIPT_TABLE)}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { "Client Receipt": [] } }),
    }
  );

  if (!clearRes.ok) {
    const text = await clearRes.text();
    throw new Error(`Airtable clear "Client Receipt" failed (${clearRes.status}): ${text}`);
  }

  const url = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${encodeURIComponent(
    "Client Receipt"
  )}/uploadAttachment`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
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

/** Marks a record as sent. Field names must match exactly what drives the "Ready to Send Post Appt Email" view. */
export async function markPostApptEmailSent(recordId: string): Promise<void> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENT_RECEIPT_TABLE)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        "Post Appt Email Sent": true,
        "Post Appt Email Sent At": new Date().toISOString(),
      },
      typecast: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Client Receipt: failed to mark Post Appt Email Sent (${res.status}): ${text}`);
  }
}

/**
 * Full generate + store pipeline for one record: builds the PDF, uploads
 * it to Blob, and attaches it in Airtable. Does NOT send the email or mark
 * Post Appt Email Sent — the cron route does that afterward, same
 * separation as generateAndStoreSlip.
 */
export async function generateAndStoreReceipt(
  recordId: string,
  fields: Record<string, unknown>
): Promise<{ buffer: Buffer; blobUrl: string; filename: string }> {
  const data = buildReceiptData(fields);
  const buffer = await generateReceiptPdf(data);
  const filename = buildReceiptFilename(fields, recordId);

  const { url } = await uploadReceiptToBlob(recordId, buffer);
  await attachReceiptToAirtable(recordId, buffer, filename);

  return { buffer, blobUrl: url, filename };
}
