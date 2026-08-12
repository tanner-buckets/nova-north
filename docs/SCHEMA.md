# Schema design

Reference document. Not migrations — convert to SQL at phase 2 and later, one
migration per table, each with RLS enabled and a policy in the same file.

---

## Access strategy

Three mechanisms, used deliberately:

| Mechanism | Used for |
|---|---|
| **RLS policies** | Which *rows* a caller may touch |
| **Views** | Which *columns* the public may read |
| **RPC functions** | Lookups where the caller supplies a key (player lookup) |

The anon key has **no direct SELECT** on `players`, `registrations`, or
`attendance`. It reads public views and calls functions. This is what keeps birth
year, contact details, and pre-registration lists out of reach even for someone
querying the API directly, bypassing the site.

---

## Tables

### `players`
Professor read/write. No public access.

| Column | Type | Notes |
|---|---|---|
| `player_id` | text PK | Play! Pokémon Player ID |
| `first_name` | text | Public |
| `last_initial` | text | Public |
| `birth_year` | int | **Protected** |
| `contact` | text null | Discord or email, optional. **Protected** |
| `notes` | text null | **Protected** |
| `created_at` | timestamptz | |

**View `public_players`** — exposes `player_id`, `first_name`, `last_initial`
only. This is what the site reads.

### `releases`
Public read. Professor write.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g. "Mega Evolution" |
| `starts_on` | date | |
| `ends_on` | date | |

Active release = the one containing today's date. Do not add an `is_active`
column; overlapping or stale flags cause silent wrong answers.

### `loyalty_tiers`
Public read. Professor write. Tier count and thresholds vary per release.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `release_id` | uuid FK | |
| `name` | text | "Booster Box", "ETB", "Booster Bundle" |
| `weeks_required` | int | |
| `sort_order` | int | |

### `earning_actions`
Public read. Professor write. Mirrors the earning spreadsheet.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | "Attend Sunday League" |
| `default_points` | int | Overridable at entry |
| `eligibility_note` | text null | "Masters only" |
| `notes` | text null | |
| `is_active` | bool | Retired actions stay for history |
| `sort_order` | int | |

Use `default_points = 0` plus a note for "Professor Discretion". Time-limited
bonuses need no feature — the professor overrides the amount.

### `prize_items`
Public read. Professor write. Mirrors the prize wall spreadsheet.

Same shape as `earning_actions`: `label`, `default_cost`, `notes`, `is_active`,
`sort_order`.

No inventory tracking. This is a price list.

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
One row per division per event. Division `all` for uncapped-by-division events.

`event_id`, `division`, `capacity`.

### `registrations`
Public **INSERT only**. No public SELECT — pre-registration lists are not public.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_id` | uuid FK | |
| `player_id` | text null | Null allowed for prereleases only |
| `first_name` | text | |
| `last_initial` | text | |
| `birth_year` | int | **Protected** |
| `contact` | text null | Optional. **Protected** |
| `division` | text | Derived from birth year at registration |
| `status` | text | confirmed, waitlist, drop_requested, dropped |
| `waitlist_position` | int null | |
| `created_at` | timestamptz | |

**View `public_event_counts`** — per event and division: capacity, confirmed
count, waitlist length. Numbers only, no names. This is what the registration
form reads to decide whether to offer a confirmed spot or a waitlist spot.

### `attendance`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `player_id` | text FK | |
| `event_id` | uuid null | |
| `attended_on` | date | Defaults to today on manual entry |
| `source` | text | tdf, manual |
| `created_by` | uuid | Professor |

**`UNIQUE (player_id, attended_on)`** — this single constraint enforces "one
loyalty week per day" at the database level. Attending league and playing the
tournament on the same Sunday cannot produce two weeks.

Release membership is derived from `attended_on` falling inside a release window.
Do not store `release_id`.

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
| `reason` | text null | Free text for discretionary awards |
| `voids_id` | uuid null | Points at the entry this reverses |
| `created_by` | uuid | Professor |
| `created_at` | timestamptz | |

Balance is `SUM(delta)`. Corrections are new rows with `voids_id` set.

### `professors`

`user_id` uuid PK referencing `auth.users`, `display_name`, `added_at`.

Every professor-write policy checks membership in this table via `auth.uid()`.

---

## Derived values — never stored

| Value | Derivation |
|---|---|
| Point balance | `SUM(delta)` from `point_ledger` |
| Loyalty weeks | `COUNT(DISTINCT attended_on)` within the release window |
| Division | From `birth_year` against the current season cutoff |
| Active release | The release whose window contains today |
| Tier earned | Highest tier whose `weeks_required` is met |

---

## Public RPC functions

`SECURITY DEFINER`, granted to anon.

**`get_player_summary(p_player_id text)`**
Returns first name, last initial, point balance, loyalty weeks this release, tier
earned, and transaction history. Returns nothing for an unknown ID. Never returns
birth year, contact, division, or notes.

**`register_for_event(...)`**
Validates the linked-group rule, derives division from birth year, checks
capacity for that division, assigns confirmed or waitlist status, returns which
one was given and the waitlist position. Doing this in a function rather than a
direct insert is what prevents a caller from writing their own status.

**`request_drop(p_player_id text, p_first_name text, p_event_id uuid)`**
Requires both Player ID and matching name. Sets status to `drop_requested`. Does
not remove the registration.

---

## Professor-only functions

**`confirm_drop(p_registration_id uuid)`**
Sets status to `dropped`, then promotes the top waitlist entry **skipping anyone
who already holds a confirmed registration in the same linked group**. Returns
who was promoted so the UI can show it.

---

## Open items

- Division cutoff logic depends on the Play! Pokémon season calendar. Confirm the
  current rule against official documentation before implementing.
- Whether a released tier list should snapshot at release end, or stay live.
  Live is simpler; snapshot is safer if the store disputes a list later.
