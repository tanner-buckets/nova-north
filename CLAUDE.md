# CLAUDE.md — LoCo League site

Project rules. Read before making changes. These are constraints, not suggestions.

---

## What this is

A website for LoCo League, a local trading
card game league run in partnership with a game store. It tracks prize points,
loyalty progress toward store purchase tiers, and event registration. Professors
(volunteer organizers) manage the data. Players read it.

The league is **LoCo League**, everywhere. There is no separate long form: the
name is the same in the masthead, the footer, page titles and body copy.

Every page carries the strapline "A Play! Pokémon league at Continental Cards,
Ashburn" under the name, so a visitor landing on any page knows what and where
this is.

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
- **No web fonts.** Georgia for display, the system sans for body. Both are
  already on the machine; a font file is a dependency and a request.
- **ES modules via CDN only.** `supabase-js` is imported from a CDN URL. Nothing
  else is added without asking.
- **One third-party embed exists**, the Google map in the home page's meeting
  details, asked about and approved. It loads outside content on a page children
  use, which is why it was a question rather than a decision. The Discord join is
  a plain link, not an embed, and loads nothing. Do not add a second embed
  without asking.

If a task seems to need a framework or a build step, stop and ask. Do not add one.

---

## Intellectual property

- Branding and wording are original. The league name, the mark, the palette and
  every phrase on the site are ours.
- **Official Pokémon artwork and marks are used deliberately**, supplied by the
  league organiser, who holds the relationship with TPCi. The risk was raised
  before any of it was committed: the repository is public, the site is deployed,
  and git history is permanent. Do not remove any of it on the grounds of the
  earlier rule — it is here on purpose. What is here:
  - `images/badges/*.png` — character art for the original thirteen badges
  - the `badge-art` storage bucket — artwork uploaded by a professor since
  - `images/play-pokemon.png` — the Play! Pokémon mark, footer of every page
  - `images/worlds.png` — the World Championships mark, on premier events
  - `images/cc-logo.png` — the venue's own mark, behind every earned badge
  - `images/icon-32.png`, `images/icon-180.png`, `favicon.ico` — the same venue
    mark, on graphite, as the tab icon. Chosen by the organiser over an original
    league mark; the concern that it reads as the store's site rather than the
    league's was raised and answered.
- Do not add further official artwork without asking.
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
- **Whether somebody played is recorded, not derived.** `attendance.played` is
  the only place the day and the fact meet: the play award is a ledger row, and
  the ledger carries no attendance date. **Null means not recorded**, from before
  the column existed — never treat it as false, or a day of tournament players
  reads as a day of spectators.
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
- **Registration closes when the event starts.** Enforced in
  `register_for_event()`, not in page code: the anon key can call the function
  directly, so a check on the schedule is not a check.
- **A professor can close registration early** with `set_registration_closed()`,
  which records who and when and is reversible. This is **not** the
  `registration_open` flag: that one says whether the event takes registration at
  all, and turning it off also removes the event from the drop confirmation
  screen and the printable desk list. Closing must leave every existing place,
  the waiting list order and drop requests alone.
- **A drop request is never refused by a closing.** A player who cannot come must
  always be able to say so, and never more than once their place could go to
  somebody waiting.
- **An event carries its own links to the two screens it leads to.** The events
  screen puts a drops button and a printable-player-list button at the top of
  each expanded event, both passing `?event=<id>`, so neither screen has to be
  picked out of a list a second time. Only where the event takes registration:
  the drop screen and the printable list both load registration-taking events, so
  for anything else the links would land on a page the event is not on.
- **An event that takes registration has a page of its own**, `event.html?e=<id>`,
  so a professor has a link to post that is one event rather than the whole
  schedule. It reads what the schedule reads and nothing more: places left and
  the number waiting, never who is registered. A flight code opens the group.
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
- Extract Player ID, name, birth year, and what is needed to award points. TDF
  files are the main way new players enter the system, so the birth year in the
  file is what gives a new player a division.
