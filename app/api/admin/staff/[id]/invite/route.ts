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

  // Who is sending this invite. Loaded before the ownership check below, which
  // needs their agency; also supplies the Invited By text further down.
  const admin = await getAgencyUserByClerkId(userId)

  // The invited row must belong to the caller's own agency.
  //
  // Without this the only gate is "you are an org admin of SOME agency", while
  // the record id comes straight from the URL and the Clerk membership granted
  // below uses the CALLER's orgId — so an admin could pull any Agency Users row
  // in the base into their own organization, as org:admin if that row's Role is
  // Admin, and be emailed a working sign-in link for them.
  //
  // This is not only reachable by hand-crafting a request. The Team page lists
  // staff via getAgencyUsersByAgencyId(agency.name), which matches on agency
  // NAME, and two names are duplicated in the live base — so those agencies
  // already render each other's people with a live Send Invite button beside
  // them. Scoping the list by record id is the wider fix and is called out
  // separately; this closes the endpoint regardless of what the page shows.
  if (!admin?.agencyId || staff.agencyId !== admin.agencyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only invitable if row is currently Unclaimed or already Invited (resend case)
  if (staff.status !== 'Unclaimed' && staff.status !== 'Invited') {
    return NextResponse.json(
      { error: `Cannot invite staff with status ${staff.status}` },
      { status: 400 }
    )
  }

  const invitedByName = admin.name ?? 'Portal Admin'

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

  // Clerk returns a ready-made sign-in URL alongside the raw token. Use it.
  //
  // This used to hand-build the link out of NEXT_PUBLIC_APP_URL, which has
  // never been set in any environment — so every invite email went out with a
  // link starting "undefined/sign-in?...". `tokenData.url` is the same link
  // Clerk would build itself, already pointing at the right instance, and it
  // is what app/api/admin/invite/route.ts has always used.
  const tokenData = await tokenRes.json()
  const magicLink: string | null = tokenData.url ?? null

  if (!magicLink) {
    return NextResponse.json(
      { error: 'Failed to generate invite link' },
      { status: 500 }
    )
  }

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
