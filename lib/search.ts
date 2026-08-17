// lib/search.ts
//
// The one way search boxes match records in this app.
//
// Exists because of a live crash: filter chains like
//   a.name.toLowerCase().includes(q) || a.city.toLowerCase().includes(q)
// worked on page load (empty query short-circuits at the first test) and
// then threw the moment someone typed, because Airtable omits empty fields
// entirely and most of these values are cast `as string` on the way in.
// 75 of 129 unclaimed agencies have no City; typing anything that missed
// the name test evaluated `undefined.toLowerCase()`.
//
// Rules this helper encodes:
//   - An empty (or whitespace) query matches every record.
//   - A missing/empty field NEVER matches a non-empty query. A record with
//     no city does not match a city search — it is not defaulted to some
//     string that could.
//   - Matching is case-insensitive substring, same as every box did before.

export function matchesSearch(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return values.some(v => !!v && v.toLowerCase().includes(q))
}
