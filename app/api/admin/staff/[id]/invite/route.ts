// app/api/admin/staff/[id]/invite/route.ts
//
// POST — Invite an EXISTING Agency Users row.
// - Called from "Send Invite" (Unclaimed → Invited) and "Resend" (Invited → Invited).
// - Creates a Clerk user + org membership if one doesn't exist for this record.
// - Generates a magic sign-in token and POSTs to the Zapier webhook.
// - Updates the AT row: Status, Portal Invite Status, Invited Date, Invited By, Clerk User ID.

import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { easternTodayISO } from '@/lib/dates'
import {
  getAgencyUserById,
  getAgencyUserByClerkId,
  updateAgencyUserPortalInvite,
} from '@/lib/airtable'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (orgRole !== 'org:admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: recordId } = await params
  const staff = await getAgencyUserById(recordId)
  if (!staff) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only invitable if row is currently Unclaimed or already Invited (resend case)
  if (staff.status !== 'Unclaimed' && staff.status !== 'Invited') {
    return NextResponse.json(
      { error: `Cannot invite staff with status ${staff.status}` },
      { status: 400 }
    )
  }

  // Look up who's sending this invite (for Invited By text)
  const admin = await getAgencyUserByClerkId(userId)
  const invitedByName = admin?.name ?? 'Portal Admin'

  const client = await clerkClient()

  // Reuse existing Clerk user if we already have one, else create
  let clerkUserId = staff.clerkUserId as string | null

  if (!clerkUserId) {
    try {
      const created = await client.users.createUser({
        emailAddress: [staff.email],
        firstName: staff.firstName,
        lastName: staff.lastName,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      })
      clerkUserId = created.id
    } catch (err: any) {
      // If a Clerk user with this email exists already, look them up
      if (err?.errors?.[0]?.code === 'form_identifier_exists') {
        const existing = await client.users.getUserList({
          emailAddress: [staff.email],
        })
        if (existing.data.length > 0) clerkUserId = existing.data[0].id
      }
      if (!clerkUserId)
        return NextResponse.json(
          { error: 'Failed to create Clerk user', detail: err?.message ?? String(err) },
          { status: 500 }
        )
    }
  }

  // Ensure org membership (AT role → Clerk role)
  try {
    await client.organizations.createOrganizationMembership({
      organizationId: orgId!,
      userId: clerkUserId,
      role: staff.role === 'Admin' ? 'org:admin' : 'org:member',
    })
  } catch (err: any) {
    // Already a member? OK — swallow.
    if (err?.errors?.[0]?.code !== 'organization_membership_exists') {
      return NextResponse.json(
        { error: 'Failed to add to organization', detail: err?.message ?? String(err) },
        { status: 500 }
      )
    }
  }

  // Fresh magic sign-in token (invalidates any prior)
  const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 60 * 60 * 24 * 30 }),
  })

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: 'Failed to generate invite link' },
      { status: 500 }
    )
  }

  const tokenData = await tokenRes.json()
  const magicLink = `${process.env.NEXT_PUBLIC_APP_URL}/sign-in?__clerk_ticket=${tokenData.token}`

  // Fire Zapier webhook for email delivery
  const webhook = process.env.ZAPIER_STAFF_INVITE_WEBHOOK
  if (webhook) {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: staff.email,
        firstName: staff.firstName,
        lastName: staff.lastName,
        agencyName: staff.agencyName,
        magicLink,
        invitedBy: invitedByName,
      }),
    })
  }

  // Update the AT row
  const today = easternTodayISO()
  await updateAgencyUserPortalInvite(recordId, {
    status: 'Invited',
    portalInviteStatus: 'Invite Sent',
    invitedDate: today,
    invitedBy: invitedByName,
    clerkUserId,
  })

  return NextResponse.json({ ok: true })
}
