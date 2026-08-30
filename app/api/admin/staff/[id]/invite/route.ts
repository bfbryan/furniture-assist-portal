// app/api/admin/staff/[id]/invite/route.ts
//
// POST — Invite an EXISTING Agency Users row.
// - Called from "Send Invite" (imported row, no Clerk user) and "Resend"
//   (already invited via here or via Add Staff Member, Clerk user exists).
// - The two are NOT flagged; the route derives what's needed from state:
//     • Clerk user  — created only when the row has no Clerk User ID.
//     • Org membership — added only when the user isn't already in the org
//       (checked with getOrganizationMembershipList). Re-adding it is what
//       made Resend fail with "Failed to add to organization" for a user
//       first created through Add Staff Member.
// - Always: a FRESH sign-in token (invalidates any prior) + the invite email.
// - Updates the AT row: Status, Portal Invite Status, Invited Date, Invited By, Clerk User ID.

import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import {
  getAgencyUserById,
  getAgencyUserByClerkId,
  updateAgencyUserPortalInvite,
} from '@/lib/airtable'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'
import { portalSignInLink } from '@/lib/auth/portal-sign-in-link'

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

  // Reuse the Clerk user this record already has, if any.
  let clerkUserId = staff.clerkUserId as string | null

  // Does that user already belong to this org? Checked up front so Resend
  // (user + membership already exist, e.g. from Add Staff Member) skips the
  // add entirely rather than relying on Clerk's duplicate error — whose code
  // string it was matching on the wrong value, turning a no-op into a 500.
  let alreadyMember = false
  if (clerkUserId) {
    try {
      const memberships = await client.users.getOrganizationMembershipList({ userId: clerkUserId })
      alreadyMember = memberships.data.some(m => m.organization.id === orgId)
    } catch {
      // Lookup failed — fall through; the add below still swallows the
      // "already a member" error as a backstop.
    }
  }

  // Create the Clerk user only for a record that has none — Send Invite on an
  // imported row. Resend skips this.
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

  // Add the org membership only when it isn't already there.
  if (!alreadyMember) {
    try {
      await client.organizations.createOrganizationMembership({
        organizationId: orgId!,
        userId: clerkUserId,
        role: staff.role === 'Admin' ? 'org:admin' : 'org:member',
      })
    } catch (err: any) {
      // Already a member? OK — swallow. Clerk has used both spellings.
      const code = err?.errors?.[0]?.code
      if (code !== 'organization_membership_exists' && code !== 'already_a_member_in_organization') {
        return NextResponse.json(
          { error: 'Failed to add to organization', detail: err?.message ?? String(err) },
          { status: 500 }
        )
      }
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

  // Take the RAW token and wrap the PORTAL's own sign-in URL around it.
  //
  // This used to send `tokenData.url` — the ready-made URL Clerk returns
  // beside the token. That URL points at the Clerk instance rather than at us,
  // so an invited staff member landed on a Clerk-hosted sign-in page instead
  // of the portal: Ben's report. The agency admin welcome has always done it
  // the other way (raw token, portal URL wrapped around it in the Airtable
  // template) and has always landed people in the right place, so this brings
  // the staff path into line with the one that works.
  //
  // NOT rebuilt from NEXT_PUBLIC_APP_URL — that is the older bug, and it
  // produced links beginning "undefined/". See lib/auth/portal-sign-in-link.ts
  // for why the origin is a constant.
  const tokenData = await tokenRes.json()
  const signInToken: string | null = tokenData.token ?? null

  if (!signInToken) {
    return NextResponse.json(
      { error: 'Failed to generate invite link' },
      { status: 500 }
    )
  }

  const magicLink = portalSignInLink(signInToken)

  // Update the AT row. The Airtable automation that used to stamp Invited
  // Date is switched off — the code owns the timestamp now.
  await updateAgencyUserPortalInvite(recordId, {
    status: 'Invited',
    portalInviteStatus: 'Invite Sent',
    invitedDate: new Date().toISOString(),
    invitedBy: invitedByName,
    clerkUserId,
  })

  // Send the invitation email. Never throws — a disabled automation or a
  // Resend failure comes back as { skipped } / { sent: false }. The invite row
  // is already written and the sign-in link is live, so a non-send does not
  // fail the request; it is surfaced via `emailSent` for the Team page to warn
  // on. Same contract as POST /api/admin/invite.
  const emailResult = await sendPortalAccountEmail({
    automationName: 'Agency Staff Welcome to Portal - Invite',
    to: staff.email,
    tokens: {
      firstName: staff.firstName,
      agencyName: staff.agencyName ?? '',
      magicLink,
    },
    agencyRecordId: staff.agencyId,
  })

  const emailSent = 'sent' in emailResult && emailResult.sent
  return NextResponse.json({ ok: true, emailSent, email: emailResult })
}
