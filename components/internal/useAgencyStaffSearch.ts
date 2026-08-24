'use client'

// components/internal/useAgencyStaffSearch.ts
//
// Lets the search box on the four Dawson agency list pages find a PERSON, not
// only an organisation. Dawson often has a caseworker's name and not the name
// of the department they sit in, and until now typing that name emptied the
// list.
//
// Typing a person's name keeps their AGENCY on screen, because these pages list
// agencies and a row here is an agency. So that a row does not appear for no
// visible reason, each page also shows the name(s) that matched underneath the
// agency, and only in the case where the agency itself did not match the query
// - see `staffHint` on each page. Type "hudson" and nothing extra appears; type
// "Ruth Benitez" and the agency appears with her name under it.
//
// Data comes from /api/dawson/agencies/staff-index in one request per page
// load, and matching is done here in the browser with the same matchesSearch
// helper the rest of the boxes use, so behaviour is identical: case-insensitive
// substring, empty query matches nothing here (the pages handle "show
// everything" themselves), missing fields never match.
//
// Deliberately NOT cached across mounts. A cache is how the Add Referral staff
// search came to hide agencies that had just been created; this list is cheap
// enough that a fresh read per page load is the simpler correct answer.

import { useCallback, useEffect, useState } from 'react'
import { matchesSearch } from '@/lib/search'

type StaffEntry = { id: string; name: string; email: string; agencyId: string }

/**
 * Returns `staffMatches(agencyId, query)` - the display names of that agency's
 * people matching the query, or an empty array (also while the index is still
 * loading, and if the request failed).
 */
export function useAgencyStaffSearch() {
  const [byAgency, setByAgency] = useState<Map<string, StaffEntry[]>>(() => new Map())

  useEffect(() => {
    let cancelled = false

    fetch('/api/dawson/agencies/staff-index')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: StaffEntry[]) => {
        if (cancelled || !Array.isArray(rows)) return
        const map = new Map<string, StaffEntry[]>()
        for (const s of rows) {
          const list = map.get(s.agencyId)
          if (list) list.push(s)
          else map.set(s.agencyId, [s])
        }
        setByAgency(map)
      })
      .catch(() => {
        // Leaves the map empty: the pages keep matching on the agency's own
        // fields exactly as they did before.
      })

    return () => { cancelled = true }
  }, [])

  return useCallback(
    (agencyId: string, query: string): string[] => {
      if (!query.trim()) return []
      const list = byAgency.get(agencyId)
      if (!list) return []
      return list
        .filter(s => matchesSearch(query, s.name, s.email))
        .map(s => s.name || s.email)
        .filter(Boolean)
    },
    [byAgency],
  )
}

/** How many matched names a hint prints before it says "and N more". */
export const STAFF_HINT_LIMIT = 3

/** "Ruth Benitez", or "Ruth Benitez, Susan Valez and 4 more". */
export function formatStaffHint(names: string[]): string {
  if (names.length === 0) return ''
  const shown = names.slice(0, STAFF_HINT_LIMIT)
  const rest = names.length - shown.length
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
}
