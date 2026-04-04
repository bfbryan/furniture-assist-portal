// app/api/admin/remove/route.ts
// Remove a staff member from the Clerk org and mark inactive in Airtable

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function deactivateAgencyUser(clerkUserId: string) {
  // Find the AT Agency Users record by Clerk User ID
  const formula = encodeURIComponent(`{Clerk User ID} = "${clerkUserId}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}?filterByFormula=${formula}&maxRecords=1`

  const findRes = await fetch(url, { headers: HEADERS })
  if (!findRes.ok) throw new Error('Failed to find Agency Users record')

  const findData = await findRes.json()
  if (!findData.records || findData.records.length === 0) {
    console.warn('No AT Agency Users record found for Clerk User ID:', clerkUserId)
    return null
  }

  const recordId = findData.records[0].id

  // Update record — set Status = Inactive, Removed Date = today
  const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({
      fields: {
        'Status': 'Inactive',
        'Removed Date': new Date().toISOString().split('T')[0],
      },
    }),
  })

  if (!patchRes.ok) {
    const err = await patchRes.text()
    throw new Error(`Airtable update failed: ${err}`)
  }

  return patchRes.json()
}

export async function DELETE(req: NextRequest) {
  const { orgRole } = await auth()

  if (orgRole !== 'org:admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { clerkUserId, orgId } = await req.json()

  if (!clerkUserId || !orgId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const client = await clerkClient()

    // 1. Remove from Clerk org
    await client.organizations.deleteOrganizationMembership({
      organizationId: orgId,
      userId: clerkUserId,
    })

    // 2. Update AT Agency Users record
    await deactivateAgencyUser(clerkUserId)

    return NextResponse.json({ success: true })

  } catch (err: any) {
    console.error('Remove error:', err)
    return NextResponse.json(
      { error: 'Failed to remove staff member. Please try again.' },
      { status: 500 }
    )
  }
}
