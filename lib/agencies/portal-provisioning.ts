// lib/agencies/portal-provisioning.ts
//
// The Clerk side of "give this agency's admin real portal access": create
// the org (once), create or reuse the admin's Clerk user, add them as
// org:admin, and mint a 30-day sign-in token.
//
// Extracted out of app/api/dawson/agencies/[id]/invite/route.ts, which used
// to be the only caller. It is now also called from
// app/api/dawson/agencies/[id]/status/route.ts's Pending -> Approved branch
// (agency-registration-route): approving a self-registered agency grants
// the SAME portal access Invite grants an Unclaimed one, just entered from
// a different status and behind a different button. One implementation —
// this project already carries three independent copies of fileDateOf that
// drifted from each other; this is not going to be a fourth.
//
// Both callers keep their OWN gates (status checks, Reconciled, Primary
// Admin presence, email presence) and their OWN post-provisioning stamps
// and email sends — those differ per caller (different target Airtable
// Status, different email template, different token shape in that
// template) and aren't folded in here. This function only does the Clerk
// half, which is identical either way.
//
// Clerk IDs are written back to Airtable the moment each object is
// created, same as before extraction — a retry after a mid-flight failure
// reuses the same org/user instead of minting duplicates.

import { clerkClient } from '@clerk/nextjs/server'
import { auth } from '@clerk/nextjs/server'
import { portalSignInLink } from '@/lib/auth/portal-sign-in-link'

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

export type ProvisionResult =
  | {
      ok: true
      clerkOrgId: string
      adminClerkUserId: string
      /** Raw Clerk sign-in token. Some templates want this bare (dropped
       *  straight into a `__clerk_ticket=` URL they already hardcode);
       *  others want the complete `magicLink` below. Pass whichever your
       *  template actually placeholders — see the callers for which is
       *  which, and don't guess from the other one. */
      signInToken: string
      magicLink: string
    }
  | { ok: false; error: string; status: number }

export async function provisionAgencyPortalAccess(args: {
  agencyId: string
  agencyName: string
  clerkOrgId: string | null
  primaryAdminId: string
  adminEmail: string
  adminFirstName: string
  adminLastName: string
  adminClerkUserId: string | null
}): Promise<ProvisionResult> {
  const client = await clerkClient()
  let clerkOrgId = args.clerkOrgId
  let adminClerkUserId = args.adminClerkUserId

  // 1. Clerk organization — created once, reused forever after.
  if (!clerkOrgId) {
    try {
      const org = await client.organizations.createOrganization({ name: args.agencyName })
      clerkOrgId = org.id
    } catch (err: any) {
      return {
        ok: false,
        error: `Failed to create the Clerk organization: ${err?.message ?? String(err)}`,
        status: 500,
      }
    }
    await patchAirtable('Agencies', args.agencyId, { 'Clerk Org ID': clerkOrgId })
  }

  // 2. Clerk user for the admin — reuse by id, then by email, then create.
  if (!adminClerkUserId) {
    try {
      const created = await client.users.createUser({
        emailAddress: [args.adminEmail],
        firstName: args.adminFirstName,
        lastName: args.adminLastName,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      })
      adminClerkUserId = created.id
    } catch (err: any) {
      if (err?.errors?.[0]?.code === 'form_identifier_exists') {
        const existing = await client.users.getUserList({ emailAddress: [args.adminEmail] })
        if (existing.data.length > 0) adminClerkUserId = existing.data[0].id
      }
      if (!adminClerkUserId) {
        return {
          ok: false,
          error: `Failed to create the admin user: ${err?.message ?? String(err)}`,
          status: 500,
        }
      }
    }
    await patchAirtable('Agency Users', args.primaryAdminId, { 'Clerk User ID': adminClerkUserId })
  }

  // 3. Org membership as admin — the Team page requires org:admin.
  try {
    await client.organizations.createOrganizationMembership({
      organizationId: clerkOrgId,
      userId: adminClerkUserId,
      role: 'org:admin',
    })
  } catch (err: any) {
    if (err?.errors?.[0]?.code !== 'organization_membership_exists') {
      return {
        ok: false,
        error: `Failed to add the admin to the organization: ${err?.message ?? String(err)}`,
        status: 500,
      }
    }
  }

  // 4. Fresh magic sign-in token, 30 days.
  const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: adminClerkUserId,
      expires_in_seconds: 60 * 60 * 24 * 30,
    }),
  })
  if (!tokenRes.ok) {
    return { ok: false, error: 'Failed to generate the sign-in link', status: 500 }
  }
  const tokenData = await tokenRes.json()
  const signInToken: string | null = tokenData.token ?? null
  if (!signInToken) {
    return { ok: false, error: 'Failed to generate the sign-in link', status: 500 }
  }

  return {
    ok: true,
    clerkOrgId,
    adminClerkUserId,
    signInToken,
    // Never Clerk's own tokenData.url — that points at the Clerk instance,
    // not the portal. See lib/auth/portal-sign-in-link.ts.
    magicLink: portalSignInLink(signInToken),
  }
}

/**
 * The Dawson user who clicked the button, for the "Invited By" stamp.
 * Falls back to 'Furniture Assist' if the session can't be resolved —
 * never blocks the action itself.
 */
export async function resolveDawsonActorName(): Promise<string> {
  try {
    const { userId } = await auth()
    if (!userId) return 'Furniture Assist'
    const client = await clerkClient()
    const dawsonUser = await client.users.getUser(userId)
    const name = `${dawsonUser.firstName ?? ''} ${dawsonUser.lastName ?? ''}`.trim()
    return name || 'Furniture Assist'
  } catch {
    return 'Furniture Assist'
  }
}
