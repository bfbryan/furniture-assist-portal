// lib/airtable/agency-users.ts
//
// Reads and writes against the Agency Users table — portal identity, invite
// state, and the per-staff detail view.
//
// June 2026: "Full Name" (formula = {First Name} & " " & {Last Name}) is the
// primary field, and Status gained 'Invited' / 'Unclaimed'.

import { airtableFetch, safeLookupString, BASE_ID, HEADERS } from './client'

export async function getAgencyUserByClerkId(clerkUserId: string) {
  const formula = encodeURIComponent(`{Clerk User ID} = "${clerkUserId}"`)
  const data = await airtableFetch('Agency Users', `?filterByFormula=${formula}&maxRecords=1`)

  if (!data.records || data.records.length === 0) return null

  const record = data.records[0]
  return {
    id: record.id,
    name: `${record.fields['First Name'] ?? ''} ${record.fields['Last Name'] ?? ''}`.trim(),
    email: record.fields['Email'] as string,
    role: record.fields['Role'] as string,
    agencyId: (record.fields['Agency'] as string[])?.[0] ?? null,
    phone: (record.fields['Phone Number'] as string) ?? null,
    status: record.fields['Status'] as string,
    claimedDate: (record.fields['Claimed Date'] as string) ?? null,
        firstName: (record.fields['First Name'] as string) ?? '',
    lastName:  (record.fields['Last Name'] as string) ?? '',
    clerkUserId: (record.fields['Clerk User ID'] as string) ?? null,
    portalInviteStatus: (record.fields['Portal Invite Status'] as string) ?? 'Not Invited',
  }
}
/**
 * Fetch a single Agency Users row by its Airtable record ID.
 * Used by the admin staff endpoints (invite, cancel-invite, status).
 */
