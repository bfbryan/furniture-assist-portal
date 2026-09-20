// lib/auth/donor-checkin-access.ts
//
// Gate for the donor check-in surfaces — the phone kiosk page and the
// Chromebook desk page (app/(donor)/checkin, app/(donor)/desk — one
// shared layout, app/(donor)/layout.tsx, calls isDonorCheckinDevice
// directly rather than each page calling requireDonorCheckinAccess
// separately, now that both use the identical device-session model) and
// their API routes, which still call requireDonorCheckinAccess
// individually below — a layout only ever gates pages, never API routes.
// Device-authenticated, not user-authenticated: one
// Clerk sign-in token gets redeemed once per physical device (however many
// phones, plus the Chromebook — Clerk supports multiple concurrent
// sessions under one user, so all of them can share a single "device"
// identity rather than needing one Clerk user each), and the device stays
// signed in indefinitely from there — no per-volunteer login on either
// surface, confirmed: any volunteer operates both.
//
// Deliberately DIFFERENT from lib/auth/dawson-access.ts's own model. That
// file hardcodes real people's Clerk user ids and treats "add an id,
// redeploy" as the only revocation path — a deliberate choice for a small,
// rarely-changing, source-controlled ACL of actual staff. There is no real
// id to hardcode here yet: the device identity doesn't exist until Ben
// creates it and redeems a token on the hardware, which hasn't happened as
// of this branch. Reading the allowed id(s) from an env var instead means
// provisioning or rotating a device is a Vercel env change, not a code
// deploy — a better fit for what's fundamentally an operational value, not
// a small fixed roster of named staff.
//
// DONOR_CHECKIN_DEVICE_USER_IDS does not exist in .env.local yet. Until
// Ben adds it (comma-separated Clerk user ids, one per redeemed device
// session — or all devices sharing one id, per the note above), this env
// var reads empty and the guard denies everyone. That's the correct
// default: fail closed, not silently open, while the device identity is
// still unprovisioned.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const DONOR_CHECKIN_DEVICE_USER_IDS = (process.env.DONOR_CHECKIN_DEVICE_USER_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export function isDonorCheckinDevice(userId: string | null | undefined): boolean {
  if (!userId) return false
  return DONOR_CHECKIN_DEVICE_USER_IDS.includes(userId)
}

/**
 * Route-handler auth guard, same shape as requireDawsonAccess. Call at the
 * top of any donor-checkin API route.
 */
export async function requireDonorCheckinAccess(
  options: { status?: 401 | 403 } = {}
): Promise<NextResponse | null> {
  const { userId } = await auth()
  if (!isDonorCheckinDevice(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: options.status ?? 403 })
  }
  return null
}
