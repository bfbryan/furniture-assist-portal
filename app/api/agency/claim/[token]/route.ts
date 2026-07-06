/**
 * app/api/agency/claim/[token]/route.ts
 *
 * Public token-scoped API for the agency claim landing page.
 * NO Clerk middleware — token = capability.
 *
 * GET  → look up Agency User by Claim Token → return user + agency + existing submission (if any)
 * POST → upsert Agency Profile Submissions row for this user (one row per user)
 *        + patch First Name / Last Name / Phone Number on the Agency User
 *        + set Claim Token Used At (once)
 *
 * Token stays valid after submit (per Ben's design choice). Latest submission wins.
 * Lookup uses the hidden 'Submitted by User ID' text field (mirrors userRec.id)
 * because filterByFormula against linked-record fields matches the linked table's
 * primary field, not the record ID — unreliable if two users share a name.
 * Expiry: 7 days from Claim Token Sent At (enforced server-side here).
 *
 * REQUIRED AIRTABLE FIELDS (exact names):
 *   Agency Users:
 *     Claim Token, Claim Token Sent At, Claim Token Used At,
 *     First Name, Last Name, Phone Number, Email, Agency (link)
 *   Agencies:
 *     Agency Name, Office Name, Address, Address 2, City, State, Zip,
 *     Main Phone Number, Website, EIN#
 *   Agency Profile Submissions:
 *     Submitted By User (link), Agency (link),
 *     User First Name, User Last Name, User Phone,
 *     Agency Name Choice, Proposed Agency Name, Proposed Duplicate Of,
 *     Proposed Office Name, Proposed Street, Proposed Street 2, Proposed City,
 *     Proposed State, Proposed Zip, Proposed Main Phone, Proposed Website, Proposed EIN,
 *     Admin Choice, Nominated Admin Name, Nominated Admin Email, Nominated Admin Role,
 *     Additional Notes
 */

import { NextResponse } from 'next/server'

