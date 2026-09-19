# LoCo League

Database and website for the LoCo League, a trading card game
league that meets Sundays at 2:00 PM at Continental Cards Tournament Location,
21140 Ashburn Crossing Dr #110, Ashburn, VA 20147.

Read `CLAUDE.md` before changing anything — it is constraints, not suggestions.
`docs/SCHEMA.md` is the data design for every phase.

---

## Read this first: migrations deploy themselves

The Supabase GitHub integration is enabled. **A migration file merged to `main` is
applied to the production database immediately. There is no confirmation step.**

- Review migration SQL **before it is committed**, not before it is deployed.
- Never edit a migration that has already been pushed. Write a new one.
- Never commit a migration that is a work in progress.

### Validating a migration before you commit it

Paste the file into the Supabase SQL Editor wrapped in a transaction:

```sql
begin;

-- paste the whole migration here

rollback;
```

Postgres runs all of it, then throws it away. A syntax error, a bad constraint or
a policy that cannot be created surfaces with a line number, and nothing persists.

Do **not** swap `rollback` for `commit` to apply it by hand. Supabase records
applied migrations in `supabase_migrations.schema_migrations`, and a manual run
does not update that table — so the next push would try to create the same objects
again and fail. Let the integration apply it.

---

## Build phases

Schema comes before pages. Building UI against mocked data means rebuilding it
against real functions and policies later. All seven phases are built.

| Phase | Work | State |
|---|---|---|
| 1 | Reference tables: `earning_actions`, `prize_items`, `releases`, `loyalty_tiers` | done |
| 2 | People and consent: `players`, `professors`, `consent_log`, visibility helpers | done |
| 3 | Points and attendance: `attendance`, `point_ledger`, consent expiry | done |
| 4 | Events and registration | done |
| 5 | Public pages, built against the real tables | done |
| 6 | Professor screens, including TDF upload | done |
| 7 | Printable lists for the store and the desk | done |

Running alongside phase 1: a minimal static shell on GitHub Pages — one page and a
nav — to prove the deploy chain works while nothing is at stake. It does not grow
into the full site before phase 5.

Full detail, including the consent model, is in `CLAUDE.md`.

---

## Layout

```
CLAUDE.md             project rules
docs/SCHEMA.md        data design, all phases
supabase/migrations/  schema, one file per phase. Applied on push to main.
data/source/          spreadsheet exports. Mostly gitignored; see below.
```

---

## data/source/

Two files are committed, because they hold no personal data and are the provenance
for what phase 1 seeds into the database:

- `earning-actions.csv` — ways to earn prize points, with an `is_active` column
- `prize-items.csv` — the prize wall price list

**Everything else in that folder is gitignored, deliberately.** The player exports
identify real people, most of them children, and this repository is public. The
rule is deny-by-default: a new export dropped in there is ignored unless it is
explicitly allowed, so a file is never exposed by an oversight.

That applies even after names are stripped. A Player ID on its own still identifies
a person, and the consent model treats it as gated — hidden by default for minors,
revocable, and dependent on recent attendance. Git history is permanent and cannot
be revoked, so ID-only exports stay out as well.

Keep those files backed up somewhere private. They are the only record of how the
opening balances were earned.

---

## What is built

**Phase 1** — `supabase/migrations/20260820204116_reference_tables.sql`

Four tables, each with RLS enabled, a public `SELECT` policy, and
`INSERT`/`UPDATE`/`DELETE` restricted to professors. Seeded from the two committed
CSVs: 14 earning actions, 12 of them active, and 38 prize items. `releases` and
`loyalty_tiers` are created empty for a professor to fill.

Write policies call `public.is_professor()`, which reads a `professors` table that
phase 2 creates. The helper is `plpgsql` on purpose: its body is not resolved until
it runs, so this migration applies cleanly today, and the policies need no change
when that table arrives.

**Phase 2** — `supabase/migrations/20260911170252_people_and_consent.sql`

`players`, `professors` and `consent_log`, plus the visibility helpers and the
`public_players` view. Creating `professors` also completes phase 1 retroactively:
`is_professor()` starts returning real answers.

Two mechanisms carry the privacy model, and both are enforced by the database
rather than by discipline:

- **`anon` receives exactly one grant in the whole migration** — `select` on
  `public_players`. It has no access to `players`, `professors` or `consent_log`.
  The view works because `security_invoker` is off, so it runs as its owner and
  reads a table the caller cannot.