export async function getAgencyUserById(recordId: string) {
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    cache: 'no-store',
  })

  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Airtable getAgencyUserById failed: ${await res.text()}`)
  }

  const record = await res.json()
  const f = record.fields ?? {}

  // Resolve agency name from the linked-record field, if present
  let agencyName: string | null = null
  const agencyLink = f['Agency'] as string[] | undefined
  if (agencyLink && agencyLink[0]) {
    try {
      const aRes = await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent('Agencies')}/${agencyLink[0]}`,
        { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }, cache: 'no-store' }
      )
      if (aRes.ok) {
        const a = await aRes.json()
        agencyName = (a.fields?.['Agency Name'] as string) ?? null
      }
    } catch {
      // ignore — agencyName stays null
    }
  }

  return {
    id: record.id,
    name: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
    firstName: (f['First Name'] as string) ?? '',
    lastName: (f['Last Name'] as string) ?? '',
    email: f['Email'] as string,
    phone: (f['Phone Number'] as string) ?? null,
    role: f['Role'] as string,
    status: f['Status'] as string,
    portalInviteStatus: (f['Portal Invite Status'] as string) ?? 'Not Invited',
    invitedDate: (f['Invited Date'] as string) ?? null,
    invitedBy: (f['Invited By'] as string) ?? null,
    claimedDate: (f['Claimed Date'] as string) ?? null,
    clerkUserId: (f['Clerk User ID'] as string) ?? null,
    agencyId: agencyLink?.[0] ?? null,
    agencyName,
  }
}
export async function stampFirstLogin(agencyUser: {
  id: string
  claimedDate?: string | null
  role?: string
  agencyId?: string | null
}) {
  // Already claimed — no-op
  if (agencyUser.claimedDate) return

  const now = new Date().toISOString()

  // Update Agency User: Claimed Date + Portal Invite Status
  await airtableFetch('Agency Users', `/${agencyUser.id}`, {
    method: 'PATCH',
    body: {
      fields: {
        'Claimed Date': now,
        'Portal Invite Status': 'Claimed',
      },
    },
  })

  // Cascade to Agency if this user is Primary Admin
  if (agencyUser.role === 'Admin' && agencyUser.agencyId) {
    const agencyData = await airtableFetch('Agencies', `/${agencyUser.agencyId}`)
    const primaryAdminLink = (agencyData.fields?.['Primary Admin'] as string[]) ?? []
    const isPrimaryAdmin = primaryAdminLink.includes(agencyUser.id)
    const agencyClaimedDate = agencyData.fields?.['Claimed Date']

    if (isPrimaryAdmin && !agencyClaimedDate) {
      await airtableFetch('Agencies', `/${agencyUser.agencyId}`, {
        method: 'PATCH',
        body: {
          fields: {
            'Claimed Date': now,
            'Status': 'Approved',
          },
        },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// getStaffWithDetails
// ---------------------------------------------------------------------------
// Mirrors getAgencyWithDetails but for a single Agency User (staff member).
// Powers /dawson/staff/[id] — the deep-link from the referral detail page
// and the agency detail page's staff list.
//
// Returns: staff identity + status + role, agency link (id + name), and
// every Client Referral where {Referring Staff Link} points at this user.
// The referral list is sorted newest-first so the panel opens with recent
// activity at the top.
//
// Edge cases handled:
//   • Staff exists but has no linked Agency (rare — placeholder imports):
//     agencyId/agencyName come back null, no error.
//   • Staff has zero referrals: referrals: [] (empty list, not null).
//   • Not found: caller (route) should map the airtableFetch 404 to a 404
//     response.
export async function getStaffWithDetails(staffId: string) {
  const user = await airtableFetch('Agency Users', `/${staffId}`)
  const uf = user.fields

  const firstName = ((uf['First Name'] as string) ?? '').trim()
  const lastName  = ((uf['Last Name']  as string) ?? '').trim()
  const fullName  = `${firstName} ${lastName}`.trim()

  // Agency is a single-link field on Agency Users — grab the first id.
  const agencyId = (uf['Agency'] as string[])?.[0] ?? null

  // Fetch the linked agency (for name + status) and this staff's referrals
  // in parallel. Skip the agency fetch cleanly if the staff has no Agency.
  //
  // Referrals filter uses {Referring Staff} — the lookup field on Client
  // Referrals that pulls the linked staff's display name through
  // Referring Staff Link. Filtering by the raw link field's record id
  // (either ARRAYJOIN or & "" serialization) does not work reliably here,
  // so we mirror the pattern getAgencyWithDetails uses for its own filter
  // against the {Referring Agency} lookup, which is proven in production.
  // Trade-off: two staff members with the exact same full name would show
  // each other's referrals. Acceptable for now — revisit once we hit a
  // real collision.
  const [agency, referralData] = await Promise.all([
    agencyId
      ? airtableFetch('Agencies', `/${agencyId}`).catch(() => null)
      : Promise.resolve(null),
    fullName
      ? airtableFetch(
          'Client Referrals',
          `?filterByFormula=${encodeURIComponent(
            `{Referring Staff} = "${fullName.replace(/"/g, '\\"')}"`,
          )}&sort[0][field]=Referral%20Date&sort[0][direction]=desc`,
        )
      : Promise.resolve({ records: [] }),
  ])

  const referrals = (referralData.records ?? []).map((r: any) => {
    const f = r.fields
    return {
      id: r.id,
      clientName: `${f['First Name'] ?? ''} ${f['Last Name'] ?? ''}`.trim(),
      referralDate: f['Referral Date'] as string,
      appointmentDate: (f['Appointment Date'] as string[])?.[0] ?? null,
      referralReview: f['Referral Review'] as string,
      appointmentStatus: f['Appointment Status'] as string,
      referredBy: safeLookupString(f['Referring Staff']),
    }
  })

  return {
    id: user.id,
    firstName,
    lastName,
    name: fullName,
    email:  ((uf['Email']        as string) ?? '').trim() || null,
    phone:  ((uf['Phone Number'] as string) ?? '').trim() || null,
    role:   (uf['Role']   as string) ?? null,
    status: (uf['Status'] as string) ?? null,
    invitedDate:         (uf['Invited Date']         as string) ?? null,
    recordCreationDate:  (uf['Record Creation Date'] as string) ?? null,
    // June 2026 flag from Excel-import placeholders.
    needsReview: (uf['Needs Review'] as boolean) ?? false,
    clerkUserId: (uf['Clerk User ID'] as string) ?? null,
    // Agency link — null for placeholder / orphaned staff records.
    agencyId,
    agencyName:   agency ? ((agency.fields['Agency Name'] as string) ?? null) : null,
    agencyStatus: agency ? ((agency.fields['Status']      as string) ?? null) : null,
    referrals,
    referralCount: referrals.length,
  }
}

export async function getAgencyUsersByAgencyId(agencyId: string) {
  const formula = encodeURIComponent(`{Agency} = "${agencyId}"`)
  const data = await airtableFetch(
    'Agency Users',
    `?filterByFormula=${formula}&sort[0][field]=Last%20Name&sort[0][direction]=asc`,
  )

  return data.records.map((r: any) => ({
    id: r.id,
    name: `${r.fields['First Name'] ?? ''} ${r.fields['Last Name'] ?? ''}`.trim(),
    firstName: (r.fields['First Name'] as string) ?? '',
    lastName: (r.fields['Last Name'] as string) ?? '',
    email: r.fields['Email'] as string,
    phone: (r.fields['Phone Number'] as string) ?? null,
    role: r.fields['Role'] as string,
    status: r.fields['Status'] as string,
    clerkUserId: (r.fields['Clerk User ID'] as string) ?? null,
    invitedDate: (r.fields['Invited Date'] as string) ?? null,
    // Surfaces June 2026 Needs Review flag so the AgencyDetail page can
    // badge users that came from name-only Excel imports (Option B).
    needsReview: (r.fields['Needs Review'] as boolean) ?? false,
    recordCreationDate: (r.fields['Record Creation Date'] as string) ?? null,
    portalInviteStatus: (r.fields['Portal Invite Status'] as string) ?? 'Not Invited',
    invitedBy:          (r.fields['Invited By'] as string) ?? null,
    claimedDate:        (r.fields['Claimed Date'] as string) ?? null,
  }))
}

// Note: Agency Users Status options changed in June 2026 — added 'Invited'
// and 'Unclaimed' (the latter was already used by importers; the type
// signature here is enforced at the API boundary).
export async function updateAgencyUserStatus(
  recordId: string,
  status: 'Unclaimed' | 'Invited' | 'Pending' | 'Active' | 'Inactive',
) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields: { Status: status } }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

/**
 * Update the portal-invite state on an Agency User row.
 *
 * Used by:
 *   - POST /api/admin/staff/[id]/invite       → mark row as invited
 *   - POST /api/admin/staff/[id]/cancel-invite → revert to unclaimed
 *   - PATCH /api/admin/staff/[id]/status with body {portalInviteStatus:'Wrong Agency'}
 *
 * Any field can be omitted. Undefined fields are left unchanged; explicit
 * null clears the field.
 */
export async function updateAgencyUserPortalInvite(
  recordId: string,
  update: {
    status?: 'Unclaimed' | 'Invited' | 'Active' | 'Inactive'
    portalInviteStatus?: 'Not Invited' | 'Invite Sent' | 'Claimed' | 'Wrong Agency'
    invitedDate?: string | null   // ISO date "YYYY-MM-DD" or null to clear
    invitedBy?: string | null      // admin's display name or null to clear
    claimedDate?: string | null    // ISO date or null to clear
    clerkUserId?: string | null    // Clerk user id or null to clear
  }
) {
  const fields: Record<string, unknown> = {}
  if (update.status !== undefined)             fields['Status']                = update.status
  if (update.portalInviteStatus !== undefined) fields['Portal Invite Status']  = update.portalInviteStatus
  if (update.invitedDate !== undefined)        fields['Invited Date']          = update.invitedDate
  if (update.invitedBy !== undefined)          fields['Invited By']            = update.invitedBy
  if (update.claimedDate !== undefined)        fields['Claimed Date']          = update.claimedDate
  if (update.clerkUserId !== undefined)        fields['Clerk User ID']         = update.clerkUserId

  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable updateAgencyUserPortalInvite failed: ${err}`)
  }

  return res.json()
}

/**
 * Update self-service fields on an Agency User's own row.
 * Used by PATCH /api/agency/me.
 */
export async function updateAgencyUserProfile(
  recordId: string,
  update: {
    firstName?: string
    lastName?: string
    phone?: string | null
  }
) {
  const fields: Record<string, unknown> = {}
  if (update.firstName !== undefined) fields['First Name']   = update.firstName
  if (update.lastName !== undefined)  fields['Last Name']    = update.lastName
  if (update.phone !== undefined)     fields['Phone Number'] = update.phone

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Agency Users')}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
