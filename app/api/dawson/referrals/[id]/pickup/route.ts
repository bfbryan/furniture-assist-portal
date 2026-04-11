// app/api/dawson/referrals/[id]/pickup/route.ts
// Accepts OCR scan data — updates appointment status and item quantities in AT
// Called by OCR tool after scanning client pickup sheet QR code

import { NextRequest, NextResponse } from 'next/server'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const API_KEY = process.env.AIRTABLE_API_KEY!

// Valid AT field names for pickup quantities
const VALID_QUANTITY_FIELDS = new Set([
  'LR Bookcase/Storage', 'LR Chair', 'LR Coffee Table', 'LR Couch/Loveseat/Futon',
  'LR End Table/TV Stand', 'LR Lamp', 'LR Picture/Other Decor', 'LR Rug',
  'LR Student Desk', 'LR TV/Electronics',
  'BR Bedframe', 'BR Dresser', 'BR Mattress/Boxspring', 'BR Nightstand',
  'DR Chair', 'DR Dining Table',
  'KH Bathroom', 'KH Cookbook', 'KH Dishes', 'KH General Household',
  'KH Home Office', 'KH Linen', 'KH Pots/Pans/Utensils', 'KH Small Appliance',
  'CL Clothes', 'CL Shoes',
  'BK Baby Clothes', 'BK Crib/Bassinet', 'BK General Baby', 'BK Toys/Books/School',
])

const VALID_STATUSES = ['Completed', 'No Show', 'Cancelled', 'Scheduled', 'Pending Schedule']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // No user auth here — this endpoint is called by OCR tool with API key
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.OCR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const { appointmentStatus, quantities } = body

  const fields: Record<string, unknown> = {}

  // Update appointment status if provided
  if (appointmentStatus) {
    if (!VALID_STATUSES.includes(appointmentStatus)) {
      return NextResponse.json({ error: `Invalid status: ${appointmentStatus}` }, { status: 400 })
    }
    fields['Appointment Status'] = appointmentStatus
  }

  // Update quantity fields if provided
  if (quantities && typeof quantities === 'object') {
    for (const [field, value] of Object.entries(quantities)) {
      if (!VALID_QUANTITY_FIELDS.has(field)) {
        return NextResponse.json({ error: `Invalid field: ${field}` }, { status: 400 })
      }
      if (typeof value !== 'number' || value < 0) {
        return NextResponse.json({ error: `Invalid value for ${field}: must be a non-negative number` }, { status: 400 })
      }
      fields[field] = value
    }
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Client Referrals')}/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: Object.keys(fields) })
}
