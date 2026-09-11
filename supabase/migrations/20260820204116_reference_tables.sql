-- Phase 1: reference tables.
--
-- earning_actions, prize_items, releases, loyalty_tiers. No personal data.
-- All four are publicly readable and professor-writable. This is where the RLS
-- pattern for the whole project is established.
--
-- earning_actions and prize_items are seeded from the spreadsheet exports.
-- releases and loyalty_tiers are created empty; a professor enters each release
-- and its tiers.

-- ---------------------------------------------------------------------------
-- Professor check
-- ---------------------------------------------------------------------------
-- FORWARD DEPENDENCY. READ BEFORE APPLYING.
--
-- public.professors is a phase 2 table and does not exist yet. Every
-- professor-write policy below calls this function instead of naming that table,
-- because a policy that references a missing table fails at CREATE POLICY time
-- and would stop this whole migration from applying.
--
-- A plpgsql body is syntax-checked when created but its table references are not
-- resolved until it runs, so this function is created cleanly today. Until phase 2
-- creates public.professors, a write by an authenticated user raises
-- undefined_table (42P01) rather than being refused by policy. Nothing writes to
-- these tables in phase 1: there is no auth and no admin screen, and the seed at
-- the end of this file runs as the migration role, which RLS does not apply to.
--
-- When phase 2 creates public.professors this function starts working. No policy
-- needs to change.
create or replace function public.is_professor()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  return exists (
    select 1
    from public.professors
    where user_id = auth.uid()
  );
end;
$function$;

comment on function public.is_professor() is
  'True when the caller is in public.professors. Called by every professor-write policy. Depends on the phase 2 professors table.';

revoke all on function public.is_professor() from public;
grant execute on function public.is_professor() to authenticated;

-- ---------------------------------------------------------------------------
-- earning_actions
-- ---------------------------------------------------------------------------
create table public.earning_actions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  default_points integer not null default 0,
  eligibility_note text,
  notes text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

comment on table public.earning_actions is
  'Ways to earn prize points. Seeded from data/source/earning-actions.csv.';
comment on column public.earning_actions.default_points is
  'Default award. A professor may override it at entry. Zero plus a note covers professor discretion.';
comment on column public.earning_actions.is_active is
  'False retires the action. Rows are never deleted, so history keeps pointing at them.';

grant select on public.earning_actions to anon, authenticated;
grant insert, update, delete on public.earning_actions to authenticated;

alter table public.earning_actions enable row level security;

create policy earning_actions_select_public
  on public.earning_actions
  for select
  to anon, authenticated
  using (true);

create policy earning_actions_insert_professor
  on public.earning_actions
  for insert
  to authenticated
  with check (public.is_professor());

create policy earning_actions_update_professor
  on public.earning_actions
  for update
  to authenticated
  using (public.is_professor())
  with check (public.is_professor());

create policy earning_actions_delete_professor
  on public.earning_actions
  for delete
  to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- prize_items
-- ---------------------------------------------------------------------------
create table public.prize_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  default_cost integer not null,
  notes text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

-- The source spreadsheet carried the conversion rate below as a stray third
-- header rather than as a column of data. It is the rule of thumb used to price
-- the wall, not a stored value, so it is recorded here.
comment on table public.prize_items is
  'Prize wall price list. No inventory tracking. Ticket values are roughly 4 points per $1 of retail value. Seeded from data/source/prize-items.csv.';
comment on column public.prize_items.default_cost is
  'Standard cost in prize points. A professor may override it at the point of trade.';
comment on column public.prize_items.is_active is
  'False retires the item. Rows are never deleted, so history keeps pointing at them.';

grant select on public.prize_items to anon, authenticated;
grant insert, update, delete on public.prize_items to authenticated;

alter table public.prize_items enable row level security;

create policy prize_items_select_public
  on public.prize_items
  for select
  to anon, authenticated
  using (true);

create policy prize_items_insert_professor
  on public.prize_items
  for insert
  to authenticated
  with check (public.is_professor());

create policy prize_items_update_professor
  on public.prize_items
  for update
  to authenticated
  using (public.is_professor())
  with check (public.is_professor());

create policy prize_items_delete_professor
  on public.prize_items
  for delete
  to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- releases
-- ---------------------------------------------------------------------------
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  finalized_at timestamptz
);

comment on table public.releases is
  'A loyalty period. The active release is the one whose window contains today; there is deliberately no is_active column.';
comment on column public.releases.finalized_at is
  'Set when tier results are snapshotted into loyalty_results at the end of the release.';

grant select on public.releases to anon, authenticated;
grant insert, update, delete on public.releases to authenticated;

alter table public.releases enable row level security;

create policy releases_select_public
  on public.releases
  for select
  to anon, authenticated
  using (true);

create policy releases_insert_professor
  on public.releases
  for insert
  to authenticated
  with check (public.is_professor());

create policy releases_update_professor
  on public.releases
  for update
  to authenticated
  using (public.is_professor())
  with check (public.is_professor());

create policy releases_delete_professor
  on public.releases
  for delete
  to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- loyalty_tiers
-- ---------------------------------------------------------------------------
create table public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete restrict,
  tier_name text not null,
  product text not null,
  weeks_required integer not null,
  sort_order integer not null default 0,
  constraint loyalty_tiers_tier_name_check
    check (tier_name in ('Crystal', 'Gold', 'Silver')),
  constraint loyalty_tiers_release_id_tier_name_key
    unique (release_id, tier_name)
);

comment on table public.loyalty_tiers is
  'One set of rows per release. Tier names are stable; the product, the week threshold, and the number of tiers all vary by release.';
