/**
 * app/agency/claim/[token]/page.tsx
 *
 * Public agency profile claim page — NO Clerk middleware on this route.
 * Token = capability URL: possession of the URL = permission to submit
 * a profile update tied to one Agency User + their linked Agency.
 *
 * FLOW:
 *   1. GET  /api/agency/claim/[token]         → returns { user, agency, existingSubmission? }
 *   2. POST /api/agency/claim/[token]         → creates/updates row in Agency Profile Submissions
 *                                                also updates User First/Last/Phone on Agency Users
 *
 * DESIGN CHOICE (per Ben, 2026-07-06):
 *   Token stays valid after submit → user can return to edit. Latest submission wins on review.
 *
 * AIRTABLE FIELD REFERENCES (must match exactly):
 *   Agency Users:
 *     - Claim Token, Claim Token Sent At, Claim Token Used At
 *     - First Name, Last Name, Phone, Email, Agency (link)
 *   Agency Profile Submissions:
 *     - Submitted By User (link), Agency (link)
 *     - User First Name, User Last Name, User Phone
 *     - Agency Name Choice: "Correct as-is" | "Propose new name" | "Duplicate of another agency"
 *     - Proposed Agency Name, Proposed Duplicate Of (SINGLE LINE TEXT — flip in Airtable)
 *     - Proposed Office Name, Proposed Street, Proposed Street 2, Proposed City,
 *       Proposed State, Proposed Zip, Proposed Main Phone, Proposed Website, Proposed EIN
 *     - Admin Choice: "I am the admin" | "Someone else at my agency" | "Not sure yet"
 *     - Nominated Admin Name, Nominated Admin Email, Nominated Admin Role
 *     - Additional Notes
 */

'use client'

import { useEffect, useState, use } from 'react'
import { formatEIN } from '@/lib/ein'

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

type ClaimData = {
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  agency: {
    id: string
    name: string
    officeName: string | null
    street: string | null
    street2: string | null
    city: string | null
    state: string | null
    zip: string | null
    mainPhone: string | null
    website: string | null
    ein: string | null
  }
  existingSubmission: FormState | null
}

type AgencyNameChoice =
  | 'Correct as-is'
  | 'Propose new name'
  | 'Duplicate of another agency'
  | ''

type AdminChoice =
  | 'I am the admin'
  | 'Someone else at my agency'
  | 'Not sure yet'
  | ''

type FormState = {
  // user fields (written back to Agency Users)
  userFirstName: string
  userLastName: string
  userPhone: string
  // agency name resolution
  agencyNameChoice: AgencyNameChoice
  proposedAgencyName: string
  proposedDuplicateOf: string
  // agency profile fields
  proposedOfficeName: string
  proposedStreet: string
  proposedStreet2: string
  proposedCity: string
  proposedState: string
  proposedZip: string
  proposedMainPhone: string
  proposedWebsite: string
  proposedEIN: string
  // admin nomination
  adminChoice: AdminChoice
  nominatedAdminName: string
  nominatedAdminEmail: string
  nominatedAdminRole: string
  // notes
  additionalNotes: string
}

const EMPTY_FORM: FormState = {
  userFirstName: '',
  userLastName: '',
  userPhone: '',
  agencyNameChoice: '',
  proposedAgencyName: '',
  proposedDuplicateOf: '',
  proposedOfficeName: '',
  proposedStreet: '',
  proposedStreet2: '',
  proposedCity: '',
  proposedState: '',
  proposedZip: '',
  proposedMainPhone: '',
  proposedWebsite: '',
  proposedEIN: '',
  adminChoice: '',
  nominatedAdminName: '',
  nominatedAdminEmail: '',
  nominatedAdminRole: '',
  additionalNotes: '',
}

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------

