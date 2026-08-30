// app/api/admin/invite/route.ts
// Invite a brand-new staff member from the Team page ("Add Staff Member") —
// creates (or reuses) the Clerk user, adds them to the org, creates the Agency
// Users row, and emails the magic link through the Email Automations pattern
// (the Zapier webhook this used to POST to has been retired).
//
// Steps 1–4 each roll back the Clerk user this request created if a later step
// fails, so a retry starts clean rather than dead-ending on "user already
// exists". Every failure returns a step-specific message plus `detail` with the
// underlying Clerk / Airtable text — this is an admin-only route.
//
// The "Agency Staff Welcome to Portal - Invite" row in Email Automations is
// enabled, so step 5 sends for real via Resend; a send failure is surfaced in
// the response (`emailSent: false`) but does not fail the invite — the row
// exists and the sign-in link is live, and "Resend Invite" on the Team page
// issues a fresh one.

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'
import { portalSignInLink } from '@/lib/auth/portal-sign-in-link'
import { getAgencyUserByEmail } from '@/lib/airtable'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function createAgencyUserRecord(data: {
  firstName: string
  lastName: string
  email: string
  role: string
  agencyId: string
  clerkUserId: string
  invitedByName: string
  phone: string | null
}) {
  const fields: Record<string, unknown> = {
    'First Name':    data.firstName,
    'Last Name':     data.lastName,
    'Email':         data.email,
    'Role':          data.role === 'org:admin' ? 'Admin' : 'Staff',
    'Clerk User ID': data.clerkUserId,
    // Created straight into the invited state — the magic link is already on
    // its way, so the row belongs in the Team page's Awaiting Claim section
    // (Invited + Invite Sent). First sign-in flips it to Active/Claimed.
    'Status':        'Invited',
    'Portal Invite Status': 'Invite Sent',
    'Invited Date':  new Date().toISOString(),
    'Phone Number':  data.phone ?? '',
    'Invited By':    data.invitedByName,
    // Linked record — Airtable expects an array of record IDs
    'Agency':        [data.agencyId],
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}`
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable create failed: ${err}`)
  }

  return res.json()
}

export async function POST(req: NextRequest) {
  const { orgRole } = await auth()

  if (orgRole !== 'org:admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const {
    firstName,
    lastName,
    email,
    role,
    phone,
    orgId,
    agencyId,
    agencyName,
    invitedByName,
  } = await req.json()

  if (!firstName || !lastName || !email || !orgId || !agencyId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  // Don't create a second Agency Users row for an email that already has one —
  // surface it instead. Same agency: it's already on their team. Another
  // agency: Furniture Assist has to move it.
  const existing = await getAgencyUserByEmail(email)
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.agencyId === agencyId
            ? `${existing.name || email} is already on your team.`
            : `${email} is already set up with another agency. Contact Furniture Assist to move them.`,
      },
      { status: 409 },
    )
  }

  const client = await clerkClient()
  const clerkErr = (err: unknown) =>
    (err as { errors?: { code?: string; message?: string; longMessage?: string }[] })?.errors?.[0]
  const detailOf = (err: unknown) => {
    const e = clerkErr(err)
    return e?.longMessage || e?.message || (err instanceof Error ? err.message : String(err))
  }

  // Tracks whether THIS request created the Clerk user, so a failure in a
  // later step rolls back only what it made and a genuine pre-existing user
  // is left alone.
  let clerkUserId: string | null = null
  let createdClerkUser = false

  const rollback = async () => {
    if (createdClerkUser && clerkUserId) {
      // Deleting the user also drops the org membership created below.
      await client.users.deleteUser(clerkUserId).catch(e =>
        console.error('Invite rollback: could not delete Clerk user', clerkUserId, e),
      )
    }
  }

  // 1. Create the Clerk user — or reuse one that already exists for this email
  //    (a retry after an earlier partial failure, or a user left over from the
  //    agency claim flow). skipPassword* mirrors POST /api/admin/staff/[id]/
  //    invite: this instance has password as an auth factor, so createUser
  //    without them fails with form_param_missing — which is what surfaced as
  //    the generic "Failed to send invitation" on the Team page.
  try {
    const user = await client.users.createUser({
      emailAddress: [email],
      firstName,
      lastName,
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    })
    clerkUserId = user.id
    createdClerkUser = true
  } catch (err) {
    if (clerkErr(err)?.code === 'form_identifier_exists') {
      const existing = await client.users.getUserList({ emailAddress: [email] })
      clerkUserId = existing.data[0]?.id ?? null
    }
    if (!clerkUserId) {
      console.error('Invite: createUser failed:', err)
      return NextResponse.json(
        { error: 'Could not create the portal user.', detail: detailOf(err) },
        { status: 500 },
      )
    }
  }

  // 2. Add to the caller's Clerk org with the requested role.
  try {
    await client.organizations.createOrganizationMembership({
      organizationId: orgId,
      userId: clerkUserId,
      role: role || 'org:member',
    })
  } catch (err) {
    if (clerkErr(err)?.code !== 'organization_membership_exists') {
      await rollback()
      console.error('Invite: createOrganizationMembership failed:', err)
      return NextResponse.json(
        { error: 'Could not add the user to your agency.', detail: detailOf(err) },
        { status: 500 },
      )
    }
  }

  // 3. Generate a magic sign-in token. The RAW token wrapped in the PORTAL's
  //    sign-in URL, not Clerk's ready-made `tokenData.url` — that one points at
  //    the Clerk instance and dropped invited staff on a Clerk-hosted page.
  //    Same fix, same reason, as POST /api/admin/staff/[id]/invite; both feed
  //    the same Airtable template. See lib/auth/portal-sign-in-link.ts.
  const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 60 * 60 * 24 * 30 }),
  })
  const tokenData = await tokenRes.json().catch(() => ({}))
  const signInToken: string | null = tokenData.token ?? null
  if (!tokenRes.ok || !signInToken) {
    await rollback()
    console.error('Invite: sign_in_tokens failed:', tokenRes.status, tokenData)
    return NextResponse.json(
      { error: 'Could not generate the sign-in link.', detail: tokenData?.errors?.[0]?.message ?? `HTTP ${tokenRes.status}` },
      { status: 500 },
    )
  }
  const magicLink = portalSignInLink(signInToken)

  // 4. Create the Agency Users row.
  try {
    await createAgencyUserRecord({
      firstName,
      lastName,
      email,
      role: role || 'org:member',
      agencyId,
      clerkUserId,
      invitedByName,
      phone,
    })
  } catch (err) {
    await rollback()
    console.error('Invite: Airtable create failed:', err)
    return NextResponse.json(
      { error: 'Could not save the staff record.', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // 5. Send the invitation email. Never throws — a disabled automation or a
  //    Resend failure comes back as { skipped } / { sent: false } and the
  //    invite still counts as created (the row exists, the link is live).
  //    Surface it so a non-send is visible without being fatal.
  const emailResult = await sendPortalAccountEmail({
    automationName: 'Agency Staff Welcome to Portal - Invite',
    to: email,
    tokens: {
      firstName,
      agencyName: agencyName ?? '',
      magicLink,
    },
    agencyRecordId: agencyId,
  })

  const emailSent = 'sent' in emailResult && emailResult.sent
  return NextResponse.json({
    success: true,
    userId: clerkUserId,
    emailSent,
    email: emailResult,
  })
}
