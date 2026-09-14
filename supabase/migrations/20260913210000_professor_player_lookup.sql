-- A professor looking a player up should find them.
--
-- get_player_summary() returns null for anyone whose Player ID visibility is not
-- in force, which is right for the public and wrong for the people running the
-- league. A professor already reads every name on the admin screens; having the
-- player lookup answer "no such player" for a child is not a privacy measure, it
-- is a professor being lied to about their own league.
--
-- Consent decides what the PUBLIC sees. It was never meant to decide what a
-- professor can look up.
--
-- Nothing else changes. For an anonymous caller the behaviour is identical: the
-- visibility gate still applies, the label still comes from display_label(), and
-- a player without consent is still invisible. public_players is untouched, so
-- the browse list the public reads is unchanged.

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

  -- Checked separately now. The visibility gate used to double as an existence
  -- check, because an unknown ID is never visible; a professor passes that gate,
  -- so an unknown ID has to be refused on its own or this would answer for
  -- players who do not exist.
  select first_name, last_name into v_first, v_last
  from public.players
  where player_id = p_player_id;

  if not found then
    return null;
  end if;

  -- A professor sees the real name. Everyone else sees whatever consent allows,
  -- which is the Player ID alone, first name and last initial, or nothing.
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
    'display_label', v_label,
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
    'history', v_history,
    -- So a professor can be told they are looking at somebody the public cannot
    -- see. An anonymous caller only ever receives this as true, because a false
    -- one returned null above.
    'visible_publicly', v_visible
  );
end;
$function$;

comment on function public.get_player_summary(text) is
  'Player lookup. Returns null for an unknown ID, and for a player without ID visibility unless the caller is a professor. A professor sees every player and their real name; everyone else sees only what consent allows.';