- **`INSERT` and `UPDATE` on `players` are both granted per column**, and the
  consent columns are in neither list. A professor cannot write
  `show_player_id` or `show_name` directly, nor set them when creating a row;
  the only route is `set_player_visibility()`, which always writes a
  `consent_log` row. RLS is row-level, so keeping a column out of reach needs a
  grant, not a policy.

`player_id` is updatable so a mis-entry can be corrected. Every foreign key
referencing it therefore uses `ON UPDATE CASCADE`, or the correction would be
refused — `professors`, `consent_log`, and all four phase 3 tables. Cascading
does not conflict with "never update a ledger row": it corrects a label that was
always wrong, and rewrites no transaction.

`consent_log` has no insert, update or delete policies at all. Rows arrive only
through that function and can never be altered.

**`public_players` returns zero rows until phase 3.** Visibility requires
attendance within three months, and `last_attendance_on()` is a stub returning
null, so the model fails closed. Phase 3 replaces that one function body; no
policy or view changes.

**Phase 3** — `supabase/migrations/20260912210720_points_and_attendance.sql`

`attendance`, `point_ledger`, `loyalty_carryover`, `loyalty_results`, the first
public RPC, and the consent expiry job.

This is the migration that switches the visibility model on. `last_attendance_on()`
stops returning null and reads `max(attended_on)` from `attendance`. Nothing else
changes — no policy, no view.

- **`point_ledger` is append only in fact**, not by convention. No `UPDATE` or
  `DELETE` policy and no `UPDATE` or `DELETE` grant exists for anyone. A mistake
  is corrected with a reversing row carrying `voids_id`.
- **`attendance` can be deleted**, deliberately unlike the ledger. A check-in
  against the wrong player is a clerical error, and leaving it would grant a
  loyalty week nobody earned.
- **`anon` gains two things only**: `get_player_summary()` and `active_release()`.
  No table access.
- **`get_player_summary()` returns null for an unknown Player ID and for a player
  without visibility**, deliberately indistinguishable, so it cannot be used to
  discover which IDs exist.

`loyalty_carryover` is a one-time bridge. The previous tracking counted weeks
without recording dates, so those weeks cannot become attendance rows. From here
weeks derive from dated attendance and nobody types a count again — the table
should never gain another row.

**`point_ledger.reason` is publicly visible** for a player whose ID visibility is
in force, because it appears in their transaction history. It is for "Bring a
friend bonus", never for anything about a person.

**Phase 4** — `supabase/migrations/20260913001725_events_and_registration.sql`

`events`, `event_capacities`, `registrations`, the `public_event_counts` view,
and the three registration functions.

**The first phase with public write.** A stranger with the anon key can now create
a registration — but only by calling `register_for_event()`. `registrations` has
no anon grant and **no INSERT policy at all**, so even a professor registers
someone through the function. A direct insert would let a caller write their own
`status` and take a confirmed spot past a full division.

- **A Player ID is required for every registration**, prereleases included. This
  departs from the earlier design, which allowed a blank ID for prereleases.
  Requiring it makes duplicate detection work everywhere and gives every
  registrant a way to drop. Someone without one goes to a help page.
- **Division is derived from the event's date, not today's.** Seasons roll over
  on 1 September, so registering in August for a September event must use the
  season the event falls in.
- **One queue per event, promotion by division.** `waitlist_position` is global
  for the event; `confirm_drop()` then promotes the first person whose division
  has room and who is not already confirmed on another flight.
- **`request_drop()` returns the same result whether or not anything matched**,
  so it cannot be used to discover which Player IDs are registered.
- **`public_event_counts` emits integers only** — capacity, confirmed, waitlist,
  per event and division. No names, no IDs, at any consent level.

### Registration abuse: detection, not prevention

Registration is deliberately open — no login, no captcha. Supabase's configurable
rate limits cover Auth endpoints only and do not apply to the Data API.

A per-address cap was written and then removed, for a concrete reason worth
remembering: **everyone on the store's wifi shares one public address.** Capping
registrations per address would turn a busy prerelease sign-up into a wall of
rejections for real players, which is a worse outcome than the abuse it prevents.

So the address is recorded and nothing is refused on the strength of it:

- `registrations.source_ip` is protected — no public grant, absent from
  `public_event_counts`, returned by no function. Safe to clear once an event has
  passed.
