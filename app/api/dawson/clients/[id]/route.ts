// app/api/dawson/clients/[id]/route.ts
//
// PATCH endpoint for editing a Client record from the Client Detail page
// (formerly the Referral Detail page). Since First Name / Last Name / DOB /
// Address / etc. on Client Referrals are now LOOKUPS through the Client
// link, all identity edits must land on the Clients table. The Client
// Referrals row will pick up the new values on its next read.
//
// The client sends a flat payload (see ClientInfoCard in
// dawson-referrals-detail-page.tsx). Empty strings clear the field in
// Airtable; keys are only written when the value is a non-undefined string.

import { NextRequest, NextResponse } from 'next/server'
import { updateClient } from '@/lib/airtable'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

// Map JSON payload keys → Airtable Clients field names. Order matches the
// ClientInfoCard form.
const FIELD_MAP: Record<string, string> = {
  firstName: 'First Name',
  lastName:  'Last Name',
  dob:       'DOB',              // stored as MDY text on Clients
  phone:     'Phone',
  language:  'Preferred Language',
  address:   'Address',
  address2:  'Address 2',
  city:      'City',
  state:     'State',
  zip:       'Zip',
  county:    'County',
  hhSize:    '# in HH',
  children:  '# Children',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const fields: Record<string, unknown> = {}
  for (const [key, airtableField] of Object.entries(FIELD_MAP)) {
    if (key in body) {
      const val = body[key]
      // Only accept strings (empty string is valid — clears the cell).
      // Everything else is silently ignored so a rogue key can't corrupt a row.
      if (typeof val === 'string') {
        fields[airtableField] = val
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: 'No editable fields in payload' },
      { status: 400 },
    )
  }

  try {
    await updateClient(id, fields)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
