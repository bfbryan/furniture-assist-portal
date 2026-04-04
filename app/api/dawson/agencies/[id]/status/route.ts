// app/api/dawson/agencies/[id]/status/route.ts

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_USER_IDS = ['user_3BmTnGTVcPCuCJTpP8uKrQm4KXj']

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const { status, previousStatus } = await req.json()

  const validStatuses = ['Pending', 'Approved', 'Rejected', 'Inactive']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Fetch current agency record to get Clerk Org ID and contact info
  const agencyRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agencies')}/${id}`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )
  if (!agencyRes.ok) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }
  const agencyData = await agencyRes.json()
  const clerkOrgId = agencyData.fields['Clerk Org ID'] as string ?? null
  const agencyName = agencyData.fields['Agency Name'] as string
  const contactEmail = agencyData.fields['Email'] as string
  const contactFirstName = agencyData.fields['First Name'] as string

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

  // Send Zapier webhooks for email notifications
  try {
    // Inactive — always send deactivation email
    if (status === 'Inactive' && process.env.ZAPIER_AGENCY_INACTIVE_WEBHOOK) {
      await fetch(process.env.ZAPIER_AGENCY_INACTIVE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencyName, contactEmail, contactFirstName }),
      })
    }

    // Approved from Inactive only — reinstatement email
    if (status === 'Approved' && previousStatus === 'Inactive' && process.env.ZAPIER_AGENCY_REINSTATE_WEBHOOK) {
      await fetch(process.env.ZAPIER_AGENCY_REINSTATE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencyName, contactEmail, contactFirstName }),
      })
    }
  } catch (err) {
    console.error('Zapier webhook failed:', err)
  }

  return NextResponse.json({ success: true })
}

