'use client'

// app/dawson/staff/[id]/page.tsx
//
// detail-pages-rebuild. Fed entirely by GET /api/dawson/staff/[id]
// (getStaffWithDetails) — one Agency Users record, one Agencies record (for
// Status only — Name comes off a lookup already on the Agency Users row),
// and this person's referrals via the Client Referrals reverse link. See
// lib/airtable/agency-users.ts for the read.
//
// Read-only, same as before this rebuild — no status changes, no editing.
// Every caller (Referral Details card, agencies/[id] staff rows,
// staff/wrong-agency, universal search) wants "view the record"; none
// expects an action here.
//
// Weights: Lato (no fontFamily set, the inherited body face) ships 400/700
// only; Montserrat (fontFamily: var(--font-montserrat)) ships 400/600/700.
// The previous version of this page used Montserrat 800 throughout and Lato
// 600 in a few places — both unloaded, the same bug the agency portal was
// swept for. Every declaration below is 400/600/700.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DAWSON_PAGE_BAR_HEIGHT } from '@/components/internal/DawsonPageBar'
import { formatEasternTimestamp, formatDateOnly } from '@/lib/dates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Referral = {
  id: string
  clientName: string
  referralReview: string
  appointmentStatus: string
  effectiveAppointmentDate: string | null
  preferredDate: string | null
}

type Staff = {
  id: string
  firstName: string
  lastName: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  status: string | null
  invitedDate: string | null
  invitedBy: string | null
  recordCreationDate: string | null
  needsReview: boolean
  clerkUserId: string | null
  // Membership is a SEPARATE axis from Status / Portal Invite Status — an
  // agency admin's own assertion that this person works there. Blank
  // (unconfirmed, the default) is what this whole rebuild exists to stop
  // hiding — see the header pill and the Membership row below.
  membershipStatus: string | null
  membershipDecidedBy: string | null
  membershipDecidedAt: string | null
  // The portal claim, stamped once by stampFirstLogin on first Clerk
  // sign-in. NOT the same fact as the older agency-data-reconciliation
  // claim-token flow (served by app/agency/claim/[token]) — that flow is
  // about agency profile data, not portal access, and doesn't belong here.
  claimedDate: string | null
  lastLogin: string | null
  portalInviteStatus: string | null
  // Ben's own hand-ticked check on a bounced send, not an automated flag.
  emailBounce: boolean
  agencyId: string | null
  agencyName: string | null
  agencyStatus: string | null
  referrals: Referral[]
  referralCount: number
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// Record Creation Date is a date-only value ('YYYY-MM-DD') despite its
// Airtable field type — checked live, not assumed from the type name.
// Invited Date / Membership Decided At / Claimed Date / Last Login are real
// instants (full timestamps) and go through formatEasternTimestamp instead.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatInstant(dateStr: string | null): string {
  if (!dateStr) return '—'
  return formatEasternTimestamp(dateStr, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Styling — same tokens as the rebuilt agency detail page
// ---------------------------------------------------------------------------

const CARD: React.CSSProperties = {
  background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', overflow: 'hidden',
}
const CARD_HEAD: React.CSSProperties = {
  padding: '16px 24px', borderBottom: '1px solid #EDE9E1',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
}
const CARD_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px',
  letterSpacing: '0.10em', textTransform: 'uppercase', color: '#1B2B4B',
}
const MUTED_EMPTY: React.CSSProperties = { fontSize: '13px', color: '#7A8899', fontStyle: 'italic' }

// Staff statuses come from Agency Users.Status: Active | Invited | Unclaimed
// | Pending | Inactive — confirmed live, all 5 covered.
const STATUS_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  Active:    { accent: '#2A7F6F', badgeBg: 'rgba(42,127,111,0.12)',   badgeText: '#2A7F6F' },
  Invited:   { accent: '#5B8DB8', badgeBg: 'rgba(91,141,184,0.12)',   badgeText: '#5B8DB8' },
  Unclaimed: { accent: '#7A8899', badgeBg: '#F0F0F0',                 badgeText: '#7A8899' },
  Pending:   { accent: '#C9A84C', badgeBg: 'rgba(201,168,76,0.15)',   badgeText: '#C9A84C' },
  Inactive:  { accent: '#7A8899', badgeBg: '#F0F0F0',                 badgeText: '#7A8899' },
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '10px 0', borderBottom: '1px solid #F7F5F1' }}>
      <div style={{ width: '140px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#7A8899', letterSpacing: '0.04em', paddingTop: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: '#1B2B4B', flex: 1 }}>
        {value || '—'}
      </div>
    </div>
  )
}