- **Store the year only.** The file carries a full date of birth. Read the year
  as the file is parsed and drop the month and day there, so they never reach a
  variable that could be written. A full date of birth is never stored, from a
  file or from anywhere else.
- Birth year is set when a player is **created**. An import never overwrites the
  birth year of a player who already has a row: division drives registration
  caps, and a professor who corrected it by hand outranks a file.
- A TDF import **never** sets a visibility flag. Appearing in a tournament file is
  not consent.
- After parsing, prompt the professor for the event type so point values can be
  applied, and **prompt** for other attendees present but not in the file. A
  collapsed disclosure is not a prompt: anyone who turned up without entering the
  tournament earns the same loyalty week, and the upload is the only moment they
  are still standing there to be remembered.
- **The repeat-upload check is keyed on the tournament's own id**, read from the
  file directly after the name, and stored on `point_ledger.source_ref`. Not on
  the name: a league that exports the same event name every Sunday would flag
  every returning player from the second week onward, and the default is not to
  pay them, so regulars would quietly stop earning the play point. Two
  tournaments on one day have two ids and do not collide.
- **No id, no check.** A file without one is not guessed at from its name; the
  screen says plainly that nothing was checked, because a professor assuming a
  check ran is worse than no check.
- **`source_ref` is not public.** `reason` is — `get_player_summary()` returns it
  and it shows on a player card — which is exactly why a filing reference does
  not go in there.
- **Only players the file lists earn the play award.** Someone added by hand
  earns the loyalty week and the attendance point and nothing more. The file is
  the claim that a tournament was played; a name typed at the desk is not.
- **Ask which judges were there**, as a list of checkboxes, not a fourth search.
  A judge is at every event by definition, and making a professor retype four
  names every week is asking them to enter what the site already knows. The list
  comes from `professors` joined to their own player record, never from IDs
  written into page code: who judges changes.
- **A judge earns what anybody added by hand earns** — the loyalty week and the
  attendance point, and no play award. Judging is not playing. A judge who also
  played is in the file already, so their box is ticked and locked rather than
  offering to add them twice.
- **Ask how many other attendees there were** — parents, siblings, anyone in the
  room without a Player ID. They earn nothing and are never recorded by name.
  The count is per **day**, not per file: two files from one Sunday are one
  roomful, so a second entry replaces rather than adds, and the box says so and
  shows what is already recorded. The manual attendance screen asks the same
  question, or a day recorded by hand would read as nobody having come.
  It belongs on the **"Was anyone else here?"** card with the other question
  about who was in the room, not at the end of the point awards where it was the
  last field on a long form and went unanswered.
- **The points are two number boxes, not two dropdowns**, and they are folded
  away behind a disclosure because they are right nearly every week. Which
  earning action a ledger row points at is decided by the premier checkbox;
  the box decides how many points, not what they were for. Two lists of every
  earning action was a lot of screen for a choice nobody makes, and picking a
  different action to get a different number was the long way round to it.
- **The fields on the record card are built once per file, not once per render.**
  `redraw()` replaces the whole screen and runs every time somebody is added by
  hand or a judge is ticked. Rebuilding the fields with it silently reverted
  them: tick "this was a premier event", add one person, and premier was off
  again and everybody earned a point less, with nothing on screen saying so.

---

## The home page's outside links

- **The map is the keyless embed**, `maps.google.com/maps?q=...&output=embed`.
  No API key, so there is none to keep, rotate or leak from a public repository.
- **The query is the street address alone, with no business name.** Searching
  "Continental Cards" matches the shop's own Google listing, which is a different
  place from the tournament room: it sent people to the shop. Both the map and
  the directions link ask for `21140 Ashburn Crossing Dr #110` and nothing else,
  so what the map shows is what the page prints.
- **Its box has a definite height, not an aspect ratio.** The embed measures its
  box once, on load, and draws the map to whatever it finds. With `aspect-ratio`
  the height was not resolved at that moment, so it drew a thin strip of map and
  left the rest grey.
