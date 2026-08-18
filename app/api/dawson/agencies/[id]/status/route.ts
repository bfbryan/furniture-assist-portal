// app/api/dawson/agencies/[id]/status/route.ts

import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { sendPortalAccountEmail } from '@/lib/notifications/portal-account-email'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

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

  // Update AT status
  const fields: Record<string, unknown> = { Status: status }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
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
  } catch (err) {
    console.error('Status notice email failed:', err)
  }

  return NextResponse.json({ success: true })
}
