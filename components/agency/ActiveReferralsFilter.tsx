'use client'

// components/agency/ActiveReferralsFilter.tsx
//
// The staff filter shared by the Active Referrals and History pages, and the
// header counts on both, which follow it.
//
// It is still named for Active because that is where it was written; History
// was the second caller and reuses this provider rather than carrying a second
// copy of the same state. History's own tiles live next to History's outcome
// rules, in app/(agency)/referrals/history/HistoryClient.tsx - only the
// provider and the hook are shared.
//
// Why this exists: the counts were computed on the server across the whole
// agency, while the "Filter by Staff" dropdown below them filtered the list in
// the browser. So picking a staff member re-drew the list and left the numbers
// above it completely still — an admin filtering to one person saw that
// person's referrals under the agency's totals, with nothing saying the two
// were measuring different things.
//
// Fixing it means the numbers and the list have to read one piece of state.
// The counts live in the page hero and the list lives in <main>, so the state
// is held here, in a provider the server page wraps around both. The referrals
// themselves are held here too, so the array crosses the server/client
// boundary once rather than once per consumer.
//
// Nothing changes for a staff (non-admin) user: they are only ever sent their
// own referrals, the dropdown is admin-only, and the filter therefore stays on
// 'all' — which selects every referral they were given, exactly as before.
//
// `filtered` is the STAFF filter only. History layers its own search, outcome
// and date-range controls on top of it inside HistoryClient; those deliberately
// do not reach the header tiles, because a "Completed" count that reads 0
// because you clicked the Cancelled chip is worse than no count at all. Active
// has no other filters, so there the two sets are the same thing.

import { createContext, useContext, useMemo, useState } from 'react'

// The fields this file reads. Kept structural rather than importing
// ReferralTable's Referral type, so the two can be checked independently.
type FilterableReferral = {
  referredBy: string | null
  referralReview: string
  appointmentStatus: string
}

type StaffFilterValue<T extends FilterableReferral = FilterableReferral> = {
  /** Selected staff name, or 'all'. */
  staffFilter: string
  setStaffFilter: (v: string) => void
  /** Every referral the server sent, unfiltered. */
  referrals: T[]
  /** Referrals matching the current selection — what the list renders. */
  filtered: T[]
  /** Distinct staff names, for the dropdown. */
  staffNames: string[]
}

const Ctx = createContext<StaffFilterValue | null>(null)

export function useStaffFilter<
  T extends FilterableReferral = FilterableReferral,
>(): StaffFilterValue<T> {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useStaffFilter must be used inside <StaffFilterProvider>')
  }
  return ctx as StaffFilterValue<T>
}

export function StaffFilterProvider<T extends FilterableReferral>({
  referrals,
  children,
}: {
  referrals: T[]
  children: React.ReactNode
}) {
  const [staffFilter, setStaffFilter] = useState<string>('all')

  const value = useMemo<StaffFilterValue<T>>(() => {
    const staffNames = Array.from(
      new Set(referrals.map(r => r.referredBy).filter(Boolean)),
    ) as string[]

    const filtered =
      staffFilter === 'all'
        ? referrals
        : referrals.filter(r => r.referredBy === staffFilter)

    return { staffFilter, setStaffFilter, referrals, filtered, staffNames }
  }, [referrals, staffFilter])

  return <Ctx.Provider value={value as StaffFilterValue}>{children}</Ctx.Provider>
}

// ActiveHeroStats (the Pending / Scheduled tiles) lived here — removed with the
// Active page layout rework: the two counts duplicated the dashboard and
// neither was actionable. The provider now only serves the staff filter and
// the active set to ReferralTable.
