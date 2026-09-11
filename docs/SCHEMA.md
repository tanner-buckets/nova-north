# Schema design

Reference document. Not migrations — convert to SQL one migration per phase, each
with RLS enabled and a policy in the same file.

---

## Access strategy

Three mechanisms, used deliberately:

| Mechanism | Used for |
|---|---|
| **RLS policies** | Which *rows* a caller may touch |
| **Views** | Which *columns* the public may read |
| **RPC functions** | Lookups where the caller supplies a key |

The anon key has **no direct SELECT** on `players`, `registrations`, `attendance`,
`loyalty_results`, or `consent_log`. It reads public views and calls functions.
This keeps names, birth years, contact details, and pre-registration lists out of
reach even for someone querying the API directly, bypassing the site.

Reference tables (`earning_actions`, `prize_items`, `releases`, `loyalty_tiers`)
are publicly readable and professor-writable. Professors edit all of them from
the admin screens — none of this content is hardcoded.

---

## Player visibility — the consent model

This is the most important section in the document. It exists because the Play!
Pokémon Standards of Conduct prohibit disclosure of another person's personal
information without their explicit consent, and because TPCi's own ranking
display is elected by the player or, for a minor, by a parent or guardian.

### Two independent switches

| Switch | Adult default | Minor default |
|---|---|---|
| Player ID visible publicly | **Yes** | **No** |
| Name visible publicly (first name + last initial) | **No** | **No** |

Full last names are **never** publicly visible, at any consent level. They are
visible only to a signed-in professor.

### Who may change what

- Only **professors** change visibility flags. There is no public self-service
  toggle.
- A professor may set them **only on the player's consent**, or a parent's or
  guardian's consent for a minor.
- An adult player may ask a professor to hide their Player ID. Handle this
  request in person; do not build a public form in v1.
- Every change writes a `consent_log` row. That log is the record if a parent
  ever asks why their child appeared on a website.

### Expiry — three months

Visibility lapses when a player has no attendance in the preceding three months.
Implemented **twice, deliberately**:

1. **At read time.** Every public function and view tests
   `consent_flag AND last_attendance_on >= current_date - interval '3 months'`.
   This fails closed. If no maintenance ever runs, visibility still stops on
   schedule.
2. **By a periodic job.** A scheduled task clears expired flags to `false` and
   writes a `consent_log` row with source `expiry`. This is what makes the
   promise real — the flags do not sit in the database indefinitely.

A returning player is **not** automatically restored. A professor re-confirms
consent and re-sets the flag. That is the point: the record is not a permanent
home for the information.

### Anonymization

Where a row must appear but the player has no ID visibility, the display label is
the literal string `PLAYER` with no other identifying value. Distinguish two
cases:

- **Lookup and browse lists** — non-consented players are **omitted entirely**.
- **Complete sets where a row must exist** (event result ordering, counts) —
  the row appears with the label `PLAYER`.

---

## Tables

### `players`
Professor read/write. No public access.

| Column | Type | Notes |
|---|---|---|
| `player_id` | text PK | Play! Pokémon Player ID. The source of truth. |
| `first_name` | text | Public **only** when `show_name` is in effect |
| `last_name` | text | **Protected.** Never public in full, at any consent level. |
| `birth_year` | int | **Protected.** Drives division and minor status. |
| `contact` | text null | Discord or email, optional. **Protected** |
| `notes` | text null | **Protected** |
| `show_player_id` | bool null | Null means use the age-based default. True or false is an explicit professor-recorded election. |
| `show_name` | bool | Default false. Never defaults true for anyone. |
| `consent_source` | text null | `player` or `guardian` |
| `consent_recorded_by` | uuid null | Professor who recorded it |
| `consent_recorded_at` | timestamptz null | |
| `created_at` | timestamptz | |

`show_player_id` is nullable on purpose. Null lets the age-based default apply
and adjusts automatically when a minor becomes an adult. An explicit `false` is
an adult opt-out and must survive that transition.

### `consent_log`
Append only. Professor read. No public access. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `player_id` | text FK | |
| `field` | text | `show_player_id` or `show_name` |
| `old_value` | bool null | |
| `new_value` | bool null | |
| `source` | text | `player`, `guardian`, `expiry` |
| `changed_by` | uuid null | Professor; null when source is `expiry` |
| `note` | text null | e.g. "Guardian consented in person, 2026-09-14" |
| `created_at` | timestamptz | |

### `releases`
Public read. Professor write.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g. "Mega Evolution" |
| `starts_on` | date | |
| `ends_on` | date | |
| `finalized_at` | timestamptz null | Set when tier results are snapshotted |

Active release = the one containing today's date. Do not add an `is_active`
column; overlapping or stale flags cause silent wrong answers.

### `loyalty_tiers`
Public read. Professor write. One set of rows per release.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `release_id` | uuid FK | |
| `tier_name` | text | `Crystal`, `Gold`, or `Silver`. Check constraint. |
| `product` | text | What the tier earns this release |
| `weeks_required` | int | |
| `sort_order` | int | Crystal highest |

