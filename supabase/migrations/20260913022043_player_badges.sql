-- Badge awards, and the thresholds that turn them into a rank.
--
-- Written so that the badge list can change without breaking anything. There are
-- thirteen today; there may be nine or twenty later.
--
-- Three properties make that safe:
--
--   1. An award references badges.id, not a name or a position. Rewording
--      "Snack" to "Snack Bringer" changes nothing about who earned it.
--   2. Retiring a badge sets badges.is_active = false. The row stays, so a player
--      who earned it keeps it, and their history still resolves.
--   3. The number of badges a rank needs lives in a column rather than in prose
--      or in page code. If the list grows to twenty and Ace Trainer should need
--      twelve, that is an UPDATE, not a migration and not a code change.
--
-- No rank is stored. Rank is derived from badges earned, league visits, and the
-- one fact that cannot be derived: whether a player has beaten the Elite 4.

-- ---------------------------------------------------------------------------
-- player_badges
-- ---------------------------------------------------------------------------
create table public.player_badges (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  badge_id uuid not null references public.badges (id),
  awarded_on date not null default current_date,
  awarded_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),

  -- A badge is earned once. Re-awarding it is a mistake, not a second badge.
  constraint player_badges_once unique (player_id, badge_id)
);

create index player_badges_player_idx on public.player_badges (player_id);

comment on table public.player_badges is
  'One row per badge a player has earned. No public access: badge progress is reached through an RPC, so it stays behind the consent check.';
comment on column public.player_badges.awarded_by is
  'Professor who recorded it. Null if it arrived from an import rather than a person.';
comment on column public.player_badges.note is
  'Optional context, e.g. which event the badge was earned at.';

grant select, insert, delete on public.player_badges to authenticated;
-- No UPDATE: a badge award is either right or it is removed and re-recorded.
-- Editing one in place would let the player or date drift silently.

alter table public.player_badges enable row level security;

create policy player_badges_select_professor
  on public.player_badges for select to authenticated using (public.is_professor());
create policy player_badges_insert_professor
  on public.player_badges for insert to authenticated with check (public.is_professor());
create policy player_badges_delete_professor
  on public.player_badges for delete to authenticated using (public.is_professor());

-- ---------------------------------------------------------------------------
-- Rank thresholds as data
-- ---------------------------------------------------------------------------
-- qualification stays as the human sentence shown on the page. These columns are
-- what a derivation reads, so the two cannot drift into disagreeing about a
-- number that appears in both.
alter table public.trainer_card_ranks
  add column badges_required integer,
  add column visits_required integer,
  add column requires_elite_four boolean not null default false;

comment on column public.trainer_card_ranks.badges_required is
  'Badges needed for this rank. Null where the rank is not earned by badges.';
comment on column public.trainer_card_ranks.visits_required is
  'League visits needed. Null where attendance is not the criterion.';
comment on column public.trainer_card_ranks.requires_elite_four is
  'True only for League Champion, the one rank that cannot be derived from counting.';

update public.trainer_card_ranks set visits_required = 3  where sort_order = 1;
update public.trainer_card_ranks set badges_required = 4  where sort_order = 2;
update public.trainer_card_ranks set badges_required = 8  where sort_order = 3;
update public.trainer_card_ranks set requires_elite_four = true where sort_order = 4;

-- ---------------------------------------------------------------------------
-- The one fact that cannot be counted
-- ---------------------------------------------------------------------------
-- Everything else about rank is derivable: badges from player_badges, visits
-- from attendance. Beating the Elite 4 is an event a professor witnesses, so it
-- has to be recorded somewhere. A date rather than a flag, because when it
-- happened is worth keeping.
alter table public.players
  add column champion_awarded_on date;

comment on column public.players.champion_awarded_on is
  'Date this player beat the Elite 4, or null. The only stored part of rank.';

-- Column grants on players are explicit, so the new column needs adding to both
-- lists or professors cannot write it. The consent columns stay out, as ever.
revoke all on public.players from anon, authenticated;

grant select on public.players to authenticated;

grant insert (player_id, first_name, last_name, birth_year, contact, notes,
              champion_awarded_on)
  on public.players to authenticated;

grant update (player_id, first_name, last_name, birth_year, contact, notes,
              champion_awarded_on)
  on public.players to authenticated;
