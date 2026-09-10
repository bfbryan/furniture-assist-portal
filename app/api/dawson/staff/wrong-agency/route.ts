// app/api/dawson/staff/wrong-agency/route.ts
//
// GET — every Agency Users row an agency admin has flagged as not working at
// their office.
//
// Flagging one of these does three things (PATCH /api/admin/staff/[id]/status,
// membershipStatus: 'Not At This Office'): it deletes their Clerk organisation
// membership, it writes Membership Status = 'Not At This Office' with a
// Membership Decided By / Decided At stamp, and the agency Team page moves them
// into its own "Not at this office" section (Confirm undoes it). Their past
// referrals stop being visible to the agency. This route, and the page over
// it, are the internal view of who has been flagged.
//
// (Before the membership-confirmation branch this flag lived on Portal Invite
// Status as 'Wrong Agency', with no timestamp — hence the older field names in
// the URL path and page route, kept to avoid breaking links.)
//
// Static segment, so it does not collide with the [id] route beside it: Next
// matches a literal path segment ahead of a dynamic one.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

const FIELDS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone Number',
  'Agency',
  'Agency Name (from Agency)',
  'Status',
  'Invited Date',
  'Invited By',
  'Record Creation Date',
  'Membership Decided At',
  'Membership Decided By',
]

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agency Users`)
  url.searchParams.set('filterByFormula', '{Membership Status} = "Not At This Office"')
  url.searchParams.set('pageSize', '100')
  for (const f of FIELDS) url.searchParams.append('fields[]', f)

  // Only the fields this route actually reads. Airtable omits blank fields
  // entirely, so every one of them is optional — that is not defensive typing,
  // it is the shape of the response.
  type AgencyUserFields = {
    'First Name'?: string
    'Last Name'?: string
    Email?: string
    'Phone Number'?: string
    Agency?: string[]
    'Agency Name (from Agency)'?: string[]
    Status?: string
    'Invited Date'?: string
    'Invited By'?: string
    'Record Creation Date'?: string
    'Membership Decided At'?: string
    'Membership Decided By'?: string
  }
  type AirtableRecord = { id: string; fields?: AgencyUserFields }

  // Agency Name comes from the lookup already on the row, so no second request
  // and no agency-name join to keep in step with the other list pages.
  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), { headers: HEADERS, cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: 500 })
    }
    const data = await res.json()
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  const staff = records.map(r => {
    const f = r.fields ?? {}
    const firstName = (f['First Name'] ?? '').trim()
    const lastName = (f['Last Name'] ?? '').trim()
    return {
      id: r.id,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      email: (f['Email'] ?? '').trim() || null,
      phone: (f['Phone Number'] ?? '').trim() || null,
      agencyId: f['Agency']?.[0] ?? null,
      agencyName: f['Agency Name (from Agency)']?.[0] ?? null,
      status: f['Status'] ?? null,
      invitedDate: f['Invited Date'] ?? null,
      invitedBy: f['Invited By'] ?? null,
      addedDate: f['Record Creation Date'] ?? null,
      // The flag now carries its own timestamp and author (Membership Decided
      // At / By), written by PATCH /api/admin/staff/[id]/status. decidedAt is
      // what the page dates the flag by; decidedBy is which agency admin
      // raised it.
      decidedAt: f['Membership Decided At'] ?? null,
      decidedBy: f['Membership Decided By'] ?? null,
    }
  })

  // Most recently flagged first — a flag raised today is the one worth reading.
  // Falls back to Record Creation Date for any row flagged before the timestamp
  // field existed.
  staff.sort((a, b) =>
    (b.decidedAt ?? b.addedDate ?? '').localeCompare(a.decidedAt ?? a.addedDate ?? ''),
  )

  return NextResponse.json(staff)
}