Tier names are stable across releases. Product, thresholds, and tier count vary —
a release may have two tiers instead of three. Unique on
(`release_id`, `tier_name`).

### `loyalty_results`
Professor read/write. No public access. Historical record for a completed release.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `release_id` | uuid FK | |
| `player_id` | text FK | |
| `weeks_attended` | int | Snapshot at finalization |
| `tier_id` | uuid null FK | Null means no tier earned |
| `recorded_at` | timestamptz | |

Unique on (`release_id`, `player_id`).

During an active release, weeks and tier are computed live from `attendance`.
When a release ends, a professor finalizes it, which writes one row here per
player and stamps `releases.finalized_at`. History then cannot drift if
attendance is later corrected. This is the one deliberate exception to "derive,
do not store" — a snapshot of a closed period, not a cached value.

### `earning_actions`
Public read. Professor write.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | |
| `default_points` | int | Overridable at entry |
| `eligibility_note` | text null | "Masters only", "Juniors/Seniors only" |
| `notes` | text null | |
| `is_active` | bool | Default true |
| `sort_order` | int | |

`default_points = 0` plus a note covers "Professor Discretion". Time-limited
bonuses need no feature — the professor overrides the amount at entry.

### `prize_items`
Public read. Professor write.

`label`, `default_cost`, `notes`, `is_active` (default true), `sort_order`.

No inventory tracking. This is a price list. Catalog values run at roughly four
points per dollar of retail value.

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `event_type` | text | league, casual, challenge, cup, prerelease, special |
| `starts_at` | timestamptz | |
| `is_premier` | bool | Premier events require a Player ID |
| `registration_open` | bool | |
| `linked_group_id` | uuid null | Events sharing a value are mutually exclusive |

### `event_capacities`
One row per division per event. Division `all` for events not capped by division.

`event_id`, `division`, `capacity`.

