'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
// Cancel / withdraw / reschedule dialogs, shared with the referral detail
// page so the agency portal has one copy of each.
import {
  ConfirmModal,
  RescheduleModal,
  type AvailableDate,
  type ConfirmModalState,
  type RescheduleModalState,
} from './ReferralActionModals'
// One definition, shared with the referral detail page and with PATCH
// /api/referrals/[id]. This file used to carry a byte-for-byte copy, which is
// how a status added in one place could go missing in the other.
import { getPortalStatus } from '@/lib/referrals/edit-window'
// Shared with the referral detail page, which fills the same blank on the same
// referral from the same three Airtable fields.
import { requestedSlot } from '@/lib/referrals/requested-slot'
// Staff filter state, shared with the Pending / Scheduled counts in the page
// hero so the two cannot disagree.
import { useStaffFilter } from './ActiveReferralsFilter'

type Referral = {
  id: string
  clientName: string
  referralDate: string
  appointmentDate: string | null
  appointmentTime: string | null
  referralReview: string
  appointmentStatus: string
  appointmentSlipUrl: string | null
  dataPageUrl: string | null
  referredBy: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  // Reschedule requests only — what the agency asked for.
  preferredDate?: string | null
  preferredTime?: string | null
  schedulingFlexibility?: string | null
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sortReferrals(referrals: Referral[], key: string): Referral[] {
  const byAppt = ['Scheduled', 'Reschedule', 'Completed', 'Cancelled', 'Rejected']
  if (byAppt.includes(key)) {
    return [...referrals].sort((a, b) => {
      const da = a.appointmentDate ?? '9999'
      const db = b.appointmentDate ?? '9999'
      return da < db ? -1 : da > db ? 1 : 0
    })
  }
  return [...referrals].sort((a, b) => {
    return a.referralDate < b.referralDate ? 1 : a.referralDate > b.referralDate ? -1 : 0
  })
}

const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Submitted:  { accent: '#C9A84C', badgeBg: '#FEF9EC', badgeText: '#C9A84C' },
  Scheduling: { accent: '#5B8DB8', badgeBg: '#EBF3FB', badgeText: '#5B8DB8' },
  Scheduled:  { accent: '#2A7F6F', badgeBg: '#EAF4F2', badgeText: '#2A7F6F' },
  // Gold, the colour reschedule already carries everywhere else in the portal.
  Reschedule: { accent: '#C9A84C', badgeBg: '#FEF9EC', badgeText: '#C9A84C' },
  Completed:  { accent: '#1B2B4B', badgeBg: '#E8ECF2', badgeText: '#1B2B4B' },
  Cancelled:  { accent: '#C0392B', badgeBg: '#FDEDEC', badgeText: '#C0392B' },
  Rejected:   { accent: '#C0392B', badgeBg: '#FDEDEC', badgeText: '#C0392B' },
}

const COL_HEADER: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#1B2B4B', marginBottom: '6px',
}

const COL_VALUE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 600,
  fontSize: '12px', color: '#1B2B4B',
}

const COL_SUB: React.CSSProperties = {
  fontSize: '11px', color: '#7A8899',
}

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#1B2B4B', color: 'white', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '5px', pointerEvents: 'none', zIndex: 10 }}>
          {label}
        </div>
      )}
    </div>
  )
}

