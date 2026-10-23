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

Registration opens Sundays at 2:00 PM and play begins at 2:30 PM, at
Continental Cards Tournament Location, 21140 Ashburn Crossing Dr #110, Ashburn,
VA 20147. **2:00 is the time the site leads with**, everywhere a single time is
shown: it is the one a player needs to act on.

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
  a plain link, not an embed, and loads nothing, and neither does anything on the
  Resources page. Do not add a second embed without asking.

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
  - `images/league-challenge.png`, `images/league-cup.png` — the official marks
    for the two sanctioned events, supplied by the organiser. Quantised to a
    64-colour palette: they are flat logo art, and RGBA cost five times as much
    for a picture with no gradients in it.
  - `images/worlds.png` — the World Championships mark. It was the single mark
    for every premier event and is now the fallback for one that is neither a
    Cup nor a Challenge. Still here on purpose.
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
- Professor notes
- Pre-registration lists — who registered for an event is never public

**Contact used to be on that list and no longer is.** A player may now ask for
their Discord handle to be published, and a professor may grant it. This was a
deliberate change, made knowingly. What keeps it safe is the shape of it, so do
not loosen any of these:

- `show_contact` defaults **false** for everybody and never defaults true. The
  age-based default that `show_player_id` has does not exist here.
- It is set only through `set_player_visibility()`, so every change writes a
  `consent_log` row naming who recorded it and on whose say-so. A minor needs
  guardian consent, as for any other flag.
- Public means `show_contact` **and** `id_visible()`. A contact detail cannot
  outlive the consent that published it, and it lapses with the three-month
  attendance rule like everything else. `expire_stale_consent()` clears it —
  that is the part worth checking if either is ever rewritten.
- `get_player_summary()` is what decides. It returns `contact` as null to
  anybody who may not see it, so no page ever reasons about this itself.

These are visible only to a signed-in professor. Division and birth year are
stored and used for logic (registration caps, minor status) but never rendered.

### Player identity is consent-gated

The site shows **Player IDs only** by default, and names never by default.
Two independent switches, both professor-controlled:

| Switch | Adult default | Minor default |
|---|---|---|
| Player ID visible | Yes | **No** |
| Name visible (first name + last initial) | **No** | **No** |
| Contact visible (Discord handle) | **No** | **No** |

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

### Photographs

A photograph is the one thing on this site that shows a child's face, and the
consent model above cannot help with it: there is no flag on a picture and no
way to tell from the file who is in it. A person decides, every time.

- **Nothing is visible until a professor approves it**, and that is enforced in
  the database, not the page. The `gallery` bucket is **private** — unlike
  `badge-art` there is no public URL — so a file can only be fetched through a
  signed URL, and anon may only sign an object an approved row points at. A
  photograph waiting for review is unreadable even to somebody holding its exact
  path.
- **A published photograph carries no identity.** No name, no Player ID, no
  division, no date beyond the day it was sent. The submitter is recorded so a
  professor knows who to ask, and `approved_gallery()` does not return that
  column.
- **The caption is the leak.** It is the one place a submitter can type a child's
  name onto a public page, so a professor can rewrite or clear it before
  approving, and the form asks people not to put names in it.
- **Taking one down is the same action as turning one down.** A parent changing
  their mind is the likeliest request this will ever get, and it must not be a
  different button somewhere else. Both delete the files and keep the row.
- **Camera and location data never reach the server.** A phone photograph
  carries EXIF, very often including the GPS coordinates of the room. The page
  resizes and re-encodes to a canvas before uploading, which keeps the pixels
  and nothing else — the stripping is a consequence of resizing rather than a
  step that can be forgotten.

### Implementation rules

- **Row Level Security is row-level, not column-level.** Hiding a column requires
  a view or column grants, not a policy.
- The anon key gets **no direct SELECT** on `players`, `registrations`,
  `attendance`, `loyalty_results`, or `consent_log`.
- Every public-facing surface gets its display string from `display_label()`.
  Never assemble a name from columns in page code.
- **Never decide whether somebody is public by reading `show_player_id`.** The
  flag is three-valued and it is only half the rule: null means "use the
  age-based default", which for an adult is **yes**, and visibility also lapses
  without attendance in the last three months. `id_visible()` is the only thing
  that knows, and `public_players` is that function applied to everybody — a
  professor screen asking "is this player listed" should test membership of that
  view. The players page read the flag directly and got it wrong both ways: every
  consenting adult who had never been toggled by hand showed as "not public"
  while appearing correctly on the public list, and a recorded consent whose
  attendance had gone stale showed as public when it was no longer in force.

### Players can ask

`players.html` carries a form under a looked-up card: ask to be listed, ask to
be taken off again, or record a Pokémon TCG Live name. It writes a
`visibility_requests` row and **changes nothing**. A professor reads it at the
top of `admin/consent.html` and decides, and the decision goes through
`set_player_visibility()` like every other flag change.

- **Both directions, one place.** A form that only ever added visibility would
  put the easy half on the website and leave the half somebody might feel
  awkward about to a conversation at a desk.
- **Untouched means "leave it alone".** Each switch is three-state. A form that
  sent false for everything nobody ticked would read as a request to be hidden
  from somebody who only wanted to add a TCG Live name.
