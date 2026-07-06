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
          proposedEIN: body.existingSubmission?.proposedEIN ?? body.agency.ein ?? '',
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
    if (!form.adminChoice) {
      setSubmitError('Please choose an option under "Agency administrator".')
      return
    }
    if (form.adminChoice === 'Someone else at my agency') {
      if (!form.nominatedAdminName.trim() || !form.nominatedAdminEmail.trim()) {
        setSubmitError('Please provide the name and email of the person you\u2019re nominating.')
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
        <p className="text-neutral-500">Loading\u2026</p>
      </PageShell>
    )
  }

  if (loadError || !data) {
    return (
      <PageShell>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
          <h2 className="text-lg font-semibold">This link can\u2019t be opened</h2>
          <p className="mt-2 text-sm">
            {loadError || 'The link may be invalid, expired, or already used.'}
          </p>
          <p className="mt-2 text-sm">
            If you think this is a mistake, reply to the email that sent you this link and we\u2019ll
            send a fresh one.
          </p>
        </div>
      </PageShell>
    )
  }

  if (submitted) {
    return (
      <PageShell>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-6">
          <h2 className="text-xl font-semibold text-teal-900">Thanks — we got it.</h2>
          <p className="mt-2 text-sm text-teal-900">
            Your submission has been recorded for <strong>{data.agency.name}</strong>. Our team will
            review it and follow up if we need anything.
          </p>
          <p className="mt-4 text-sm text-teal-900">
            Need to update your answers? This link stays active — just reopen it and edit. The most
            recent submission is the one we\u2019ll use.
          </p>
          <button
            className="mt-6 rounded-md border border-teal-600 bg-white px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100"
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
      <header className="mb-8">
        <p className="text-sm uppercase tracking-wide text-neutral-500">Furniture Assist</p>
        <h1 className="mt-1 text-3xl font-semibold text-neutral-900">
          Confirm your agency profile
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          We\u2019re cleaning up our partner directory before the fall referral season. Please review
          the information below and correct anything that\u2019s wrong. It should take about 3
          minutes.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* --------------- YOUR INFO --------------- */}
        <Section
          title="Your information"
          description="Confirm your name and phone. We\u2019ll use these when we contact you about referrals."
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
          <Field label="Phone">
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
              { value: 'Correct as-is', label: 'Yes, that\u2019s correct.' },
              { value: 'Propose new name', label: 'The name is wrong — here\u2019s the correct one.' },
              {
                value: 'Duplicate of another agency',
                label: 'This is a duplicate of another record you have for us.',
              },
            ]}
          />

          {form.agencyNameChoice === 'Propose new name' && (
            <Field label="Correct agency name" required>
              <input
                type="text"
                value={form.proposedAgencyName}
                onChange={(e) => set('proposedAgencyName', e.target.value)}
                className={inputCls}
              />
            </Field>
          )}

          {form.agencyNameChoice === 'Duplicate of another agency' && (
            <Field
              label="Which other record?"
              hint="Type the name of the other agency record as you know it — we\u2019ll look it up on review."
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
          )}
        </Section>

        {/* --------------- AGENCY DETAILS --------------- */}
        <Section
          title="Agency details"
          description="Confirm or update. Leave anything blank you\u2019re unsure about."
        >
          <Field label="Office name" hint="e.g. Newark Field Office, if the agency has multiple locations.">
            <input
              type="text"
              value={form.proposedOfficeName}
              onChange={(e) => set('proposedOfficeName', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Street address">
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
            <Field label="City">
              <input
                type="text"
                value={form.proposedCity}
                onChange={(e) => set('proposedCity', e.target.value)}
                className={inputCls}
                autoComplete="address-level2"
              />
            </Field>
            <Field label="State">
              <input
                type="text"
                value={form.proposedState}
                onChange={(e) => set('proposedState', e.target.value)}
                className={inputCls}
                autoComplete="address-level1"
                maxLength={2}
              />
            </Field>
            <Field label="ZIP">
              <input
                type="text"
                value={form.proposedZip}
                onChange={(e) => set('proposedZip', e.target.value)}
                className={inputCls}
                autoComplete="postal-code"
              />
            </Field>
          </div>
          <Field label="Main phone">
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
          <Field label="EIN" hint="Optional — helps us verify duplicates.">
            <input
              type="text"
              value={form.proposedEIN}
              onChange={(e) => set('proposedEIN', e.target.value)}
              className={inputCls}
            />
          </Field>
        </Section>

        {/* --------------- ADMIN NOMINATION --------------- */}
        <Section
          title="Agency administrator"
          description="Who at your agency should manage the Furniture Assist relationship going forward?"
        >
          <RadioGroup
            name="adminChoice"
            value={form.adminChoice}
            onChange={(v) => set('adminChoice', v as AdminChoice)}
            options={[
              { value: 'I am the admin', label: 'I\u2019m the right person.' },
              { value: 'Someone else at my agency', label: 'Someone else \u2014 I\u2019ll tell you who.' },
              { value: 'Not sure yet', label: 'Not sure yet.' },
            ]}
          />

          {form.adminChoice === 'Someone else at my agency' && (
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
          )}
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
            className="rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting\u2026' : 'Submit'}
          </button>
        </div>
      </form>
    </PageShell>
  )
}

// -------------------------------------------------------------------------
// Presentational bits
// -------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">{children}</main>
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
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
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
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-neutral-800">
        {label}
        {required && <span className="text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
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
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
            value === opt.value
              ? 'border-teal-600 bg-teal-50'
              : 'border-neutral-200 bg-white hover:border-neutral-300'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="mt-0.5 h-4 w-4 text-teal-700 focus:ring-teal-600"
          />
          <span className="text-neutral-800">{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

const inputCls =
  'block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600'