- **Get directions is a link, not the embed.** `google.com/maps/dir/?api=1` is
  Google's documented URL and opens the Maps app on a phone. Nothing loads from
  Google until somebody taps it.
- **The Discord join is a plain button, not a widget.** Discord's embeddable
  widget needs the server owner to turn it on in Server Settings, and the
  Continental Cards server has it off — `widget.json` answers
  `403 Widget Disabled`. If that ever changes, a widget becomes possible.
- **The invite must never expire.** A Discord invite carries an expiry and a use
  limit unless it is created without them, and either one turns the button into a
  dead end with nothing on the page changing to say so. Check a replacement
  against `discord.com/api/v10/invites/<code>?with_expiration=true` before
  swapping it in: `expires_at` has to be null.
- **The join button wears Discord's blurple**, `#5865f2`, which is the one colour
  on the site outside the palette. A gold button would read as ours, and that
  server is the store's room rather than ours. White on it clears 4.5:1.
- **What the Discord is actually for**: a Pokémon channel carrying product and
  tournament announcements, and somewhere to ask a question between Sundays.
  Pairings are **not** posted there, so do not write that they are. The page says
  nothing about pairings either way: raising them only to rule them out sends a
  reader looking for something the page cannot help with.

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
event.html          one event, by ?e=<id>, for a link that can be posted
prizes.html         prize wall catalog
players.html        player lookup by Player ID
admin/              professor-only pages
data/source/*.csv   spreadsheet exports used to seed reference tables
event-registration.js  the register and cancel forms, shared by both pages
supabase-client.js  the client, league time, and the DOM helpers
styles.css          all styles
supabase/migrations/  schema, one file per change
```

---

## Build phases — do not skip ahead

Schema comes before pages. Building UI against mocked data means rebuilding it
against real functions and policies later.

Current phase: **all seven are built**. New work extends them rather
than skipping ahead.

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
6. **Professor screens.** Login-gated admin pages. TDF upload comes first,
   because that is how attendance is recorded and nothing downstream is real
   without it. Then visibility consent, drop confirmation, manual points, the
   Trainer Card, players, events and reference data.
7. **Printable lists.** Loyalty tiers for the store, pre-registration for the
   desk. Print stylesheets, professor-only.

`admin/attendance-history.html` reads all of it back: how many came each week,
split by played, attended and age division, and who was there on any given day.
**Total** — players plus everybody without a Player ID — leads the table, because
Players at the left with Others at the far right got read as the total, which it
is not. A day nobody counted shows `11+`, a floor rather than a number. The
division headings are `JR`, `SR` and `MA`: spelled out they are the three widest
columns on a table that already scrolls on a phone.
It writes nothing. Both figures come from `attendance_by_day()` and
`attendance_on()` rather than from queries in page code, because the division
split needs birth years and a birth year is a protected field — a professor may
read one, but shipping several hundred to a browser to bucket them is handing out
protected data to do arithmetic SQL can do. Full names and divisions put it
behind the sign-in with the printable lists.

Running alongside phase 1: deploy a minimal static shell to GitHub Pages — one
page and a nav, confirmed live. This proves the deploy chain works while nothing
is at stake. Do not expand it into the full site before phase 5.

Do not build features from a later phase because they seem convenient.

---

## Visual identity

Gold and graphite. Tokens live at the top of `styles.css`.

- `--gold` is the action colour: links, primary buttons, the big figures. It is
  dark enough to sit on white (5.37:1).
- `--amber` is a **background only**. White on it fails at 2.28, so it never
  carries text.
- `--danger` is red, and is reserved for destructive or wrong. Before this it was
  amber, which made a destructive button look like every other accent.
- `--gold-metal` is one gradient, reused, so gold reads as a metal rather than as
  mustard. Flat gold looks cheap.
- `--teal` and `--teal-lift` still exist, pointing at the gold. Thirty-odd call
  sites use them and renaming those would be churn: what changed is the colour,
  not what the token means.

The masthead is one dark band carrying the name, the strapline and the menu. The
site used to have a bar and a separate nav strip, which was two pieces of
furniture doing one job. An inner page drops the meeting details and keeps the
rest, so a header does not eat a phone screen on the way somewhere else.

The name itself is gold, using `--gold-metal` clipped to the text, with a solid
fallback for browsers that cannot clip a background to text.

The Play! Pokémon mark sits bottom right of every footer, on a white chip. It is
black and red on transparent and would vanish into the dark footer; inverting it
turned the red cyan, and a brand mark in the wrong colours is worse than one that
needed a background.

The venue mark sits to the left of the name in the masthead, matching the
height of the name and the strapline together. That is why those two are wrapped
in `.masthead-top` and `.masthead-titles`: the mark has to be a sibling of both,
not of the name alone.

It carries no plate, unlike the tab icon. The band behind it is already graphite,
which is the contrast the pale gold needed.

**Its height is a number per header variant**, not `align-self: stretch`.
Stretch does nothing to an image — `height: auto` on a replaced element resolves
to its intrinsic size, so the mark would be 197px tall and the band would grow to
fit it. Letting it grow with the column would run away on a narrow screen anyway:
a taller mark is a wider mark, a wider mark leaves the strapline less room, the
strapline wraps, and the column gets taller again. Four numbers, one per
combination of full or compact and narrow or wide.

`alt` is empty. The strapline underneath already says Continental Cards in text,
and the mark sits next to a link whose name is "LoCo League" — alt text there
would change what that link is called.

### The tab icon

The venue mark on a graphite tile, at `images/icon-32.png`, `images/icon-180.png`
and `favicon.ico`. Graphite because the mark is pale gold on transparent and
would vanish against a light tab strip; the tile is `--ink`, the masthead band,
so the tab matches the top of the page.

- **Every page carries the link tags.** There is no build step and so no shared
  head, which means a new page needs them copied in or its tab falls back to the
  browser's blank icon.
- **The paths are relative**, like every other link here. Pages serves the site
  from the `/nova-north/` subpath, so a leading slash resolves to the domain root
  and 404s. An admin page needs `../`.
- `favicon.ico` sits at the repo root because browsers request it with no tag at
  all. It holds 16, 32 and 48 pixel versions.
- Generated from `CC-Logo-No-Text.png` by fitting the mark to the tile height at
  10% padding and reducing from 8× with Lanczos. Regenerating from a different
  picture is the way to change it; the sizes are not hand-drawn.

A premier event carries the World Championships mark in its top right corner.
`is_premier` is the flag, and it is set on exactly the League Cups and
Challenges.

### Charts

One chart exists: the stacked column on the attendance history page. Inline SVG
built in page code — there is no charting library, because there is no build step
and no dependency budget, and a stacked column is a handful of rectangles.

- **Stacked, because the question is part-to-whole.** The height of a column is
  everybody who was there; inside it the divisions stack darkest first with
  Others on top.
- **One hue in four ordinal steps, not four categorical hues.** Divisions are age
  bands, and an age band is ordinal: the order means something, so it belongs in
  the colour. Master `#5c430b`, Senior `#8a6410`, Junior `#b08420`, Others
  `#d9a32c` — three of them existing tokens. Validated together as a ramp:
  monotone lightness, a visible step between each pair, and the light end still
  readable on the card. Gold against graphite was tried first and fails — a grey
  light enough to sit in the band is too close to gold to tell apart.
- **The total is a line, not a segment**, in `--ink-soft` graphite so it does not
  read as a fifth band. It **breaks where nobody counted the others**: on those
  days the total is a floor, and joining across would draw a dip that came from
  nobody counting rather than from anybody staying home. A hollow dot marks
  those days; a filled one marks a known total.
- **A 2px gap in the surface colour separates the segments.** Never a stroke
  around a mark: a border is ink that is not data.
- Marks cap at 24px wide; the data end is rounded 4px and the baseline is square.
  Gridlines are hairline, solid and recessive. Text wears text tokens, never the
  series colour.
- **A legend is always present** once there are two series, and one direct label
  rides the endpoint. A number on every column would go unread.
- **Hover and keyboard focus show the same tooltip**, and it is clamped so the
  last columns do not push it off the edge. It never gates anything: every figure
  is in the table underneath.
- On a narrow screen the wrapper scrolls rather than the chart shrinking into
  illegibility, the same as `.table-wrap`.

### Badges

A badge carries its own art and its own colours on its row: `image_path`,
`tile_color`, `tile_edge`.

- `image_path` null means the committed file at `images/badges/<code>.png`,
  which is where the original thirteen still live. Set, it names an object in
  the `badge-art` storage bucket. One code path, two sources, and no re-upload
  of artwork that already works.
- The colours are extracted from the picture **in the browser, at upload**, by
  `admin/badge-art.js`. They used to be extracted offline and pasted into
  `styles.css` by hand, which is why a badge a professor created had none: a
  broken image on a plain gold tile.
- The edge is the fill darkened until white on it clears 4.5:1. It rounds to
  whole channels at **every** step, not only at the end, because that is what
  the offline script did and the thirteen stored values must stay re-derivable.
  Keeping floats is a shade more accurate and puts a new badge on a different
  footing from an old one.

Colour is never a stylesheet entry any more. A badge added by a professor could
never have had one.

Each earned tile has three layers: the colour from the artwork, the venue mark
filling the tile behind it, and the badge art on top at 90%. The backdrop is a
CSS background rather than an `<img>` — it is decoration, and a screen reader has
no use for it. Because it is set in `styles.css`, which lives at the root, the
`url()` resolves the same from an admin page as from a public one.

**The player page shows only earned badges.** The count still says how many exist
("5 of 13"), so the set is not a mystery, but a card mostly made of empty slots
was not worth the space.

**The Trainer Card screen keeps the empty slots.** They are the buttons a
professor clicks to award a badge, so removing them would remove awarding.

**The programs page carries the picture at the end of each row**, after the name
and the task, because those are what somebody reads down the list for. The tile
has no label there: the name is already the first cell, and repeating it would
read twice to a screen reader. `badgeTile(badge, { withName: false })`.

### Seasons end by decision, not by succession

A season used to end the moment a later one had a badge, because
`current_badge_season()` was `max(season_year)`. A changeover cannot afford that:
last season's badges have to stay earnable while the new list goes up.

- `badge_seasons` holds one row per **retirement**. A season with no row is
  running, so adding next year's list needs no bookkeeping and cannot
  half-happen.
- Retiring is **reversible and never a delete**. The row is flipped and
  `retired_at` stays. There is no `DELETE` grant on the table.
- `active_badge_seasons()` is what is being awarded. `current_badge_season()` is
  the newest of those.
- **Rank is the best any running season gives** — `best_player_rank()`, with
  `best_rank_season()` naming which one. Judging on the newest alone would demote
  everybody the moment a new badge list appeared.
- **Elite 4 and Champion belong to one season each**, and during an overlap the
  Trainer Card asks which. The picker defaults to the newest running season and
  is only shown when there is a choice. Without it the award lands silently on
  the wrong year, which is how a set of 2026 Champions became 2027 ones.
- **The Champion badge threshold counts the chosen season's badges alone.** Two
  half-finished lists must not add up to one Champion.
- The picker does **not** govern badges. A badge carries its own season on its
  row, so every running season is shown together and needs no telling.
- The prize discount counts badges **per season and takes the best**, for the
  same reason.
- A professor cannot retire the only season still running. That would leave no
  badges being awarded at all.

### A badge can be secret

`is_secret` keeps a badge off the programs page and out of `badges_available`, so
nothing on a card hints that it exists. A professor sees it, marked, and awards
it like any other. Once earned it is on the card and in the total.

Secret is not retired. A retired badge is finished with; a secret one is live and
unannounced.

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
