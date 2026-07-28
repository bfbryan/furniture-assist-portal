// components/dawson/modals/RescheduleModal.tsx
//
// Reschedule modal for shifting a referral to a different Saturday.
//
// Dawson always picks a specific date. Time slot is optional:
//   - Date only              -> Preferred Date set, Status 'Reschedule',
//                               auto-reschedule automation picks time
//   - Date + Time            -> bypass automation, write Scheduled directly
//
// Time pills show per-slot booked/cap. Full slots stay clickable — Dawson
// can override; a soft warning appears under the confirm button.
//
// Used by:
//   - app/dawson/referrals/[id]/page.tsx         (detail page action bar)
//   - app/dawson/referrals/scheduled/page.tsx    (row action)
//   - app/dawson/referrals/history/page.tsx      (No Show row action)



'use client'



import { useEffect, useState } from 'react'



// Per-slot capacities — MUST match at-auto-schedule-script.js TIME_CAPS
// and the SLOT_MAX constant on app/dawson/schedule/page.tsx.
const SLOT_CAP: Record<TimeSlot, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}



const TIME_SLOTS: TimeSlot[] = ['9am', '10am', '11am', '12pm', '1pm']



export type TimeSlot = '9am' | '10am' | '11am' | '12pm' | '1pm'



export type AvailableDate = {
  date: string
  slotsRemaining: number
  slots9am?: number
  slots10am?: number
  slots11am?: number
  slots12pm?: number
  slots1pm?: number
}



type Props = {
  open: boolean
  name: string
  availableDates: AvailableDate[]
  onConfirm: (
    preferredDate: string,
    appointmentTime: TimeSlot | null,
  ) => void
  onClose: () => void
  loading: boolean
}



function bookedForSlot(d: AvailableDate | undefined, slot: TimeSlot): number {
  if (!d) return 0
  switch (slot) {
    case '9am':  return d.slots9am  ?? 0
    case '10am': return d.slots10am ?? 0
    case '11am': return d.slots11am ?? 0
    case '12pm': return d.slots12pm ?? 0
    case '1pm':  return d.slots1pm  ?? 0
  }
}



export default function RescheduleModal({
  open,
  name,
  availableDates,
  onConfirm,
  onClose,
  loading,
}: Props) {
  const [preferredDate, setPreferredDate] = useState('')
  const [appointmentTime, setAppointmentTime] = useState<TimeSlot | null>(null)
  const [error, setError] = useState<string | null>(null)



  useEffect(() => {
    if (open) {
      setPreferredDate('')
      setAppointmentTime(null)
      setError(null)
    }
  }, [open])



  if (!open) return null



  const selectedDate = availableDates.find((d) => d.date === preferredDate)
  const isOverride =
    appointmentTime !== null &&
    selectedDate !== undefined &&
    bookedForSlot(selectedDate, appointmentTime) >= SLOT_CAP[appointmentTime]



  const handleConfirm = () => {
    setError(null)
    if (!preferredDate) {
      setError('Pick a Saturday.')
      return
    }
    onConfirm(preferredDate, appointmentTime)
  }



  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(27,43,75,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '36px',
          maxWidth: '540px',
          width: '92%',
          boxShadow: '0 20px 60px rgba(27,43,75,0.2)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-montserrat)',
            fontWeight: 800,
            fontSize: '18px',
            color: '#1B2B4B',
            marginBottom: '10px',
          }}
        >
          Reschedule Appointment
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: '#7A8899',
            lineHeight: 1.7,
            marginBottom: '20px',
          }}
        >
          Reschedule for {name}. Pick a Saturday and (optionally) a time slot.
        </p>



        <label
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: '#1B2B4B',
            marginBottom: '6px',
            display: 'block',
          }}
        >
          Preferred Saturday
        </label>
        <select
          value={preferredDate}
          onChange={(e) => {
            setPreferredDate(e.target.value)
            setAppointmentTime(null)
          }}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: '7px',
            border: '1px solid #EDE9E1',
            fontSize: '14px',
            color: '#2C3A4A',
            background: 'white',
            outline: 'none',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          <option value="">Select a Saturday...</option>
          {availableDates.map((d) => {
            const dateObj = new Date(d.date + 'T00:00:00')
            const label = dateObj.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
            return (
              <option key={d.date} value={d.date}>
                {label} — {d.slotsRemaining} slot{d.slotsRemaining === 1 ? '' : 's'} open
              </option>
            )
          })}
        </select>



        {/* Time-slot pills — visible whenever a Saturday is picked */}
        {preferredDate && (
          <>
            <label
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#1B2B4B',
                marginBottom: '6px',
                display: 'block',
              }}
            >
              Time (optional — leave blank to auto-schedule)
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              {TIME_SLOTS.map((slot) => {
                const booked = bookedForSlot(selectedDate, slot)
                const cap = SLOT_CAP[slot]
                const full = booked >= cap
                const selected = appointmentTime === slot
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() =>
                      setAppointmentTime(selected ? null : slot)
                    }
                    style={{
                      padding: '10px 6px',
                      borderRadius: '8px',
                      border: selected
                        ? '2px solid #2A7F6F'
                        : full
                          ? '1px solid #F0C4BE'
                          : '1px solid #EDE9E1',
                      background: selected
                        ? '#2A7F6F'
                        : full
                          ? '#FDEDEC'
                          : 'white',
                      color: selected ? 'white' : full ? '#C0392B' : '#2C3A4A',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '3px',
                      fontFamily: 'var(--font-montserrat)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        lineHeight: 1,
                      }}
                    >
                      {slot}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        opacity: selected ? 0.85 : 1,
                        lineHeight: 1,
                      }}
                    >
                      {booked}/{cap}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}



        {error && (
          <div
            style={{
              background: '#FDEDEC',
              border: '1px solid #C0392B',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '12px',
              fontSize: '13px',
              color: '#C0392B',
            }}
          >
            {error}
          </div>
        )}



        {isOverride && appointmentTime && (
          <div
            style={{
              fontSize: '12px',
              color: '#8A6A00',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C9A84C"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Override — {appointmentTime} is at capacity (
            {bookedForSlot(selectedDate, appointmentTime)}/
            {SLOT_CAP[appointmentTime]} booked)
          </div>
        )}



        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '7px',
              border: '1px solid #EDE9E1',
              background: 'white',
              color: '#2C3A4A',
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '10px 20px',
              borderRadius: '7px',
              border: 'none',
              background: '#2A7F6F',
              color: 'white',
              fontFamily: 'var(--font-montserrat)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? '...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
