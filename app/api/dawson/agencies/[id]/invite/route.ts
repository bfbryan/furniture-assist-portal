// app/api/dawson/agencies/[id]/invite/route.ts
//
// POST — Invite an Unclaimed agency's Primary Admin to the portal.
//
// Ben reconciles an agency in Airtable (ticks Reconciled, links a Primary
// Admin who has an email), then clicks Invite on the Unclaimed list. This:
//   1. Creates the Clerk organization (unless the agency already has one)
//      and writes Clerk Org ID back to the Agencies row.
//   2. Creates the admin's Clerk user (reusing any existing user with that
//      email) and writes Clerk User ID back to their Agency Users row.
//   3. Adds them to the organization as org:admin.
//   4. Generates a 30-day magic sign-in token.
//   5. Stamps the Agencies row (Status → Invited, Invited Date) and the
//      admin's row (Status → Invited, Portal Invite Status → Invite Sent,
//      Invited Date, Invited By).
//   6. Sends "Agency Welcome to Portal - Claimed" through the Email
//      Automations pattern. While that automation is disabled the send is
//      skipped by design and the invite still succeeds.
//
// Clerk IDs are written back the moment each object is created, so a retry
// after a mid-flight failure reuses the same org/user instead of minting
// duplicates. Calling this again for an already-Invited agency is the resend
// case: everything is reused and a fresh token is issued.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { updateAgencyUserPortalInvite } from '@/lib/airtable'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'
import { provisionAgencyPortalAccess, resolveDawsonActorName } from '@/lib/agencies/portal-provisioning'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function patchAirtable(table: string, recordId: string, fields: Record<string, unknown>) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ fields }) }
  )
  if (!res.ok) throw new Error(`Airtable ${table} update failed: ${await res.text()}`)
  return res.json()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id: agencyId } = await params

  const agencyRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${agencyId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: 'no-store' }
  )
  if (!agencyRes.ok) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }
  const agencyRecord = await agencyRes.json()
  const af = agencyRecord.fields ?? {}

  const agencyName = (af['Agency Name'] as string) ?? ''
  const agencyStatus = (af['Status'] as string) ?? ''
  const reconciled = (af['Reconciled'] as boolean) ?? false
  const primaryAdminId = (af['Primary Admin'] as string[])?.[0] ?? null
  let clerkOrgId = (af['Clerk Org ID'] as string) ?? null

  // The guard that keeps Ben's one-at-a-time rollout safe: only a reconciled
  // agency with an admin on file can be invited. Everything else is a 400
  // with a message the UI can show verbatim.
  if (agencyStatus !== 'Unclaimed' && agencyStatus !== 'Invited') {
    return NextResponse.json(
      { error: `Cannot invite an agency with status ${agencyStatus}` },
      { status: 400 }
    )
  }
  if (!reconciled) {
    return NextResponse.json(
      { error: 'This agency has not been reconciled yet. Tick Reconciled in Airtable first.' },
      { status: 400 }
    )
  }
  if (!primaryAdminId) {
    return NextResponse.json(
      { error: 'No Primary Admin is linked on this agency yet. Set one in Airtable first.' },
      { status: 400 }
    )
  }

  // Fetch the Primary Admin's Agency Users row directly — the lookups on the
  // Agencies row would do for the email, but the stamps below need the row id
  // and its current Clerk User ID.
  const adminRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${primaryAdminId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: 'no-store' }
  )
  if (!adminRes.ok) {
    return NextResponse.json(
      { error: 'The linked Primary Admin record could not be loaded.' },
      { status: 500 }
    )
  }
  const adminRecord = await adminRes.json()
  const uf = adminRecord.fields ?? {}
  const adminFirstName = ((uf['First Name'] as string) ?? '').trim()
  const adminLastName = ((uf['Last Name'] as string) ?? '').trim()
  const adminEmail = ((uf['Email'] as string) ?? '').trim()
  let adminClerkUserId = (uf['Clerk User ID'] as string) ?? null

  if (!adminEmail) {
    return NextResponse.json(
      { error: 'The Primary Admin has no email on file. Add one in Airtable first.' },
      { status: 400 }
    )
  }

  // Clerk org + admin user + org membership + sign-in token — shared with
  // the Pending -> Approved provisioning branch in status/route.ts. See
  // lib/agencies/portal-provisioning.ts for why this isn't inlined here
  // any more.
  const provisioned = await provisionAgencyPortalAccess({
    agencyId,
    agencyName,
    clerkOrgId,
    primaryAdminId,
    adminEmail,
    adminFirstName,
    adminLastName,
    adminClerkUserId,
  })
  if (!provisioned.ok) {
    return NextResponse.json({ error: provisioned.error }, { status: provisioned.status })
  }
  clerkOrgId = provisioned.clerkOrgId
  adminClerkUserId = provisioned.adminClerkUserId
  // "Agency Welcome to Portal - Claimed" takes a `magicLink` placeholder — a
  // COMPLETE sign-in URL used directly as the href on both CTA buttons, the
  // same contract the staff invite template uses. NOT the bare token; that
  // contract belongs to "Agency Registration Approval" (status/route.ts),
  // which already hardcodes its own URL around just the token.
  const magicLink = provisioned.magicLink

  // Who clicked Invite — stamped on the admin row as Invited By.
  const invitedByName = await resolveDawsonActorName()

  // 5. Stamps. The Airtable automation that used to write Invited Date is
  // switched off — the code owns these timestamps now.
  const now = new Date().toISOString()
  await patchAirtable('Agencies', agencyId, {
    Status: 'Invited',
    'Invited Date': now,
  })
  await updateAgencyUserPortalInvite(primaryAdminId, {
    status: 'Invited',
    portalInviteStatus: 'Invite Sent',
    invitedDate: now,
    invitedBy: invitedByName,
    clerkUserId: adminClerkUserId,
    // Auto-confirm the Primary Admin's own membership in the SAME PATCH so it
    // is atomic with the invite. They are the person the agency is being
    // handed to — there is no one else to vouch for them, and without this
    // their own referrals (and the referral-visibility gate generally) would
    // sit dark until they confirmed themselves. Decided By is the operations
    // portal, not a person.
    membershipStatus: 'Confirmed',
    membershipDecidedBy: 'Furniture Assist',
    membershipDecidedAt: now,
  })

  // 6. Welcome email. Skipped (not failed) while the automation is disabled.
  const email = await sendPortalAccountEmail({
    automationName: 'Agency Welcome to Portal - Claimed',
    to: adminEmail,
    tokens: {
      'Admin First Name': adminFirstName,
      'Agency Name': agencyName,
      magicLink,
    },
    agencyRecordId: agencyId,
  })

  return NextResponse.json({ ok: true, email })
}
