// lib/airtable/clients.ts
//
// Writes against the Clients table. Client Referrals reads these fields as
// lookups through the Client link, so identity edits land here only.

import { BASE_ID, HEADERS } from './client'

// Update fields on a Clients record. First Name / Last Name / DOB /
// Address / Phone / etc. live here — Client Referrals reads them as
// lookups through the Client link, so this is the only place identity
// edits from the Client Detail page should land.
export async function updateClient(
  clientId: string,
  fields: Record<string, unknown>,
) {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Clients')}/${clientId}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ fields }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
