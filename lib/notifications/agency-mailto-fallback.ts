// lib/notifications/agency-mailto-fallback.ts
//
// The one place every agency email's "no portal access" fallback builds
// its mailto: link. Used everywhere ChangeUrl/ChangeLabel falls back to
// "email us" instead of a portal deep link:
//   - app/api/cron/appointment-reminders/route.ts    (Monday reminder)
//   - app/api/cron/appointment-slip-notice/route.ts  (Wednesday confirmation)
//   - app/api/cron/client-receipt/route.ts           (Tuesday no-show send)
//   - lib/notifications/change-instruction.ts, and through it
//     reschedule-notice.ts and cancellation-notice.ts (event-fired)
// One shared builder so none of them can drift on subject/body shape
// independently — before this, each of the five had its own bare
// "mailto:agencies@furnitureassist.com" literal with no subject or body.
//
// Two purposes, not one shape:
//   'missed'   — the no-show send. The client didn't come; ask for a new
//                date. No time in the body — a missed appointment's time
//                doesn't matter to what happens next.
//   'upcoming' — everyone else. An appointment exists (reminder,
//                confirmation, reschedule) or existed until just now
//                (cancellation) and might need to change.

import { formatDateOnly } from "@/lib/dates";

const CHANGE_FALLBACK_ADDRESS = "agencies@furnitureassist.com";

export type AgencyMailtoPurpose = "missed" | "upcoming";

export type AgencyMailtoInfo = {
  clientFirstName?: string | null;
  clientLastName?: string | null;
  /** 'YYYY-MM-DD'. */
  apptDateStr?: string | null;
  /** e.g. '10am' — only used for 'upcoming'; 'missed' never shows a time. */
  apptTime?: string | null;
};

/**
 * Builds the "email us" fallback mailto: link, subject and body prefilled.
 *
 * Never puts the client's name in the subject — a subject line shows on a
 * lock screen and in a shared inbox list without anyone opening the
 * message, and some agencies serve clients for whom that exposure is a
 * real risk. The name goes in the body only, where opening the message is
 * required to see it.
 *
 * Every data line is dropped outright, not shown half-filled, when its
 * value is missing: no "Client: " with nothing after it, and for
 * 'upcoming' no "Appointment:" line unless BOTH date and time are known —
 * one without the other is still a half-filled version of the
 * "<Mon D>, <time>" shape, not a genuinely useful partial line. The
 * trailing prompt line ("Preferred new date:" / "Change needed…") carries
 * no variable data and always appears.
 *
 * encodeURIComponent does two jobs at once here: it percent-encodes the
 * subject/body text (an accent, an apostrophe, or a stray "&" in a name
 * can't break the query string), and a literal newline in the body
 * becomes %0A in the output — the correct mailto line-break escape, with
 * no manual %0A substitution needed.
 *
 * The returned string later becomes a fillTemplate token value inside an
 * href="..." attribute. fillTemplate's escapeHtml turns this string's own
 * "&" (the query-string separator between subject and body) into "&amp;",
 * which every mail/browser client decodes back to "&" when it reads the
 * href — a valid, required escape for an HTML attribute, not a bug.
 * Nothing else in the string needs escaping: after encodeURIComponent,
 * the subject and body contain no literal &, <, >, or " for escapeHtml to
 * find.
 */
export function buildAgencyMailtoFallback(
  purpose: AgencyMailtoPurpose,
  info: AgencyMailtoInfo
): string {
  const subject = purpose === "missed" ? "Reschedule request" : "Appointment change request";

  const lines: string[] = [];

  const name = [info.clientFirstName, info.clientLastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (name) lines.push(`Client: ${name}`);

  const dateLabel = info.apptDateStr
    ? formatDateOnly(info.apptDateStr, { month: "short", day: "numeric" })
    : "";

  if (purpose === "missed") {
    if (dateLabel) lines.push(`Missed appointment: ${dateLabel}`);
    lines.push("Preferred new date:");
  } else {
    if (dateLabel && info.apptTime) {
      lines.push(`Appointment: ${dateLabel}, ${info.apptTime}`);
    }
    lines.push("Change needed (cancel or new date):");
  }

  const body = lines.join("\n");
  return `mailto:${CHANGE_FALLBACK_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
