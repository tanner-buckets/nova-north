-- The badge board: every player against one season's badges, in one read.
--
-- The professor screens answer questions about one player at a time. This is
-- the other direction -- who has earned Raid, who is on five badges, who is one
-- short of the Cooltrainer threshold -- and until now the only way to ask it
-- was to open forty Trainer Cards one after another.
--
-- One row per player and not one row per player per badge. A few hundred
-- players against thirteen badges is a few thousand rows to say what fits in a
-- few hundred, and the screen wants them grouped by player anyway.
--
-- Everything is returned and the filtering happens in the page: a professor
-- narrowing by attendance or by badge count is re-asking the same question of
-- the same rows, and a round trip per keystroke would make it feel broken. The
-- payload is names and ids, which this screen is already allowed to show, and
-- NO BIRTH YEAR AND NO DIVISION -- the same line trainer_card_roster holds.

create function public.badge_board(p_season integer)
returns table (
  player_id text,
  first_name text,
  last_name text,
  badge_count integer,
  recent_days integer,
  earned uuid[],
  steps jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may read the badge board';
  end if;

  return query
  with season_badges as (
    -- EVERY badge in the season, retired ones included, because that is what
    -- player_rank() counts. CLAUDE.md says retiring a badge stops it counting
    -- towards rank and the function does not actually do that -- it joins on
    -- season_year alone. Counting differently here would put a number on this
    -- screen that disagrees with the rank on the player's own card, which is a
    -- worse problem than the one it would be trying to fix. The screen marks
    -- retired badges instead, so the disagreement is visible rather than
    -- silently baked into a total.
    select b.id, b.step_count
      from public.badges b
     where b.season_year = p_season
  ),
  held as (
    select pb.player_id,
           array_agg(pb.badge_id) as ids,
           count(*)::integer as n
      from public.player_badges pb
      join season_badges sb on sb.id = pb.badge_id
     group by pb.player_id
  ),
  stepped as (
    select g.player_id, jsonb_object_agg(g.badge_id::text, g.n) as js
      from (
        select bp.player_id, bp.badge_id, count(*)::integer as n
          from public.badge_progress bp
          join season_badges sb on sb.id = bp.badge_id
         where sb.step_count is not null
           -- A step recorded above what the badge now asks for lies dormant,
           -- and the Trainer Card screen does not draw it. Counting it here
           -- would report "4 of 3" on a board nobody could reconcile.
           and bp.step_number <= sb.step_count
         group by bp.player_id, bp.badge_id
      ) g
     group by g.player_id
  ),
  recent as (
    -- Three months is the window consent uses, and active has to mean one
    -- thing across this site.
    --
    -- count(distinct) rather than count(*), to match trainer_card_roster
    -- exactly -- two screens reporting a different number for "how recently
    -- have they been here" is the kind of thing nobody reconciles. It is
    -- belt and braces either way: attendance_one_per_day is a unique
    -- constraint on (player_id, attended_on), so a second row for one Sunday
    -- cannot exist. CLAUDE.md says one can, and says that is why this is
    -- distinct; the constraint has been there since the table was created and
    -- no migration has dropped it.
    select a.player_id, count(distinct a.attended_on)::integer as n
      from public.attendance a
     where a.attended_on >= current_date - interval '3 months'
     group by a.player_id
  )
  select
    p.player_id,
    p.first_name,
    p.last_name,
    coalesce(h.n, 0),
    coalesce(r.n, 0),
    -- An empty array rather than null, so the page never has to ask which kind
    -- of nothing it was looking at.
    coalesce(h.ids, array[]::uuid[]),
    coalesce(s.js, '{}'::jsonb)
  from public.players p
  left join held h on h.player_id = p.player_id
  left join stepped s on s.player_id = p.player_id
  left join recent r on r.player_id = p.player_id
  order by p.first_name, p.last_name;
end;
$function$;

comment on function public.badge_board(integer) is
  'Professor only. One row per player for a badge season: how many of that season''s badges they hold, which ones, how far through any stepped badge they are, and distinct days attended in the last three months. Carries no birth year and no division.';

-- Postgres grants EXECUTE on a new function to PUBLIC by default, so the grant
-- below is not what decides who may call this -- without the revoke, anon can
-- call it too. The is_professor() guard inside is the thing that actually
-- refuses, and it would refuse anon anyway, but a function that reads every
-- player's name should not be reachable by a role that has no business asking.
-- Same posture player_identity_matches() takes.
revoke execute on function public.badge_board(integer) from public;
grant execute on function public.badge_board(integer) to authenticated;

-- The seasons this screen can be pointed at. current_badge_season() is the
-- newest and active_badge_seasons() is the ones still being awarded; this is
-- every season that has a badge list at all, because last year's board is a
-- real thing somebody may want to look at.
create function public.badge_seasons_all()
returns table (season_year integer, badge_count integer)
language sql
stable
set search_path = ''
as $function$
  select b.season_year, count(*)::integer
    from public.badges b
   group by b.season_year
   order by b.season_year desc;
$function$;

comment on function public.badge_seasons_all() is
  'Every season that has badges, newest first. Not the same as active_badge_seasons(), which is only the ones still being awarded.';

grant execute on function public.badge_seasons_all() to anon, authenticated;
