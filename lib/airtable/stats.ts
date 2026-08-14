// lib/airtable/stats.ts
//
// Aggregate counts for the internal dashboard. Both tables are read in full
// via airtableFetchAll — a single airtableFetch caps at 100 records and
// would silently under-count.

import { airtableFetchAll, safeLookupString } from './client'
import { easternTodayISO } from '../dates'

export async function getDashboardStats() {
  // Both tables need the FULL row set to compute accurate totals; a single
  // airtableFetch caps at 100 records and silently under-counts.
  const [agencies, referrals] = await Promise.all([
    airtableFetchAll('Agencies', ''),
    airtableFetchAll('Client Referrals', '?sort[0][field]=Referral%20Date&sort[0][direction]=desc'),
  ])

  // The Eastern month, not the runtime's. Read off the server clock, "this
  // month" flipped over on the last evening of the month, so those referrals
  // were counted against the month that had not started yet.
  const startOfMonth = `${easternTodayISO().slice(0, 7)}-01`

  const agencyRecords = agencies.records
  const referralRecords = referrals.records

  return {
    totalAgencies: agencyRecords.length,
    pendingAgencies: agencyRecords.filter((r: any) => r.fields['Status'] === 'Pending').length,
    approvedAgencies: agencyRecords.filter((r: any) => r.fields['Status'] === 'Approved').length,
    totalReferrals: referralRecords.length,
    pendingReferrals: referralRecords.filter((r: any) => r.fields['Referral Review'] === 'Pending').length,
    scheduledReferrals: referralRecords.filter(
      (r: any) =>
        r.fields['Appointment Status']?.name === 'Scheduled' ||
        r.fields['Appointment Status'] === 'Scheduled',
    ).length,
    thisMonthReferrals: referralRecords.filter((r: any) => r.fields['Referral Date'] >= startOfMonth).length,
    recentReferrals: referralRecords.slice(0, 5).map((record: any) => {
      const f = record.fields
      return {
        id: record.id,
        clientName: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
        referralDate: f['Referral Date'] as string,
        referralReview: f['Referral Review'] as string,
        appointmentStatus: f['Appointment Status'] as string,
        // Guarded lookups — return null instead of rec IDs.
        referringAgency: safeLookupString(f['Referring Agency']),
        referredBy: safeLookupString(f['Referring Staff']),
      }
    }),
    pendingAgencyList: agencyRecords
      .filter((r: any) => r.fields['Status'] === 'Pending')
      .slice(0, 5)
      .map((record: any) => {
        const f = record.fields
        const adminFirst = safeLookupString(f['Admin First Name']) ?? ''
        const adminLast = safeLookupString(f['Admin Last Name']) ?? ''
        return {
          id: record.id,
          name: f['Agency Name'] as string,
          city: f['City'] as string,
          // FIXED: "Registration Date" → "Record Creation Date"
          registrationDate: (f['Record Creation Date'] as string) ?? null,
          contactName: `${adminFirst} ${adminLast}`.trim(),
        }
      }),
  }
}
