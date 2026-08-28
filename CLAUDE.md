# Furniture Assist — Agency Portal

Next.js on Vercel. Airtable is the database, Clerk is auth, Resend sends mail.
Two surfaces share the codebase: the **agency portal** (agency admins and staff)
and the **internal / Dawson operations portal** under `/dawson`.

This is a volunteer-run nonprofit. Real referrals in the base are real families
with real appointments. Treat the data accordingly.

---

## Never do these

- **No writes to Airtable or Clerk during development.** Read-only queries against
  the live base are fine and encouraged for verifying claims. Writes are not.
- **Never submit, cancel, withdraw or reschedule a referral** while building or
  testing. Several of those paths send real email to real agencies.
- **Do not change the Airtable schema.** Field types, display timezones, new
  fields — flag them for Ben, don't do them. If a display problem can only be
  fixed in Airtable, say so rather than writing a shifted value to make one view
  look right.
- **Do not change Vercel environment variables or Clerk dashboard configuration.**
  Those are Ben's. Diagnose and report.
- **Never use `NEXT_PUBLIC_APP_URL`.** It has never been set in any environment
  and previously produced links beginning with the literal word `undefined`. The
  portal origin is a constant in `lib/auth/portal-sign-in-link.ts`. An invite is
  read long after the deploy that sent it, and a preview deploy must never mail
  links pointing at itself.

## Scope constraints

Standing rule: **colour, font style, the left nav and the header stay as they
are.** If a change would touch any of those, stop and ask. If Ben explicitly asks
for one of them, note in the writeup that it's his override.

Do not introduce new colours, fonts, sizes, corner radii or shadows. Use what is
already in the codebase. Brand palette is navy `#1B2B4B`, teal `#2A7F6F`, gold
`#C9A84C`, cream `#F7F5F1`; Montserrat for headings, Lato for body.

`globals.css` already has a box-sizing reset. Don't add another.

Don't fix adjacent things nobody asked about. If a sibling page has the same
problem, say so in the writeup and offer, rather than expanding the diff.

## How to work

**Diagnose before fixing.** Ben's description of a problem is a symptom report,
not a diagnosis. Find the actual cause before changing anything. If the reported
problem isn't real, doesn't reproduce, or is caused by something other than what
he named, say that plainly instead of quietly fixing something else. Two or three
items per batch usually turn out to be something other than what they looked like
— that is the expected rate, not a failure.

**On ambiguity, implement nothing.** If a request could reasonably mean two
different things, and the difference is real rather than wording, do not pick one.
Write it up as an **OPEN ITEM** with the tradeoff and what each choice costs. If a
decision genuinely has to be taken to ship the item, take the reversible one, label
it as your call and not his, and say exactly how to change it.

**One branch, one PR per batch.** Don't stack branches.

**When a constant appears in more than one file, consolidate it.** Copied values
drift. Put it in `lib/` and have the copies import it. If a copy exists somewhere
this repo cannot reach — an Airtable automation script, for example — say so
prominently at the top of the new module.

---

## Verification standards

Every item in the writeup gets one of two labels, and never anything vaguer:

- **Verified** — and say how: browser, live Airtable query, offline test.
- **Built but unproven** — and say why it couldn't be exercised.

Never imply something works when it hasn't been run.

**Data claims come from querying the live base, read-only.** Not from reading the
code and inferring. If a claim covers a whole table ("no referral is both X and
Y"), check it across the table and give the row count.

**Layout claims come from a real browser**, loading the real compiled stylesheet
and the real fonts, comparing `scrollWidth` against `clientWidth`. Not from
reading the CSS. Standard widths: **390, 430, 768, 820, 1024, 1180, 1280, 1366,
1440, 1728**. Report actual pixel numbers, before and after.

**Before calling an overflow or regression new, stash the changes and re-measure.**
If the numbers are identical, it's pre-existing — say so and don't claim credit or
blame.

Note: the `/dawson` shell keeps a fixed 240px sidebar at every width, so internal
pages need roughly 1024px. Below that they overflow. This is known and out of scope
unless asked.

## Checks before the writeup

Run all three and report each:

| check | how to report |
|---|---|
| `npx tsc --noEmit` | clean, or the errors |
| `npm run build` | succeeds, page count, new routes registered |
| `npx eslint .` | **compared against `main`, finding by finding** |

Lint is compared on file, rule and message — not on totals. `main` carries
pre-existing errors. State the count on both, and account for every difference in
either direction. A new finding is acceptable if it's deliberate and consistent
with its neighbours; say which and why.

---

## The PR description

Write it as the last step, after the work is done, from what actually happened.

- Open with a one-line count of what's in the branch and what wasn't touched.
- Take items in the order Ben listed them, with his numbering.
- Group by area when there are many items.
- For each: what was actually changed, why, and the verification label.
- Put corrections to the brief in the item they belong to, not in a footnote.
- Include the measurements. Tables for column widths, contrast ratios, overflow
  numbers, before and after.
- End with the checks table, then anything Ben needs to decide or do himself
  (Airtable schema, Vercel env, Clerk config), then merged branches still on the
  remote — listed, not deleted.
- Where useful, add a short **Worth clicking** line per item: what to open on the
  preview deploy to confirm it. Include any "please don't press this" warnings.

Plain sentences. No marketing. If something is half-done, uncertain, or was a
judgement call, that is the part worth writing out in full.