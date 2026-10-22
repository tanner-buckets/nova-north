-- The player card carries a TCG Live name, and a contact where one is public.
--
-- get_player_summary() is the only thing a player card reads, and it already
-- knows whether this caller is a professor and whether the player is visible.
-- Those are exactly the two questions these fields turn on, so they belong
-- here rather than in a second call the page would have to keep in step.
--
--   ptcg_live  a game handle. Public wherever the player is public.
--   contact    a way to reach somebody. A professor always sees it. Anybody
--              else only where show_contact is set AND id_visible() holds, so
--              it cannot outlive the consent that published it.
--   contact_public  whether the handle above is on the public card as well.
--              Contact was private without exception until today; a professor
--              who learned that rule should not have to assume it still holds.
--
-- Reproduced whole because a function body cannot be patched. Only the three
-- marked places differ from 20260923100000.

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
  v_ptcg text;
  v_contact text;
  v_contact_public boolean;
begin
  v_professor := public.is_professor();
  v_visible := public.id_visible(p_player_id);

  if not v_visible and not v_professor then
    return null;
  end if;

  select first_name, last_name, ptcg_live,
         -- Contact goes out to a professor always, and to everybody else only
         -- where the player asked for it AND their listing is in force. It
         -- rides on id_visible(), so it lapses when the rest of their consent
         -- does rather than outliving it.
         case when v_professor or (show_contact and v_visible)
              then contact else null end,
         (show_contact and v_visible)
    into v_first, v_last, v_ptcg, v_contact, v_contact_public
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
    'visible_publicly', v_visible,
    'ptcg_live', v_ptcg,
    'contact', v_contact,
    -- So a professor can see at a glance whether the handle in front of them
    -- is on the public card too. Contact used to be private without exception,
    -- and somebody who learned that rule should not have to assume it still
    -- holds.
    'contact_public', v_contact_public
  );
end;
$function$;
