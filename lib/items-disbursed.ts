// lib/items-disbursed.ts
//
// Single source of truth for the Items Disbursed catalog.
//
// These 30 labels map 1:1 to Number fields on the Client Referrals table in
// Airtable. Before this file existed the list was hardcoded twice — once in
// getReferralById() to read, and it would have needed a third copy to write.
// Everything now derives from CATALOG:
//
//   • lib/airtable.ts  getReferralById()  — builds the read shape
//   • app/api/dawson/referrals/[id]/route.ts — allowlists PATCH field names
//   • app/dawson/referrals/[id]/page.tsx — renders display + edit steppers
//
// Adding an item to the pickup sheet = add one Number field in Airtable and
// one line here. Nothing else changes.

export type DisbursedItem = {
  /** Display label shown in the portal. */
  label: string
  /** Exact Airtable field name on Client Referrals. Never change casually. */
  field: string
}

export type DisbursedGroup = {
  /** Stable key — matches the JSON shape returned by getReferralById(). */
  key: 'livingRoom' | 'bedroom' | 'diningRoom' | 'kitchen' | 'linens' | 'misc'
  /** Section heading in the UI. */
  title: string
  items: DisbursedItem[]
}

// NOTE ON KEY NAMES: `linens` actually holds Clothes & Shoes and `misc` holds
// Baby / Kids. Those keys are legacy — they predate the July 2026 pickup-sheet
// redesign and are baked into the API response shape. Renaming them is a
// breaking change for any other consumer, so the misleading keys stay and the
// human-facing `title` carries the truth.
export const CATALOG: DisbursedGroup[] = [
  {
    key: 'livingRoom',
    title: 'Living Room',
    items: [
      { label: 'Bookcase / Storage',        field: 'LR Bookcase/Storage' },
      { label: 'Chair',                     field: 'LR Chair' },
      { label: 'Coffee Table',              field: 'LR Coffee Table' },
      { label: 'Couch / Loveseat / Futon',  field: 'LR Couch/Loveseat/Futon' },
      { label: 'End Table / TV Stand',      field: 'LR End Table/TV Stand' },
      { label: 'Lamp',                      field: 'LR Lamp' },
      { label: 'Picture / Decor',           field: 'LR Picture/Other Decor' },
      { label: 'Rug',                       field: 'LR Rug' },
      { label: 'Student Desk',              field: 'LR Student Desk' },
      { label: 'TV / Electronics',          field: 'LR TV/Electronics' },
    ],
  },
  {
    key: 'bedroom',
    title: 'Bedroom',
    items: [
      { label: 'Bedframe',                  field: 'BR Bedframe' },
      { label: 'Dresser',                   field: 'BR Dresser' },
      { label: 'Mattress / Boxspring',      field: 'BR Mattress/Boxspring' },
      { label: 'Nightstand',                field: 'BR Nightstand' },
    ],
  },
  {
    key: 'diningRoom',
    title: 'Dining Room',
    items: [
      { label: 'Dining Table',              field: 'DR Dining Table' },
      { label: 'Chair',                     field: 'DR Chair' },
    ],
  },
  {
    key: 'kitchen',
    title: 'Kitchen / Household',
    items: [
      { label: 'Dishes',                    field: 'KH Dishes' },
      { label: 'Pots / Pans / Utensils',    field: 'KH Pots/Pans/Utensils' },
      { label: 'Small Appliance',           field: 'KH Small Appliance' },
      { label: 'Linen',                     field: 'KH Linen' },
      { label: 'Bathroom',                  field: 'KH Bathroom' },
      { label: 'General Household',         field: 'KH General Household' },
      { label: 'Home Office',               field: 'KH Home Office' },
      { label: 'Cookbook',                  field: 'KH Cookbook' },
    ],
  },
  {
    key: 'linens',
    title: 'Clothes & Shoes',
    items: [
      { label: 'Clothes',                   field: 'CL Clothes' },
      { label: 'Shoes',                     field: 'CL Shoes' },
    ],
  },
  {
    key: 'misc',
    title: 'Baby / Kids',
    items: [
      { label: 'Crib / Bassinet',           field: 'BK Crib/Bassinet' },
      { label: 'Baby Clothes',              field: 'BK Baby Clothes' },
      { label: 'General Baby',              field: 'BK General Baby' },
      { label: 'Toys / Books / School',     field: 'BK Toys/Books/School' },
    ],
  },
]

/** The four free-text companions that live alongside the quantities. */
export const DISBURSED_TEXT_FIELDS = {
  checkInTime:       'Check-in Time',
  checkoutTime:      'Check-out Time',
  otherItems:        'Other Items',
  distributionNotes: 'Distribution Notes',
} as const

export type DisbursedTextKey = keyof typeof DISBURSED_TEXT_FIELDS

/** label -> Airtable field, for turning an edited row back into a PATCH. */
export const FIELD_BY_LABEL: Record<string, string> = Object.fromEntries(
  CATALOG.flatMap(g => g.items.map(i => [`${g.key}::${i.label}`, i.field])),
)

/** Every writable quantity field name. Used as the PATCH allowlist. */
export const QUANTITY_FIELDS: ReadonlySet<string> = new Set(
  CATALOG.flatMap(g => g.items.map(i => i.field)),
)
