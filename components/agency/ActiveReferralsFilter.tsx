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

/**
 * The Pending / Scheduled tiles in the page hero.
 *
 * Both definitions are lifted unchanged from the server page they replace —
 * Pending is `Referral Review = 'Pending'` and Scheduled is
 * `Appointment Status = 'Scheduled'` — so the only thing that has changed is
 * the set they are counted over.
 */
export function ActiveHeroStats() {
  const { filtered } = useStaffFilter()

  const pendingCount = filtered.filter(r => r.referralReview === 'Pending').length
  const scheduledCount = filtered.filter(r => r.appointmentStatus === 'Scheduled').length

  return (
    <div className="fa-hero-stats flex items-center gap-4 flex-wrap">
      <div className="bg-white/8 border border-white/12 rounded-xl px-5 py-3 text-center min-w-[80px]">
        <div className="font-montserrat font-extrabold text-2xl text-white leading-none mb-1">
          {pendingCount}
        </div>
        <div className="text-xs font-bold uppercase tracking-wider text-white/45">Pending</div>
      </div>
      <div className="bg-white/8 border border-[rgba(58,160,141,0.4)] rounded-xl px-5 py-3 text-center min-w-[80px]">
        <div className="font-montserrat font-extrabold text-2xl text-[#3AA08D] leading-none mb-1">
          {scheduledCount}
        </div>
        <div className="text-xs font-bold uppercase tracking-wider text-white/45">Scheduled</div>
      </div>
    </div>
  )
}