export default function AgencyClaimPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<ClaimData | null>(null)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // ---- Load claim data ---------------------------------------------------

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/agency/claim/${encodeURIComponent(token)}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (!cancelled) {
            setLoadError(body.error || `Unable to load claim (status ${res.status})`)
            setLoading(false)
          }
          return
        }
        const body: ClaimData = await res.json()
        if (cancelled) return
        setData(body)
        // Seed form from existing submission (if any), else from user/agency
        setForm({
          ...EMPTY_FORM,
          userFirstName: body.existingSubmission?.userFirstName ?? body.user.firstName ?? '',
          userLastName: body.existingSubmission?.userLastName ?? body.user.lastName ?? '',
          userPhone: body.existingSubmission?.userPhone ?? body.user.phone ?? '',
          agencyNameChoice: body.existingSubmission?.agencyNameChoice ?? '',
          proposedAgencyName: body.existingSubmission?.proposedAgencyName ?? '',
          proposedDuplicateOf: body.existingSubmission?.proposedDuplicateOf ?? '',
          proposedOfficeName: body.existingSubmission?.proposedOfficeName ?? body.agency.officeName ?? '',
          proposedStreet: body.existingSubmission?.proposedStreet ?? body.agency.street ?? '',
          proposedStreet2: body.existingSubmission?.proposedStreet2 ?? body.agency.street2 ?? '',
          proposedCity: body.existingSubmission?.proposedCity ?? body.agency.city ?? '',
          proposedState: body.existingSubmission?.proposedState ?? body.agency.state ?? '',
          proposedZip: body.existingSubmission?.proposedZip ?? body.agency.zip ?? '',
          proposedMainPhone: body.existingSubmission?.proposedMainPhone ?? body.agency.mainPhone ?? '',
          proposedWebsite: body.existingSubmission?.proposedWebsite ?? body.agency.website ?? '',
          proposedEIN: formatEIN(body.existingSubmission?.proposedEIN ?? body.agency.ein ?? ''),
          adminChoice: body.existingSubmission?.adminChoice ?? '',
          nominatedAdminName: body.existingSubmission?.nominatedAdminName ?? '',
          nominatedAdminEmail: body.existingSubmission?.nominatedAdminEmail ?? '',
          nominatedAdminRole: body.existingSubmission?.nominatedAdminRole ?? '',
          additionalNotes: body.existingSubmission?.additionalNotes ?? '',
        })
        setLoading(false)
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err?.message || 'Unable to load claim')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  // ---- Helpers -----------------------------------------------------------

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // ---- Submit ------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    // Light client validation
    if (!form.userFirstName.trim() || !form.userLastName.trim()) {
      setSubmitError('Please enter your first and last name.')
      return
    }
    if (!form.userPhone.trim()) {
      setSubmitError('Please enter your phone number — we’ll use it to contact you about referrals.')
      return
    }
    if (!form.agencyNameChoice) {
      setSubmitError('Please choose an option under "Agency name".')
      return
    }
    if (form.agencyNameChoice === 'Propose new name' && !form.proposedAgencyName.trim()) {
      setSubmitError('Please enter the proposed agency name.')
      return
    }
    if (form.agencyNameChoice === 'Duplicate of another agency' && !form.proposedDuplicateOf.trim()) {
      setSubmitError('Please tell us the name of the other agency record.')
      return
    }
    if (
      !form.proposedStreet.trim() ||
      !form.proposedCity.trim() ||
      !form.proposedState.trim() ||
      !form.proposedZip.trim()
    ) {
      setSubmitError('Please confirm the agency’s street address, city, state, and ZIP.')
      return
    }
    if (!form.proposedMainPhone.trim()) {
      setSubmitError('Please confirm the agency’s main phone number.')
      return
    }
    if (!form.adminChoice) {
      setSubmitError('Please choose an option under "Agency administrator".')
      return
    }
    if (form.adminChoice === 'Someone else at my agency') {
      if (!form.nominatedAdminName.trim() || !form.nominatedAdminEmail.trim()) {
        setSubmitError('Please provide the name and email of the person you’re nominating.')
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/agency/claim/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSubmitError(body.error || `Unable to submit (status ${res.status})`)
        setSubmitting(false)
        return
      }
      setSubmitted(true)
      setSubmitting(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      setSubmitError(err?.message || 'Unable to submit')
      setSubmitting(false)
    }
  }

  // ---- Render ------------------------------------------------------------

  if (loading) {
    return (
      <PageShell>
        <p className="text-[#7A8899]">Loading…</p>
      </PageShell>
    )
  }

  if (loadError || !data) {
    return (
      <PageShell>
        <BrandHeader />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
          <h2 className="text-lg font-bold" style={{ fontFamily: HEADING_FONT }}>
            This link can’t be opened
          </h2>
          <p className="mt-2 text-sm">
            {loadError || 'The link may be invalid, expired, or already used.'}
          </p>
          <p className="mt-2 text-sm">
            If you think this is a mistake, reply to the email that sent you this link and we’ll
            send a fresh one.
          </p>
        </div>
      </PageShell>
    )
  }

  if (submitted) {
    return (
      <PageShell>
        <BrandHeader />
        <div className="rounded-xl border-l-4 border-[#2A7F6F] bg-white p-8 shadow-[0_4px_16px_rgba(27,43,75,0.06)]">
          <h2 className="text-2xl font-bold text-[#1B2B4B]" style={{ fontFamily: HEADING_FONT }}>
            Thanks — we got it.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#2C3A4A]">
            Your submission has been recorded for <strong>{data.agency.name}</strong>. Our team will
            review it and follow up if we need anything.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[#2C3A4A]">
            Need to update your answers? This link stays active — just reopen it and edit. The most
            recent submission is the one we’ll use.
          </p>
          <button
            className="mt-6 rounded-md border border-[#2A7F6F] bg-white px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-[#2A7F6F] transition-colors hover:bg-[#EAF5F2]"
            style={{ fontFamily: HEADING_FONT }}
            onClick={() => setSubmitted(false)}
          >
            Edit my submission
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <BrandHeader />
      <header className="mb-10 text-center">
        <h1
          className="text-3xl font-bold text-[#1B2B4B] sm:text-4xl"
          style={{ fontFamily: HEADING_FONT }}
        >
          Confirm Your Agency Profile
        </h1>
        <div className="mx-auto mt-5 h-[3px] w-full max-w-md bg-[#2A7F6F]" />
        <p className="mx-auto mt-6 max-w-xl text-[#7A8899]">
          We’re cleaning up agency records ahead of our Agency Portal rollout. A few minutes now
          saves confusion later.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* --------------- YOUR INFO --------------- */}
        <Section
          title="Your information"
          description="Confirm your name and phone. We’ll use these when we contact you about referrals."
        >
          <Field label="First name" required>
            <input
              type="text"
              value={form.userFirstName}
              onChange={(e) => set('userFirstName', e.target.value)}
              className={inputCls}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" required>
            <input
              type="text"
              value={form.userLastName}
              onChange={(e) => set('userLastName', e.target.value)}
              className={inputCls}
              autoComplete="family-name"
            />
          </Field>
          <Field label="Email" hint="Locked — email us if this needs to change.">
            <input
              type="email"
              value={data.user.email}
              disabled
              className={`${inputCls} bg-neutral-100 text-neutral-500`}
            />
          </Field>
          <Field label="Phone" required>
            <input
              type="tel"
              value={form.userPhone}
              onChange={(e) => set('userPhone', e.target.value)}
              className={inputCls}
              autoComplete="tel"
            />
          </Field>
        </Section>

        {/* --------------- AGENCY NAME --------------- */}
        <Section
          title="Agency name"
          description={`We currently have you listed under "${data.agency.name}". Is that right?`}
        >
          <RadioGroup
            name="agencyNameChoice"
            value={form.agencyNameChoice}
            onChange={(v) => set('agencyNameChoice', v as AgencyNameChoice)}
            options={[
              { value: 'Correct as-is', label: 'Yes, that’s correct.' },
              {
                value: 'Propose new name',
                label: 'The name is wrong — here’s the correct one.',
                reveal: (
                  <Field label="Correct agency name" required>
                    <input
                      type="text"
                      value={form.proposedAgencyName}
                      onChange={(e) => set('proposedAgencyName', e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                ),
              },
              {
                value: 'Duplicate of another agency',
                label: 'This is a duplicate of another record you have for us.',
                reveal: (
                  <Field
                    label="Which other record?"
                    hint="Type the name of the other agency record as you know it — we’ll look it up on review."
                    required
                  >
                    <input
                      type="text"
                      value={form.proposedDuplicateOf}
                      onChange={(e) => set('proposedDuplicateOf', e.target.value)}
                      className={inputCls}
                      placeholder="e.g. Ironbound Community Corp"
                    />
                  </Field>
                ),
              },
            ]}
          />
        </Section>

        {/* --------------- AGENCY DETAILS --------------- */}
        <Section
          title="Agency details"
          description="Confirm or update. Leave anything blank you’re unsure about."
        >
          <Field label="Office name" hint="e.g. Newark Field Office, if the agency has multiple locations.">
            <input
              type="text"
              value={form.proposedOfficeName}
              onChange={(e) => set('proposedOfficeName', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Street address" required>
            <input
              type="text"
              value={form.proposedStreet}
              onChange={(e) => set('proposedStreet', e.target.value)}
              className={inputCls}
              autoComplete="address-line1"
            />
          </Field>
          <Field label="Street address (line 2)">
            <input
              type="text"
              value={form.proposedStreet2}
              onChange={(e) => set('proposedStreet2', e.target.value)}
              className={inputCls}
              autoComplete="address-line2"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="City" required>
              <input
                type="text"
                value={form.proposedCity}
                onChange={(e) => set('proposedCity', e.target.value)}
                className={inputCls}
                autoComplete="address-level2"
              />
            </Field>
            <Field label="State" required>
              <input
                type="text"
                value={form.proposedState}
                onChange={(e) => set('proposedState', e.target.value)}
                className={inputCls}
                autoComplete="address-level1"
                maxLength={2}
              />
            </Field>
            <Field label="ZIP" required>
              <input
                type="text"
                value={form.proposedZip}
                onChange={(e) => set('proposedZip', e.target.value)}
                className={inputCls}
                autoComplete="postal-code"
              />
            </Field>
          </div>
          <Field label="Main phone" required>
            <input
              type="tel"
              value={form.proposedMainPhone}
              onChange={(e) => set('proposedMainPhone', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Website">
            <input
              type="url"
              value={form.proposedWebsite}
              onChange={(e) => set('proposedWebsite', e.target.value)}
              className={inputCls}
              placeholder="https://"
            />
          </Field>
          <Field label="EIN" hint="Format: XX-XXXXXXX. Optional — helps us verify duplicates.">
            <input
              type="text"
              value={form.proposedEIN}
              onChange={(e) => set('proposedEIN', formatEIN(e.target.value))}
              className={inputCls}
              placeholder="XX-XXXXXXX"
              inputMode="numeric"
              maxLength={10}
            />
          </Field>
        </Section>

        {/* --------------- ADMIN NOMINATION --------------- */}
        <Section
          title="Agency administrator"
          description="The agency administrator will manage your agency’s presence on the Furniture Assist Portal — including adding or removing staff members who can submit referrals on your behalf. Please choose the right person for this role."
        >
          <RadioGroup
            name="adminChoice"
            value={form.adminChoice}
            onChange={(v) => set('adminChoice', v as AdminChoice)}
            options={[
              { value: 'I am the admin', label: 'I’m the right person.' },
              {
                value: 'Someone else at my agency',
                label: 'Someone else \u2014 I’ll tell you who.',
                reveal: (
                  <div className="space-y-4">
                    <Field label="Their name" required>
                      <input
                        type="text"
                        value={form.nominatedAdminName}
                        onChange={(e) => set('nominatedAdminName', e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Their email" required>
                      <input
                        type="email"
                        value={form.nominatedAdminEmail}
                        onChange={(e) => set('nominatedAdminEmail', e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Their role / title">
                      <input
                        type="text"
                        value={form.nominatedAdminRole}
                        onChange={(e) => set('nominatedAdminRole', e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                ),
              },
              { value: 'Not sure yet', label: 'Not sure yet.' },
            ]}
          />
        </Section>

        {/* --------------- NOTES --------------- */}
        <Section
          title="Anything else?"
          description="Anything we should know — new programs, another office, staffing changes."
        >
          <Field label="Notes">
            <textarea
              value={form.additionalNotes}
              onChange={(e) => set('additionalNotes', e.target.value)}
              className={`${inputCls} min-h-[100px]`}
              rows={4}
            />
          </Field>
        </Section>

        {/* --------------- SUBMIT --------------- */}
        {submitError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {submitError}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[#2A7F6F] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-[#1F6B5C] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ fontFamily: HEADING_FONT }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </PageShell>
  )
}

// -------------------------------------------------------------------------
// Presentational bits
// -------------------------------------------------------------------------

// Furniture Assist brand tokens (sampled from furnitureassist.com)
const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const TEAL_LIGHT = '#3AA08D'
const TEXT = '#2C3A4A'
const MUTED = '#7A8899'
const HEADING_FONT = 'Montserrat, sans-serif'
const BODY_FONT = 'Lato, sans-serif'

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#F7F8FA]"
      style={{ fontFamily: BODY_FONT, color: TEXT }}
    >
      {/* Google Fonts — Montserrat for headings, Lato for body */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Montserrat:wght@600;700&display=swap"
      />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">{children}</main>
    </div>
  )
}

function BrandHeader() {
  return (
    <div className="mb-10 flex justify-center">
      <img
        src="https://furnitureassist.com/wp-content/uploads/2026/02/logo_2.22.26.jpg"
        alt="Furniture Assist"
        className="h-20 w-auto"
      />
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[#E5E9EF] bg-white p-6 shadow-[0_4px_16px_rgba(27,43,75,0.06)] sm:p-8">
      <div className="mb-6">
        <h2
          className="text-xl font-bold text-[#1B2B4B]"
          style={{ fontFamily: HEADING_FONT }}
        >
          {title}
        </h2>
        <div className="mt-3 h-[2px] w-full bg-gradient-to-r from-[#2A7F6F] via-[#2A7F6F] to-[#2A7F6F]/10" />
        {description && (
          <p className="mt-4 text-sm leading-relaxed text-[#2C3A4A]">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-sm font-semibold text-[#1B2B4B]">
        {label}
        {required && <span className="text-[#B34A3F]">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#7A8899]">{hint}</span>}
    </label>
  )
}

function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; reveal?: React.ReactNode }[]
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <div key={opt.value}>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                selected
                  ? 'border-[#2A7F6F] bg-[#EAF5F2]'
                  : 'border-[#E5E9EF] bg-white hover:border-[#B8C1CC]'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="mt-0.5 h-4 w-4 accent-[#2A7F6F]"
              />
              <span className="text-[#2C3A4A]">{opt.label}</span>
            </label>
            {selected && opt.reveal && (
              <div className="ml-7 mt-3 space-y-4">{opt.reveal}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// EIN formatter: strips non-digits, inserts dash after 2 digits, caps at 9 digits total.
const inputCls =
  'block w-full rounded-md border border-[#D4D9E0] bg-white px-3 py-2 text-sm text-[#2C3A4A] shadow-sm placeholder:text-[#B8C1CC] focus:border-[#2A7F6F] focus:outline-none focus:ring-1 focus:ring-[#2A7F6F]'
