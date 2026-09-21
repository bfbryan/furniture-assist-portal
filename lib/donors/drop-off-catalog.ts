// lib/donors/drop-off-catalog.ts
//
// Single source for the drop-off form's 30 items: payload key -> Airtable
// field name on In Kind Donations -> per-item cap. The payload keys
// (`qty_couch`, `qty_chair`, ...) are NOT invented here — they're the
// existing pickup form's own field names, reused deliberately so the new
// drop-off form's markup and this route speak the same vocabulary the
// pickup form already does. Everything downstream (the route, any page
// posting to it) references an item by its `key`, never by the Airtable
// `field` string directly — that's what makes the two renames already
// scheduled at switchover ("Coffee Table/TV Stand" -> "Coffee Table",
// "End Table" -> "End Table/TV Stand") a two-line edit in THIS file and
// nothing else. Grep the repo for either string outside this file before
// changing it; if anything else matches, something imported the wrong
// thing.
//
// This is NOT lib/catalog/items-disbursed.ts. That file is the Client
// Referrals disbursement catalog — a different table, a different base
// (the agency/referral base, not AIRTABLE_DONOR_BASE_ID), prefixed field
// names ("LR Couch/Loveseat/Futon"), and alphabetical ordering. The item
// *names* happen to overlap (both are "what furniture exists"), the
// *fields*, *keys* and *order* do not.
//
// Group order matches the real pickup form's own category order (Living
// Room, Kitchen/Linen, Bedroom, Baby/Kids, Dining, Clothes) — not
// alphabetical, not the Airtable field-creation order. Keeping it means
// a diff against the real form stays legible.
//
// Caps are hard — the route rejects a submission over the cap as plain
// validation, the same as any other bad field (see
// app/api/donations/drop-off/route.ts). These numbers match the pickup
// form's own caps, given directly, not measured.

export type DropOffItem = {
  /** Payload key — the pickup form's own field name, e.g. "qty_couch".
   *  Referenced by the route and any page posting to it; never the
   *  Airtable field name directly. */
  key: string
  /** Display label, as the form shows it (unit hints like "# of boxes"
   *  included verbatim where the form uses them). */
  label: string
  /** Exact Airtable field name on In Kind Donations, TODAY. The two
   *  fields flagged above are the only ones expected to change. */
  field: string
  /** Advisory cap — see the file header. */
  cap: number
}

export type DropOffGroup = {
  key: string
  title: string
  items: DropOffItem[]
}

export const DROP_OFF_CATALOG: DropOffGroup[] = [
  {
    key: 'livingRoom',
    title: 'Living Room Furniture',
    items: [
      { key: 'qty_couch',        label: 'Couch / Loveseat / Futon', field: 'Couch/Loveseat', cap: 3 },
      { key: 'qty_chair',        label: 'Chair',                    field: 'Living Room Chair', cap: 6 },
      // SCHEDULED RENAME at switchover: field becomes "Coffee Table".
      { key: 'qty_coffee_table', label: 'Coffee Table',             field: 'Coffee Table/TV Stand', cap: 2 },
      // SCHEDULED RENAME at switchover: field becomes "End Table/TV Stand".
      { key: 'qty_end_table',    label: 'End Table / TV Stand',     field: 'End Table', cap: 4 },
      { key: 'qty_bookcase',     label: 'Bookcase / Storage',       field: 'Bookcase/Storage', cap: 3 },
      { key: 'qty_desk',         label: 'Student Desk',             field: 'Student Desk', cap: 2 },
      { key: 'qty_lamp',         label: 'Lamp',                     field: 'Lamp', cap: 5 },
      { key: 'qty_decor',        label: 'Picture / Other Decor',    field: 'Picture/Other Decor', cap: 5 },
      { key: 'qty_rug',          label: 'Rug',                      field: 'Rug', cap: 3 },
      { key: 'qty_tv',           label: 'TV / Electronics',         field: 'TV/Electronics', cap: 3 },
    ],
  },
  {
    key: 'kitchenLinen',
    title: 'Kitchen / Linen',
    items: [
      { key: 'qty_appliance',            label: 'Small Appliance',                 field: 'Small Kitchen Appliance', cap: 5 },
      { key: 'qty_dishes',               label: 'Dishes (# of boxes)',             field: 'Dishes', cap: 5 },
      { key: 'qty_cookbooks',            label: 'Cookbook (# of boxes)',           field: 'Cookbooks', cap: 3 },
      { key: 'qty_linen',                label: 'Linen (# of bags)',               field: 'Linen', cap: 5 },
      { key: 'qty_pots',                 label: 'Pots / Pans / Utensils (# of boxes)', field: 'Pots/Pans/Utensils', cap: 4 },
      { key: 'qty_general_household',    label: 'General Household',              field: 'General Household', cap: 5 },
      { key: 'qty_bathroom',             label: 'Bathroom',                       field: 'Bathroom', cap: 3 },
      { key: 'qty_home_office',          label: 'Home Office',                    field: 'Home Office', cap: 3 },
    ],
  },
  {
    key: 'bedroom',
    title: 'Bedroom Furniture',
    items: [
      { key: 'qty_mattress',   label: 'Mattress / Boxspring', field: 'Mattress/Boxspring', cap: 3 },
      { key: 'qty_bedframe',   label: 'Bedframe',             field: 'Bedframe', cap: 3 },
      { key: 'qty_dresser',    label: 'Dresser',              field: 'Dresser', cap: 3 },
      { key: 'qty_nightstand', label: 'Nightstand',           field: 'Nightstand', cap: 4 },
    ],
  },
  {
    key: 'babyKids',
    title: 'Baby / Kids',
    items: [
      { key: 'qty_crib',         label: 'Crib / Bassinet',              field: 'Crib/Bassinet', cap: 2 },
      { key: 'qty_toys',         label: 'Toys / Books / School (# of boxes)', field: 'Toys/Books/School', cap: 5 },
      { key: 'qty_general_baby', label: 'General Baby',                 field: 'General Baby', cap: 3 },
      { key: 'qty_baby_clothes', label: 'Baby Clothes (# of bags)',     field: 'Baby Clothes', cap: 5 },
    ],
  },
  {
    key: 'diningRoom',
    title: 'Dining Room Furniture',
    items: [
      { key: 'qty_dining_table', label: 'Dining Table', field: 'Dining Table', cap: 1 },
      { key: 'qty_dining_chair', label: 'Chair',         field: 'Dining Chair', cap: 8 },
    ],
  },
  {
    key: 'clothes',
    title: 'Clothes',
    items: [
      { key: 'qty_clothes', label: 'Clothes (# of bags)', field: 'Adult Clothes', cap: 10 },
      { key: 'qty_shoes',   label: 'Shoes (# of bags)',   field: 'Shoes', cap: 5 },
    ],
  },
]

/** Flat list, form order preserved — most call sites want this, not the
 *  grouped shape. */
export const DROP_OFF_ITEMS: DropOffItem[] = DROP_OFF_CATALOG.flatMap(g => g.items)

/** key -> item, for the route to resolve a submitted quantity. */
export const DROP_OFF_ITEM_BY_KEY: Record<string, DropOffItem> = Object.fromEntries(
  DROP_OFF_ITEMS.map(i => [i.key, i]),
)