- **Player ID and first name together**, the same proof a drop request and a
  gallery submission ask for, with **one refusal covering both** — telling a
  wrong ID from a wrong name apart would make this a way to test which Player
  IDs exist.
- **One pending request per player.** A second submission updates the first, so
  correcting a typo does not leave a professor two rows to reconcile.
- **The review row says whether the player is under 18**, because guardian
  consent is the rule for a child and the screen should not make a professor go
  and look it up before deciding. The "who agreed" field starts on *guardian*
  for a minor.

**A TCG Live name is not a contact.** `ptcg_live` is a game handle and is public
wherever the player is already public — no flag of its own. It is not a way to
message somebody, which is the whole reason contact needs one and this does not.

When in doubt about whether something can be shown publicly: it cannot.

---

## Security

- Client code uses the **anon key only**. It is public by design.
- The **`service_role` key must never** appear in any file in this repo, in
  client code, or in an example. If a task seems to need it, stop and ask.
- `.env` and `.env.local` are gitignored. Never commit them.
- **Every table gets RLS enabled and at least one policy in the same migration
  that creates it.** A table without a policy is a bug.
- Public write access exists only for event registration, drop requests and
  gallery submissions. Everything else requires an authenticated professor.
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
- **The loyalty box on the programs page carries a print link, for a signed-in
  professor.** It points at `admin/print.html?release=<id>` for the release the
  page is already describing, so the sheet is not the printable lists screen
  plus the same release picked out of a dropdown a second time. `print.js`
  accepts that parameter the way it already accepted `?event=`, and ignores an
  id that is not in its list. Same posture as every other professor-only thing
  on a public page: it decides what to **show**, and row level security is what
  refuses the data.
- **The same two links are on the public schedule, for a signed-in professor.**
  A professor arriving at league opens the schedule like everybody else, and
  that is the page with the event they want on it. The pair lives in
  `supabase-client.js` beside `playerLinks()` and takes a `prefix`, because the
  schedule sits at the root and the events screen inside `admin/`; two copies
  would drift. Like every other professor-only thing on a public page, this
  decides what to **show** and not what is allowed -- the admin pages are static
  files anyone can fetch, and row level security is what refuses the data. On
  the schedule the links are simply absent for an event that takes no
  registration; the explainer that says to turn registration on belongs on the
  screen where that is one checkbox away.
- **Picking a kind of event fills in what that kind always needs.** A League
  Cup or Challenge ticks premier and registration and fills the division caps
  with 56 / 16 / 16 / 32; a Prerelease ticks registration and **clears**
  capacity, because its limit is however many kits the store has and no default
  can guess it. Clearing rather than leaving it matters: a Prerelease quietly
  keeping a Cup's 56 would publish a limit nobody chose. League, casual and
  special have no preset and nothing is touched.
- **Only on the create form.** On an existing event this would silently turn
  registration on for something that already has places and a waiting list, and
  changing a kind is not the same as deciding to take registration. `TYPE_PRESETS`
  in `admin/events.js`, applied on the type dropdown's change event when `isNew`.
  Like the point values on the upload screen, they are defaults a professor
  edits, not rules.
- **An event can be copied from one that already exists.** Most weeks are last
  week again, and everything that makes an event -- the name, the kind, the fee,
  the capacity, whether it is premier -- is the same. The picker sits above the
  create form and reseeds it; `eventForm()` already keys on `!event.id`, so a
  prefilled object with no id is a create form and needed no second form.
- **The flight PIN is never copied.** This is the trap the rest of the feature
  is built around. A PIN is what puts events in one group, and a copy carrying
  it would quietly join the group it came from -- where a player already holding
  a confirmed place would then be refused a place on the new event, for a reason
  nothing on screen explains. A second flight is made by typing the PIN in,
  which is a decision rather than a leftover.
- **The date moves, the time of day does not.** A copy is dated to the next
  Sunday at the hour the original ran, so a 5pm prerelease stays at 5pm. The
  date is the first thing a professor will change and the field is right there,
  so a sensible guess beats an empty box.
- **A copied desk time counts as chosen only when it was not the default.** If
  `registration_opens_at` was half an hour before the start, it stays following
  the start time; if it was deliberately set to something else, it sticks when
  the date is moved. Carrying the value without this distinction would freeze
  every copied event's desk time, including the ones that never wanted one.
- **Capacity comes across**, because it is the tedious half of a Cup and the
  half most likely to be forgotten. Only where the source took registration: a
  cap on an event that refuses registration caps nothing.
- **An event carries two times, and they mean different things.** `starts_at` is
  when play starts and is what every rule keys on: the registration cutoff, the
  division calculation, the drop screen, the printable list.
  `registration_opens_at` is when the desk opens on the day, and it is
  **displayed and nothing else** — it does not gate `register_for_event()`.
  Every event in the table was once entered half an hour early because the desk
  time was the number a professor had in front of them, and the schedule printed
  it as the event time; `20261014120000_registration_opens.sql` moved every
  stored instant into the new column and put play half an hour later. The admin
  form asks for a time rather than a datetime and composes the date from the
  event, so the two cannot end up on different days, and the default start is
  2:30 rather than 2:00 — prefilling the desk time is how this happened in the
  first place.
