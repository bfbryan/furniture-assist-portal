// lib/donors/drop-off-catalog.ts
//
// Single source for the drop-off form's 30 items: form key -> Airtable
// field name on In Kind Donations -> per-item cap. Everything downstream
// (the route, the test page, any future rebuild of the real form)
// references an item by its stable `key`, never by the Airtable `field`
// string directly — that's what makes the two renames already scheduled
// at switchover ("Coffee Table/TV Stand" -> "Coffee Table", "End Table"
// -> "End Table/TV Stand") a two-line edit in THIS file and nothing else.
// Grep the repo for either string outside this file before changing it;
// if anything else matches, something imported the wrong thing.
//
// This is NOT lib/catalog/items-disbursed.ts. That file is the Client
// Referrals disbursement catalog — a different table, a different base
// (the agency/referral base, not AIRTABLE_DONOR_BASE_ID), prefixed field
// names ("LR Couch/Loveseat/Futon"), and alphabetical ordering. The item
// *names* happen to overlap (both are "what furniture exists"), the
// *fields* and *order* do not. Checked live against the donor base's
// actual schema and five recent Zap-written records — see the PR
// description for the source, not inferred from the other file.
//
// Order matches the form's own display order (Bedroom, Living Room,
// Kitchen/Linen, Baby/Kids, Dining Room, Clothes) — cosmetic, but keeping
// it means a diff against the real form's field order stays legible.
//
// Caps are advisory only (see lib/donors/drop-off-intake.ts) — a
// donor picking a form dropdown option above the cap still submits; the
// route flags it rather than rejecting. These numbers match the pickup
// form's own caps as given; drop-off has never had caps before this.

export type DropOffItem = {
  /** Stable key. Referenced by the route and the test page — never the
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
    key: 'bedroom',
    title: 'Bedroom',
    items: [
      { key: 'mattressBoxspring', label: 'Mattress/Boxspring', field: 'Mattress/Boxspring', cap: 3 },
      { key: 'bedframe',          label: 'Bedframe',           field: 'Bedframe',            cap: 3 },
      { key: 'dresser',           label: 'Dresser',            field: 'Dresser',             cap: 3 },
      { key: 'nightstand',        label: 'Nightstand',         field: 'Nightstand',          cap: 4 },
    ],
  },
  {
    key: 'livingRoom',
    title: 'Living Room',
    items: [
      { key: 'couchLoveseatFuton', label: 'Couch/Loveseat/Futon', field: 'Couch/Loveseat', cap: 3 },
      { key: 'livingRoomChair',    label: 'Chair',                field: 'Living Room Chair', cap: 6 },
      // SCHEDULED RENAME at switchover: field becomes "Coffee Table".
      { key: 'coffeeTable',        label: 'Coffee Table',         field: 'Coffee Table/TV Stand', cap: 2 },
      // SCHEDULED RENAME at switchover: field becomes "End Table/TV Stand".
      { key: 'endTableTvStand',    label: 'End Table/TV Stand',   field: 'End Table', cap: 4 },
      { key: 'bookcaseStorage',    label: 'Bookcase/Storage',     field: 'Bookcase/Storage', cap: 3 },
      { key: 'studentDesk',        label: 'Student Desk',         field: 'Student Desk', cap: 2 },
      { key: 'lamp',                label: 'Lamp',                 field: 'Lamp', cap: 5 },
      { key: 'pictureOtherDecor',  label: 'Picture/Other Decor',  field: 'Picture/Other Decor', cap: 5 },
      { key: 'rug',                 label: 'Rug',                  field: 'Rug', cap: 3 },
      { key: 'tvElectronics',      label: 'TV/Electronics',       field: 'TV/Electronics', cap: 3 },
    ],
  },
  {
    key: 'kitchenLinen',
    title: 'Kitchen/Linen',
    items: [
      { key: 'smallAppliance',     label: 'Small Appliance',             field: 'Small Kitchen Appliance', cap: 5 },
      { key: 'dishes',             label: 'Dishes (# of boxes)',         field: 'Dishes', cap: 5 },
      { key: 'cookbook',           label: 'Cookbook (# of boxes)',       field: 'Cookbooks', cap: 3 },
      { key: 'linen',              label: 'Linen (# of bags)',           field: 'Linen', cap: 5 },
      { key: 'potsPansUtensils',   label: 'Pots/Pans/Utensils (# of boxes)', field: 'Pots/Pans/Utensils', cap: 4 },
      { key: 'generalHousehold',   label: 'General Household',           field: 'General Household', cap: 5 },
      { key: 'bathroom',           label: 'Bathroom',                    field: 'Bathroom', cap: 3 },
      { key: 'homeOffice',         label: 'Home Office',                 field: 'Home Office', cap: 3 },
    ],
  },
  {
    key: 'babyKids',
    title: 'Baby/Kids',
    items: [
      { key: 'cribBassinet',       label: 'Crib/Bassinet',               field: 'Crib/Bassinet', cap: 2 },
      { key: 'toysBooksSchool',    label: 'Toys/Books/School (# of boxes)', field: 'Toys/Books/School', cap: 5 },
      { key: 'generalBaby',        label: 'General Baby',                field: 'General Baby', cap: 3 },
      { key: 'babyClothes',        label: 'Baby Clothes (# of bags)',    field: 'Baby Clothes', cap: 5 },
    ],
  },
  {
    key: 'diningRoom',
    title: 'Dining Room',
    items: [
      { key: 'diningTable',        label: 'Dining Table',                field: 'Dining Table', cap: 1 },
      { key: 'diningChair',        label: 'Chair',                       field: 'Dining Chair', cap: 8 },
    ],
  },
  {
    key: 'clothes',
    title: 'Clothes',
    items: [
      { key: 'adultClothes',       label: 'Clothes (# of bags)',         field: 'Adult Clothes', cap: 10 },
      { key: 'shoes',              label: 'Shoes (# of bags)',           field: 'Shoes', cap: 5 },
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
