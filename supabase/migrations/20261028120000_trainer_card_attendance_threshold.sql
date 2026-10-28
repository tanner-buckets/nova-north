-- How many Sundays in the last three months, not merely whether there was one.
--
-- `trainer_card_roster` returned `attended_recently`, a boolean: did this
-- player turn up at all inside the three month window. That is the right
-- question for consent, which is where the window comes from, and it is a
-- blunt one for deciding who gets a printed card -- somebody who came once in
-- August is on the same footing as somebody who has not missed a week.
--
-- So the boolean becomes the count behind it, and the screen gets to choose
-- the threshold. One is what the boolean meant, so the default changes
-- nothing; the professor can raise it to four, which on roughly thirteen
-- Sundays is somebody who is actually around.
--
-- COUNT(DISTINCT attended_on), not count(*). A player entered in two events on
-- one Sunday has two attendance rows, and the league's own rule is one loyalty
-- week per calendar day however many events were played. Counting rows would
-- quietly promote anybody who plays the side event.
--
-- The window stays at three months and stays fixed. Active has to mean one
-- thing across this site or it means nothing; what is new is how much
-- attendance counts as active, not how far back anybody looks.
--
-- Dropped and recreated rather than replaced: a `returns table` column list is
-- part of the signature, and Postgres refuses to change one in place. Nothing
-- but the Trainer Card Creator calls this.

drop function if exists public.trainer_card_roster(integer, integer);

create function public.trainer_card_roster(
  p_badge_season integer,
  p_card_season integer
)
returns table (
  player_id text,
  first_name text,
  last_name text,
  rank_name text,
  badge_count integer,
  recent_days integer,
  has_card boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may read the Trainer Card roster';
  end if;

  return query
  select
    p.player_id,
    p.first_name,
    p.last_name,
    public.player_rank(p.player_id, p_badge_season),
    (select count(*)::integer
       from public.player_badges pb
       join public.badges b on b.id = pb.badge_id
      where pb.player_id = p.player_id and b.season_year = p_badge_season),
    (select count(distinct a.attended_on)::integer
       from public.attendance a
      where a.player_id = p.player_id
        and a.attended_on >= current_date - interval '3 months'),
    exists (select 1 from public.trainer_card_prints t
             where t.player_id = p.player_id
               and t.season_year = p_card_season
               and t.voided_at is null)
  from public.players p
  order by p.first_name, p.last_name;
end;
$function$;

comment on function public.trainer_card_roster(integer, integer) is
  'Professor only. The choosing list for the Trainer Card screen: rank and badges from the badge season, has_card from the card season, recent_days as distinct days attended in the last three months. Deliberately carries no birth year.';

grant execute on function public.trainer_card_roster(integer, integer) to authenticated;
