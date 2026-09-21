// lib/notifications/no-show-notice.ts
//
// Read/write helpers for the Tuesday missed-appointment (no-show) email.
// Sent alongside the Client Receipt from the same cron
// (app/api/cron/client-receipt/route.ts), reading a separate Airtable view.
//
// Deliberately does NOT touch "Post Appt Email Sent" / "Post Appt Email Sent
// At" — that pair belongs to the receipt alone, on a field Ben already
// created for this: "No Show Email Sent At". A no-show can reach Completed
// WITHOUT ever passing through rescheduleReferral() — the no-show email
// itself asks the agency to say if the client actually came in, and Ben
// corrects the status directly in Airtable when they do. If this send
// shared the receipt's marker, that correction would leave the referral
// permanently excluded from the Completed view (it would already read as
// "post-appt email sent" from the no-show send). Each email keeps its own
// marker so neither can block the other.

const CLIENT_REFERRAL_TABLE = "Client Referrals";
// ---- UPDATE if this doesn't match the exact Airtable view name ----
// Ben's own filter (not re-derived here): Status = No Show, Ready for
// Post-Appt Email = checked, No Show Email Sent At is empty.
export const NO_SHOW_PENDING_VIEW = "Ready to Send Post Appt Email - No Show";
// --------------------------------------------------------------------

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

export type NoShowRecord = {
  id: string;
  fields: Record<string, unknown>;
};

/** Records currently sitting in the No Show Ready-to-send view. */
export async function getNoShowPending(): Promise<NoShowRecord[]> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
    CLIENT_REFERRAL_TABLE
  )}?view=${encodeURIComponent(NO_SHOW_PENDING_VIEW)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) {
    throw new Error(`Failed to fetch "${NO_SHOW_PENDING_VIEW}": ${await res.text()}`);
  }
  const data = await res.json();
  return (data.records || []).map((r: { id: string; fields: Record<string, unknown> }) => ({
    id: r.id,
    fields: r.fields,
  }));
}

/**
 * Retires a record after a successful send: stamps this email's own marker
 * and clears the manual trigger checkbox.
 *
 * Clearing "Ready for Post-Appt Email" here (not leaving it for whoever
 * corrects the record to Completed to notice) matters: if a later
 * correction fires the receipt on the SAME stale tick, the receipt would
 * go out with no items-disbursed fields ever filled in for it. A
 * correction has to earn a fresh tick from Ben.
 *
 * Never writes "Post Appt Email Sent" / "Post Appt Email Sent At" — see
 * the file header.
 */
export async function markNoShowEmailSent(recordId: string): Promise<void> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CLIENT_REFERRAL_TABLE)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        "No Show Email Sent At": new Date().toISOString(),
        "Ready for Post-Appt Email": false,
      },
      typecast: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`No-show notice: failed to mark ${recordId} as sent (${res.status}): ${text}`);
  }
}
