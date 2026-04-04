// app/api/admin/invite/route.ts
// Invite a new staff member — creates Clerk user, adds to org, creates AT Agency Users record

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

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
    'Status':        'Pending',
    'Invited Date':  new Date().toISOString().split('T')[0],
    'Phone Number':  data.phone ??'',
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
      body: JSON.stringify({ user_id: user.id }),
    })
    const tokenData = await tokenRes.json()
    const magicLink: string | null = tokenData.url ?? null

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

    // 5. Send invitation email with magic link
  
    await fetch(process.env.ZAPIER_STAFF_INVITE_WEBHOOK!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, magicLink, agencyName }),
    })

    return NextResponse.json({ success: true, userId: user.id, magicLink })

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