- **`registration_ip_activity`** shows professors any address with more than one
  registration for an event, with first and last seen. A shared address is
  normal; a professor decides whether twelve from one address is a family, a
  scout troop, or a script.
- **`event_registration_summary`** gives the counts a professor sees on logging
  in: confirmed, waitlisted, and drops awaiting confirmation, per event.

Both professor views use `security_invoker = true`, the opposite of
`public_event_counts`. RLS on `registrations` therefore applies, so a signed-in
non-professor sees zero rows. The public view has it off precisely so it can
count rows the caller cannot read; these two must not.

If abuse ever does appear, the better lever is a *rate* rather than a total — say
five submissions from one address within a minute, which a script trips instantly
and a room full of people never does.

**Phase 5, in progress** — the public pages.

Built so far:

| File | In the nav | Reads from |
|---|---|---|
| `index.html` | Home | nothing — static copy |
| `schedule.html` | Schedule | `events`, `public_event_counts`, `register_for_event()`, `request_drop()` |
| `league_programs.html` | League programs | `trainer_card_ranks`, `badges`, `earning_actions`, `releases`, `loyalty_tiers` |
| `prize-items.html` | no | `prize_items` |
| `players.html` | Players | `get_player_summary()`, `public_players` |
| `id_help.html` | no | nothing — static copy |

All five public pages are built.

`supabase-client.js` holds the client, league-time formatting and the DOM
helpers. Times are pinned to `America/New_York`: "2:00 PM" must mean the same
thing to every reader, wherever they are.

Nav entries for pages that do not exist yet render as `.nav-soon` spans rather
than links, so the live site never serves a 404 while the set is filled in. Swap
the span for an anchor as each page lands.

Pages are served from a project subpath, `tanner-buckets.github.io/nova-north/`,
so every internal link is relative. An absolute `/styles.css` would resolve to the
domain root and break.

### The Trainer Card Program

`trainer_card_ranks`, `badges` and `player_badges`, set up so the badge list can
change without breaking anything:

- An award references `badges.id`, never a name or a position. Rewording a badge
  changes nothing about who earned it.
- Retiring a badge sets `is_active = false`. The row stays, so a player who
  earned it keeps it.
- The number of badges a rank needs is a column, not prose and not page code. If
  the list grows and Ace Trainer should need twelve, that is an `UPDATE`.

**No rank is stored.** It derives from badges earned and league visits, plus the
one fact that cannot be counted: `players.champion_awarded_on`, set when a
professor witnesses someone beat the Elite 4.

`player_badges` has no `UPDATE` grant. An award is either right, or it is deleted
and re-recorded — editing in place would let the player or the date drift
silently.

### Badges are seasonal

Each season has its own badge list. Names may repeat year to year, and rank is
judged on the most recent season's badges.

- **The badge carries the season, not the award.** That is what makes the
  September–October overlap work: a 2026 badge earned in October 2026 still
  counts toward 2026.
- **`current_badge_season()` is the latest season present in `badges`.** Adding
  next year's list is what advances it — no flag to flip, and the autumn overlap
  needs no special case.
- **Rank is never stored, for any season.** Badges persist and carry their
  season, so 2026's rank is still derivable in 2030. A badge corrected years
  later corrects the history with it.
- **Champion is a table**, one row per season won, which is what lets a two-time
  Champion show two stars.
- **`elite_four_wins` records wins only.** A lost attempt leaves no trace and can
  be retried; rows are season-scoped, so progress resets each year.

The thirteen seeded badges are the 2025–26 list, so they belong to season 2026.
There is no 2027 list yet.

### Professor screens

Sign in at `admin/index.html` with the Supabase Auth account tied to a
`professors` row. `auth.js` decides what to *show*; it is not a security
boundary. The admin HTML is a static file anyone can fetch, so hiding a button
protects nothing — row level security refuses every professor query without a
real session, and that is what actually holds.

**The way in is a "Professor sign in" link in the footer of every public page.**
Without it the site was a closed loop: the bar below only appears once you are
signed in, and nothing pointed at the sign-in page, so the only route was knowing
the URL by heart. It is quiet, because a player has no use for it — quiet is the
whole of the intent. It is not hidden and not a secret: the admin pages are
static files anyone can fetch, an unlinked page is no safer than a linked one,
and what protects the data is row level security.

