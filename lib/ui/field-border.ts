// lib/ui/field-border.ts
//
// THE border colour every text field on an Add Referral screen draws with.
// One definition, imported by all three of them.
//
// ---------------------------------------------------------------------------
// Why this value, and why it moved twice
// ---------------------------------------------------------------------------
// Dawson could not see where the fields were. The original #EDE9E1
// (--cream-dark) against a white field fill is a contrast ratio of 1.21:1.
// Technically a border, but well below the point at which an edge reads as an
// edge, and these forms are long enough that hunting for the next box is real
// friction.
//
// The first attempt at this moved it to #CFC7B8, and Dawson reported no
// change. That was not a revert: #CFC7B8 was still in the file, exactly as it
// had been set. It was simply too small a step - 1.68:1 against white. The
// comment that shipped with it said as much, and said 3:1 "lands around
// #A9A296". That last part was wrong; #A9A296 measures 2.53:1.
//
// WCAG 1.4.11 asks for 3:1 for a non-text UI boundary, which an input outline
// is. This value clears it:
//
//     #EDE9E1  1.21:1   original
//     #CFC7B8  1.68:1   the step Dawson could not see
//     #9E8E70  3.20:1   this
//
// (All against #FFFFFF, which is the fill every one of these fields sets.)
//
// It is the SAME warm cream, not a new grey: #CFC7B8 is hsl(39, 19%, 77%) and
// this is hsl(39, 19%, 53%) - identical hue and saturation, three steps down in
// lightness. It also clears 3:1 against the #FAF8F4 sub-panels (3.02:1), so a
// field sitting on cream rather than white is covered too.
//
// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
// This is the FIELD outline only, and only on the Add Referral screens:
//
//   app/dawson/referrals/new/page.tsx              internal Add Referral
//   components/agency/NewReferralForm.tsx          agency Add Referral
//   components/internal/modals/AddAgencyStaffModal named from the first
//
// #EDE9E1 is still doing several other jobs across the app - card edges,
// dividers, panel outlines, secondary button borders - and none of those are
// what Dawson reported. Ben's standing rule is that colour does not move unless
// he asks, so they are untouched, including the Profile page's own fields and
// the Reschedule and Cancel modals. If Dawson wants the same treatment on
// another screen, point its fields at this constant.
export const FIELD_BORDER = '#9E8E70'

/** `border` shorthand for a field at rest. */
export const FIELD_BORDER_STYLE = `1px solid ${FIELD_BORDER}`
