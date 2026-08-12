# CLAUDE.md — Nova North League site

Project rules. Read before making changes. These are constraints, not suggestions.

---

## What this is

A website for a local trading card game league run in partnership with a game
store. It tracks prize points, loyalty progress toward store purchase tiers, and
event registration. Professors (volunteer organizers) manage the data. Players
read it.

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

---

## Privacy — the rules that matter most

These fields are **stored but never publicly displayed and never readable by the
anon key**:

- `birth_year`
- Derived division (Junior / Senior / Master)
- Contact fields (Discord handle, email)
- Professor notes
- Pre-registration lists (names of who registered for an event)

Publicly readable player fields are exactly: **Player ID, first name, last
initial**. Nothing else.

Implementation rule: **Row Level Security is row-level, not column-level.**
Hiding a column requires a view or column grants, not a policy. Public reads go
through views and RPC functions that expose only safe columns. The anon key gets
no direct `SELECT` on `players`, `registrations`, or `attendance`.

When in doubt about whether something can be shown publicly: it cannot.

---

## Security

- Client code uses the **anon key only**. It is public by design.
- The **`service_role` key must never** appear in any file in this repo, in
  client code, or in an example. If a task seems to need it, stop and ask.
- `.env` and `.env.local` are gitignored. Never commit them.
- **Every table gets RLS enabled and at least one policy in the same migration
  that creates it.** A table without a policy is a bug. Never create a table and
  leave the policy for later.
- Public write access exists only for event registration and drop requests.
  Everything else requires an authenticated professor.
- Professor identity is checked against the `professors` table by `auth.uid()`.

---

## Data model principles

- **Append only.** The point ledger is a log of transactions. Balance is a sum.
  Never store or update a running total column.
- **Void, never edit.** Correcting a mistake means writing a reversing entry that
  references the original. Never update or delete a ledger row.
- **Retire, never delete.** Earning actions and prize items get an `is_active`
  flag. Historical rows must keep pointing at valid records. Deleting breaks
  history.
- **Derive, do not store.** Division comes from birth year. Loyalty week count
  comes from counting distinct attendance dates. Release membership comes from
  the date falling inside the release window. Do not denormalize these.
- **Player ID is the key.** Names change spelling between imports; Player ID does
  not. Match on Player ID and update the name.
- **Defaults are overridable.** Point values on earning actions and prize items
  are defaults a professor can change at entry time. Do not treat them as fixed.

---

## Domain rules

- **One loyalty week per calendar day**, regardless of how many events a player
  attended that day. Enforced by a unique constraint on (player, date).
- Loyalty resets each **release**. A release has a date window and its own set of
  tiers. Tier count, thresholds, and prizes vary per release — they are rows, not
  constants.
- Prize points **never reset**.
- Attendance can come from a TDF upload or from manual professor entry. Both
  grant prize points and a loyalty week. Manual entry has a date field defaulting
  to today.
- Registration does **not** create attendance. Check-in is separate and happens on
  the day.
- Within a group of linked events, a player may hold **one confirmed registration
  and any number of waitlist spots**.
- When a drop is confirmed, promote the top waitlist entry **skipping anyone who
  already holds a confirmed spot in that linked group**. Show the professor an
  on-screen confirmation naming who was promoted.
- Drop requests require Player ID **and** matching name, and do not take effect
  until a professor confirms.
- Premier events require a Player ID. Prereleases do not.

---

## TDF handling

- TDF files are XML. Parse them **in the browser** with `DOMParser`.
- **Never upload the file anywhere.** Never store it. Never put it in Supabase
  Storage.
- Extract only: Player ID, name, and what is needed to award points. **Do not
  store the date of birth found in the file** — birth year is captured separately
  at registration.
- After parsing, prompt the professor for the event type so point values can be
  applied, and offer to add other attendees who were present but not in the file.

---

## Printing

Printable outputs are **print stylesheets**, not generated files. Use
`@media print`. Do not add jsPDF, pdfmake, or any PDF library.

Two printable views are needed: loyalty tier lists for the store, and
pre-registration lists for the professor desk. Neither is public.

---

## File layout

```
index.html          league overview, meeting time, how to join
schedule.html       upcoming events
prizes.html         prize wall catalog
players.html        player lookup by Player ID
admin/              professor-only pages
data/*.json         static content (schedule, informational copy)
app.js              shared logic
styles.css          all styles
supabase/migrations/  schema, one file per change
```

---

## Build phases — do not skip ahead

Current phase: **1**.

1. **Static site.** Informational pages, content in `data/*.json`, no Supabase, no
   auth, no database. Ship this first.
2. **Event registration.** First database feature. Form writes, capacity, waitlist.
3. **Player lookup, read only.** Data entered by hand to validate the model.
4. **Professor login and admin screens.** Manual points and attendance entry.
5. **TDF upload and parsing.**

Do not build features from a later phase because they seem convenient. Do not
create database tables during phase 1.

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
- Anything that needs the `service_role` key
- Anything that stores a full date of birth
- Anything that deletes rather than retires or voids
- Anything from a build phase later than the current one
