// app/api/dawson/staff/wrong-agency/route.ts
//
// GET — every Agency Users row an agency admin has flagged as belonging to
// somebody else.
//
// Flagging one of these does three things (PATCH /api/admin/staff/[id]/status):
// it deletes their Clerk organisation membership, it writes Portal Invite
// Status = 'Wrong Agency', and the agency Team page then filters them out of
// its own list. Up to now that was the end of it — the row went quiet in
// Airtable and no portal surface showed it, so nobody internally could see who
// had been flagged or act on it. This route, and the page over it, are the
// missing end of that flow.
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
]

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agency Users`)
  url.searchParams.set('filterByFormula', '{Portal Invite Status} = "Wrong Agency"')
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
      // The flag itself carries no timestamp — there is no field for one on
      // Agency Users — so these two are what the page can honestly date it by.
      // See the note on the page for what that means for the "when" column.
      invitedDate: f['Invited Date'] ?? null,
      invitedBy: f['Invited By'] ?? null,
      addedDate: f['Record Creation Date'] ?? null,
    }
  })

  // Most recently added first — a flag raised today is the one worth reading.
  staff.sort((a, b) => (b.addedDate ?? '').localeCompare(a.addedDate ?? ''))

  return NextResponse.json(staff)
}
