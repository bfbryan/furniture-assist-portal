// app/api/dawson/agencies/[id]/status/route.ts

import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'
import { easternTodayISO } from '@/lib/dates'
import { updateAgencyUserPortalInvite } from '@/lib/airtable'
import { provisionAgencyPortalAccess, resolveDawsonActorName } from '@/lib/agencies/portal-provisioning'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }

async function patchAirtable(table: string, recordId: string, fields: Record<string, unknown>) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ fields }) }
  )
  if (!res.ok) throw new Error(`Airtable ${table} update failed: ${await res.text()}`)
  return res.json()
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const { status, previousStatus } = await req.json()

  // Per user: leave validStatuses as-is. Unclaimed/Invited transitions
  // are handled by other endpoints (import, invite). This route covers
  // Pending → Approved/Rejected and Approved ↔ Inactive transitions only.
  const validStatuses = ['Pending', 'Approved', 'Rejected', 'Inactive']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Fetch current agency record to get Clerk Org ID and contact info.
  // SCHEMA MIGRATION (June 2026): the Agencies table no longer holds
  // First Name / Email directly. They are now lookup fields via the
  // Primary Admin link: "Admin First Name" and "Admin Email".
  // Both return arrays from Airtable (lookup format) — take [0].
  const agencyRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )
  if (!agencyRes.ok) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }
  const agencyData = await agencyRes.json()
  const clerkOrgId = (agencyData.fields['Clerk Org ID'] as string) ?? null
  const agencyName = agencyData.fields['Agency Name'] as string

  // Lookup fields come back as arrays; unwrap to first value (or '').
  const unwrapLookup = (v: unknown): string => {
    if (Array.isArray(v)) return (v[0] as string) ?? ''
    if (typeof v === 'string') return v
    return ''
  }
  const contactEmail = unwrapLookup(agencyData.fields['Admin Email'])
  const contactFirstName = unwrapLookup(agencyData.fields['Admin First Name'])

  // ------------------------------------------------------------------
  // Pending -> Approved: a self-registered agency's one decision point.
  // The thank-you page's copy tells a registrant that approval leads to a
  // portal invitation — two separate clicks (Approve, then later Invite)
  // is how that ends up half-done, so this does the SAME Clerk
  // provisioning app/api/dawson/agencies/[id]/invite/route.ts does for an
  // Unclaimed agency, entered from a different status behind a different
  // button. Same gates as Invite too (Reconciled, Primary Admin present
  // and has an email) — reconciliation stays Ben's own pass either way.
  //
  // All-or-nothing: the Airtable Status PATCH only happens AFTER
  // provisioning succeeds, so a gate failure or a Clerk error leaves the
  // agency exactly where it was (Pending), not half-approved with no
  // portal access.
  // ------------------------------------------------------------------
  if (status === 'Approved' && previousStatus === 'Pending') {
    const reconciled = (agencyData.fields['Reconciled'] as boolean) ?? false
    const primaryAdminId = (agencyData.fields['Primary Admin'] as string[])?.[0] ?? null

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

    const adminRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${primaryAdminId}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
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
    const adminClerkUserId = (uf['Clerk User ID'] as string) ?? null

    if (!adminEmail) {
      return NextResponse.json(
        { error: 'The Primary Admin has no email on file. Add one in Airtable first.' },
        { status: 400 }
      )
    }

    const provisioned = await provisionAgencyPortalAccess({
      agencyId: id,
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

    const invitedByName = await resolveDawsonActorName()
    const now = new Date().toISOString()

    await patchAirtable('Agencies', id, {
      Status: 'Approved',
      ...(agencyData.fields['Approval Date'] ? {} : { 'Approval Date': easternTodayISO() }),
    })
    await updateAgencyUserPortalInvite(primaryAdminId, {
      status: 'Invited',
      portalInviteStatus: 'Invite Sent',
      invitedDate: now,
      invitedBy: invitedByName,
      clerkUserId: provisioned.adminClerkUserId,
      // Same reasoning as invite/route.ts: they are the person the agency
      // is being handed to, there is no one else to vouch for them.
      membershipStatus: 'Confirmed',
      membershipDecidedBy: 'Furniture Assist',
      membershipDecidedAt: now,
    })

    // "Agency Registration Approval" hardcodes its own sign-in URL around
    // a bare `token` placeholder — NOT the `magicLink` shape the other
    // two welcome templates use. Ships Enabled unchecked like every other
    // automation before go-live.
    const email = await sendPortalAccountEmail({
      automationName: 'Agency Registration Approval',
      to: adminEmail,
      tokens: {
        'First Name': adminFirstName,
        'Agency Name': agencyName,
        token: provisioned.signInToken,
      },
      agencyRecordId: id,
    })

    return NextResponse.json({ success: true, email })
  }

  // ------------------------------------------------------------------
  // Every other transition this route has always handled: Pending ->
  // Rejected, Approved <-> Inactive. Unchanged except for the Rejected
  // email/date-stamp addition below.
  // ------------------------------------------------------------------
  const fields: Record<string, unknown> = { Status: status }

  // agency-detail-rebuild: only the auto-claim cascade (stampFirstLogin)
  // ever stamped Approval Date — this manual path (Dawson clicking Approve
  // on a Pending agency) flipped Status without it, so the detail page's
  // lifecycle timeline had no date for a segment it otherwise shows as
  // reached. Stamp it here too, but only when transitioning TO Approved and
  // it isn't already set — an agency that was Approved, went Inactive, and
  // is now Reinstated keeps its original approval date rather than getting
  // today's.
  if (status === 'Approved' && !agencyData.fields['Approval Date']) {
    fields['Approval Date'] = easternTodayISO()
  }
  // Same gap, same fix, for Rejected: read elsewhere (getAllAgencies /
  // getAgencyWithDetails both return rejectedDate) but never written by
  // any path before now. Noticed while wiring the Rejected email below —
  // sending a rejection notice with no rejection date on the record it
  // describes would be its own small inconsistency.
  if (status === 'Rejected' && !agencyData.fields['Rejected Date']) {
    fields['Rejected Date'] = new Date().toISOString()
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ fields }) }
  )

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  // Update Clerk org metadata if we have an org ID
  if (clerkOrgId) {
    try {
      const client = await clerkClient()
      if (status === 'Inactive') {
        await client.organizations.updateOrganizationMetadata(clerkOrgId, {
          publicMetadata: { status: 'Inactive' },
        })
      } else if (status === 'Approved') {
        await client.organizations.updateOrganizationMetadata(clerkOrgId, {
          publicMetadata: { status: 'Active' },
        })
      }
    } catch (err) {
      console.error('Clerk metadata update failed:', err)
    }
  }

  // Email notifications through the Email Automations pattern (these used to
  // POST to Zapier webhooks whose Zaps have been switched off for weeks).
  // Only fire when we have a contactEmail — agencies without a Primary Admin
  // wouldn't have anywhere to send the email. While either automation is
  // disabled in Airtable, its send is skipped by design.
  try {
    if (status === 'Inactive' && contactEmail) {
      await sendPortalAccountEmail({
        automationName: 'Agency Inactive Notice',
        to: contactEmail,
        tokens: { contactFirstName, agencyName },
        agencyRecordId: id,
      })
    }

    if (status === 'Approved' && previousStatus === 'Inactive' && contactEmail) {
      await sendPortalAccountEmail({
        automationName: 'Agency Reinstate Notice',
        to: contactEmail,
        tokens: { contactFirstName, agencyName },
        agencyRecordId: id,
      })
    }

    // Rejected has never sent anything, for any agency, until now — this
    // closes that gap generally, not just for self-registrations, since
    // the route doesn't otherwise distinguish Source and Pending is
    // currently only reachable by self-registration anyway.
    if (status === 'Rejected' && contactEmail) {
      await sendPortalAccountEmail({
        automationName: 'Agency Registration Rejected',
        to: contactEmail,
        tokens: { 'First Name': contactFirstName, 'Agency Name': agencyName },
        agencyRecordId: id,
      })
    }
  } catch (err) {
    console.error('Status notice email failed:', err)
  }

  return NextResponse.json({ success: true })
}
