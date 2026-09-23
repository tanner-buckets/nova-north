-- Two things the badge model could not express.
--
-- 1. A secret badge. Every badge was listed on the programs page, so there was
--    no way to have one a player finds rather than works towards.
--
-- 2. More than one season at a time. current_badge_season() was max(season_year),
--    so the first badge of a new season retired the old one on the spot. During
--    a changeover both need to be awardable, and when a season ends is a
--    decision a professor makes rather than something a later row causes.

-- ---------------------------------------------------------------------------
-- 1. Secret badges
-- ---------------------------------------------------------------------------
alter table public.badges
  add column is_secret boolean not null default false;

comment on column public.badges.is_secret is
  'Kept off the programs page and out of the badge count until a player earns it. A professor sees it and can award it like any other. Secret is not the same as retired: a retired badge is finished with, a secret one is live but unannounced.';

-- ---------------------------------------------------------------------------
-- 2. Seasons end when a professor says so
-- ---------------------------------------------------------------------------
-- A row here is a retirement decision, nothing else. A season with no row is
-- active, so adding the first badge of a new year needs no bookkeeping and
-- cannot half-happen. Retiring is reversible: the row is flipped, not deleted.
create table public.badge_seasons (
  season_year integer primary key,
  is_active boolean not null default true,
  retired_at timestamptz,
  retired_by uuid references auth.users (id) on delete set null
);

comment on table public.badge_seasons is
  'Which badge seasons are still being awarded. A season with no row here is active: rows exist to record a professor retiring one, and are flipped rather than deleted so the decision stays visible.';

grant select on public.badge_seasons to anon, authenticated;
grant insert, update on public.badge_seasons to authenticated;
-- No delete. Un-retiring is is_active = true, which keeps retired_at as the
-- record of what happened.

alter table public.badge_seasons enable row level security;

create policy badge_seasons_select_public
  on public.badge_seasons for select to anon, authenticated using (true);
create policy badge_seasons_insert_professor
  on public.badge_seasons for insert to authenticated with check (public.is_professor());
create policy badge_seasons_update_professor
  on public.badge_seasons for update to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- ---------------------------------------------------------------------------
-- Which seasons count
-- ---------------------------------------------------------------------------
create or replace function public.active_badge_seasons()
returns setof integer
language sql
stable
set search_path = ''
as $function$
  select distinct b.season_year
  from public.badges b
  left join public.badge_seasons s on s.season_year = b.season_year
  where coalesce(s.is_active, true)
  order by 1 desc;
$function$;

comment on function public.active_badge_seasons() is
  'Seasons that have badges and have not been retired. A season with no badge_seasons row is active.';

-- Still the newest, but the newest ACTIVE one. Callers use it for a default:
-- which season a new badge lands in, which season a card is labelled with.
create or replace function public.current_badge_season()
returns integer
language sql
stable
set search_path = ''
as $function$
  select max(season) from public.active_badge_seasons() as season;
$function$;

comment on function public.current_badge_season() is
  'Newest season still being awarded. Was max(season_year) over every badge, which meant the first badge of a new year retired the old one on the spot.';

