-- Badges become seasonal, and the Trainer Card gains its missing pieces.
--
-- What changed: each season has its own badge list. Names may repeat year to
-- year, rank is judged on the most recent season's badges, and a player can be
-- Champion in more than one season.
--
-- Three consequences shape this migration:
--
--   1. A badge carries its season, not the award. That is what makes the
--      September-October overlap work: a 2026 badge earned in October 2026 still
--      counts toward 2026, because the badge row says which season it belongs to.
--
--   2. Rank is never stored, for any season. Badges persist and carry their
--      season, so rank for 2026 is still derivable in 2030: count that season's
--      badges, and check whether they won Champion that year.
--
--   3. Champion becomes a table rather than a column. One row per season won,
--      which is what lets a two-time Champion show two stars.
--
-- The thirteen seeded badges are the 2025-26 list, so they belong to season 2026.

-- ---------------------------------------------------------------------------
-- badges gain a season
-- ---------------------------------------------------------------------------
alter table public.badges add column season_year integer;

update public.badges set season_year = 2026;

alter table public.badges alter column season_year set not null;

-- A code is unique within a season, not across all time. "Snack" can exist in
-- 2026 and again in 2027 as separate badges that separate players earn.
alter table public.badges drop constraint badges_code_key;
alter table public.badges add constraint badges_season_code_key unique (season_year, code);

create index badges_season_idx on public.badges (season_year);

comment on column public.badges.season_year is
  'The Play! Pokemon season this badge belongs to, named for the year it ends in. The award date may fall outside it: badges from the previous season can still be earned into September and October.';

-- The season whose badges currently count. Derived as the latest season with a
-- badge list, so adding next year's badges is what advances it -- no flag to
-- flip, and the autumn overlap needs no special case.
create or replace function public.current_badge_season()
returns integer
language sql
stable
set search_path = ''
as $function$
  select max(season_year) from public.badges;
$function$;

grant execute on function public.current_badge_season() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- champion_awards
-- ---------------------------------------------------------------------------
create table public.champion_awards (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  season_year integer not null,
  awarded_on date not null default current_date,
  awarded_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),

  -- Champion once per season. Winning it twice in one year is a mistake.
  constraint champion_awards_once_per_season unique (player_id, season_year)
);

create index champion_awards_player_idx on public.champion_awards (player_id);

comment on table public.champion_awards is
  'One row per season a player became League Champion. A player with three rows has three stars.';

grant select, insert, delete on public.champion_awards to authenticated;
-- No UPDATE: an award is either right, or removed and re-recorded.

alter table public.champion_awards enable row level security;

create policy champion_awards_select_professor
  on public.champion_awards for select to authenticated using (public.is_professor());
create policy champion_awards_insert_professor
  on public.champion_awards for insert to authenticated with check (public.is_professor());
create policy champion_awards_delete_professor
  on public.champion_awards for delete to authenticated using (public.is_professor());

-- The single-date column this replaces never held a value, and it cannot record
-- being Champion in two seasons, so it goes rather than sitting there
-- contradicting the table above.
alter table public.players drop column champion_awarded_on;

-- ---------------------------------------------------------------------------
-- elite_four_wins
-- ---------------------------------------------------------------------------
-- Four battles, all four needed for Champion. Only wins are recorded, so a
-- failed attempt leaves no trace and can simply be tried again. Rows are
-- season-scoped, which is what makes progress reset each year.
create table public.elite_four_wins (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  season_year integer not null,
  battle_number integer not null check (battle_number between 1 and 4),
  won_on date not null default current_date,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint elite_four_wins_once unique (player_id, season_year, battle_number)
);

create index elite_four_wins_player_idx on public.elite_four_wins (player_id, season_year);

comment on table public.elite_four_wins is
  'One row per Elite 4 battle won, per season. Losses are not recorded; a battle can be re-attempted until it is won.';

grant select, insert, delete on public.elite_four_wins to authenticated;

alter table public.elite_four_wins enable row level security;

create policy elite_four_wins_select_professor
  on public.elite_four_wins for select to authenticated using (public.is_professor());
create policy elite_four_wins_insert_professor
  on public.elite_four_wins for insert to authenticated with check (public.is_professor());
create policy elite_four_wins_delete_professor
  on public.elite_four_wins for delete to authenticated using (public.is_professor());