// Header pill. Hides entirely at 'Confirmed' — the normal, healthy value —
// so a fully-confirmed staff member shows no membership pill at all rather
// than a reassuring one. 'Not At This Office' reads the same muted grey as
// plain-unconfirmed (matching the Team page's own convention: that state is
// a recoverable parked state, not an alarm, once it's already been flagged
// — the destructive weight lives in the confirm dialog that gets a person
// there, not in every later display of it), with distinct label text.
function MembershipPill({ status }: { status: string | null }) {
  if (status === 'Confirmed') return null
  const label = status === 'Not At This Office' ? 'Not at this office' : 'Not yet confirmed'
  return (
    <span style={{
      padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
      letterSpacing: '0.04em', textTransform: 'uppercase', background: '#F0F0F0', color: '#7A8899',
    }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Referrals — fresh-built, matching agencies/[id]'s ReferralsCard styling.
// Not AgencyReferralsPanel: that component's ReferralStatus type has no
// 'Reschedule' variant and no styling for it at all — this page's shaper
// already carries a status the old component structurally can't represent.
// This was AgencyReferralsPanel's only remaining caller (the agency page
// stopped using it in its own rebuild); it is now orphaned.
// ---------------------------------------------------------------------------

// No REFERRAL_STATUS_ORDER — that only exists on agencies/[id] to drive its
// filter pills, which this card doesn't have (see ReferralsCard below).
type ReferralStatusKey = 'Pending Schedule' | 'Scheduled' | 'Cancelled' | 'Reschedule' | 'Completed' | 'No Show'
const REFERRAL_STATUS_STYLE: Record<ReferralStatusKey, { bg: string; fg: string }> = {
  'Pending Schedule': { bg: '#F0F0F0', fg: '#7A8899' },
  Scheduled:          { bg: 'rgba(42,127,111,0.12)', fg: '#2A7F6F' },
  Reschedule:         { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
  Cancelled:          { bg: 'rgba(192,57,43,0.1)', fg: '#C0392B' },
  Completed:          { bg: '#F0F0F0', fg: '#7A8899' },
  'No Show':          { bg: 'rgba(201,168,76,0.15)', fg: '#8B7724' },
}
// Anything not in REFERRAL_STATUS_STYLE (an Airtable option this map hasn't
// caught up with) falls back to this — red, visually unlike every real
// status so it can't be mistaken for one — same convention as the agency
// page's fix for the identical shape of bug.
const UNKNOWN_STATUS_STYLE = { bg: 'rgba(192,57,43,0.08)', fg: '#C0392B' }
const REFERRAL_STATUS_LABEL: Record<ReferralStatusKey, string> = {
  'Pending Schedule': 'Pending Schedule',
  Scheduled: 'Scheduled',
  Reschedule: 'Reschedule requested',
  Cancelled: 'Cancelled',
  Completed: 'Completed',
  'No Show': 'No Show',
}

// Returns the real Appointment Status value when this map doesn't recognise
// it, rather than guessing — the exact bug this rebuild fixes. The
// pre-rebuild page mapped 5 of 6 Appointment Status options and fell back
// to '?? Pending Schedule' for the sixth (Reschedule), so a referral
// awaiting a reschedule decision silently read as "not yet scheduled."
function referralStatusKey(r: Referral): string {
  if (r.referralReview === 'Rejected' || r.referralReview === 'Withdrawn') return 'Cancelled'
  const map: Record<string, ReferralStatusKey> = {
    'Pending Schedule': 'Pending Schedule',
    Scheduled: 'Scheduled',
    Reschedule: 'Reschedule',
    Cancelled: 'Cancelled',
    Completed: 'Completed',
    'No Show': 'No Show',
  }
  return map[r.appointmentStatus] ?? (r.appointmentStatus || 'Unknown')
}
function isKnownReferralStatus(key: string): key is ReferralStatusKey {
  return key in REFERRAL_STATUS_STYLE
}
function referralStatusLabel(key: string): string {
  return isKnownReferralStatus(key) ? REFERRAL_STATUS_LABEL[key] : key
}
function referralStatusStyle(key: string): { bg: string; fg: string } {
  return isKnownReferralStatus(key) ? REFERRAL_STATUS_STYLE[key] : UNKNOWN_STATUS_STYLE
}

function monthLabel(yearMonthKey: string): string {
  return formatDateOnly(`${yearMonthKey}-01`, { month: 'long', year: 'numeric' })
}

// Same convention as agencies/[id] — not invented here. A request-status row
// files under what was asked for; everything else files under the live
// appointment date, coalesced with the snapshot taken when a slot was
// released, so a cancelled referral still groups into the month it was
// booked for.
function isRequestStatus(appointmentStatus: string): boolean {
  return appointmentStatus === 'Reschedule' || appointmentStatus === 'Pending Schedule'
}
function fileDateOf(r: Referral): string | null {
  if (isRequestStatus(r.appointmentStatus)) {
    return r.preferredDate || r.effectiveAppointmentDate || null
  }
  return r.effectiveAppointmentDate || null
}

// No search / filter / date-range controls — this is one person's referral
// list, not an agency's aggregate; the agency page's controls earn their
// keep at that scale, not this one. Month grouping is kept for the same
// reason it's kept there: it's how Dawson already reads a referral list.
function ReferralsCard({ referrals }: { referrals: Referral[] }) {
  const sorted = [...referrals].sort((a, z) => (fileDateOf(z) ?? '').localeCompare(fileDateOf(a) ?? ''))

  const months: { groups: { key: string; rows: Referral[] }[]; noDate: Referral[] } = { groups: [], noDate: [] }
  for (const r of sorted) {
    const fd = fileDateOf(r)
    if (!fd) { months.noDate.push(r); continue }
    const key = fd.slice(0, 7)
    const last = months.groups[months.groups.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else months.groups.push({ key, rows: [r] })
  }
  months.noDate.sort((a, z) => a.clientName.localeCompare(z.clientName))

  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <div style={CARD_TITLE}>Referrals</div>
        <div style={{ fontSize: '11px', color: '#7A8899' }}>{referrals.length} total</div>
      </div>

      {referrals.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', ...MUTED_EMPTY }}>No referrals yet.</div>
      ) : (
        <>
          {months.groups.map(group => (
            <div key={group.key}>
              <div style={{ padding: '8px 24px', background: '#FAF8F4', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B8C1CC' }}>
                {monthLabel(group.key)}
              </div>
              {group.rows.map(r => <ReferralRow key={r.id} r={r} />)}
            </div>
          ))}
          {months.noDate.length > 0 && (
            <div>
              <div style={{ padding: '8px 24px', background: '#FAF8F4', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B8C1CC' }}>
                No date yet
              </div>
              {months.noDate.map(r => <ReferralRow key={r.id} r={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Client · Date · Status. No Staff column — every row on this card is
// already this one person's referral, so repeating their name would be
// noise. No column headers — same reasoning as agencies/[id]: self-evident
// content, and the coloured pill needs no label either.
const REFERRAL_ROW_GRID = 'minmax(0, 1fr) 110px 150px'

function ReferralRow({ r }: { r: Referral }) {
  const key = referralStatusKey(r)
  const style = referralStatusStyle(key)
  const fd = fileDateOf(r)
  return (
    <a
      href={`/dawson/referrals/${r.id}`}
      style={{ display: 'grid', gridTemplateColumns: REFERRAL_ROW_GRID, gap: '12px', alignItems: 'center', padding: '10px 24px', borderBottom: '1px solid #F7F5F1', textDecoration: 'none' }}
    >
      <span style={{ fontSize: '13px', fontWeight: 700, color: '#2A7F6F', overflowWrap: 'anywhere' }}>{r.clientName}</span>
      <span style={{ fontSize: '12px', color: '#7A8899' }}>{fd ? formatDate(fd) : '—'}</span>
      <span style={{
        justifySelf: 'start', padding: '3px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase', background: style.bg, color: style.fg,
      }}>
        {referralStatusLabel(key)}
      </span>
    </a>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    params.then(({ id }) => {
      fetch(`/api/dawson/staff/${id}`)
        .then(async r => {
          if (r.status === 404) { setNotFound(true); setLoading(false); return null }
          if (!r.ok) throw new Error('load failed')
          return r.json()
        })
        .then(data => {
          if (data) setStaff(data)
          setLoading(false)
        })
        .catch(() => { setNotFound(true); setLoading(false) })
    })
  }, [params])

  if (loading) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A8899' }}>
      Loading staff...
    </div>
  )

  if (notFound || !staff) return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C0392B' }}>
      Staff not found.
    </div>
  )

  const statusColors = STATUS_COLORS[staff.status ?? ''] ?? STATUS_COLORS.Inactive
  const initials =
    (staff.name || '?')
      .split(' ')
      .map(w => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'

  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>

      <header style={{
        background: 'white', borderBottom: '1px solid #EDE9E1',
        padding: '0 32px', minHeight: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px',
        position: 'sticky', top: DAWSON_PAGE_BAR_HEIGHT, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0' }}>
          {/* Fallback to /dawson/agencies when opened in a fresh tab — staff
              pages are always reached from an agency or referral page.
              /dawson/agencies/active was the pre-consolidation name; it only
              worked because next.config.ts still redirects it. */}
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) router.back()
              else router.push('/dawson/agencies')
            }}
            style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(27,43,75,0.5)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <span style={{ color: '#EDE9E1' }}>→</span>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#1B2B4B' }}>
            {staff.name || '—'}
          </div>
        </div>

        {/* Status always shows — it's the primary fact. The other three hide
            at their normal value, so a healthy record shows one pill, not
            four. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0' }}>
          {staff.status && (
            <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: statusColors.badgeBg, color: statusColors.badgeText }}>
              {staff.status}
            </span>
          )}
          <MembershipPill status={staff.membershipStatus} />
          {staff.emailBounce && (
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(192,57,43,0.1)', color: '#C0392B' }}>
              ⚠ Email Bounced
            </span>
          )}
          {staff.needsReview && (
            <span
              title="Created from Excel import without an email — needs admin review"
              style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: 'rgba(201,168,76,0.18)', color: '#C9A84C' }}
            >
              ⚠ Review
            </span>
          )}
        </div>
      </header>

      <div style={{ padding: '28px 32px', display: 'grid', gridTemplateColumns: '1.75fr 1fr', gap: '20px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <div style={CARD}>
            <div style={{ background: statusColors.accent, height: '4px' }} />
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: '#1B2B4B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '16px', color: '#3AA08D', flexShrink: 0 }}>
                  {initials}
                </div>
                <div>
                  <h1 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '20px', color: '#1B2B4B', margin: '0 0 4px' }}>
                    {staff.name || '—'}
                  </h1>
                  {staff.role && (
                    <div style={{ fontSize: '12px', color: '#7A8899' }}>{staff.role}</div>
                  )}
                </div>
              </div>
              <div style={{ borderTop: '1px solid #F7F5F1', paddingTop: '4px' }}>
                <InfoRow
                  label="Agency"
                  value={
                    staff.agencyId && staff.agencyName ? (
                      <a
                        href={`/dawson/agencies/${staff.agencyId}`}
                        style={{ color: '#2A7F6F', textDecoration: 'none' }}
                      >
                        {staff.agencyName}
                        {staff.agencyStatus && (
                          <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, padding: '1px 8px', borderRadius: '20px', background: '#F0F0F0', color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {staff.agencyStatus}
                          </span>
                        )}
                      </a>
                    ) : (
                      <span style={{ color: '#7A8899', fontStyle: 'italic' }}>No agency linked</span>
                    )
                  }
                />
                <InfoRow label="Role" value={staff.role} />
                <InfoRow
                  label="Email"
                  value={staff.email
                    ? <a href={`mailto:${staff.email}`} style={{ color: '#2A7F6F', textDecoration: 'none' }}>{staff.email}</a>
                    : <em style={{ color: '#C9A84C' }}>no email on file</em>}
                />
                <InfoRow label="Phone" value={staff.phone} />
                <InfoRow label="Record Created" value={formatDate(staff.recordCreationDate)} />
                {staff.invitedDate && (
                  <InfoRow
                    label="Invited"
                    value={<>{formatInstant(staff.invitedDate)}{staff.invitedBy && <span style={{ color: '#9AA6B2' }}> · by {staff.invitedBy}</span>}</>}
                  />
                )}
                {staff.claimedDate && (
                  <InfoRow label="Claimed" value={formatInstant(staff.claimedDate)} />
                )}
                <InfoRow
                  label="Last Login"
                  value={staff.lastLogin ? formatInstant(staff.lastLogin) : <span style={{ color: '#9AA6B2' }}>Never</span>}
                />
                <InfoRow
                  label="Portal Invite"
                  value={staff.portalInviteStatus ?? <span style={{ color: '#9AA6B2' }}>Not Invited</span>}
                />
                <InfoRow
                  label="Membership"
                  value={
                    staff.membershipStatus === 'Confirmed'
                      ? <><span style={{ color: '#2A7F6F' }}>Confirmed</span>{staff.membershipDecidedBy && ` by ${staff.membershipDecidedBy}`}{staff.membershipDecidedAt && ` · ${formatInstant(staff.membershipDecidedAt)}`}</>
                      : staff.membershipStatus === 'Not At This Office'
                        ? <><span style={{ color: '#7A8899' }}>Not at this office</span>{staff.membershipDecidedBy && ` by ${staff.membershipDecidedBy}`}{staff.membershipDecidedAt && ` · ${formatInstant(staff.membershipDecidedAt)}`}</>
                        : <span style={{ color: '#9AA6B2' }}>Not yet confirmed</span>
                  }
                />
                {staff.emailBounce && (
                  <InfoRow
                    label="Email Bounce"
                    value={<span style={{ color: '#C0392B', fontWeight: 700 }}>⚠ A send to this address bounced — worth confirming it&apos;s current.</span>}
                  />
                )}
                {staff.needsReview && (
                  <InfoRow
                    label="Review Flag"
                    value={<span style={{ color: '#C9A84C', fontWeight: 700 }}>⚠ Placeholder from Excel import — needs admin review</span>}
                  />
                )}
              </div>
            </div>
          </div>

          <ReferralsCard referrals={staff.referrals} />

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={CARD}>
            <div style={{ padding: '20px' }}>
              <div style={CARD_TITLE}>Staff Stats</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginTop: '16px' }}>
                <div style={{ background: '#F7F5F1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '24px', color: '#1B2B4B', lineHeight: 1 }}>
                    {staff.referralCount}
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#7A8899', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Total Referrals
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
