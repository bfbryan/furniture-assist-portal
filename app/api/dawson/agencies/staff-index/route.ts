// app/api/dawson/agencies/staff-index/route.ts
//
// GET /api/dawson/agencies/staff-index
//
// Every Agency User as {id, name, email, agencyId}, so the four Dawson agency
// list pages can match their search box against PEOPLE as well as against the
// organisation. Ben asked whether that was possible rather than asserting it;
// the short answer is yes, and this is why it is cheap:
//
//   • Agency Users is 269 rows today against 124 agencies. The whole table,
//     trimmed to four fields, is one paginated read and a payload of tens of
//     kilobytes. Sending it once per page load and matching in the browser is
//     less work than debouncing a server query on every keystroke, and it means
//     typing feels the same as it already does on those pages, which is
//     instant.
//   • It is deliberately NOT the /api/dawson/staff/search endpoint. That one
//     answers "which PERSON did I mean" for the Add Referral form and returns
//     at most 25 ranked people. These pages ask the opposite question - "which
//     AGENCIES should stay on screen" - and need a complete answer, not a
//     ranked top slice, or an agency would drop out of the list depending on
//     how many other people happened to match.
//
// No status filter. The four pages already partition agencies by status
// themselves, and a person is worth finding whether or not they have claimed
// their account - an Unclaimed contact off a referral slip is exactly the sort
// of name Dawson has and an agency he does not.

import { NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!
const HEADERS = { Authorization: `Bearer ${API_KEY}` }

export type AgencyStaffIndexEntry = {
  id: string
  name: string
  email: string
  agencyId: string
}

export async function GET() {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const out: AgencyStaffIndexEntry[] = []
  let offset: string | undefined

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/Agency Users`)
    url.searchParams.set('pageSize', '100')
    url.searchParams.append('fields[]', 'First Name')
    url.searchParams.append('fields[]', 'Last Name')
    url.searchParams.append('fields[]', 'Email')
    url.searchParams.append('fields[]', 'Agency')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), { headers: HEADERS })
    if (!res.ok) {
      // Soft failure. The pages fall back to matching the agency's own fields,
      // which is what they did before this existed, rather than showing an
      // error over a search box that still works.
      return NextResponse.json([])
    }

    const data = await res.json()
    for (const r of data.records ?? []) {
      const agencyLink = r.fields['Agency']
      const agencyId = Array.isArray(agencyLink) ? agencyLink[0] : null
      if (typeof agencyId !== 'string') continue

      const first = ((r.fields['First Name'] as string) ?? '').trim()
      const last = ((r.fields['Last Name'] as string) ?? '').trim()
      const email = ((r.fields['Email'] as string) ?? '').trim()
      const name = `${first} ${last}`.trim()
      if (!name && !email) continue

      out.push({ id: r.id, name, email, agencyId })
    }
    offset = data.offset
  } while (offset)

  return NextResponse.json(out)
}