function IconBtn({ color, onClick, title, children }: {
  color: string
  onClick?: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Tooltip label={title}>
      <button onClick={onClick} style={{ width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
        {children}
      </button>
    </Tooltip>
  )
}

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

// The Appointment cell on a card whose reschedule request is still with
// Furniture Assist.
//
// It used to show the requested slot alone, under a 'Requested' header. Ben
// asked for both dates: the appointment the client STILL HOLDS and the one the
// agency has asked for. He is right that one alone is dangerous — a reschedule
// request changes nothing until Dawson acts, so an agency reading only
// "Requested Oct 17" can tell a client not to come on Sep 26, when Sep 26 is
// still their appointment. The client detail page already showed both — that
// is the "at minimum" half of Ben's ask, and it was already done — so this
// brings the card into line with it.
//
// Shorter labels than the detail page's Currently / Requested pair, because
// this column is a fraction of that page's width: at 9.5px uppercase those two
// words need a 61px label track and leave the date wrapping. Now / Asked are
// the same two facts in a 34px track. Measured, not guessed.
//
// FITTING BOTH WITHOUT CROWDING. Two rows in a label/value mini-grid rather
// than four stacked lines: the labels are 10px and share one narrow auto
// track, so the pair costs one extra line of card height and no width beyond
// what the column re-tune below already gives back. Below 1280px the whole
// cell is already a label/value pair, and this nests inside it unchanged.
const REQ_LABEL: React.CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#A0A9B5',
  whiteSpace: 'nowrap',
  paddingTop: '1px',
}

// The three shapes a real request takes, plus the one a failed scan leaves
// behind — see lib/referrals/requested-slot.ts for why that fourth case is not
// hypothetical.
function RequestedSlotValue({ r }: { r: Referral }) {
  const slot = requestedSlot(r)

  const requested =
    slot.kind === 'flexible' ? (
      <span style={{ fontStyle: 'italic' }}>Any Saturday</span>
    ) : slot.kind === 'unknown' ? (
      // Nothing on the record. Says so rather than inventing a preference —
      // the same em dash the other sections use for "not set".
      <span>—</span>
    ) : (
      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 6px' }}>
        <span>{formatDate(slot.date)}</span>
        {slot.time ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ClockIcon />
            {slot.time}
          </span>
        ) : (
          <span style={{ fontStyle: 'italic' }}>Any time</span>
        )}
      </span>
    )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: '2px 6px',
        alignItems: 'start',
      }}
    >
      <div style={REQ_LABEL}>Now</div>
      <div style={COL_SUB}>
        {r.appointmentDate ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 6px' }}>
            <span>{formatDate(r.appointmentDate)}</span>
            {r.appointmentTime && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ClockIcon />
                {r.appointmentTime}
              </span>
            )}
          </span>
        ) : (
          // No appointment to keep — this referral was never scheduled, so the
          // request is a first preference rather than a move.
          <span style={{ fontStyle: 'italic' }}>Not yet scheduled</span>
        )}
      </div>

      <div style={{ ...REQ_LABEL, color: '#C9A84C' }}>Asked</div>
      <div style={{ ...COL_SUB, color: '#2C3A4A', fontWeight: 600 }}>{requested}</div>
    </div>
  )
}

function ClientCard({ r, onCancel, onReschedule, onWithdraw }: {
  r: Referral
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
  onWithdraw: (id: string, name: string) => void
}) {
  const status = getPortalStatus(r.referralReview, r.appointmentStatus)
  const colors = STATUS_COLORS[status] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }
  const isScheduled    = status === 'Scheduled'
  const isCompleted    = status === 'Completed'
  const isWithdrawable = status === 'Submitted'
  const isCancellable  = status === 'Scheduling' || status === 'Scheduled'

  const addressLine1 = [r.address, r.address2].filter(Boolean).join(', ')
  const addressLine2 = [r.city, r.state, r.zip].filter(Boolean).join(' ')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '4px 1fr', background: 'white', borderRadius: '12px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)', marginBottom: '10px' }}>
      <div style={{ background: colors.accent }} />

      {/* Column tracks live in globals.css (.fa-referral-card-grid) so they can stack below 1280px. */}
      <div className="fa-referral-card-grid" style={{ display: 'grid', alignItems: 'start', gap: '10px', padding: '14px 16px' }}>

       {/* CLIENT NAME */}
