// app/api/admin/invite/route.ts
// Invite a brand-new staff member from the Team page — creates the Clerk
// user, adds them to the org, creates the Agency Users row, and emails the
// magic link through the Email Automations pattern (the Zapier webhook this
// used to POST to has been retired).

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

  try {
    const client = await clerkClient()

    // 1. Create Clerk user
    const user = await client.users.createUser({
      emailAddress: [email],
      firstName,
      lastName,
    })

    // 2. Add to Clerk org with specified role
    await client.organizations.createOrganizationMembership({
      organizationId: orgId,
      userId: user.id,
      role: role || 'org:member',
    })

    // 3. Generate sign-in token (magic link)
    const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: user.id, expires_in_seconds: 60 * 60 * 24 * 30 }),
    })
    // The RAW token wrapped in the PORTAL's sign-in URL, not Clerk's
    // ready-made `tokenData.url` — that one points at the Clerk instance and
    // dropped invited staff on a Clerk-hosted page. Same fix, same reason, as
    // POST /api/admin/staff/[id]/invite; both feed the same Airtable template.
    // See lib/auth/portal-sign-in-link.ts.
    const tokenData = await tokenRes.json()
    const signInToken: string | null = tokenData.token ?? null
    const magicLink: string | null = signInToken ? portalSignInLink(signInToken) : null

    // 4. Create AT Agency Users record
    await createAgencyUserRecord({
      firstName,
      lastName,
      email,
      role: role || 'org:member',
      agencyId,
      clerkUserId: user.id,
      invitedByName,
      phone,
    })

    // 5. Send the invitation email. While the automation is disabled in
    // Airtable this is skipped by design and the invite still succeeds.
    const emailResult = await sendPortalAccountEmail({
      automationName: 'Agency Staff Welcome to Portal - Invite',
      to: email,
      tokens: {
        firstName,
        agencyName: agencyName ?? '',
        magicLink: magicLink ?? '',
      },
      agencyRecordId: agencyId,
    })

    return NextResponse.json({ success: true, userId: user.id, email: emailResult })

  } catch (err: any) {
    console.error('Invite error:', err)

    const code = err.errors?.[0]?.code
    if (code === 'form_identifier_exists' || err.message?.includes('already exists')) {
      return NextResponse.json(
        { error: 'A user with this email already exists in the portal.' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to send invitation. Please try again.' },
      { status: 500 }
    )
  }
}
