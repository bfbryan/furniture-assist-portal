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

/** Replace every {{Token}} in the template with the matching value. Unknown tokens become "". */
export function fillTemplate(
  template: string,
  tokens: Record<string, string>
): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    const value = tokens[key];
    return value !== undefined ? escapeHtml(value) : "";
  });
}