<div>
  <div style={COL_HEADER}>Client Name</div>
  <Tooltip label="View Client Detail">
    <a href={`/referrals/${r.id}`} style={{ textDecoration: 'none' }}>
      <div style={{ ...COL_VALUE, fontSize: '13px', color: '#2A7F6F' }}>{r.clientName}</div>
    </a>
  </Tooltip>
</div>

        {/* ADDRESS — "Client Address" rather than "Address" (Ben). The card
            also carries the agency's own address in the hero above it, so the
            bare word was ambiguous on a phone where the two are closer
            together. */}
        <div>
          <div style={COL_HEADER}>Client Address</div>
          {addressLine1 && <div style={COL_SUB}>{addressLine1}</div>}
          {addressLine2 && <div style={COL_SUB}>{addressLine2}</div>}
          {!addressLine1 && !addressLine2 && <div style={COL_SUB}>—</div>}
        </div>

        {/* PHONE — "Client Phone", same reason as the address above. */}
        <div>
          <div style={COL_HEADER}>Client Phone</div>
          <div style={COL_SUB}>{r.phone ?? '—'}</div>
        </div>

        {/* REFERRED BY */}
        <div>
          <div style={COL_HEADER}>Referred By</div>
          <div style={COL_SUB}>{r.referredBy ?? '—'}</div>
        </div>

        {/* SUBMITTED */}
        <div>
          <div style={COL_HEADER}>Submitted</div>
          <div style={COL_SUB}>{formatDate(r.referralDate)}</div>
        </div>

        {/* APPOINTMENT — date and time share one line under the single header,
            so mobile reads the same way the desktop column is labelled. Wraps
            back to two lines only where the column is too narrow to hold both.

            On a Reschedule Requested card this row showed an em dash, because
            it was only ever filled for 'Scheduled' — so the one section where
            the agency most wants to see what it asked for was the one section
            showing nothing. Those cards now carry the requested date and time
            instead, under a 'Requested' header so it cannot be misread as a
            booking. Every other section is untouched. */}
<div>
  {/* One header now, on every card. It used to flip to 'Requested' on a
      reschedule, which was right while the cell held only the requested date;
      the cell now labels both dates itself, so the flip would have left two
      labels arguing about the same thing. */}
  <div style={COL_HEADER}>Appointment</div>
  {status === 'Reschedule' ? (
    <RequestedSlotValue r={r} />
  ) : (
    <div style={{ ...COL_SUB, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 6px' }}>
      <span>{status === 'Scheduled' ? formatDate(r.appointmentDate) : '—'}</span>
      {status === 'Scheduled' && r.appointmentTime && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <ClockIcon />
          {r.appointmentTime}
        </span>
      )}
    </div>
  )}
</div>

        {/* ACTIONS */}
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', paddingTop: '14px' }}>
  {/* Appointment slip. Shown whenever a slip actually exists on the record —
      it used to be gated `false && isScheduled || isCompleted`, i.e. completed
      only, so scheduled clients had no way to reach their own slip from this
      list.

      EXCEPT once a reschedule has been requested. The slip names a date and
      time that the agency has itself asked to move, so from that moment it
      describes an appointment nobody intends to keep. It comes back on its own
      as soon as Dawson lands the request on a real date and the status leaves
      'Reschedule'; nothing is deleted, only hidden while the date is unsettled.

      marginRight: auto pins it to the LEFT edge of the actions cell, which puts
      it hard against the Appointment column rather than bunched up with
      Reschedule at the right — what Ben asked for. */}
  {r.appointmentSlipUrl && status !== 'Reschedule' && (
    <div style={{ display: 'flex', marginRight: 'auto' }}>
      <Tooltip label="Appointment Slip">
        <a href={r.appointmentSlipUrl} target="_blank" rel="noreferrer"
          style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A7F6F', textDecoration: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </a>
      </Tooltip>
    </div>
  )}
  {isCompleted && r.dataPageUrl && (
    <Tooltip label="Completed Form">
      <a href={r.dataPageUrl} target="_blank" rel="noreferrer"
        style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5B8DB8', textDecoration: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
        </svg>
      </a>
    </Tooltip>
  )}
  {isScheduled && (
    <IconBtn color="#C9A84C" onClick={() => onReschedule(r.id, r.clientName)} title="Reschedule">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </IconBtn>
  )}
  {isWithdrawable && (
    <IconBtn color="#C0392B" onClick={() => onWithdraw(r.id, r.clientName)} title="Withdraw Referral">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/><path d="M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </IconBtn>
  )}
  {isCancellable && (
    <IconBtn color="#C0392B" onClick={() => onCancel(r.id, r.clientName)} title="Cancel Appointment">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    </IconBtn>
  )}
</div>

      </div>
    </div>
  )
}

