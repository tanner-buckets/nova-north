# CLAUDE.md — NoVa North League site

Project rules. Read before making changes. These are constraints, not suggestions.

---

## What this is

A website for the Northern Virginia North League ("NoVa North"), a local trading
card game league run in partnership with a game store. It tracks prize points,
loyalty progress toward store purchase tiers, and event registration. Professors
(volunteer organizers) manage the data. Players read it.

Use "NoVa North League" in the interface. "Northern Virginia North League" is the
full name and appears where the long form is warranted.

League meets Sundays at 2:00 PM, registration closes 2:30 PM, at Continental
Cards Tournament Location, 21140 Ashburn Crossing Dr #110, Ashburn, VA 20147.

Many players are children. Privacy rules in this file are not negotiable.

---

## Hard constraints

- **No framework.** No React, Vue, Svelte, Next, Astro. Vanilla JavaScript only.
- **No build step.** No bundler, no transpiler, no `npm run build`. Files served
  as written.
- **No TypeScript.** Plain `.js` files.
- **Static hosting.** The site is served by GitHub Pages. Nothing runs on a server.
- **Mobile first.** Players read this on a phone at a game store. Design for a
  narrow viewport, then widen.
- **One CSS file.** No CSS framework, no Tailwind, no preprocessor.
- **ES modules via CDN only.** `supabase-js` is imported from a CDN URL. Nothing
  else is added without asking.

If a task seems to need a framework or a build step, stop and ask. Do not add one.

---

## Intellectual property

- Use original branding, wording, and graphics only.
- Do not use Pokémon logos, card art, character art, or official marks.
- Do not copy text from official sources.
- Describe the league; do not represent it as official.
- **Never put "Pokémon" or "Pokemon" in the domain name**, a social account
  handle, or the site title. TPCi's Media Usage Guidelines prohibit brand names in
  a domain name or publication name, and prohibit any use implying affiliation or
  endorsement.

---

## Privacy — the rules that matter most

### Never public, at any consent level

- Full last name
- Birth year, or any date of birth
- Age division (Junior / Senior / Master)
- Contact fields (Discord handle, email)
- Professor notes
- Pre-registration lists — who registered for an event is never public

These are visible only to a signed-in professor. Division and birth year are
stored and used for logic (registration caps, minor status) but never rendered.

### Player identity is consent-gated

The site shows **Player IDs only** by default, and names never by default.
Two independent switches, both professor-controlled:

| Switch | Adult default | Minor default |
|---|---|---|
| Player ID visible | Yes | **No** |
| Name visible (first name + last initial) | **No** | **No** |

Rules:

- Only a **professor** may change a visibility flag, and only with the player's
  consent, or a parent's or guardian's consent for a minor.
- An adult may ask a professor to hide their Player ID. No public self-service
  toggle in v1.
- A name is never shown without the Player ID also being shown.
- Every change writes a `consent_log` row. Changing a flag outside
  `set_player_visibility()` is a bug.

### Consent expires after three months

Visibility lapses when a player has no attendance in the preceding three months.
Enforced **twice**: every public read tests attendance recency so it fails closed,
and a scheduled job clears the stale flags so the data does not persist.

A returning player is not restored automatically. A professor re-confirms consent.

### Two states for a non-consented player

- **Lookup and browse lists** — omit the player entirely.
- **Sets that must be complete** (event result ordering, counts) — render the
  literal label `PLAYER`, with no other identifying value.

Never invent a third form. Never render a partial name, an initial, or a
truncated ID as a substitute.

### Implementation rules

- **Row Level Security is row-level, not column-level.** Hiding a column requires
  a view or column grants, not a policy.
- The anon key gets **no direct SELECT** on `players`, `registrations`,
  `attendance`, `loyalty_results`, or `consent_log`.
- Every public-facing surface gets its display string from `display_label()`.
  Never assemble a name from columns in page code.

When in doubt about whether something can be shown publicly: it cannot.

---

## Security

- Client code uses the **anon key only**. It is public by design.
- The **`service_role` key must never** appear in any file in this repo, in
  client code, or in an example. If a task seems to need it, stop and ask.
- `.env` and `.env.local` are gitignored. Never commit them.
- **Every table gets RLS enabled and at least one policy in the same migration
  that creates it.** A table without a policy is a bug.
- Public write access exists only for event registration and drop requests.
  Everything else requires an authenticated professor.
- Professor identity is checked against the `professors` table by `auth.uid()`.

### Migrations deploy automatically

The Supabase GitHub integration is enabled. **A migration file pushed to `main`
is applied to the production database.** There is no confirmation step.

- Review of migration SQL happens **before commit**, not before deploy.
- Never edit a migration that has already been pushed. Write a new one.
- Do not commit a migration as work in progress. If it is in `main`, it is live.

---

## Data model principles

- **Append only.** The point ledger is a log of transactions. Balance is a sum.
  Never store or update a running total column.
- **Void, never edit.** Correcting a mistake means writing a reversing entry that
  references the original. Never update or delete a ledger row.