- **The large figure on a card is when to arrive, not when play starts.** It
  shows `registration_opens_at`, falling back to `starts_at` for an event with
  no desk time. The card used to lead with the start time and put the desk time
  in small print underneath: accurate, and still read as "turn up at half past",
  because the big number is the one people take away. That is the failure this
  is built around — a player arriving at 2:30 has missed registration.
- **The line underneath carries both times in one sentence**, "Registration
  opens at 2:00 PM and the event begins at 2:30 PM." Neither time appears
  without the other, so neither can be read alone and acted on wrongly. It was
  briefly worded as "sign-in" to avoid colliding with the register form on the
  same card; naming both times is what actually resolves that, and the sentence
  is now the same on the schedule, the event page and the home page.
- **This is display only.** `starts_at` is still when play starts and still what
  every rule keys on, and the admin form still asks for the two times exactly as
  it did. Nothing about the data changed when the wording did.
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

## Staff scheduling

`admin/staff.html` is the two sheets the league was keeping by hand: who can
make each event, and who is doing what once they can. Professor-only, like the
printable lists and the attendance history.

- **`staff` is a roster, not an authorization table.** No policy consults it,
  and this is the line to hold. `professors` is what `is_professor()` checks,
  and its primary key is `user_id` -- a row there cannot exist without a login,
  which is why the roster had to be a separate table rather than a few columns
  added to that one. Half the people on the sheet have never had an account: a
  volunteer who floor-judges twice a year does not need one, and giving them one
  to get their name onto a rota would hand out read access to every child's full
  name and birth year to solve a scheduling problem. **Adding somebody to the
  roster grants them nothing**, and the screen says so where the button is.
- **`staff` or `volunteer`, and the difference is twofold.** Staff are asked
  for availability and are offered in the judges list when a TDF is uploaded; a
  volunteer is neither, and is put on an event by hand. Eight weeks of empty
  cells for somebody who helps when they happen to be free is eight weeks of
  nobody waiting on an answer, and it drags the present figure down for no
  reason. `loadJudges()` reads `staff` rather than `professors` for the same
  reason the grid does -- the two lists had always been assumed to be the same
  one and never were.
- **Everybody on the roster is also a player**, and the screen has two doors to
  make sure of it: *they are already a player*, which is the ordinary player
  lookup and puts them straight on the roster, and *they are not a player yet*,
  which creates the player record and the roster row together. There is
  deliberately no third door marked "no player record" -- a judge earns a
  loyalty week and an attendance point like anybody else, and that award needs
  a Player ID to land on.
- **The only rows without a `player_id` come from the seed**, where a professor
  had no player record of their own. The roster marks those rather than hiding
  them, because somebody with no ID cannot be ticked as a judge and the reason
  should be visible where it can be fixed, not discovered as a missing name on
  the upload screen.
- **The player is written before the roster row.** The other way round leaves a
  roster row pointing at a player that does not exist. A Player ID that already
  belongs to somebody is refused as a typo rather than created, and `player_id`
  is unique on `staff`, so a second roster row for one person is refused by the
  table rather than by a check in page code.
- **Availability is keyed on a DATE, not an event.** The question is "can you
  make Sunday the 25th", and it is worth asking eight weeks out -- long before
  anybody has created the events those Sundays will hold. Keyed on an event the
  grid could only ever show the weeks somebody had already filled in, which is
  backwards: knowing who is free is how you decide what to put on. The sheet had
  this right, and its Event column was a description of the day rather than the
  key to it. `event_staffing` still keys on an event, because you cannot staff a
  day that has nothing on it.
- **The Sundays are generated, not stored.** The grid draws the next eight
  whether or not anything exists for them. Generating them means no list to keep
  topped up and no week that silently stops appearing because a backfill ran
  out. `availability_dates` holds only the exceptions -- a midweek prerelease, a
  holiday Saturday -- and those rows are marked on the grid, because the eye
  stops expecting anything but a Sunday in a column of them.
- **A Sunday with nothing on it says so** rather than being left out. The day is
  real; what is on it is not decided, and that is exactly the week somebody
  needs to see.
- **An added day can be removed only while removing it does something** --
  nobody has answered for it, and no event has appeared on it. A day with
  answers keeps its row because the answers are about that day; a day with an
  event keeps its row whatever that table says, so offering to remove it is an
  offer to do nothing.
- **Four states, not two.** `available`, `out`, `playing`, `unsure`. `playing`
  is the one worth keeping: somebody entered in the side event is in the room
  and is not a judge, and folding that into `out` would have a professor ringing
  round for a body who is standing ten feet away. It does not count toward the
  number present, which is what the sheet already did.
- **No row means nobody has been asked**, which is not `unsure`. One is a person
  who has not been asked; the other has been asked and does not know. Clearing a
  cell deletes the row rather than storing an empty status.
- **The present count leads the table**, before the names. A table with a column
  per person is wide by nature, and a summary at the far right is the first
  thing off the side of a phone -- the same mistake the attendance table made
  with Total.
- **The person columns are deliberately narrow.** The grid is as wide as the
  roster, so every extra millimetre is one fewer person on screen before it
  starts scrolling. "Not asked" is the longest thing a cell ever says and the
  column is sized for it; the day column keeps its room, because it carries two
  lines.
