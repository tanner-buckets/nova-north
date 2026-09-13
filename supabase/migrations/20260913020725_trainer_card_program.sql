-- The Trainer Card Program: ranks and badges as reference tables.
--
-- These are rows rather than page markup because professors need to edit them,
-- and because phase 6 has to record which badges each player has earned. A
-- player_badges table joins to badges; hardcoding the list in HTML would mean
-- rebuilding the page the moment tracking arrives.
--
-- Same shape as earning_actions and prize_items: publicly readable,
-- professor-writable, retired rather than deleted.

-- ---------------------------------------------------------------------------
-- trainer_card_ranks
-- ---------------------------------------------------------------------------
create table public.trainer_card_ranks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qualification text not null,
  reward text,
  benefit text,
  sort_order integer not null default 0
);

comment on table public.trainer_card_ranks is
  'The four ranks. sort_order runs lowest rank first, the order a player climbs them.';
comment on column public.trainer_card_ranks.reward is
  'Null where the rank carries no one-off reward.';

grant select on public.trainer_card_ranks to anon, authenticated;
grant insert, update, delete on public.trainer_card_ranks to authenticated;

alter table public.trainer_card_ranks enable row level security;

create policy trainer_card_ranks_select_public
  on public.trainer_card_ranks for select to anon, authenticated using (true);
create policy trainer_card_ranks_insert_professor
  on public.trainer_card_ranks for insert to authenticated with check (public.is_professor());
create policy trainer_card_ranks_update_professor
  on public.trainer_card_ranks for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy trainer_card_ranks_delete_professor
  on public.trainer_card_ranks for delete to authenticated using (public.is_professor());

-- ---------------------------------------------------------------------------
-- badges
-- ---------------------------------------------------------------------------
create table public.badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  task text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

comment on table public.badges is
  'The badges a player can earn. Thirteen exist; eight qualify a player for a Champion attempt.';
comment on column public.badges.code is
  'Stable short key. Names may be reworded; this is what player_badges will reference.';
comment on column public.badges.is_active is
  'False retires a badge. Rows are never deleted, so a player who earned it keeps it.';

grant select on public.badges to anon, authenticated;
grant insert, update, delete on public.badges to authenticated;

alter table public.badges enable row level security;

create policy badges_select_public
  on public.badges for select to anon, authenticated using (true);
create policy badges_insert_professor
  on public.badges for insert to authenticated with check (public.is_professor());
create policy badges_update_professor
  on public.badges for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy badges_delete_professor
  on public.badges for delete to authenticated using (public.is_professor());

-- ---------------------------------------------------------------------------
-- Seed, from the Trainer Card Program information sheet
-- ---------------------------------------------------------------------------
insert into public.trainer_card_ranks (name, qualification, reward, benefit, sort_order)
values
  ('League Trainer', 'Come to league three times', null,
   'Can earn badges', 1),
  ('League Cooltrainer', 'Earn 4 badges', 'Prize pack',
   'Priority registration for sanctioned events', 2),
  ('League Ace Trainer', 'Earn 8 badges', '25 prize points',
   'Can challenge the Elite 4, and a 10% prize wall discount', 3),
  ('League Champion', 'Beat the Elite 4', 'Prize pack and certificate',
   'Input into league planning, and may stand in as a proxy Elite 4', 4);

insert into public.badges (code, name, task, sort_order)
values
  ('raid',       'Raid',       'Win a Level 1 Raid, a Level 2 Raid, and a Level 3 Raid', 1),
  ('points',     'Points',     'Earn CP at a Continental League Cup or Challenge', 2),
  ('prerelease', 'Prerelease', 'Finish 3-0 at a Prerelease', 3),
  ('glc',        'GLC',        'Win a GLC event with any type', 4),
  ('vgc',        'VGC',        'Participate in a video game event at league', 5),
  ('snack',      'Snack',      'Bring a snack to share on a non-potluck day', 6),
  ('builder',    'Builder',    'Donate a rental deck in a professor approved format', 7),
  ('teacher',    'Teacher',    'Run a Learn to Play session for new players', 8),
  ('expert',     'Expert',     'Answer 2 judge qualifier type questions, one attempt each week', 9),
  ('attendance', 'Attendance', 'Play in 10 league events', 10),
  ('friendship', 'Friendship', 'Bring a friend to league who has not come before', 11),
  ('network',    'Network',    'Attend another league and get an energy card signed by a professor', 12),
  ('community',  'Community',  'Awarded at judge discretion, for going above and beyond to help our community', 13);