Once signed in, that link is replaced by a bar at the foot of the public pages.
Its links are contextual: the way back to the tools is everywhere, and the upload
shortcut only on the home page, where a professor lands after an event.

Building the bar is separate from deciding to show it, so it can be rendered and
looked at without a session. A thing only visible after signing in is a thing
nobody checks.

### TDF upload

`admin/upload.html` is how attendance is normally recorded, and the main way new
players enter the system. The file is parsed with `DOMParser` in the browser and
thrown away — never uploaded, never stored.

The birth year is read from the file, because it is what gives a new player a
division, and division drives registration caps and minor status. **Only the
year.** The month and day are discarded inside the parser, at the only point in
the program where they exist, so a full date of birth never reaches a variable
that could be written. An import sets a birth year only on a player it is
creating; a professor who corrected one by hand outranks a file.

Each attendee gets two things: an `attendance` row, and point ledger entries for
attending and for playing. The screen asks one question, "was this a premier
event?", which switches the play award between the casual and championship
actions. Both dropdowns stay editable, because point values are defaults a
professor may override.

Two consequences of the domain rules show up in the result message rather than as
errors:

- **A second event on the same day adds no attendance row.** The unique
  constraint on (player, date) is the one-loyalty-week-per-day rule working.
  Those players still receive the play points, because two events are two things
  played.
- **The same tournament is never paid twice.** That last rule makes a plain
  re-upload dangerous: the attendance row and the attendance point are protected
  by the constraint, but the play point is deliberately not, so uploading a file
  again would pay it a second time. Before recording, the screen asks which of
  these players already hold a ledger entry naming this tournament, warns if any
  do, and leaves them out of the play award. Their attendance still stands and
  everyone else is unaffected.

  **Detection, not refusal.** Playing in two tournaments earns two lots of points
  — only the day itself is counted once — so the professor can tick "pay them
  anyway" and override it. The check goes on the reason text, which names the
  tournament, because nothing links a ledger row to a TDF and there is no
  tournament identifier stored anywhere. Two flights exported under one name look
  identical to it, which is exactly the case the override exists for. If the
  check itself fails, nothing is recorded: recording without it could pay
  somebody twice.
- **A player in the file who is not in `players` yet is created on the spot**,
  with the birth year from the file. One whose date of birth is missing or
  unreadable gets a null year and counts as a minor until a professor records
  one. Either way they stay hidden — appearing in a tournament file is not
  consent, and nothing in this path touches a visibility flag.

Anyone who turned up but is missing from the file is added by hand, by Player ID
or by searching for the ID by name. **They earn the day and the attendance point,
not the play point.** A tournament file is the claim that somebody played; being
remembered at the desk is not, and that step exists for people who came along
without entering. Somebody who did play but is missing from the file is the rare
case, and the points screen is where that one point goes.

Attendance and points are two statements, not one transaction. A failure between
them leaves attendance written and points not, which the error message says
plainly so the ledger can be checked before a retry. Moving both into one
`SECURITY DEFINER` function is the fix when it is worth the migration.

### Manual attendance

`admin/attendance.html`, for a day the file will not export and for a player who
comes along before they ever enter a tournament. The write is shared with the
upload in `admin/attendance-core.js`; duplicating it would let the two drift, and
the one that drifted would be the rarely used one, discovered only when
somebody's points were wrong.

**It records turning up and nothing else: one point and one loyalty week.** No
play award, because nothing here claims a tournament was played — a tournament
file *is* that claim, which is why the upload adds the play point and this screen
does not. The award is stated rather than offered as a dropdown, so the screen
cannot be talked into paying for something else. Everything else a player earns
or spends goes through the points screen, where it can be described and reversed.

It does create players. Somebody often turns up for a few Sundays before their
first event, and those Sundays count. Nothing is written when they are typed in:
the new player joins the pending list and is created when the attendance is
recorded, so an abandoned form leaves nothing behind. A typed ID that already
belongs to somebody is refused as a typo rather than accepted as a new person.

The date defaults to today in league time, not the browser's, so a professor
entering Sunday's attendance from a laptop set to another zone still gets Sunday.

### Points

`admin/points.html`. Everything a player earns beyond turning up, and everything
they spend at the prize wall.

Append only, and not by convention: professors hold `INSERT` on `point_ledger`
and no `UPDATE` or `DELETE` at all, with no policy for either, so a row cannot be
altered or removed through the API. A mistake is corrected by writing a reversing
entry that points at the original with `voids_id`. Both stay visible, which is
the point — a balance nobody can quietly rewrite is worth more than a tidy one.
An entry that has already been reversed cannot be reversed again, or the
correction would cancel the correction and the balance would drift back.

