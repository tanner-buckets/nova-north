# NoVa North League

Database and website for the Northern Virginia North League, a trading card game
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
against real functions and policies later. Current phase: **4**.

| Phase | Work | State |
|---|---|---|
| 1 | Reference tables: `earning_actions`, `prize_items`, `releases`, `loyalty_tiers` | done |
| 2 | People and consent: `players`, `professors`, `consent_log`, visibility helpers | done |
| 3 | Points and attendance: `attendance`, `point_ledger`, consent expiry | done |
| 4 | Events and registration | in progress |
| 5 | Public pages, built against the real tables | |
| 6 | Professor screens | |
| 7 | TDF upload and parsing | |

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

### The registration throttle

Registration is deliberately open: no login, no captcha. Supabase's configurable
rate limits cover Auth endpoints only and do not apply to the Data API, so the
throttle lives inside `register_for_event()` instead.

PostgREST passes the request headers to Postgres, so the function reads
`x-forwarded-for` and refuses an eleventh registration for the same event from
the same address. The address is stored in `registrations.source_ip`, which is
protected: no public grant, absent from `public_event_counts`, and returned by no
function.

Two deliberate choices:

- **A signed-in professor is exempt.** They register people at the desk from one
  address all afternoon, which is precisely the pattern this would otherwise
  mistake for abuse.
- **A missing or unparseable header means no throttle**, not a refusal. This
  exists to make bulk submission tedious, not to be a security control, and it
  must never block a legitimate registration.

Households share an address, and so does a game store's wifi. Ten per event is
generous for a family but reachable if many players register on site at a busy
prerelease. If that happens, raise the number or scope it to a time window rather
than the life of the event.

`source_ip` is safe to clear once an event has passed.


### Known gaps, carried forward

- **16 Player IDs appear in the league spreadsheets but in neither official
  export.** They hold 18 opening balances worth 77 points and 5 carryover rows
  worth 5 weeks, all skipped rather than guessed at. Adding them later is a clean
  insert: the sets do not overlap, so there is no duplication risk.
- **`finalize_release()` is not written.** Deferred until Delta Reign closes on
  1 November 2026. `loyalty_results` exists and is waiting for it.
- **Nothing is player-facing yet, and nobody is visible.** Visibility needs a
  consent flag *and* attendance within three months, and `attendance` is empty by
  design — the imported weeks had no dates, which is why `loyalty_carryover`
  exists. The first real check-in is what brings the system to life.

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