comment on column public.loyalty_tiers.tier_name is
  'Crystal, Gold, or Silver. Crystal is the highest tier.';
comment on column public.loyalty_tiers.product is
  'What this tier earns the right to buy at MSRP for this release.';

grant select on public.loyalty_tiers to anon, authenticated;
grant insert, update, delete on public.loyalty_tiers to authenticated;

alter table public.loyalty_tiers enable row level security;

create policy loyalty_tiers_select_public
  on public.loyalty_tiers
  for select
  to anon, authenticated
  using (true);

create policy loyalty_tiers_insert_professor
  on public.loyalty_tiers
  for insert
  to authenticated
  with check (public.is_professor());

create policy loyalty_tiers_update_professor
  on public.loyalty_tiers
  for update
  to authenticated
  using (public.is_professor())
  with check (public.is_professor());

create policy loyalty_tiers_delete_professor
  on public.loyalty_tiers
  for delete
  to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- Seed: earning_actions
-- ---------------------------------------------------------------------------
-- From data/source/earning-actions.csv, in sheet order. Labels are the sheet text with
-- trailing whitespace trimmed. Eligibility text stays in the label and is also
-- recorded in eligibility_note. is_active comes from the sheet's Is_active
-- column. "Professor Discretion" was text in the points column, so it is stored
-- as zero points plus a note.
insert into public.earning_actions
  (label, default_points, eligibility_note, notes, is_active, sort_order)
values
  ('Attend Sunday League', 1, null, null, true, 1),
  ('Create and donate a 30-card deck for learn to play', 4, null,
   'We are not currently accepting L2P decks', false, 2),
  ('Bring a friend to league', 5, null,
   '20 points for the whole month of October', true, 3),
  ('Run a learn to play session (masters only)', 10, 'Masters only', null, true, 4),
  ('Create and donate a rental library GLC format competitive deck', 10, null,
   'Proxy free rental GLC decks earn an extra 20 points', true, 5),
  ('Create and donate a rental library Standard format competitive deck', 10, null,
   'Proxy free rental decks earn an extra 10 points', true, 6),
  ('Update a competitive rental deck for a new meta', 3, null, null, true, 7),
  ('Play in casual league tournament', 1, null, null, true, 8),
  ('Play in a league Championship Event', 2, null, null, true, 9),
  ('Be a buddy for a new league attendee (juniors/seniors only)', 5,
   'Juniors/Seniors only', null, true, 10),
  ('Bring a snack or treat to share with the league', 2, null, null, true, 11),
  ('Participate in a league special event or contest', 1, null, null, true, 12),
  ('Material Donations (Sleeves, Deck Boxes, Playable cards, etc.)', 0, null,
   'Professor Discretion', true, 13),
  ('Be a founding member of the league', 15, null, null, false, 14);

-- ---------------------------------------------------------------------------
-- Seed: prize_items
-- ---------------------------------------------------------------------------
-- From data/source/prize-items.csv, in sheet order. That sheet has no is_active column, so
-- every row is imported as active; items are retired from the admin screens.
-- Labels are the sheet text with trailing whitespace trimmed.
insert into public.prize_items
  (label, default_cost, notes, is_active, sort_order)
values
  ('Arceus figurine', 10, null, true, 1),
  ('Bearbrick Pikachu worlds promo', 25,
   'This was a promo item from the 2024 Worlds Championship in HI', true, 2),
  ('Booster pack', 24, null, true, 3),
  ('Card binder - 160, small', 40, null, true, 4),
  ('Cardguard folio', 80, null, true, 5),
  ('Charizard playmat', 40, null, true, 6),
  ('Charizard statue', 200, null, true, 7),
  ('Cookbook', 80, null, true, 8),
  ('Deck boxes', 30, null, true, 9),
  ('Deck Boxes (premium)', 60, null, true, 10),
  ('Deck boxes (small)', 30, null, true, 11),
  ('Delibird league card', 16, null, true, 12),
  ('EUIC pen', 25, 'EUIC 2025', true, 13),
  ('Glaceon + Pikachu keychain', 10, null, true, 14),
  ('Metal damage markers', 8, null, true, 15),
  ('Painted binder - 3-ring', 100, null, true, 16),
  ('Pikachu dice bag', 8, null, true, 17),
  ('Pikachu eraser', 10, null, true, 18),
  ('Pikachu promo', 8, null, true, 19),
  ('Pikachu promo dice / damage markers', 8, null, true, 20),
  ('Plush - large', 130, null, true, 21),
  ('Plush - medium', 70, null, true, 22),
  ('Plush - small', 25, null, true, 23),
  ('Pokemon Center pins', 30, null, true, 24),
  ('Posters (print)', 120, null, true, 25),
  ('Professor''s Research - Juniper slab', 70, null, true, 26),
  ('Promo Card - stamped', 35, null, true, 27),
  ('Puzzle - 151', 10, null, true, 28),
  ('Shinx figure', 20, null, true, 29),
  ('Single magnetic slab - pokeball', 25, null, true, 30),
  ('Slab binder', 100, null, true, 31),
  ('Sleeves (premium)', 35, null, true, 32),
  ('Stickers - Pokemon center EUIC', 30, 'EUIC 2025', true, 33),
  ('Sweatshirt - Worlds sweatshirt youth L', 300, null, true, 34),
  ('Tin - 2-packs', 70, null, true, 35),
  ('Triple card set in slab', 100, null, true, 36),
  ('Various pins', 10, null, true, 37),
  ('Window cling', 20, null, true, 38);
