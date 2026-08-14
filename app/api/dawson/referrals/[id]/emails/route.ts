// app/api/dawson/referrals/[id]/emails/route.ts
//
// GET /api/dawson/referrals/:id/emails
//
// The outbound email history for one client, for the Email History card on the
// internal detail page.
//
// Deliberately its own endpoint rather than more fields on
// GET /api/dawson/referrals/:id: this costs two extra Airtable round trips and
// the detail page is the busiest screen in the portal. Keeping it separate lets
// the page render the referral immediately and fill the history in when it
// arrives, instead of holding everything back for it.

import { NextRequest, NextResponse } from 'next/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'
import { getEmailLogForReferral } from '@/lib/airtable/email-log'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { id } = await params
  const entries = await getEmailLogForReferral(id)
  return NextResponse.json(entries)
}