- **Upcoming is editable and past is read only.** A rota is a plan, and it stops
  being one once the day has happened; what is left is a record, and a record
  with a dropdown on it invites somebody to tidy history. It also keeps the grid
  down to the events anybody is deciding about rather than two years of selects.
- **Retired, never deleted.** A past event's staffing still points at the row,
  and a retired member keeps their name on it while leaving the availability
  grid. The active-name unique index is partial for this reason.
- **Either a roster member or a one-off name, never both.** `event_staffing`
  checks it. The guest is the point: the sheet has people in it who helped once,
  and adding them to the roster to write them down would make the roster a list
  of everybody who has ever held a pen. A guest chip is drawn dashed, because
  the difference matters when deciding who to ask next time.
- **Being down for two jobs at one event is a warning, not a refusal.** It is
  usually a mistake and occasionally a small league. The same person twice in
  the *same* job is a duplicate and the index refuses it.
- **"Also on elsewhere" is its own table, not a column on `events`.** It is a
  professor-only working note, and `events` is publicly readable -- a column
  there would be one `select *` away from being on the schedule.
- **Who last touched a row is stamped by a trigger**, and the grants are per
  column, so a browser cannot write `updated_by`. Same arrangement as
  `league_day_notes`.
- The history is only events created through the site. The two years in the
  spreadsheet were not imported: those events were never in `events`, and
  inventing them to hang a rota on would put fiction in the events table.

## Rentable resources

The section at the foot of `league_programs.html`, filled by `rentals.js`, and
`admin/rentals.html` behind it. Four tables, all of them public: there is no
personal data in a catalogue of what is on a shelf.

- **The Current chip is silver, not gold.** Once a professor could choose a
  tag's colour, gold stopped being available to the status: a gold Current beside
  a gold Regional winner is two pills that look the same and mean different
  kinds of thing. Silver also stays clear of the warm pale grey Needs updating
  wears, so the two statuses read apart at a glance.
- **Status is not a tag.** `rental_decks.status` is a column with a check,
  because exactly one of *current* and *needs updating* is true at a time and a
  deck wearing both would tell a player two different things. Everything else is
  a tag, because a deck can be several of those at once.
- **The tag vocabulary is a table, not an enum.** The point is that a professor
  adds one without a migration. Tags retire rather than delete, so a deck that
  wore one keeps its history.
- **A tag carries its own colour**, and null is the quiet grey most tags should
  stay. The colours were first a map in page code keyed on the label, which only
  works for tags somebody already thought of: rename one and it went grey,
  invent one and it could not have a colour at all.
- **The text colour is computed, never stored.** `readableOn()` picks white or
  ink by WCAG contrast against the chosen background, so any valid hex renders
  readably — including one set straight through the API, past the swatches. The
  database checks the shape of the value and nothing else, because a database
  cannot judge contrast.
- **The screen offers swatches, not a colour wheel.** Each was checked against
  both white and ink and clears 4.5:1 with whichever the page picks. A wheel
  would let somebody land on a washed-out pill, and a short list is faster to
  choose from anyway.
- **Both formats always render**, even empty. A missing Standard list and an
  empty one look identical on a page and mean different things.
- **`claimed_note` is the duplicate guard**, and it is public for that reason:
  somebody about to spend money on cards needs to see that a bounty is spoken
  for *before* they do, not in a professor's notes.
- **Decks and bounties retire, never delete**, like every other reference row
  here.
- **Donating a deck has earning actions** — 10 points, or 20 from the bounty
  list. They are rows in `earning_actions` rather than a number written into
  copy, so the points screen can actually award what the page promises and a
  professor can override the amount like any other.
- The shelf comes from `rental_deck_shelf()` so tags arrive on the deck rather
  than as rows to regroup; a list of decks should not cost one request per deck.

## Chaos Cup

`chaos-cup.html` explains what a Chaos Cup is and shows six example rules.
Static HTML with no module and no database call, like the Resources page.

- **The caveat is the loudest thing on the page**, directly under the lede and
  before anything else. Somebody reading it is deciding what to bring, and the
  honest answer to "what are the rules" is "not these ones" — every Chaos Cup
  has its own set written for that day. A footnote at the bottom would be read
  by nobody who needed it.
- **The tone is part of the format.** The page says a Chaos Cup is meant to be
  silly, and that the answer to a confusing rule is to work it out with your
  opponent and play it the way both of you find most fun. It deliberately does
  not say "ask a judge if you are confused" — that is the right instruction for
  a League Cup and the wrong one here.
- **An event named Chaos Cup links to this page**, from the schedule and from
  its own event page. Matched on the name rather than a column: there is no
  event type for it, the events are already named that, and a new type would
  only light up on events typed again from scratch. A Chaos Cup called something
  else entirely wants a real flag on the event, not a cleverer match.
- **Six examples, not the rulebook.** There are dozens, they change every event,
  and a page that tried to list them all would be a page that goes out of date
  and gets believed anyway.
- **A Standard legal deck is the whole requirement**, and the page says so
  twice: in the lede and in the first point of how a day runs. It is the one
  question somebody has before coming.
