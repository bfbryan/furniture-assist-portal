// lib/notifications/template.ts
//
// Fills {{token}} placeholders in the HTML template stored in Airtable
// (Email Automations > Template field) with real values, and formats
// the appointment date the way Zapier's Formatter step used to.

export function formatApptDate(dateStr: string): string {
  // Airtable returns date-only fields as "YYYY-MM-DD" with no time component.
  // Parsing that directly with `new Date(...)` treats it as UTC midnight,
  // which then shifts backward a day once formatted in an earlier local
  // timezone (e.g. US timezones). Pulling the Y/M/D apart and building the
  // Date from local components avoids that shift entirely.
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Normalizes an Airtable field value (which can be a string, number,
 * array from a lookup/multi-select field, or undefined/null) into a
 * plain string safe to drop into a template.
 */
export function toTokenValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export type TemplateFill = {
  html: string;
  /**
   * Placeholder keys the template referenced but `tokens` had no value for —
   * deduped, in first-seen order. Each rendered as "" in `html`. Empty on a
   * clean fill.
   */
  unresolved: string[];
};

/**
 * Fill a template and report which placeholders had no token.
 *
 * Unknown placeholders still render as "" (unchanged behaviour — some live
 * templates carry deliberately-unfilled tokens, e.g. the reminder/notice crons
 * pass ChangeUrl/ChangeLabel ahead of the template edit that will use them).
 * `unresolved` is for the OTHER case: a caller that knows every placeholder in
 * its own template is meant to be filled, and wants to notice when the row and
 * the template have drifted apart. See sendPortalAccountEmail — this class of
 * mismatch has shipped silently four times (a staff invite greeting "Dear ,";
 * a Send Day multi-select that would have stalled three crons; getAllReferrals
 * filtering on a field that empties; the admin invite link rendering
 * about:blank). Each looked right and failed only in use.
 */
export function fillTemplateReport(
  template: string,
  tokens: Record<string, string>
): TemplateFill {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const sub = (key: string): string => {
    const value = tokens[key];
    if (value === undefined) {
      if (!seen.has(key)) {
        seen.add(key);
        unresolved.push(key);
      }
      return "";
    }
    return escapeHtml(value);
  };

  // The portal-account templates (agency welcome, staff invite, inactive,
  // reinstate) were written for Zapier and still carry its placeholder
  // dialect: {{=gives["<zap step id>"]["<key>"]}}, sometimes with single
  // quotes. The step id was only meaningful inside the Zap, so it is
  // ignored here — the inner key ("firstName", "Agency Name", "token", …)
  // is the token name. Handled first so the generic {{Token}} pass below
  // never sees the leftovers.
  const zapierFilled = template.replace(
    /{{=gives\[['"][^'"\]]*['"]\]\[['"]([^'"\]]+)['"]\]}}/g,
    (_match, key: string) => sub(key)
  );

  const html = zapierFilled.replace(
    /{{\s*(\w+)\s*}}/g,
    (_match, key: string) => sub(key)
  );

  return { html, unresolved };
}

/** Replace every {{Token}} in the template with the matching value. Unknown tokens become "". */
export function fillTemplate(
  template: string,
  tokens: Record<string, string>
): string {
  return fillTemplateReport(template, tokens).html;
}
