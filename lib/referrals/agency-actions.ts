// lib/referrals/agency-actions.ts
//
// Which of the agency's three referral actions apply, derived from the portal
// status (getPortalStatus output). One definition, shared by the referral
// detail page's action bar (app/(agency)/referrals/[id]/page.tsx) and the
// Active referrals list (components/agency/ReferralTable.tsx) so the two can't
// disagree on when Reschedule / Cancel / Withdraw is offered.
//
// `missedInRescheduleWindow` is the no-show case: a Missed Appointment still
// inside NO_SHOW_RESCHEDULE_WINDOW_DAYS. The caller computes it (it needs the
// appointment date), the detail page passes it, the Active list never has a
// Missed Appointment so it passes nothing.

export function agencyReferralActions(
  portalStatus: string,
  missedInRescheduleWindow = false,
): { isReschedulable: boolean; isCancellable: boolean; isWithdrawable: boolean } {
  const dated = portalStatus === 'Scheduling' || portalStatus === 'Scheduled'
  return {
    isReschedulable: dated || missedInRescheduleWindow,
    isCancellable: dated || portalStatus === 'Reschedule',
    isWithdrawable: portalStatus === 'Submitted',
  }
}
