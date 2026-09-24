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
// Three purposes, not one shape:
//   'missed'    — the no-show send. The client didn't come; ask for a new
//                 date. No time in the body — a missed appointment's time
//                 doesn't matter to what happens next.
//   'cancelled' — the Cancellation Notice. The appointment is gone; ask
//                 for a new date, same trailing prompt as 'missed', but
//                 the appointment line itself needs date AND time (unlike
//                 'missed') — cancellation-notice.ts still has both, from
//                 the original appointment, captured before its own cancel
//                 PATCH cleared them off the record.
//   'upcoming'  — everyone else. An appointment exists (reminder,
//                 confirmation, reschedule) and might need to change.

import { formatDateOnly } from "@/lib/dates";
import { toTokenValue } from "@/lib/notifications/template";

const CHANGE_FALLBACK_ADDRESS = "agencies@furnitureassist.com";

export type AgencyMailtoPurpose = "missed" | "cancelled" | "upcoming";

/**
 * Every field here is `unknown` ON PURPOSE, and every one is pushed through
 * toTokenValue() before it is used.
 *
 * These used to be typed `string | null`, which was a lie that cost two weeks
 * of silent non-delivery (Sep 2026). Callers pass raw Airtable fields, and
 * First Name / Last Name on Client Referrals are LOOKUPS through the Client
 * link — they arrive as `["Edward"]`, not `"Edward"`. TypeScript never caught
 * it because reschedule-notice.ts and cancellation-notice.ts read their record
 * through a `Record<string, any>`, so `any` satisfied `string | null` at every
 * call site. At runtime `(["Edward"] ?? "").trim()` threw
 * "TypeError: (e ?? '').trim is not a function" inside the name .map() below,
 * which aborted the whole notice before a single row was written anywhere.
 *
 * Declaring the real shape (unknown) rather than the hoped-for one is the
 * point: it forces the coercion to happen here, once, at the choke point all
 * five callers already share, instead of relying on each of them to remember
 * a String() or a toTokenValue() wrapper. The three cron callers happened to
 * wrap theirs and survived; the two event-fired notices did not and did not.
 */
export type AgencyMailtoInfo = {
  clientFirstName?: unknown;
  clientLastName?: unknown;
  /** 'YYYY-MM-DD', or an Airtable lookup wrapping one. */
  apptDateStr?: unknown;
  /** e.g. '10am' — used for 'cancelled' and 'upcoming'; 'missed' never
   *  shows a time. */
  apptTime?: unknown;
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
 * value is missing: no "Client: " with nothing after it, no "Missed
 * appointment:" without a date, and for 'cancelled'/'upcoming' no
 * appointment line at all unless BOTH date and time are known — one
 * without the other is still a half-filled version of the
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
  const subject = purpose === "upcoming" ? "Appointment change request" : "Reschedule request";

  const lines: string[] = [];

  // toTokenValue is the codebase's existing coercion for exactly this —
  // undefined/null -> "", an Airtable lookup array -> its values joined, and
  // anything else -> String(). Reused rather than reimplemented as a second
  // near-identical helper; the three cron callers already wrap their own
  // arguments with it, so this makes all five consistent by construction.
  const name = [info.clientFirstName, info.clientLastName]
    .map((s) => toTokenValue(s).trim())
    .filter(Boolean)
    .join(" ");
  if (name) lines.push(`Client: ${name}`);

  const apptDateStr = toTokenValue(info.apptDateStr).trim();
  const apptTime = toTokenValue(info.apptTime).trim();

  const dateLabel = apptDateStr
    ? formatDateOnly(apptDateStr, { month: "short", day: "numeric" })
    : "";

  if (purpose === "missed") {
    if (dateLabel) lines.push(`Missed appointment: ${dateLabel}`);
  } else if (dateLabel && apptTime) {
    // 'cancelled' and 'upcoming' both need date AND time, or the whole
    // line drops — half of "<Mon D>, <time>" isn't a genuinely useful
    // partial line.
    const label = purpose === "cancelled" ? "Cancelled appointment" : "Appointment";
    lines.push(`${label}: ${dateLabel}, ${apptTime}`);
  }

  lines.push(purpose === "upcoming" ? "Change needed (cancel or new date):" : "Preferred new date:");

  const body = lines.join("\n");
  return `mailto:${CHANGE_FALLBACK_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