### `registrations`
Public **INSERT only**, through `register_for_event()`. No public SELECT —
pre-registration lists are never public, regardless of any visibility consent.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_id` | uuid FK | |
| `player_id` | text null | Null allowed for prereleases only |
| `first_name` | text | **Protected** |
| `last_name` | text | **Protected** |
| `birth_year` | int | **Protected** |
| `contact` | text null | Optional. **Protected** |
| `division` | text | Derived from birth year at registration |
| `status` | text | confirmed, waitlist, drop_requested, dropped |
| `waitlist_position` | int null | |
| `created_at` | timestamptz | |

**View `public_event_counts`** — per event and division: capacity, confirmed
count, waitlist length. Numbers only, no names, no IDs.

### `attendance`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `player_id` | text FK | |
| `event_id` | uuid null | |
| `attended_on` | date | Defaults to today on manual entry |
| `source` | text | tdf, manual |
| `created_by` | uuid | Professor |

**`UNIQUE (player_id, attended_on)`** — enforces "one loyalty week per day" at the
database level.

Release membership is derived from `attended_on` falling inside a release window.
Do not store `release_id`. This table also drives consent expiry, so index
`(player_id, attended_on DESC)`.

### `point_ledger`
Append only. Never update, never delete.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `player_id` | text FK | |
| `delta` | int | Positive earn, negative spend |
| `earning_action_id` | uuid null | |
| `prize_item_id` | uuid null | |
| `event_id` | uuid null | |
| `reason` | text null | Free text for discretionary awards and opening balances |
| `voids_id` | uuid null | Points at the entry this reverses |
| `created_by` | uuid | Professor |
| `created_at` | timestamptz | |

Balance is `SUM(delta)`. Corrections are new rows with `voids_id` set.

### `professors`

`user_id` uuid PK referencing `auth.users`, `display_name`, `added_at`.

Every professor-write policy checks membership here via `auth.uid()`.

---

## Derived values — never stored

| Value | Derivation |
|---|---|
| Point balance | `SUM(delta)` from `point_ledger` |
| Loyalty weeks, active release | `COUNT(DISTINCT attended_on)` within the release window |
| Loyalty weeks, closed release | Read from `loyalty_results` |
| Division | From `birth_year` against the current season cutoff |
| Minor status | `birth_year` implies under 18 |
| Active release | The release whose window contains today |
| Tier earned, active release | Highest tier whose `weeks_required` is met |
| `last_attendance_on` | `MAX(attended_on)` from `attendance` |
| Consent in force | Flag is true **and** `last_attendance_on >= current_date - interval '3 months'` |

---

## Visibility helpers

**`id_visible(p_player_id text) returns bool`**
`COALESCE(show_player_id, NOT is_minor)` AND attendance within three months.

**`name_visible(p_player_id text) returns bool`**
`show_name` AND attendance within three months AND `id_visible` is true. Name is
never shown without the ID.

**`display_label(p_player_id text) returns text`**
- Name visible → `'Firstname L.'`
- ID visible only → the Player ID
- Neither → the literal `'PLAYER'`

Every public-facing surface uses this function. No page assembles a display name
from columns itself.

**View `public_players`** — `player_id` and `display_label` for players where
`id_visible` is true. Non-consented players are **absent**, not anonymized. This
is the browse and lookup list.

---

## Public RPC functions

`SECURITY DEFINER`, granted to anon.

**`get_player_summary(p_player_id text)`**
Returns display label, point balance, loyalty weeks this release, tier earned, and
transaction history — **only if `id_visible` is true**. Returns nothing for an
unknown ID and nothing for a player without ID visibility. Never returns last
name, birth year, contact, division, or notes.

**`get_event_results(p_event_id uuid)`**
Returns the complete ordered result set using `display_label`, so non-consented
players appear as `PLAYER` rather than being omitted. Use this where a set must be
complete.

**`register_for_event(...)`**
Validates the linked-group rule, derives division from birth year, checks capacity
for that division, assigns confirmed or waitlist status, returns which was given
and the waitlist position. Doing this in a function rather than a direct insert
prevents a caller writing their own status.

**`request_drop(p_player_id text, p_first_name text, p_event_id uuid)`**
Requires both Player ID and matching first name. Sets status to `drop_requested`.
Does not remove the registration.

---

## Professor-only functions

**`set_player_visibility(p_player_id text, p_field text, p_value bool, p_source text, p_note text)`**
Sets one flag, writes the `consent_log` row, stamps `consent_recorded_by` and
`consent_recorded_at`. **The only supported way to change a visibility flag.**
Rejects a `p_source` other than `player` or `guardian`.

**`expire_stale_consent()`**
Clears `show_player_id` and `show_name` for any player whose last attendance is
over three months old, writing a `consent_log` row with source `expiry` for each.
Idempotent. Run on a schedule; read-time checks already fail closed if it does
not run.

**`confirm_drop(p_registration_id uuid)`**
Sets status to `dropped`, then promotes the top waitlist entry **skipping anyone
who already holds a confirmed registration in the same linked group**. Returns who
was promoted so the UI can show it.

**`finalize_release(p_release_id uuid)`**
Writes one `loyalty_results` row per player with attendance in that release,
computing weeks and tier, then stamps `releases.finalized_at`. Refuses to run
twice on the same release.

---

## Import notes — one-time migration from the Google Sheets

Source files live in `data/source/`. Keep them permanently; they are the only
record of how the opening balances were earned.

**Visibility on import.** Every imported player gets `show_player_id = null` and
`show_name = false`. No historical player is publicly visible until a professor
records consent. Do not backfill consent from the fact that names appeared in a
spreadsheet — a private sheet is not publication and implies nothing.

**Players.** `player-prize-points.csv` has 992 rows but only **284 real players**
— the rest are blank padding. It is a superset of `loyalty-program.csv` (281
players, all present in the larger file), so import players from the prize-points
file.

**Opening balances.** Import the `Prize tickets` column only, as one
`point_ledger` row per player: `delta` = that value, `reason` = "Opening balance
carried forward from prior tracking", dated the import day.

**Do not import the 61 date columns.** They are running balance snapshots rather
than transactions, 14 dates are duplicated (2026-03-17 appears four times), and
there are no reason codes. Nine players show single-interval jumps over 100 points
worth spot-checking before the balances are trusted.

**Loyalty history.** `loyalty-program.csv` has week counts but no dates, so it
cannot become `attendance` rows. Import it as `loyalty_results` rows against
whichever release those counts belong to. Dated attendance tracking starts fresh
from the first TDF upload.

**Consequence worth expecting:** with no attendance rows on import, every player
fails the three-month check immediately. Nobody is publicly visible until real
attendance starts accruing. That is correct behavior, not a bug.

**Retired items.** `earning-actions.csv` carries an explicit `is_active` column.
`prize-items.csv` does not — import every row as active and retire from the admin
screens as needed.

---

## Scheduling `expire_stale_consent()`

`pg_cron` is available on the Supabase free plan and is enabled by default.
Enable it at Dashboard → Integrations → Cron, or with
`create extension if not exists pg_cron`. Schedules run in UTC.

Schedule it there, but **do not rely on it alone.** pg_cron does not retry
skipped runs, drops a tick that fires while the previous run still holds a lock,
has no failure alerting beyond a log row, and stops entirely while a project is
paused — which on the free plan happens after seven days of inactivity. That is
the same quiet stretch during which consent is most likely to be expiring.

The read-time recency check is what guarantees expiry. The job only clears the
stale flags.

Also call `expire_stale_consent()` from the scheduled GitHub Action that runs the
database backup. That workflow runs on GitHub's infrastructure, so it still fires
when the database is paused, and it doubles as the keep-alive. One workflow then
covers backup, consent cleanup, and pause avoidance.

---

## Open items

- Division cutoff logic depends on the Play! Pokémon season calendar. Confirm the
  current rule against official documentation before implementing.
