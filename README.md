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
against real functions and policies later. Current phase: **1**.

| Phase | Work | State |
|---|---|---|
| 1 | Reference tables: `earning_actions`, `prize_items`, `releases`, `loyalty_tiers` | in progress |
| 2 | People and consent: `players`, `professors`, `consent_log`, visibility helpers | |
| 3 | Points and attendance: `attendance`, `point_ledger`, consent expiry | |
| 4 | Events and registration | |
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