- **No two Chaos Cups work the same way**, and the page says that rather than
  describing one of them as though it were the format. Rules may be swapped out
  between rounds or built up across them; they may be drawn at random, put to a
  vote, or chosen by the professors; a set may be themed to a holiday. The page
  used to assert that rules never carry over, which was true of the one document
  it was written from and not of the format.
- **The rule text is the organiser's own**, from their Chaos Cup documents. It
  is not lifted from anywhere else: the rule against copying from official
  sources applies here as everywhere.
- It is reached from League programs rather than the top nav. A Chaos Cup is an
  event format rather than an ongoing programme, and the nav order was settled
  separately.

## The league charter

`charter.html` carries the mission and the values, taken from the charter draft.

- **It is not published yet.** The draft is unfinished, so the page renders for
  a signed-in professor and everybody else gets a short note. The nav item wears
  `nav-prof`, hidden until `mountProfessorBar()` puts `has-prof-bar` on the body
  — the one signal every public page already shares. Like everything `auth.js`
  governs this decides what to **show**: the file is fetchable and the text is
  in it, which is fine, because the charter is unfinished rather than secret.
  Publishing it is deleting the gate in `charter.js` and the class on the nav
  item.
- **Values are the words alone.** The draft has a one-line definition beside
  each, still being worded. Half-written definitions on a page about how to
  treat each other would be worse than the words by themselves. The card is
  already the right shape to hold one underneath.
- **Responsibilities are not here.** That section of the draft says TODO.
- **The league is LoCo League in the mission statement**, as everywhere else.
  The draft calls it by the venue's name, which is the room rather than the
  league.

## What is on next

The banner at the top of the home page, filled by `home-events.js`. Two
questions a visitor lands with — is there league this Sunday, and is there
anything to sign up for — and the schedule answers both at the cost of a tap
that somebody checking on a Saturday night should not have to take.

- **It shows strictly less than the schedule.** No description, no entry fee, no
  places left. A banner that repeats the schedule is a second schedule to keep
  in step with the first.
- **The next day is the soonest day with anything on it**, not the next Sunday.
  A Saturday prerelease is still the next thing happening, and a banner that
  skipped it would be wrong on the weekend it mattered most. The heading prints
  the date rather than saying "this Sunday", which is ambiguous in a way a date
  is not.
- **The second list is what can still be signed up for, further out.** Events on
  the next day are left out of it because they are already above with their own
  link.
- **No type chip.** Every event this league runs is named for its type — "TCG
  League Cup", "Delta Reign Prerelease" — so the chip repeated the name back and
  pushed the sign-up link onto a second line on a phone.
- **A link only where there is something to do.** An event that takes no
  registration has a page, but sending somebody to it to read "just turn up" is
  a tap that gives nothing back.
- **It fails quietly.** A summary of a page that still works does not get a red
  box across the top of the home page; it gets one line and a link to the
  schedule. Every state keeps the heading, because the section is labelled by
  its id and dropping it would leave `aria-labelledby` pointing at nothing.
- **An event stays listed until play starts**, not until the desk opens, so
  somebody reading at ten past can still see that they can walk in.

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

## The gallery

`gallery.html` shows approved photographs newest first and carries the form that
sends one in. `admin/gallery-review.html` is where they are approved. The
privacy rules are above, under **Photographs**; these are the mechanics.

- **Two renditions per photograph**, 1600px and 480px, both JPEG, both made in
  the browser by `image-file.js`. A grid of thumbnails on store wifi must not be
  twenty full-size pictures, and a 480px thumbnail is not enough for a professor
  to see who is in a picture, so the review screen can open the full one.
- **The decoded size is what is guarded, not the file size.** A JPEG is
  compressed, so bytes say almost nothing about what it costs to open: a 200KB
  file can decode to 8000 by 8000 and ask for half a gigabyte. The check is on
  `naturalWidth * naturalHeight`, after `decode()` and before any canvas exists.
  It lives in `image-file.js` and there is **one copy of it**, which is why that
  module is shared with the prize wall rather than copied for it.
- **That limit guards against a crafted file, not against a camera**, so it has
  to sit above every phone anybody will arrive with. It was first set at 24MP,
  which refused a current iPhone's default 5712 by 4284 on the first test: the
  guard caught the most ordinary photograph there is and nothing else. 60MP
  clears a 50MP phone at full resolution and still refuses an 8000 by 8000
  square. Test a change to it against a real phone photograph, not against
  arithmetic.
- **A submission is not anonymous.** Player ID and first name together, the same
  proof a drop request asks for, and **one refusal covers both** a wrong ID and
  a wrong name — telling them apart would make the form a way to test which
  Player IDs exist.
- **The files are uploaded before the row is written.** Either order strands
  something when the other half fails, and this is the half that fails
  harmlessly: two objects nothing points at, in a bucket nothing lists. The
  other way round puts a photograph with no picture into a professor's queue,
  which costs a person's time rather than a few kilobytes.
- **Anybody can put a file in the bucket.** The insert policy checks the path
  shape and nothing else, so somebody could upload and never create a row. The
  size limit and the one-item mime list keep that to disk rather than to the
  page, and an orphan is invisible because every screen reads rows. This is the
  same trade registration made: detection beats prevention when prevention means
  refusing real people.
- **Ordering is by when it was sent, not when it was approved.** A professor
  clearing a backlog in one sitting should not scramble a Sunday into whatever
  order they happened to click.
