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
