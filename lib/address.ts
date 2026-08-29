// lib/address.ts
//
// Formatting for the one address line every agency surface prints.
//
// Airtable omits blank fields, and plenty of imported agencies have no City
// (75 of 129 unclaimed ones). Interpolating the parts directly —
// `{city}, {state} {zip}` — printed a stray leading comma (", NJ 07090") on
// each of those rows. Joining only the parts that exist is the whole job;
// this lives in one place so the six surfaces that print it cannot disagree.

/** "Springfield, NJ 07081" from whichever parts are present. '' if none are. */
export function cityStateZip(
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string {
  const locality = [city, state].filter(Boolean).join(', ')
  return [locality, zip].filter(Boolean).join(' ')
}

/**
 * One line — "12 Main St, Apt 2, Newark, NJ 07101" — from whichever client
 * address parts are present. '' when none are. Shared by the Active and
 * History referral lists, which print the address under the client name.
 */
export function clientAddressLine(parts: {
  address: string | null | undefined
  address2: string | null | undefined
  city: string | null | undefined
  state: string | null | undefined
  zip: string | null | undefined
}): string {
  const stateZip = [parts.state, parts.zip].filter(Boolean).join(' ')
  return [parts.address, parts.address2, parts.city, stateZip]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}
