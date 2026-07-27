// lib/auth/dawson-access.ts
//
// Centralized allowlist for the Dawson Portal (Furniture Assist back-office UI
// and its supporting /api/dawson/* routes).
//
// To grant access to a new user: add their Clerk user ID here and redeploy.
// To revoke access: remove the ID and redeploy.
//
// This single file is the source of truth — both server routes and the
// Dawson layout/sidebar import from here, so the UI shell and the API
// gate can never drift out of sync.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export const DAWSON_PORTAL_USER_IDS = [
  'user_3BmTnGTVcPCuCJTpP8uKrQm4KXj', // Ben
  'user_3BodwTW4I7Vamt4t7wD3qeA7boM', // Ray
  'user_3BtKn01OMXSmi7eSsWvzvnEroCg', // Dawson
  'user_3H6FGzH6riZZ3W4JCFe5UXBAEc1', // Chase
] as const

export type DawsonUserId = typeof DAWSON_PORTAL_USER_IDS[number]

/**
 * Synchronous membership check. Useful in server components that already
 * have a userId from Clerk's `auth()` and just need a boolean.
 */
export function isDawsonPortalUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return (DAWSON_PORTAL_USER_IDS as readonly string[]).includes(userId)
}

/**
 * Route-handler auth guard. Call at the top of any /api/dawson/* handler.
 *
 * Returns:
 *   - `null` if the request is authorized (handler should continue)
 *   - a 403 `NextResponse` if not (handler should `return` it immediately)
 *
 * Usage:
 *   export async function PATCH(req, { params }) {
 *     const denied = await requireDawsonAccess()
 *     if (denied) return denied
 *     // ...handler logic...
 *   }
 *
 * The `status` option lets admin-only endpoints return 401 instead of 403
 * if they want to preserve their original status code; default is 403 to
 * match the pattern used across the rest of /api/dawson/*.
 */
export async function requireDawsonAccess(
  options: { status?: 401 | 403 } = {}
): Promise<NextResponse | null> {
  const { userId } = await auth()
  if (!isDawsonPortalUser(userId)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: options.status ?? 403 }
    )
  }
  return null
}