-- ---------------------------------------------------------------------------
-- Rank, derived
-- ---------------------------------------------------------------------------
-- Champion outranks everything. Otherwise it is the highest rank whose badge
-- threshold is met, falling back to the entry rank. Thresholds come from
-- trainer_card_ranks, so changing what Ace Trainer needs is an UPDATE.
create or replace function public.player_rank(p_player_id text, p_season integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_badges integer;
  v_rank text;
begin
  if exists (
    select 1 from public.champion_awards
    where player_id = p_player_id and season_year = p_season
  ) then
    select name into v_rank from public.trainer_card_ranks
    where requires_elite_four order by sort_order desc limit 1;
    if v_rank is not null then
      return v_rank;
    end if;
  end if;

  select count(*) into v_badges
  from public.player_badges pb
  join public.badges b on b.id = pb.badge_id
  where pb.player_id = p_player_id and b.season_year = p_season;

  select name into v_rank from public.trainer_card_ranks
  where badges_required is not null and badges_required <= v_badges
  order by badges_required desc limit 1;

  if v_rank is not null then
    return v_rank;
  end if;

  -- Entry rank: everyone who turns up starts here.
  select name into v_rank from public.trainer_card_ranks order by sort_order limit 1;
  return v_rank;
end;
$function$;

comment on function public.player_rank(text, integer) is
  'Rank for one player in one season. Never stored: badges carry their season, so a past season stays derivable indefinitely.';

grant execute on function public.player_rank(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_player_summary, extended
-- ---------------------------------------------------------------------------
-- Adds the Trainer Card to what a player sees: their rank this season, the
-- badges they hold, how far they are through the Elite 4, and every season they
-- have been Champion.
--
-- Still returns null for an unknown Player ID and for a player without ID
-- visibility, which must stay indistinguishable, or the function becomes a way
-- to discover which IDs exist.
create or replace function public.get_player_summary(p_player_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_release_id uuid;
  v_release_name text;
  v_weeks integer;
  v_balance integer;
  v_history jsonb;
  v_season integer;
  v_badges jsonb;
  v_badges_available integer;
  v_seasons jsonb;
  v_champions jsonb;
  v_elite integer;
begin
  if not public.id_visible(p_player_id) then
    return null;
  end if;

  select id, name into v_release_id, v_release_name
  from public.releases
  where current_date between starts_on and ends_on
  order by starts_on desc
  limit 1;

  if v_release_id is not null then
    v_weeks := public.loyalty_weeks(p_player_id, v_release_id);
  end if;

  select coalesce(sum(delta), 0) into v_balance
  from public.point_ledger where player_id = p_player_id;

  select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb) into v_history
  from (
    select l.created_at,
           l.delta,
           coalesce(l.reason, a.label, p.label) as description,
           l.voids_id is not null as is_correction
    from public.point_ledger l
    left join public.earning_actions a on a.id = l.earning_action_id
    left join public.prize_items p on p.id = l.prize_item_id
    where l.player_id = p_player_id
  ) h;

  v_season := public.current_badge_season();

  select coalesce(jsonb_agg(
           jsonb_build_object('code', b.code, 'name', b.name, 'awarded_on', pb.awarded_on)
           order by b.sort_order), '[]'::jsonb)
    into v_badges
  from public.player_badges pb
  join public.badges b on b.id = pb.badge_id
  where pb.player_id = p_player_id and b.season_year = v_season;

  select count(*) into v_badges_available
  from public.badges where season_year = v_season and is_active;

  -- One entry per season this player earned anything, newest first. Rank is
  -- recomputed rather than remembered, so a past season stays accurate even if
  -- a badge is corrected years later.
  select coalesce(jsonb_agg(s order by s.season_year desc), '[]'::jsonb) into v_seasons
  from (
    select b.season_year,
           count(*) as badges_earned,
           public.player_rank(p_player_id, b.season_year) as rank
    from public.player_badges pb
    join public.badges b on b.id = pb.badge_id
    where pb.player_id = p_player_id
    group by b.season_year
  ) s;

  select coalesce(jsonb_agg(season_year order by season_year desc), '[]'::jsonb)
    into v_champions
  from public.champion_awards where player_id = p_player_id;

  select count(*) into v_elite
  from public.elite_four_wins
  where player_id = p_player_id and season_year = v_season;

  return jsonb_build_object(
    'player_id', p_player_id,
    'display_label', public.display_label(p_player_id),
    'point_balance', v_balance,
    'release_name', v_release_name,
    'loyalty_weeks', v_weeks,
    'tier_earned', public.tier_earned(v_weeks, v_release_id),
    'season_year', v_season,
    'rank', public.player_rank(p_player_id, v_season),
    'badges', v_badges,
    'badges_available', v_badges_available,
    'badge_seasons', v_seasons,
    'champion_seasons', v_champions,
    'elite_four_wins', v_elite,
    'history', v_history
  );
end;
$function$;

grant execute on function public.get_player_summary(text) to anon, authenticated;