type StatusGroup = {
  key: string
  sectionTitle: string
  referrals: Referral[]
  collapsible?: boolean
}

// The referrals and the staff filter both come from StaffFilterProvider now,
// rather than a prop and local state respectively. That is what lets the
// Pending / Scheduled counts in the page hero move with the dropdown down
// here — they read the same filtered list this table renders.
export default function ReferralTable({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter()
  const { staffFilter, setStaffFilter, staffNames, filtered: filteredReferrals } =
    useStaffFilter<Referral>()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ open: false, type: null, id: '', name: '' })
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleModalState>({ open: false, id: '', name: '' })
  const [loading, setLoading] = useState(false)
  // A cancel / withdraw / reschedule that did not go through. Cleared when a
  // modal opens; while it is set the modal stays open and shows it.
  const [actionError, setActionError] = useState<string | null>(null)
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])

  // Load available Saturdays for the reschedule modal.
  // 2-week lead time enforced via leadDays=14 (Dawson defaults to 7).
  useEffect(() => {
    fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setAvailableDates(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Cancel / Withdraw — bare POST, no body.
  //
  // The response used to be discarded entirely, so a 403, a 500 from a failed
  // Airtable write, or a dropped connection on a phone looked exactly like
  // success: the dialog closed and the list refreshed. An agency would tell a
  // client not to come while Furniture Assist still held the appointment.
  // These three actions are the only ones an agency has, so the modal now
  // stays open and says so unless the write actually landed.
  const handleConfirm = async () => {
    setLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/referrals/${confirmModal.id}/${confirmModal.type}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || 'That did not go through. Please try again.')
        return
      }
      setConfirmModal({ open: false, type: null, id: '', name: '' })
      router.refresh()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Reschedule — JSON body { preferredDate, preferredTime, flexible }
  const handleRescheduleConfirm = async (
    preferredDate: string | null,
    flexible: boolean,
    preferredTime: string | null,
  ) => {
    setLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/referrals/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDate, preferredTime, flexible }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error || 'That did not go through. Please try again.')
        return
      }
      // Refresh availability — the previous slot is now open, the new one is taken.
      fetch('/api/agency/schedule/available?weeks=8&leadDays=14', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => setAvailableDates(Array.isArray(data) ? data : []))
        .catch(() => {})
      setRescheduleModal({ open: false, id: '', name: '' })
      router.refresh()
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const groups: StatusGroup[] = [
    { key: 'Submitted',  sectionTitle: 'Awaiting Approval',        referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Submitted'),  'Submitted') },
    { key: 'Scheduling', sectionTitle: 'Awaiting Appointment Date', referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Scheduling'), 'Scheduling') },
    { key: 'Scheduled',  sectionTitle: 'Appointment Scheduled',     referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Scheduled'),  'Scheduled') },
    // A client whose reschedule request is with Furniture Assist. Without this
    // group the card matched no section and vanished from the agency's Active
    // list the moment they asked for a new date — the request looked like it
    // had deleted the client.
    { key: 'Reschedule', sectionTitle: 'Reschedule Requested',      referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Reschedule'), 'Reschedule') },
    { key: 'Completed',  sectionTitle: 'Completed Clients',         referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Completed'),  'Completed'),  collapsible: true },
    { key: 'Cancelled',  sectionTitle: 'Cancelled Appointments',    referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Cancelled'),  'Cancelled'),  collapsible: true },
    { key: 'Rejected',   sectionTitle: 'Rejected Referrals',        referrals: sortReferrals(filteredReferrals.filter(r => getPortalStatus(r.referralReview, r.appointmentStatus) === 'Rejected'),   'Rejected'),   collapsible: true },
  ]

  // Tested against the GROUPED total, not the incoming array. A referral whose
  // portal status matches none of the seven groups above renders in no section
  // (GroupSection returns null when its list is empty), so testing
  // referrals.length meant an unmapped status produced a page with no cards and
  // no empty state either — which reads as broken rather than empty. Any future
  // status that nobody maps now shows "No referrals found." instead.
  if (groups.every(g => g.referrals.length === 0)) {
    return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '36px', textAlign: 'center', color: '#7A8899', fontSize: '14px' }}>
        No referrals found.
      </div>
    )
  }

  return (
    <>
      <ConfirmModal
        modal={confirmModal}
        onConfirm={handleConfirm}
        onClose={() => { setActionError(null); setConfirmModal({ open: false, type: null, id: '', name: '' }) }}
        loading={loading}
        error={actionError}
      />
      <RescheduleModal
        modal={rescheduleModal}
        availableDates={availableDates}
        onConfirm={handleRescheduleConfirm}
        onClose={() => { setActionError(null); setRescheduleModal({ open: false, id: '', name: '' }) }}
        loading={loading}
        submitError={actionError}
      />
      {/* Staff filter — admin only. Wrapping lives in globals.css
          (.fa-filter-row): label plus select is wider than a small phone, so
          the select takes its own line. */}
      {isAdmin && staffNames.length > 0 && (
        <div className="fa-filter-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#1B2B4B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Filter by Staff
          </label>
          <select
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            style={{
              padding: '8px 14px',
              borderRadius: '7px',
              border: '1px solid #EDE9E1',
              fontSize: '13px',
              color: '#2C3A4A',
              background: 'white',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Staff</option>
            {staffNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {groups.map(group => (
  <GroupSection
    key={group.key}
    group={group}
    onCancel={(id, name) => setConfirmModal({ open: true, type: 'cancel', id, name })}
    onReschedule={(id, name) => setRescheduleModal({ open: true, id, name })}
    onWithdraw={(id, name) => setConfirmModal({ open: true, type: 'withdraw', id, name })}
  />
))}
    </>
  )
}

function GroupSection({ group, onCancel, onReschedule, onWithdraw }: {
  group: StatusGroup
  onCancel: (id: string, name: string) => void
  onReschedule: (id: string, name: string) => void
  onWithdraw: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(!group.collapsible)
  if (group.referrals.length === 0) return null
  const colors = STATUS_COLORS[group.key] ?? { accent: '#7A8899', badgeBg: '#F0F0F0', badgeText: '#7A8899' }

  return (
    <div style={{ marginBottom: '40px' }}>
      <button
        onClick={() => group.collapsible && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: group.collapsible ? 'pointer' : 'default', padding: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: colors.accent, fontFamily: 'var(--font-montserrat)' }}>
            {group.sectionTitle}
          </span>
          {group.collapsible && (
            <span style={{ fontSize: '11px', color: '#7A8899' }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
        <span style={{ fontSize: '13px', color: '#7A8899', fontWeight: 600, paddingRight: '10px' }}>
          {group.referrals.length} referral{group.referrals.length !== 1 ? 's' : ''}
        </span>
      </button>
      {open && group.referrals.map(r => (
  <ClientCard key={r.id} r={r} onCancel={onCancel} onReschedule={onReschedule} onWithdraw={onWithdraw} />
))}
    </div>
  )
}