Balance is the sum of the deltas. There is no total column and there must never
be one.

Spending is a negative delta carrying `prize_item_id`, so it is a transaction
like any other. A spend that would take somebody below zero is **warned about,
not blocked** — a professor may knowingly hand something over on credit, and
refusing would make the screen lie about who decides. The resulting balance is
stated before the button is pressed, and a negative balance is coloured so
somebody notices it.

Point values are defaults. Each is prefilled from the action or item and stays
editable, and an action worth zero plus a note is how a one-off award is
recorded.

### The rank discount

A League Ace Trainer or a League Champion takes **10% off** anything on the prize
wall, rounded **up** in the player's favour: a 25 point pack is 3 off, not 2.

Qualification is worked out in one place so the reminder and the price cannot
disagree. The badge threshold is read from `trainer_card_ranks` rather than
written into the page, the same way the Trainer Card screen reads it, so moving
the ladder moves the discount with it. **Champions qualify for ever** — the rank
resets each season, having been Champion does not.

The points screen says so next to the balance, and the price is already
discounted everywhere it appears: the dropdown reads "Booster pack (22, was 25)"
and the cost field is prefilled with 22. A professor reading one number off the
screen and another off the shelf is how a discount gets forgotten.

The cost stays editable, like every other point value. When a discounted price is
recorded, the ledger entry says "10% rank discount", so a smaller number in the
history is explicable a season later without anyone having to remember the rule.

### Retiring an item on redemption

Handing something over does **not** by itself take it off the prize wall — most
items are restocked. Retiring one is a separate checkbox on the redemption, and
because it changes what every professor and player sees rather than just this
player's balance, it asks for confirmation naming the item. The ledger is written
first and the retire second: the points are the part that has to be right, so if
the retire then fails the redemption stands and the message says exactly what is
left to do.

Every action and item is loaded, active or retired, because history has to keep
naming what a past entry was for. Only the active subset is offered in the
dropdowns.

### Prize wall and earning

`admin/prizes.html` holds both sides of the prize point ledger: what points buy,
and what earns them. `prize_items` and `earning_actions` are the same shape — a
label, a number, a note, a sort order and an `is_active` flag — so one component
drives both rather than two that would drift.

Nothing is ever deleted. A row is retired, which takes it out of every dropdown
and off the public pages while leaving it intact, because ledger entries hold
foreign keys to both tables and history has to keep naming what somebody earned
or took. Deleting would either orphan those rows or be refused outright. Putting
something back is immediate; taking it away asks first, because that direction
changes what everyone sees.

The earning list is also what attendance depends on: the upload and the manual
screen both look for the attendance award **by name**, and fall back to a
dropdown rather than a wrong value if it has been renamed.

### Reference data

`admin/reference.html` covers badges, Trainer Card ranks, and releases with their
loyalty tiers. These are the tables that decide what the rest of the site means,
and all of them are read live rather than copied anywhere, so a change re-decides
what everybody has already earned.

**Adding a badge for a later season rolls the league over.**
`current_badge_season()` is `max(season_year)` on `badges`, so the first 2027
badge makes 2027 the current season: every player's rank is judged on 2027 badges
from that moment and 2026 becomes history. The add form says so when the year
typed is later than the season running now, because it is not obvious and it is
not undoable by deleting one row.

Ranks can be edited but not added or removed. Four ranks is the program, and a
fifth would need the public pages thought through first — `player_rank()` reads
the thresholds from this table rather than having them written into it, so moving
one changes every player's rank at once.

Releases have no active flag: the one running is whichever window contains today,
which is why two overlapping windows would fight. Adding an overlapping release
is **not refused** — the database does not refuse it, and a professor correcting
one window at a time would be blocked halfway — but it is named in the result.

### Events

`admin/events.html` creates and edits events, sets what they cost, and decides
which take pre-registration. Everything on it reaches the public schedule.

Capacity is per division plus an optional event total. **Everyone is a ceiling on
the whole event**, applied on top of any division limit: a place needs room in
the division *and* room in the event. Set either, both, or neither; neither is
uncapped. Clearing a division on screen deletes its row rather than leaving an
old number quietly capping an event a professor believes is now open.