- **Paging is keyset on `(submitted_at, id)`**, not an offset, so a photograph
  approved while somebody is part way down the page cannot shift the rest and
  show one of them twice.

## Resources

`admin/resources.html` is the outside links professors reach for most, grouped
by when they are reached for: the rules, running a league day, and the professor
programme. It is static HTML with no module and no database call, because it is
a list of links to other people's websites.

- **It does not gate on sign-in.** There is nothing to sign in for. The other
  tools gate because they read data, not because of the folder they live in, and
  a gate here would be theatre.
- **Every card says where it goes**, as the bare host under the description. The
  whole page is somebody else's website, and a professor about to tap one should
  be able to see which one without a status bar, which a phone does not have.
  The one that is a file says `PDF` as well.
- **The page says which links are official and which are not.** The pokemon.com
  ones are; a timer, a raffle wheel and a community forum are not. Listing them
  together without saying so would imply an endorsement nobody gave, which is
  the same rule as everywhere else here.
- **Descriptions are written here, not copied.** Nothing on this page is lifted
  from an official source.
- Official documents move. The page says so, and points at the rules hub as the
  way to find where one went, rather than leaving a dead link looking like a
  mistake in this site.

## Printing

Printable outputs are **print stylesheets**, not generated files. Use
`@media print`. Do not add jsPDF, pdfmake, or any PDF library.

Two printable views are needed: loyalty tier lists for the store, and
pre-registration lists for the professor desk. **Neither is public, and both are
professor-only pages.** Printed lists may show full names because they are handed
to the store or used at the desk — this is a disclosure to the venue, not
publication. Nothing printed is ever rendered on a public page.

### The Trainer Card Creator

`admin/trainer-cards.html` prints membership cards, eight to a Letter page. The
same rule applies: a print stylesheet, and the browser's own Save as PDF is what
makes the file.

- **The measurements come from the supplied template, not from taste.** A page
  is 612 by 792pt, a card is 251.97 by 158.70pt, the columns start at 35.74pt
  and 319.43pt and the rows repeat every 181.3pt. The three field positions are
  measured off the artwork itself — every box is 10.03% tall and starts 27.54%
  across. Changing the artwork means re-measuring it, not nudging numbers until
  it looks right.
- **Two seasons, and they are deliberately different.** The rank and the badges
  come from the season that has been *played*; the print record is filed under
  the season the card is *issued for*. They are the two constants at the top of
  `trainer-cards.js`, and every database function takes both as parameters so
  the pairing stays visible rather than buried.
- **A card is the one place a full name and a birth year appear together.** It
  is the player's own card, handed to the player. The roster that chooses who
  gets one deliberately carries **no** birth years — only `trainer_card_batch()`
  does, and only for the handful already chosen.
- **Badges are the artwork used as a mask, filled with the stored
  `tile_color`.** Nothing is sampled at print time; the colour was extracted at
  upload. A third of a field box was the first size tried and it made every
  badge vanish — the art is mostly thin limbs, and at 5.3pt a silhouette is four
  stray pixels. 8pt is the floor at which one still reads as a shape.
- **Nothing is printed inside a 9.52pt edge**, which is 6% of the card height
  and the same inset the heading block uses, so the badge run starts level with
  the two text lines. Cards are cut by hand from a sheet of eight, so the last
  millimetre of any one of them is the least reliable part of it — the first
  badge used to sit 6pt down, inside a guillotine's margin of error.
- **The two lines read "League" and then the rank**, which is the stored name
  split across them: ranks are stored as "League Ace Trainer". The card used to
  say "LoCo League" above the stripped rank, which repeated the word.
- **They ride the inside edge of the white circle, top to bottom.** The circle
  is measured off the artwork rather than eyeballed: fitting its left edge gives
  centre (815.8, 225.6) and radius 350.5 on the template, to within half a
  pixel. `arcPlacement()` spreads them at a comfortable pitch until they would
  reach the name box, then compresses and shrinks just enough that thirteen
  still fit without touching. The run stops above the name box because
  everything inside the circle below that line is also inside the box.
- **Several stored colours are nearly white** — Friendship is `#fefec5`,
  Community `#ffcbde` — and they now sit on a white circle. A hairline halo on
  the list keeps those readable. It belongs on the list rather than the item, or
  it outlines the square the mask was cut from instead of the silhouette.
- **The sheet escapes `main` when printing.** `main` is capped at 46rem, which
  is 552pt — narrower than the 612pt page it contains, so the browser quietly
  shrank every card to about 94% to make it fit, which still looked plausible.
  `.card-print main` drops the cap and the padding. Scoped to that class so the
  loyalty and registration sheets keep theirs.
- **The page box is a NAMED page**, `@page trainer-cards`. A bare `@page` with
  no margin would strip the margins off every other printable page too.
- **A Champion gets a gold star**, on the white below the gold band and in from
  the right edge, about a fifth taller than a field box and dropped by its own
  height so it sits clear of the band. It is drawn as an SVG polygon rather than typed
  as a star glyph: there are no web fonts here, so a glyph would be whatever
  shape the reading font happens to carry. The gold is `#b99d2c`, sampled from
  the band itself. Its shadow is a `drop-shadow`, which follows the polygon,
  rather than a `box-shadow`, which would outline the square the star is drawn
  in — and it is **darker than the two text lines use**, because those sit on
  the grey building while the star sits on white, where the same alpha washes
  out. Sampling the artwork's own label shadow gives an average of (86, 83, 72);
  0.65 black over white renders (89, 89, 89), which is that, measured rather
  than guessed.
