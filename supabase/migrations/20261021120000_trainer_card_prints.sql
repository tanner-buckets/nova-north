-- Printing Trainer Cards.
--
-- `admin/trainer-cards.html` builds a list of players and prints one card each,
-- eight to a Letter page. Three things are needed from the database and none of
-- them existed:
--
--   1. A record of who has had a card printed, so "nobody has a card yet" is
--      answerable. Nothing anywhere recorded this.
--   2. A roster to choose from, carrying enough to decide who needs a card and
--      NOT carrying a birth year.
--   3. The card contents for the chosen players only, which is where the birth
--      year and the badge artwork come in.
--
-- The split between 2 and 3 is the point. A birth year is a protected field. A
-- professor may read one, and the card prints one, but shipping four hundred of
-- them to a browser so it can draw a list nobody has chosen from yet is handing
-- out protected data for no reason. The roster answers "who needs a card"; the
-- batch answers "what goes on these cards".
--
-- TWO SEASONS, AND THEY ARE NOT THE SAME ONE. Every function here takes the
-- season it needs rather than asking current_badge_season(), because a card
-- printed now shows what a player earned LAST season while being issued as
-- THIS season's card. The page passes 2026 for the badges and the rank, and
-- 2027 for the print record. Baking either number into SQL would make that
-- pairing invisible and a migration to change; as parameters it is two
-- constants at the top of trainer-cards.js.

-- ---------------------------------------------------------------------------
-- trainer_card_prints
-- ---------------------------------------------------------------------------
-- Append only, like the point ledger: a reprint is another row, never an update.
-- The question this answers is "has anybody printed one of these yet", and a
-- card that was printed and then reprinted was still printed.
create table public.trainer_card_prints (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  season_year integer not null,
  printed_at timestamptz not null default now(),
  printed_by uuid references auth.users (id) on delete set null
);

create index trainer_card_prints_lookup_idx
  on public.trainer_card_prints (season_year, player_id);

comment on table public.trainer_card_prints is
  'One row per card printed. Append only -- a reprint is another row. Not public: it is a list of who is in the league.';
comment on column public.trainer_card_prints.season_year is
  'Which season the card was ISSUED for, which is not necessarily the season whose badges it shows. A player who had a 2026 card still needs a 2027 one.';

-- No public read at any consent level: this is a roll of who belongs to the
-- league, which is the same thing a pre-registration list is.
grant select, insert on public.trainer_card_prints to authenticated;

alter table public.trainer_card_prints enable row level security;

create policy trainer_card_prints_select_professor
  on public.trainer_card_prints for select to authenticated
  using (public.is_professor());

create policy trainer_card_prints_insert_professor
  on public.trainer_card_prints for insert to authenticated
  with check (public.is_professor());

-- ---------------------------------------------------------------------------
-- trainer_card_roster
-- ---------------------------------------------------------------------------
-- Everyone, with what the screen needs to decide who gets a card. No birth
-- year: see the note at the top.
--
-- `attended_recently` is the same three month window the consent rules use.
-- Active has to mean one thing across this site or it means nothing.
create or replace function public.trainer_card_roster(
  p_badge_season integer,
  p_card_season integer
)
returns table (
  player_id text,
  first_name text,
  last_name text,
  rank_name text,
  badge_count integer,
  attended_recently boolean,
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
    exists (select 1 from public.attendance a
             where a.player_id = p.player_id
               and a.attended_on >= current_date - interval '3 months'),
    exists (select 1 from public.trainer_card_prints t
             where t.player_id = p.player_id and t.season_year = p_card_season)
  from public.players p
  order by p.first_name, p.last_name;
end;
$function$;

comment on function public.trainer_card_roster(integer, integer) is
  'Professor only. The choosing list for the Trainer Card screen: rank and badges from the badge season, has_card from the card season. Deliberately carries no birth year.';

-- ---------------------------------------------------------------------------
-- trainer_card_batch
-- ---------------------------------------------------------------------------
-- What actually goes on the cards, for the chosen players only.
--
-- The badges come back as jsonb rather than a joined row per badge, because the
-- page draws one card per player and a player with nine badges should not
-- arrive as nine rows to be regrouped in a browser.
--
-- Secret badges are included. A secret badge is unannounced, not unearned, and
-- the rule everywhere else is that once it is earned it is on the card.
create or replace function public.trainer_card_batch(
  p_badge_season integer,
  p_player_ids text[]
)
returns table (
  player_id text,
  first_name text,
  last_name text,
  birth_year integer,
  rank_name text,
  badges jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may print Trainer Cards';
  end if;

  return query
  select
    p.player_id,
    p.first_name,
    p.last_name,
    p.birth_year,
    public.player_rank(p.player_id, p_badge_season),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', b.code,
               'name', b.name,
               'image_path', b.image_path,
               'tile_color', b.tile_color)
             order by b.sort_order)
        from public.player_badges pb
        join public.badges b on b.id = pb.badge_id
       where pb.player_id = p.player_id and b.season_year = p_badge_season
    ), '[]'::jsonb)
  from public.players p
  where p.player_id = any (p_player_ids)
  order by p.first_name, p.last_name;
end;
$function$;

comment on function public.trainer_card_batch(integer, text[]) is
  'Professor only. Everything printed on a card, for the chosen players only. Carries a birth year, which is why it is scoped to a chosen list rather than returning the roll.';

-- ---------------------------------------------------------------------------
-- record_trainer_card_prints
-- ---------------------------------------------------------------------------
-- Called when the print view is built, not when the paper comes out -- a page
-- is never told whether somebody went through with the print dialog or
-- cancelled it. A cancelled print therefore counts as printed. The screen says
-- so, and a card can always be printed again.
create or replace function public.record_trainer_card_prints(
  p_card_season integer,
  p_player_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may record a Trainer Card print';
  end if;

  insert into public.trainer_card_prints (player_id, season_year, printed_by)
  select unnest(p_player_ids), p_card_season, auth.uid();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

comment on function public.record_trainer_card_prints(integer, text[]) is
  'Professor only. Logs that cards were produced, so the screen can offer everyone without one.';

revoke all on function public.trainer_card_roster(integer, integer) from anon;
revoke all on function public.trainer_card_batch(integer, text[]) from anon;
revoke all on function public.record_trainer_card_prints(integer, text[]) from anon;
grant execute on function public.trainer_card_roster(integer, integer) to authenticated;
grant execute on function public.trainer_card_batch(integer, text[]) to authenticated;
grant execute on function public.record_trainer_card_prints(integer, text[]) to authenticated;