Flights of one event share a **four digit PIN**, chosen by a professor. It is
typed at a desk, which a UUID is not. The form lists the PINs already in use so
"pick one not in use" is answerable, and the check constraint refuses anything
that is not exactly four digits — a typo that quietly makes a group of one is
worse than a refusal. The PIN appears on the professor event list and never on
the public schedule: it groups flights for the desk and means nothing to a
player.

New events prefill to the next Sunday at 2:00, which is when league meets.

Times are league time, not the browser's. A `datetime-local` input carries no
zone, so the value is composed and parsed against `America/New_York` explicitly,
reading the offset from the date itself rather than assuming one — otherwise an
event in November would be written an hour out by a rule that was correct in
July. The conversion round-trips exactly on both clock-change Sundays, including
the repeated hour and the hour that does not exist.

### Trainer Card

`admin/trainer-card.html` records badges, Elite 4 battles and Champion.

**Rank is not recorded and not computed here.** `player_rank()` decides it from
the season's badges, the ranks table and any Champion award, and the screen asks
it rather than keeping a second opinion that could disagree. The Champion
threshold is read from `trainer_card_ranks` too, so moving it is a data change
rather than a code change.

Nothing is edited. All three tables grant `INSERT` and `DELETE` and no `UPDATE`,
so every control is a toggle: award it, or take it back. A badge given to the
wrong player is taken off them and given to the right one. Badges are coloured by
position in the season's list, the same rule the public player card uses, so next
season's badges colour themselves.

Only Elite 4 **wins** are recorded. A lost battle is nothing and a player may
retry as often as they like, so there is no attempt to store. Everything on the
screen is seasonal and resets when the next season's badge list arrives; past
seasons stay on the player's record.

Recording a Champion who does not yet meet the threshold is **warned about, not
blocked** — `player_rank()` does not check eligibility either, and a professor
who watched the battles outranks a count. It says what is missing and asks.

### Players

`admin/players.html` adds someone who did not arrive through a tournament file,
and corrects a record that is wrong. It writes names, birth year, contact and
notes.

It cannot write a visibility flag — not because it declines to, but because
professors hold no `UPDATE` grant on those columns, so the attempt would be
refused. The screen states the current visibility and links to the consent screen
rather than offering a control.

There is no delete. A player record is never removed: attendance, ledger entries,
badges and registrations all point at it, and history has to keep resolving.
Correcting a Player ID is supported instead, and every foreign key referencing
players cascades so the correction carries rather than orphaning rows.

### Drop confirmation

`admin/drops.html`. A player asking to drop does not drop them: `request_drop()`
only marks the registration, and nothing moves until a professor confirms. That
is the point of the two steps — confirming is what promotes somebody off the
waiting list, and a promotion should not happen on an anonymous click.

The promotion rule lives in `confirm_drop()`, not in the page. It walks the
waitlist in order, skips anyone already holding a confirmed spot on another
flight of the same linked group, and skips anyone whose division is still full.
The screen's own job is to **name who was promoted**, because otherwise nobody
knows who to tell.

Two kinds of drop, deliberately weighted differently:

- **Someone who asked** has already confirmed it. The request is the
  confirmation, so one click finishes it.
- **Someone who did not ask** is a different act: it takes their place away and
  may promote somebody else, neither of which can be clicked back. That one asks
  first, naming the player.

The list is narrowed to events that **take registration**. A casual event nobody
signs up for has nobody to drop and no waiting list to promote from, so listing
it is noise at the desk. The one exception is any event with a request already
waiting, which is listed whatever its state — registration closes, and a request
made before it closed still has to be confirmable, or the player who asked is
stranded.

These lists are never public. Full names are shown for the same reason they
appear on a printed desk list.

### Visibility consent

`admin/consent.html` is the only screen that can make a player public, and it
cannot write the consent columns directly: professors hold no `UPDATE` grant on
them, so `set_player_visibility()` is not the preferred route but the only one
the API allows. Each switch is a separate call, so `consent_log` keeps one row
per decision rather than one row covering two.

The card reports what is **in force**, not what the flags say. Those differ more
often than they agree:

- `show_player_id` is a tri-state. Null means the age default is still in charge
  and moves with the player as they get older; true or false is a recorded
  decision that outlives their next birthday. The screen says which, because "no"
  and "nobody asked" are not the same fact.