-- ---------------------------------------------------------------------------
-- Rank across an overlap
-- ---------------------------------------------------------------------------
-- The best rank any active season gives. During a changeover a player who
-- reached League Ace Trainer last season keeps it while last season is still
-- being awarded, and drops only when a professor retires that season. Judging
-- on the newest season alone would demote everybody the moment a new badge list
-- appeared, which is the opposite of what an overlap is for.
create or replace function public.best_player_rank(p_player_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_season integer;
  v_rank text;
  v_best text;
  v_order integer;
  v_best_order integer := -1;
begin
  for v_season in select * from public.active_badge_seasons() loop
    v_rank := public.player_rank(p_player_id, v_season);

    select sort_order into v_order
    from public.trainer_card_ranks where name = v_rank;

    if v_order is not null and v_order > v_best_order then
      v_best_order := v_order;
      v_best := v_rank;
    end if;
  end loop;

  if v_best is not null then
    return v_best;
  end if;

  -- No active season at all, or no ranks set up. Everybody starts somewhere.
  select name into v_best from public.trainer_card_ranks order by sort_order limit 1;
  return v_best;
end;
$function$;

comment on function public.best_player_rank(text) is
  'The highest rank any active season earns this player. Used instead of a single season so an overlap does not demote anybody.';

-- Which active season is carrying that rank, so a card can say so rather than
-- leaving a player to guess why they are still an Ace Trainer.
create or replace function public.best_rank_season(p_player_id text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_season integer;
  v_best_season integer;
  v_order integer;
  v_best_order integer := -1;
begin
  for v_season in select * from public.active_badge_seasons() loop
    select sort_order into v_order
    from public.trainer_card_ranks
    where name = public.player_rank(p_player_id, v_season);

    if v_order is not null and v_order > v_best_order then
      v_best_order := v_order;
      v_best_season := v_season;
    end if;
  end loop;

  return v_best_season;
end;
$function$;

grant execute on function public.active_badge_seasons() to anon, authenticated;
grant execute on function public.best_player_rank(text) to anon, authenticated;
grant execute on function public.best_rank_season(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The summary follows
-- ---------------------------------------------------------------------------
-- Changed from the previous version: badges and the badge count span every
-- active season rather than one; rank is the best of them; a secret badge is
-- absent from the count until this player has earned it.
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
  v_professor boolean;
  v_visible boolean;
  v_first text;
  v_last text;
  v_label text;
begin
  v_professor := public.is_professor();
  v_visible := public.id_visible(p_player_id);

  if not v_visible and not v_professor then
    return null;
  end if;

  select first_name, last_name into v_first, v_last
  from public.players
  where player_id = p_player_id;

  if not found then
    return null;
  end if;

  if v_professor then
    v_label := trim(coalesce(v_first, '') || ' ' || coalesce(v_last, ''));
  else
    v_label := public.display_label(p_player_id);
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

  -- Everything earned in a season still being awarded, newest season first so
  -- a card during an overlap leads with the current list.
  select coalesce(jsonb_agg(
           jsonb_build_object('code', b.code, 'name', b.name,
                              'season_year', b.season_year,
                              'is_secret', b.is_secret,
                              'image_path', b.image_path,
                              'tile_color', b.tile_color,
                              'tile_edge', b.tile_edge,
                              'awarded_on', pb.awarded_on)
           order by b.season_year desc, b.sort_order), '[]'::jsonb)
    into v_badges
  from public.player_badges pb
  join public.badges b on b.id = pb.badge_id
  where pb.player_id = p_player_id
    and b.season_year in (select * from public.active_badge_seasons());

  -- What is on offer: every active badge in an active season, except a secret
  -- one this player has not found. An unearned secret is not in the total, so
  -- nothing on the card hints that it exists.
  select count(*) into v_badges_available
  from public.badges b
  where b.is_active
    and b.season_year in (select * from public.active_badge_seasons())
    and (
      not b.is_secret
      or exists (select 1 from public.player_badges pb
                 where pb.player_id = p_player_id and pb.badge_id = b.id)
    );

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

  -- Elite 4 resets per season and is shown for the newest active one.
  select count(*) into v_elite
  from public.elite_four_wins
  where player_id = p_player_id and season_year = v_season;

  return jsonb_build_object(
    'player_id', p_player_id,
    'display_label', v_label,
    'point_balance', v_balance,
    'release_name', v_release_name,
    'loyalty_weeks', v_weeks,
    'tier_earned', public.tier_earned(v_weeks, v_release_id),
    'season_year', v_season,
    'rank', public.best_player_rank(p_player_id),
    'rank_season', public.best_rank_season(p_player_id),
    'active_seasons', (select coalesce(jsonb_agg(s order by s desc), '[]'::jsonb)
                       from public.active_badge_seasons() as s),
    'badges', v_badges,
    'badges_available', v_badges_available,
    'badge_seasons', v_seasons,
    'champion_seasons', v_champions,
    'elite_four_wins', v_elite,
    'history', v_history,
    'visible_publicly', v_visible
  );
end;
$function$;

comment on function public.get_player_summary(text) is
  'Player lookup. Null for an unknown ID, and for a player without ID visibility unless the caller is a professor. Badges and the badge count span every active season; rank is the best of them; an unearned secret badge is absent from the count.';
