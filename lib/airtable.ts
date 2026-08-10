// lib/airtable.ts
//
// Read/write helpers for the Furniture Assist portal.
//
// Schema migration (June 2026) — what changed here:
//
//   Agencies:
//     DELETED: First Name, Last Name, Email, Phone Number,
//              Client Referrals (text), Agency Code, Admin Confirmed
//     ADDED:   Primary Admin (link → Agency Users)
//              Admin First Name, Admin Last Name, Admin Email,
//              Admin Phone (lookups via Primary Admin)
//              Invited Date, Rejected Date
//     RENAMED reference: "Registration Date" was never a real field —
//              the correct field name is "Record Creation Date".
//              All read sites have been corrected.
//
//   Agency Users:
//     NEW primary: Full Name (formula = {First Name} & " " & {Last Name})
//     DELETED: Client Referrals (text), Agency UID, Display Name (superseded
//              by Full Name as primary on 06/30/26)
//     ADDED:   Needs Review (Checkbox), Referrals Submitted (reverse link),
//              Full Name (formula primary)
//
//   Client Referrals:
//     NEW:     Referring Staff Link (link → Agency Users, single)
//     CHANGED (Text/Email/Phone → Lookup via Referring Staff Link):
//              Referring Agency, Referring Staff, Agency Email, Staff Phone
//     DELETED: Assigned By, Emergency
//
// Every contact-facing field on Agencies now comes through Agency Users
// via the Primary Admin link. Every staff/agency-facing field on a
// Client Referral comes through Agency Users via the Referring Staff Link.
//
// ---------------------------------------------------------------------------
// This file is now a BARREL. The implementations live in ./airtable/*.
// It re-exports the same 23 names it always has, so the 25 modules that
// `import { ... } from '@/lib/airtable'` keep working unchanged.
//
// Two modules under ./airtable are intentionally NOT re-exported here:
//
//   client.ts     The shared transport: airtableFetch, airtableFetchAll,
//                 unwrapLookup, safeLookupString, BASE_ID/API_KEY/HEADERS,
//                 REC_ID_RE. All of it was private before the split and
//                 stays private. Modules inside ./airtable import it
//                 directly from './client'.
//
//   reminders.ts  The appointment reminder automation. It opens its own
//                 Airtable SDK connection (new Airtable(...).base(...))
//                 instead of going through the shared transport above, so
//                 it is not part of this barrel's surface. Its importers
//                 reach it directly at '@/lib/airtable/reminders'.
// ---------------------------------------------------------------------------

export * from './airtable/agencies'
export * from './airtable/agency-users'
export * from './airtable/clients'
export * from './airtable/import-log'
export * from './airtable/referrals'
export * from './airtable/schedule'
export * from './airtable/stats'
