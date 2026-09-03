'use client'

// components/internal/useListUrlState.ts
//
// URL-backed state for Dawson's list pages. The merged Referrals page is the
// first caller; Agencies and the Needs Action page are expected to follow.
//
// Every filter a list page carries — search text, date range, status pill,
// which groups are expanded — lives in the query string. Clicking into a
// record and pressing Back then restores the list exactly: same filters, same
// open sections. That round trip is the OCR reconciliation workflow — open a
// Saturday, click each client to check the scan read, Back, next — fifty times
// a sitting, and it is unusable if Back drops you at the top of an unfiltered
// list.
//
// Contract:
//   • You pass the full set of keys and their DEFAULT string values, as a
//     STABLE object — a module-level constant or a useMemo. It is a hook
//     dependency; a fresh object literal every render would rebuild the setter
//     every render.
//   • A key sitting at its default is omitted from the URL, so the resting
//     state of the page is a clean path with no query string.
//   • Every write is router.replace, never push: changing a filter must not
//     stack a history entry, or Back would walk back through filter states
//     instead of leaving the page.
//   • Values are strings. A caller that needs a list (the set of expanded
//     group keys) joins and splits it itself. Keeping this layer to strings is
//     what lets three pages that filter on different things share it.
//
// A caller using useSearchParams under the hood (this hook does) must sit
// inside a <Suspense> boundary — see the page that uses it.

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useListUrlState<K extends string>(
  defaults: Record<K, string>,
): readonly [Record<K, string>, (patch: Partial<Record<K, string>>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  const values = useMemo(() => {
    const params = new URLSearchParams(search)
    const out = {} as Record<K, string>
    for (const key of Object.keys(defaults) as K[]) {
      const raw = params.get(key)
      out[key] = raw === null || raw === '' ? defaults[key] : raw
    }
    return out
  }, [search, defaults])

  const setValues = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const params = new URLSearchParams(search)
      for (const key of Object.keys(patch) as K[]) {
        const next = patch[key]
        if (next === undefined || next === '' || next === defaults[key]) params.delete(key)
        else params.set(key, next)
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [search, pathname, router, defaults],
  )

  return [values, setValues] as const
}
