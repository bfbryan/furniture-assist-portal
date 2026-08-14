// lib/airtable/email-log.ts
//
// Reads the Email Log table — one row per email the portal has attempted to
// send, written by logEmailSend() in lib/airtable/reminders.ts.
//
// Row shape in Airtable:
//   Email Type        link → Email Automations (the automation that sent it)
//   Status            Sent | Delivered | Bounced | Complained | Failed
//   Sent At           datetime
//   Agency User Email the recipient
//   Bounce Reason     text, only populated on a Bounced / Failed row
//   Client Referrals  link → Client Referrals
//
// Why we walk the link from the referral rather than filtering Email Log:
// Airtable formulas compare a linked-record field against the linked table's
// PRIMARY field, not its record ID, and Client Referrals' primary field is a
// formula ('Unique ID'). Client Referrals carries the reverse link ('Email
// Log'), so reading the ids off the referral and fetching those rows by
// RECORD_ID() is both exact and cheap.
//
// Email Type is a link, so it comes back as record IDs. Resolving them needs
// the Email Automations table; that fetch runs in parallel with the log rows.

import { airtableFetch, airtableFetchAll } from './client'

/** Just enough of an Airtable record to read one Email Log row. */
type AirtableRecord = { id: string; fields?: Record<string, unknown> }
type AirtablePage = { records?: AirtableRecord[] }

export type EmailLogEntry = {
  id: string
  /** Automation name, e.g. 'Appointment Confirmation'. Null if unresolvable. */
  type: string | null
  status: string | null
  /** ISO datetime, or null on a row written without one. */
  sentAt: string | null
  recipient: string | null
  /** Only ever set on a Bounced / Failed row. */
  bounceReason: string | null
}

/** Chunk size for the RECORD_ID() OR(...) formula, to keep the URL sane. */
const ID_BATCH = 40

function buildRecordIdFormula(ids: string[]): string {
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

/**
 * Every logged email for one referral, newest first.
 *
 * Never throws: this is supporting detail on a page whose primary content is
 * the referral itself, so a failure here returns an empty list rather than
 * taking the page down with it.
 */
export async function getEmailLogForReferral(referralId: string): Promise<EmailLogEntry[]> {
  try {
    const referral = await airtableFetch('Client Referrals', `/${referralId}`)
    const logIds: string[] = referral?.fields?.['Email Log'] ?? []
    if (logIds.length === 0) return []

    const batches: string[][] = []
    for (let i = 0; i < logIds.length; i += ID_BATCH) {
      batches.push(logIds.slice(i, i + ID_BATCH))
    }

    const [automationRecords, ...logPages] = await Promise.all([
      // Small table, one field. Names live on the automation row, not on the
      // log row, so there is no way to avoid resolving them.
      airtableFetchAll('Email Automations', '?fields%5B%5D=Email%20Type'),
      ...batches.map(ids =>
        airtableFetch(
          'Email Log',
          `?filterByFormula=${encodeURIComponent(buildRecordIdFormula(ids))}&maxRecords=${ids.length}`,
        ),
      ),
    ])

    const typeNameById = new Map<string, string>()
    for (const a of (automationRecords.records ?? []) as AirtableRecord[]) {
      const name = a.fields?.['Email Type']
      if (typeof name === 'string' && name.trim() !== '') typeNameById.set(a.id, name)
    }

    const entries: EmailLogEntry[] = (logPages as AirtablePage[])
      .flatMap(page => page.records ?? [])
      .map(r => {
        const f = r.fields ?? {}
        const typeId = (f['Email Type'] as string[])?.[0] ?? null
        const bounce = (f['Bounce Reason'] as string) ?? ''
        return {
          id: r.id,
          type: typeId ? typeNameById.get(typeId) ?? null : null,
          status: (f['Status'] as string) ?? null,
          sentAt: (f['Sent At'] as string) ?? null,
          recipient: (f['Agency User Email'] as string) ?? null,
          // logEmailSend writes '' rather than leaving it blank, so normalize.
          bounceReason: bounce.trim() === '' ? null : bounce,
        }
      })

    // Newest first. Rows with no Sent At sort last rather than to the top.
    return entries.sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
  } catch (e) {
    console.error(`Email Log lookup failed for referral ${referralId}:`, e)
    return []
  }
}