- **Retire, never delete.** Earning actions and prize items get an `is_active`
  flag. Historical rows must keep pointing at valid records.
- **Derive, do not store.** Division comes from birth year. Loyalty week count
  comes from counting distinct attendance dates. Release membership comes from the
  date falling inside the release window. Consent in force comes from the flag
  plus attendance recency. The one exception is `loyalty_results`, a snapshot of a
  closed release.
- **Player ID is the key.** Names change spelling between imports; Player ID does
  not. Match on Player ID and update the name.
- **Defaults are overridable.** Point values are defaults a professor can change
  at entry time.

---

## Domain rules

- **One loyalty week per calendar day**, regardless of how many events a player
  attended that day. Enforced by a unique constraint on (player, date).
- Loyalty resets each **release**. A release has a date window and its own tiers.
  Tier names are Crystal, Gold, and Silver; the product each earns, the
  thresholds, and the number of tiers vary per release.
- Prize points **never reset**.
- Attendance can come from a TDF upload or manual professor entry. Both grant
  prize points and a loyalty week. Manual entry has a date field defaulting to
  today.
- Registration does **not** create attendance. Check-in is separate.
- Within a group of linked events, a player may hold **one confirmed registration
  and any number of waitlist spots**.
- When a drop is confirmed, promote the top waitlist entry **skipping anyone who
  already holds a confirmed spot in that linked group**. Show the professor an
  on-screen confirmation naming who was promoted.
- Drop requests require Player ID **and** matching name, and do not take effect
  until a professor confirms.
- **Every registration requires a Player ID**, prereleases included. Someone
  without one is sent to a help page explaining how to look one up or create one,
  including for a child, with professor contact details as the fallback. A
  registration is never anonymous: the ID is what makes duplicate detection and
  self-service drops possible.

---

## TDF handling

- TDF files are XML. Parse them **in the browser** with `DOMParser`.
- **Never upload the file anywhere.** Never store it. Never put it in Supabase
  Storage.
- Extract only Player ID, name, and what is needed to award points. **Do not store
  the date of birth found in the file** — birth year is captured separately at
  registration.
- A TDF import **never** sets a visibility flag. Appearing in a tournament file is
  not consent.
- After parsing, prompt the professor for the event type so point values can be
  applied, and offer to add other attendees present but not in the file.

---

## Printing

Printable outputs are **print stylesheets**, not generated files. Use
`@media print`. Do not add jsPDF, pdfmake, or any PDF library.

Two printable views are needed: loyalty tier lists for the store, and
pre-registration lists for the professor desk. **Neither is public, and both are
professor-only pages.** Printed lists may show full names because they are handed
to the store or used at the desk — this is a disclosure to the venue, not
publication. Nothing printed is ever rendered on a public page.

---

## File layout

```
index.html          league overview, meeting time, how to join
schedule.html       upcoming events
prizes.html         prize wall catalog
players.html        player lookup by Player ID
admin/              professor-only pages
data/source/*.csv   spreadsheet exports used to seed reference tables
app.js              shared logic
styles.css          all styles
supabase/migrations/  schema, one file per change
```

---

## Build phases — do not skip ahead

Schema comes before pages. Building UI against mocked data means rebuilding it
against real functions and policies later.

Current phase: **5**.

1. **Reference tables.** `earning_actions`, `prize_items`, `releases`,
   `loyalty_tiers`. Seeded from the spreadsheet exports. No personal data — this
   is where RLS policies are written and tested for the first time.
2. **People and consent.** `players`, `professors`, `consent_log`, the visibility
   helpers, and `public_players`. Import the player list with no visibility.
3. **Points and attendance.** `attendance`, `point_ledger`,
   `get_player_summary()`, `expire_stale_consent()`. Opening balances arrive as
   ledger entries labelled as carried forward.
4. **Events and registration.** `events`, `event_capacities`, `registrations`,
   `public_event_counts`, `register_for_event()`, `request_drop()`,
   `confirm_drop()`.
5. **Public pages.** Built against the real tables and functions.
6. **Professor screens.** Login-gated admin pages for manual points, attendance,
   visibility consent, drop confirmation, and the printable lists.
7. **TDF upload and parsing.**

Running alongside phase 1: deploy a minimal static shell to GitHub Pages — one
page and a nav, confirmed live. This proves the deploy chain works while nothing
is at stake. Do not expand it into the full site before phase 5.

Do not build features from a later phase because they seem convenient.

---

## Conventions

- Two-space indentation.
- Plain, direct copy. Write for a parent reading on a phone in a game store.
- Error messages say what happened and what to do about it.
- No emoji in the UI.
- Semantic HTML. Keyboard focus visible. Alt text on images.
- Comment the non-obvious. Do not comment the obvious.

---

## When to stop and ask

- Anything that would add a dependency, a framework, or a build step
- Anything that would display a protected field
- Anything that would show a name, or a Player ID, without checking the
  visibility helpers
- Anything that sets a visibility flag outside `set_player_visibility()`
- Anything that needs the `service_role` key
- Anything that stores a full date of birth
- Anything that deletes rather than retires or voids
- Anything from a build phase later than the current one