- **The checkbox reads the permission, not the column.** An adult with nothing
  recorded is listed by the age default, so the box is ticked even though
  `show_player_id` is null. Reading the raw column showed an adult who *is*
  listed as unticked — confusing on its own, and it left no obvious way to take
  somebody off at their request, because the box they needed unticked already
  looked unticked. Unticking now records an explicit `false`, which outlasts the
  default.
- It is compared against that same permission on submit, so leaving an adult's
  box alone records **nothing**. Comparing against the raw column would have
  written an explicit "yes" every time a professor opened an adult's record and
  saved — consent invented by a page rather than given by a person.
- `show_name` is not null and defaults to false, so false carries no information
  about whether anyone was ever asked. It is worded differently for that reason.
- Consent needs attendance inside three months behind it. A player can have both
  switches on and still be invisible.

**Lapsed players are the case the screen exists for.** Their switches already say
yes, so an ordinary "save what changed" form would record nothing on exactly the
visit that matters. When consent has lapsed the form re-writes both switches and
a fresh consent date, and the button says re-confirm.

Lapsed is derived from `id_visible()` rather than recomputed in the browser: if
the switches permit, attendance exists, and the database still says no, the only
remaining reason is recency. That cannot drift from the three months actually
enforced.

Two rules the database does not hold, which the interface therefore does:

- **A minor's consent comes from a parent or guardian.** The function accepts
  either source for anybody. For a minor the control is removed rather than
  defaulted, so it cannot be set to "the player" by a slip. A player with no
  birth year counts as a minor and is treated the same way.
- **A name is never shown without the Player ID.** The database holds this one —
  `name_visible()` is false whenever `id_visible()` is — but recording a switch
  that silently does nothing misleads the professor, so the form says so.

### Passwords

`admin/password.html`. Supabase Auth could always do this; nothing on the site
used it, so a professor who forgot a password had no route back in and the
sign-in screen told them to ask somebody who had no way to help.

One page, three states, because they are the same conversation from different
starting points:

- arriving from a reset link, with a token to exchange
- already signed in, changing a password that is known
- neither, asking for a link

A reset link is answered **identically whether or not the address has an
account**. Otherwise the form becomes a way to find out who the professors are.

Eight characters minimum, which is more than Supabase's own floor: these
accounts can read every player's full name and birth year.

#### Supabase configuration this depends on

The reset email's link goes wherever **Authentication → URL Configuration** says,
not wherever the page asks. `redirectTo` is only a request, and an address that
is not allow-listed is ignored — which is why an earlier reset attempt landed on
`localhost:3000`. Both of these have to be set:

- **Site URL** — `https://tanner-buckets.github.io/nova-north/`
- **Redirect URLs** — add `https://tanner-buckets.github.io/nova-north/admin/password.html`,
  and `http://localhost:8000/admin/password.html` to test locally

The built-in email sender is rate limited and meant for development. For four
professors resetting a password once in a while it is enough; if links start
failing to arrive, the fix is SMTP under **Authentication → Emails**, not a
change here.

### The player page, signed in

`players.html` is public, and shows a professor everything.

The browse list is consent-gated for the public: a player without consent is
absent rather than anonymised, because this is a browse list rather than a set
that has to be complete. For a signed-in professor it is every player, with a
name and ID search, and the ones the public cannot see are marked.

`get_player_summary()` used to return null for anyone whose visibility was not in
force, which is right for the public and wrong for the people running the league.
A professor already reads every name on the admin screens; having the player
lookup answer "no such player" for a child is not a privacy measure, it is a
professor being lied to about their own league. **Consent decides what the public
sees. It was never meant to decide what a professor can look up.**

For an anonymous caller nothing changed: the gate still applies, the label still
comes from `display_label()`, and `public_players` is untouched. A professor sees
the real full name and a `visible_publicly` flag, so the card can say plainly
that this player is not on the public site.

The card also carries links for a signed-in professor — **prize points, Trainer
Card, visibility and consent, player record** — each already pointing at that
player.

Those four screens are all about a single player, and a professor rarely wants
just one of them: consent, points and the Trainer Card come up in the same
conversation at the desk. So every one of the four carries the same row, minus
itself, and `playerLinks()` in `supabase-client.js` is the single definition of
it. Having to search for the same person three times was the tax that made the
tools feel slow.