// -------------------------------------------------------------------------
// Config
// -------------------------------------------------------------------------

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`

const TABLE_USERS = 'Agency Users'
const TABLE_AGENCIES = 'Agencies'
const TABLE_SUBMISSIONS = 'Agency Profile Submissions'

const TOKEN_EXPIRY_DAYS = 7

// -------------------------------------------------------------------------
// Airtable helpers (local — public route, don't share Clerk-authed helpers)
// -------------------------------------------------------------------------

function assertEnv() {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable credentials not configured on server.')
  }
}

async function atFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${AIRTABLE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    // Never cache — token lookups + writes must always be fresh
    cache: 'no-store',
  })
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`Airtable ${res.status}: ${bodyText.slice(0, 500)}`)
  }
  return res.json()
}

function encodeFormula(formula: string) {
  return encodeURIComponent(formula)
}

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

type Params = { params: Promise<{ token: string }> }

// -------------------------------------------------------------------------
// GET — look up token
// -------------------------------------------------------------------------

export async function GET(_req: Request, { params }: Params) {
  try {
    assertEnv()
    const { token } = await params

    if (!token || token.length < 32) {
      return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
    }

    // 1. Find the Agency User by Claim Token
    const userFormula = `{Claim Token} = "${token.replace(/"/g, '\\"')}"`
    const userRes = await atFetch(
      `/${encodeURIComponent(TABLE_USERS)}?filterByFormula=${encodeFormula(userFormula)}&maxRecords=1`
    )
    const userRec = userRes.records?.[0]
    if (!userRec) {
      return NextResponse.json(
        { error: 'This link is not valid. It may have already been used or been revoked.' },
        { status: 404 }
      )
    }

    // 2. Expiry check (7 days from Claim Token Sent At)
    const sentAt = userRec.fields['Claim Token Sent At']
    if (sentAt) {
      const sent = new Date(sentAt)
      const expires = new Date(sent.getTime() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      if (Date.now() > expires.getTime()) {
        return NextResponse.json(
          { error: 'This link has expired. Please reply to the email that sent it and we’ll issue a new one.' },
          { status: 410 }
        )
      }
    }

    // 3. Load linked Agency
    const agencyLink = userRec.fields['Agency']
    const agencyId = Array.isArray(agencyLink) ? agencyLink[0] : null
    if (!agencyId) {
      return NextResponse.json(
        { error: 'Your record isn’t linked to an agency yet. Please contact Furniture Assist.' },
        { status: 409 }
      )
    }
    const agencyRes = await atFetch(
      `/${encodeURIComponent(TABLE_AGENCIES)}/${encodeURIComponent(agencyId)}`
    )
    const agencyFields = agencyRes.fields || {}

    // 4. Existing submission (if this user has already submitted, seed the form)
    const subFormula = `{Submitted by User ID} = "${userRec.id}"`
    const subRes = await atFetch(
      `/${encodeURIComponent(TABLE_SUBMISSIONS)}?filterByFormula=${encodeFormula(
        subFormula
      )}&sort%5B0%5D%5Bfield%5D=Submitted%20At&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`
    )
    const subRec = subRes.records?.[0]

    return NextResponse.json({
      user: {
        id: userRec.id,
        firstName: userRec.fields['First Name'] || '',
        lastName: userRec.fields['Last Name'] || '',
        email: userRec.fields['Email'] || '',
        phone: userRec.fields['Phone Number'] || '',
      },
      agency: {
        id: agencyId,
        name: agencyFields['Agency Name'] || '',
        officeName: agencyFields['Office Name'] || null,
        street: agencyFields['Address'] || null,
        street2: agencyFields['Address 2'] || null,
        city: agencyFields['City'] || null,
        state: agencyFields['State'] || null,
        zip: agencyFields['Zip'] || null,
        mainPhone: agencyFields['Main Phone Number'] || null,
        website: agencyFields['Website'] || null,
        ein: agencyFields['EIN#'] || null,
      },
      existingSubmission: subRec
        ? {
            userFirstName: subRec.fields['User First Name'] || '',
            userLastName: subRec.fields['User Last Name'] || '',
            userPhone: subRec.fields['User Phone'] || '',
            agencyNameChoice: subRec.fields['Agency Name Choice'] || '',
            proposedAgencyName: subRec.fields['Proposed Agency Name'] || '',
            proposedDuplicateOf: subRec.fields['Proposed Duplicate Of'] || '',
            proposedOfficeName: subRec.fields['Proposed Office Name'] || '',
            proposedStreet: subRec.fields['Proposed Street'] || '',
            proposedStreet2: subRec.fields['Proposed Street 2'] || '',
            proposedCity: subRec.fields['Proposed City'] || '',
            proposedState: subRec.fields['Proposed State'] || '',
            proposedZip: subRec.fields['Proposed Zip'] || '',
            proposedMainPhone: subRec.fields['Proposed Main Phone'] || '',
            proposedWebsite: subRec.fields['Proposed Website'] || '',
            proposedEIN: subRec.fields['Proposed EIN'] || '',
            adminChoice: subRec.fields['Admin Choice'] || '',
            nominatedAdminName: subRec.fields['Nominated Admin Name'] || '',
            nominatedAdminEmail: subRec.fields['Nominated Admin Email'] || '',
            nominatedAdminRole: subRec.fields['Nominated Admin Role'] || '',
            additionalNotes: subRec.fields['Additional Notes'] || '',
          }
        : null,
    })
  } catch (err: any) {
    console.error('[claim GET] error:', err)
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 })
  }
}

// -------------------------------------------------------------------------
// POST — save submission + patch user
// -------------------------------------------------------------------------

type PostBody = {
  userFirstName: string
  userLastName: string
  userPhone: string
  agencyNameChoice: string
  proposedAgencyName: string
  proposedDuplicateOf: string
  proposedOfficeName: string
  proposedStreet: string
  proposedStreet2: string
  proposedCity: string
  proposedState: string
  proposedZip: string
  proposedMainPhone: string
  proposedWebsite: string
  proposedEIN: string
  adminChoice: string
  nominatedAdminName: string
  nominatedAdminEmail: string
  nominatedAdminRole: string
  additionalNotes: string
}

const ALLOWED_NAME_CHOICES = new Set([
  'Correct as-is',
  'Propose new name',
  'Duplicate of another agency',
])
const ALLOWED_ADMIN_CHOICES = new Set([
  'I am the admin',
  'Someone else at my agency',
  'Not sure yet',
])