- **Champion is found from `requires_elite_four`, not from the word.** The flag
  is a column on `trainer_card_ranks`; matching the name would break the star
  the day somebody rewords the ladder.
- **A url() inside a CSS custom property resolves against the stylesheet, not
  the page.** `styles.css` is at the root, so a badge path written `../images/`
  for an admin page resolved above the site and 404ed silently, leaving every
  silhouette blank with nothing in the console. The path is made absolute in
  page code before it is handed to CSS.
- **A card counts as printed when the dialog opens**, because nothing tells a
  page whether the print went ahead. Assuming the opposite is worse: it hands
  out duplicates. The screen says so plainly.
- **The undo is the other half of that bargain.** "The cards did not print"
  voids the run that was just made, and everybody on it goes back on the list.
  It appears only once cards exist and withdraws the moment the list changes —
  an undo offer that outlives the run it belongs to is a trap.
- **A print run has an id.** `trainer_card_prints.batch_id` is one uuid per
  press of Create the cards, and the undo names it. Voiding by player and season
  instead would catch whatever is newest for those players, which is usually the
  right row and occasionally is not: two professors on one league day, or a
  reprint for somebody who was missed.
- **Voiding is a function, not a grant.** `void_trainer_card_batch()` is
  `SECURITY DEFINER` and touches three columns of one run. An `UPDATE` grant on
  the table would let any signed-in professor write any column of any row from a
  browser.
- **Rows are voided, never removed**, here as everywhere else. The press of the
  button did happen; it just did not produce a card.
- **The counts on the two source buttons are live.** They were drawn once at
  startup, which left them stale from the first print onward — the figure on
  "no card yet" is the whole reason that button exists.

---

## File layout

```
index.html          league overview, meeting time, how to join
schedule.html       upcoming events
event.html          one event, by ?e=<id>, for a link that can be posted
prizes.html         prize wall catalog
players.html        player lookup by Player ID
gallery.html        approved photographs, and the form that sends one in
charter.html        the mission and values, professor-only until the draft lands
chaos-cup.html      what a Chaos Cup is, and example rules
rentals.js          the rental shelf and bounty list on the programs page
home-events.js      the what-is-on-next banner at the top of the home page
admin/              professor-only pages
admin/staff.html    the staffing roster, availability and event staffing
data/source/*.csv   spreadsheet exports used to seed reference tables
event-registration.js  the register and cancel forms, shared by both pages
image-file.js       resizing, re-encoding and the decoded-size guard
gallery-store.js    the gallery bucket and its signed URLs
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

The tools menu is **four collapsed sections**, not a list. Sixteen tools in one
column had stopped being a menu and become something to read; grouped by what a
professor came here to do, the page is four choices and everything else is one
click away.

**A queue that is waiting for a person carries a count**, on the tool card and
on the section holding it. The second one is the point: collapsing a section
hides what is inside it, and something waiting for attention has to survive
that. The counts are head requests rather than rows — the number is the whole
of what the page wants and the rows can be hundreds. A queue that fails to load
gets **no badge rather than a zero**, because "nothing waiting" and "could not
tell" are different and the second must not look like the first.

The menu draws twice: once immediately with no badges, once when the counts
land. The menu is the point and the badges are a bonus on top of it.

`admin/attendance-history.html` reads all of it back: how many came each week,
split by played, attended and age division, and who was there on any given day.
**Total** — players plus everybody without a Player ID — leads the table, because
Players at the left with Others at the far right got read as the total, which it
is not. A day nobody counted shows `11+`, a floor rather than a number. The
division headings are `JR`, `SR` and `MA`: spelled out they are the three widest
columns on a table that already scrolls on a phone.
Both figures come from `attendance_by_day()` and
`attendance_on()` rather than from queries in page code, because the division
split needs birth years and a birth year is a protected field — a professor may
read one, but shipping several hundred to a browser to bucket them is handing out
protected data to do arithmetic SQL can do. Full names and divisions put it
behind the sign-in with the printable lists.

**Key statistics leads the page**: the last four weeks, this year, and the best
day there has ever been. All three count the room — everybody present, not only
the people holding a Player ID — and the card says so, because a day where
nobody counted the others is a floor and an average spanning one is a little low
rather than exact.

### Two eras of attendance, one shape

`attendance` holds one row per person per day and wants a Player ID on every
one. The two years before the site existed are counts with no names behind them,
so they live in **`attendance_history`** and `attendance_by_day()` reads both.
Inventing a hundred people to make them fit `attendance` would have been worse
than keeping them apart.

- **Where the two have the same Sunday, the live records win.** A day with even
  one row in `attendance` is reported from `attendance` and the imported row is
  ignored for it, so nothing a professor entered can be contradicted by a
  spreadsheet and re-importing is safe.
- The sheet's columns map on as **players played, judges attended, learn-to-play
  visitors are others**. Judging is not playing, which is already the rule for a
  judge added by hand at the upload screen.
- **An imported week has no birth years behind it**, so it reports its age split
  as unknown and the table prints `not recorded` across the three division
  columns. Three zeroes would claim no children came. This is the same rule the
  Played column already followed, arrived at from a different direction.
- **The chart gives those weeks a slate band of their own**, `#5b7a8c`,
  deliberately outside the gold ramp. They are not a fourth division; they are a
  different kind of knowledge about the room, and a fourth step on an ordinal
  ramp would have read as one more age band.