**One search field everywhere.** `playerPicker()` in
`admin/attendance-core.js` is the single implementation, used by the upload,
manual attendance, points, Trainer Card and consent screens. It used to be two
fields — one for an ID, one for a name — and the consent screen carried its own
second copy of the same idea, so the lookup behaved differently depending on
which screen you were on. Digits match an ID, letters match a name, and one
query does both: there is no mode to choose and no wrong box to type in. Typing
is debounced, out-of-order replies are discarded, and Enter picks the only match.

**The public page searches too.** It filters `public_players` on
`display_label`, which is exactly what consent already decided: a player whose
name is public reads as "Maya R." and can be found by name; one who consented
only to their ID reads as the ID and can be found only by that. Nothing can match
on a value the public may not see, because no such value is in the list being
matched against.

**One search field, not two.** The page already asks for a Player ID, so a second
box doing the same job a few centimetres away is the kind of thing that makes
somebody hesitate at the desk. Signed in, that field becomes "Player ID or name":
typing filters the list live, digits still look up an ID, a name matching one
player opens them, and a name matching several leaves the list filtered to pick
from. It is read by the single existing submit handler rather than by a second
listener — two listeners on one form fire in registration order at the target, so
a later one cannot pre-empt an earlier one.

One consequence worth knowing: the visibility gate used to double as an existence
check, since an unknown ID is never visible. A professor passes that gate, so an
unknown ID is now refused on its own.

### Printable lists

`admin/print.html`. Loyalty tiers to hand to the store, and pre-registration to
work from at the desk. Both are `@media print` stylesheets on a professor-only
page — there is no PDF library and no generated file.

Both sheets carry full names and Player IDs. That is a **disclosure to the venue
and to whoever runs the desk, not publication**: nothing on them is ever rendered
on a public page. Most of these players are children, so each sheet is footed
with what it contains and the instruction to hand it to a person rather than
leave it out.

The loyalty sheet asks `loyalty_weeks()` once per player rather than counting
attendance in the browser. The rule — distinct days inside the window plus the
carryover bridge — lives in the database, and a second copy here would be a
second answer that could disagree with the player's own card. It is a handful of
calls for a sheet printed once a release, and only for players with attendance in
the window at all. If the league outgrows that, the fix is a view, not a copy of
the rule.

Players below every threshold are listed under "Not yet at a tier" rather than
dropped, so the store is told who is close and not only who has arrived. The
waiting list prints in **queue order, not alphabetically** — the order is the
only information a waiting list carries, and sorting it by name would destroy it.

### Known gaps, carried forward

- **16 Player IDs appear in the league spreadsheets but in neither official
  export.** They hold 18 opening balances worth 77 points and 5 carryover rows
  worth 5 weeks, all skipped rather than guessed at. Adding them later is a clean
  insert: the sets do not overlap, so there is no duplication risk.
- **`finalize_release()` is not written.** Deferred until Delta Reign closes on
  1 November 2026. `loyalty_results` exists and is waiting for it.
- **Nobody is visible yet.** Visibility needs a consent flag *and* attendance
  within three months, and `attendance` starts empty by design — the imported
  weeks had no dates, which is why `loyalty_carryover` exists. The first TDF
  upload is what brings the system to life, and the consent screen is what makes
  anyone appear on the public site afterwards.

### Scheduling the consent expiry job

Scheduled and running daily at 07:00 UTC. Deliberately not in the migration:
creating an extension behaves differently per environment, and a failure there
would block the whole deploy. It was enabled at Dashboard → Integrations and
scheduled with:

```sql
select cron.schedule('expire-stale-consent', '0 7 * * *',
                     'select public.expire_stale_consent()');
```

The read-time check in `id_visible()` fails closed regardless, so nothing is at
risk if this is late. The job only stops stale flags sitting in the database.

### Importing players

Not as a migration. Migration files are committed to this public repository, so
seeding players there would publish their names permanently. The import runs out
of band — Supabase Studio's CSV import, or a local script using `service_role`
that never enters git.

The same applies to professors. Each signs up through Supabase Auth, then their
`user_id`, display name and Player ID are inserted by hand in the dashboard.

### Verifying a deployed migration

```sql
-- tables exist with RLS on
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('earning_actions', 'prize_items', 'releases', 'loyalty_tiers');

-- policies
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' order by tablename, cmd;
```

Then check the boundary from outside the database, with the anon key: a `SELECT`
on `prize_items` should return rows, and a `POST` to it should be refused. The
second one is the property that actually matters.