export async function POST(req: Request, { params }: Params) {
  try {
    assertEnv()
    const { token } = await params

    if (!token || token.length < 32) {
      return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
    }

    const body = (await req.json()) as PostBody

    // Validate select values (defense in depth — client already checked)
    if (!ALLOWED_NAME_CHOICES.has(body.agencyNameChoice)) {
      return NextResponse.json({ error: 'Invalid Agency Name Choice.' }, { status: 400 })
    }
    if (!ALLOWED_ADMIN_CHOICES.has(body.adminChoice)) {
      return NextResponse.json({ error: 'Invalid Admin Choice.' }, { status: 400 })
    }
    if (!body.userFirstName?.trim() || !body.userLastName?.trim()) {
      return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 })
    }

    // 1. Re-find the user by token (defensive — never trust caller-supplied IDs)
    const userFormula = `{Claim Token} = "${token.replace(/"/g, '\\"')}"`
    const userRes = await atFetch(
      `/${encodeURIComponent(TABLE_USERS)}?filterByFormula=${encodeFormula(userFormula)}&maxRecords=1`
    )
    const userRec = userRes.records?.[0]
    if (!userRec) {
      return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    }

    // 2. Expiry check
    const sentAt = userRec.fields['Claim Token Sent At']
    if (sentAt) {
      const sent = new Date(sentAt)
      const expires = new Date(sent.getTime() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      if (Date.now() > expires.getTime()) {
        return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
      }
    }

    const agencyLink = userRec.fields['Agency']
    const agencyId = Array.isArray(agencyLink) ? agencyLink[0] : null
    if (!agencyId) {
      return NextResponse.json(
        { error: 'Your record isn’t linked to an agency.' },
        { status: 409 }
      )
    }

    // 3. Upsert Agency Profile Submissions row using the hidden ID field.
    const subFormula = `{Submitted by User ID} = "${userRec.id}"`
    const subRes = await atFetch(
      `/${encodeURIComponent(TABLE_SUBMISSIONS)}?filterByFormula=${encodeFormula(
        subFormula
      )}&maxRecords=1`
    )
    const existing = subRes.records?.[0]

    const submissionFields: Record<string, unknown> = {
      'Submitted By User': [userRec.id],
      'Submitted by User ID': userRec.id,
      Agency: [agencyId],
      'User First Name': body.userFirstName.trim(),
      'User Last Name': body.userLastName.trim(),
      'User Phone': body.userPhone?.trim() || '',
      'Agency Name Choice': body.agencyNameChoice,
      'Proposed Agency Name': body.proposedAgencyName?.trim() || '',
      'Proposed Duplicate Of': body.proposedDuplicateOf?.trim() || '',
      'Proposed Office Name': body.proposedOfficeName?.trim() || '',
      'Proposed Street': body.proposedStreet?.trim() || '',
      'Proposed Street 2': body.proposedStreet2?.trim() || '',
      'Proposed City': body.proposedCity?.trim() || '',
      'Proposed State': body.proposedState?.trim() || '',
      'Proposed Zip': body.proposedZip?.trim() || '',
      'Proposed Main Phone': body.proposedMainPhone?.trim() || '',
      'Proposed Website': body.proposedWebsite?.trim() || '',
      'Proposed EIN': body.proposedEIN?.trim() || '',
      'Admin Choice': body.adminChoice,
      'Nominated Admin Name': body.nominatedAdminName?.trim() || '',
      'Nominated Admin Email': body.nominatedAdminEmail?.trim() || '',
      'Nominated Admin Role': body.nominatedAdminRole?.trim() || '',
      'Additional Notes': body.additionalNotes?.trim() || '',
    }

    if (existing) {
      await atFetch(`/${encodeURIComponent(TABLE_SUBMISSIONS)}/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: submissionFields }),
      })
    } else {
      await atFetch(`/${encodeURIComponent(TABLE_SUBMISSIONS)}`, {
        method: 'POST',
        body: JSON.stringify({ fields: submissionFields }),
      })
    }

    // 4. Patch Agency User with confirmed name/phone + Claim Token Used At (once)
    const userPatch: Record<string, unknown> = {
      'First Name': body.userFirstName.trim(),
      'Last Name': body.userLastName.trim(),
      'Phone Number': body.userPhone?.trim() || '',
    }
    if (!userRec.fields['Claim Token Used At']) {
      userPatch['Claim Token Used At'] = new Date().toISOString()
    }
    await atFetch(`/${encodeURIComponent(TABLE_USERS)}/${userRec.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: userPatch }),
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[claim POST] error:', err)
    return NextResponse.json(
      { error: 'Sorry, something went wrong saving your submission. Please try again.' },
      { status: 500 }
    )
  }
}