- **The chart is not capped at the width of its card.** A hundred-odd Sundays
  fitted to a card is a hairline comb nobody can read or aim at, so it keeps its
  own pitch and the wrapper scrolls — the bargain `.table-wrap` already makes.
  It lands scrolled to the newest week, which is the one somebody opened the
  page for.
- A real zero is kept. 3 November 2024 is the Sportsball watch party and nobody
  came; dropping it would quietly lift every average that spans it.

### The note on a week is the one thing this page writes

"Baltimore" is why twenty-five people came that Sunday, and without it the week
reads as a problem. `league_day_notes` is separate from the import because a
note is wanted for every Sunday and not only the imported ones, and the imported
ones are seeded into it so there is a single place to read them from.

- **Who wrote one is stamped by a trigger, not sent by the page.** An upsert
  carrying its own author is an upsert that could name somebody else, and the
  second write of a note would otherwise keep the first writer's name.
- **The grants are per column** — `insert (attended_on, note)`,
  `update (attended_on, note)` — so a browser cannot write `updated_by` even
  with a valid session. Row Level Security is row-level; this is the column half.
- **Emptying a note deletes the row.** The table holds notes that exist, and a
  week with nothing to say should not hold an empty string.
- A re-import does **not** overwrite an edited note: the seeding insert is
  `on conflict do nothing`, so a professor correcting a spelling keeps the
  correction.

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
- **That `../` has been lost once already.** A script that rewrote every nav
  decided the prefix with `path.startswith('admin/')`, and Windows glob returns
  `adminile.html` with a backslash, so the test was false for every admin page
  and all of them shipped without it. From inside `admin/` that meant four nav
  links 404ing and two silently landing on a different page — Home on the tools
  page, Players on the admin Players tool. **Derive the prefix from the file's
  depth** (`os.path.normpath(path).split(os.sep)`), never from a string test on
  a path, and check afterwards that every nav href resolves to a file on disk.
- `favicon.ico` sits at the repo root because browsers request it with no tag at
  all. It holds 16, 32 and 48 pixel versions.
- Generated from `CC-Logo-No-Text.png` by fitting the mark to the tile height at
  10% padding and reducing from 8× with Lanczos. Regenerating from a different
  picture is the way to change it; the sizes are not hand-drawn.

A premier event carries a mark in its top right corner. `is_premier` decides
**whether** there is one; `event_type` decides **which** — a League Challenge
and a League Cup are different sanctioned events with their own official marks,
so the card carries the right one rather than a stand-in for both.
`premierMark()` in `supabase-client.js` holds that mapping, because the schedule
and the event page both draw it and two copies would drift.

It is **4.2rem wide, twice what the old mark was**. These are official marks and
half of what they say is the words along the bottom; at 2.1rem LEAGUE CHALLENGE
was a smudge. They are also taller than wide, unlike the near-square mark they
replace, so the card reserves width and lets the height run. Below 26rem it
steps back to 3.2rem, where an event name still has somewhere to go.

`worlds.png` is the fallback. `is_premier` is set on exactly Cups and Challenges
today, but it is a column somebody can tick, and a premier event that is neither
should still read as one rather than quietly losing its mark.

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

### A prize wall item can carry a picture

The wall is a price list, and that is the right shape for reading down and the
wrong shape for "which booster box is that". `prize_items.image_path` is the
same arrangement as badge art: null means no picture, a path names an object in
a public bucket, and the page builds the URL with `prizeArtUrl()`.

- **The `prize-art` bucket is public**, like `badge-art` and unlike `gallery`. A
  prize picture is a photograph of a box on a shelf: nobody is in it, there is
  nothing to approve, and the page it appears on is open to everybody. Signing a
  URL per item would be work and latency bought for no privacy at all.
- **Only a professor puts one there.** A picture on the prize wall is the league
  saying what is on the wall, so unlike the gallery there is no public write.
- **The picture is at the end of the row**, the same placement the programs page
  gives a badge and for the same reason: the name and the cost are what somebody
  reads down the list for. `alt` is empty, because the name is the first cell of
  the same row and a screen reader has already read it.
- **The column only exists once something has a picture.** A column of empty
  cells on a wall nobody has photographed yet is a column of nothing.
- **The upload happens before the row is updated**, and the old object is
  deleted only once the row has stopped pointing at it. If the update fails, the
  picture that was just uploaded is deleted: nothing points at it, so it is
  litter rather than history.
- **The preview on the professor screen is bigger than the cell it is bound
  for.** The question being answered there is "is this the right box", and a
  56px square does not answer it.
- The field is on prize items and not on ways to earn. One component drives both
  lists, so that is a flag on the config rather than two components; an action is
  not a thing, and there is nothing to photograph.

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
