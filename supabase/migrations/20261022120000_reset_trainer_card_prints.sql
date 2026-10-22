-- Everybody needs a card again.
--
-- The prints recorded so far were made while the screen was being built and
-- tried out, so they say a card exists for people who are not holding one. The
-- "no card yet" button is only useful if it is true, and right now it is not.
--
-- VOIDED, NOT DELETED. trainer_card_prints is append only -- its own comment
-- says a reprint is another row and never an update -- and the rule everywhere
-- in this project is to void rather than remove: a point ledger entry is
-- reversed, an earning action is retired, a badge season is flipped. A delete
-- here would also throw away the one useful thing those rows carry, which is
-- that somebody stood at a printer on a particular day. Keeping them costs a
-- few hundred bytes and answers "did we already hand Maya one of these?" later.
--
-- A void is not a correction of the past. It says the print no longer counts
-- toward whether that player needs a card, which is exactly what is wanted:
-- the card was printed, and it is being reissued anyway.

alter table public.trainer_card_prints
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users (id) on delete set null,
  add column void_reason text;

comment on column public.trainer_card_prints.voided_at is
  'Set when a print stops counting toward whether a player needs a card. The row stays: it is still true that a card was printed that day.';
comment on column public.trainer_card_prints.void_reason is
  'Why, in words a professor would use. Null on a row that still counts.';

comment on table public.trainer_card_prints is
  'One row per card printed. Append only -- a reprint is another row, and a print that no longer counts is voided rather than removed. Not public: it is a list of who is in the league.';

-- Every print to date. voided_by stays null because this is not a person
-- voiding them one at a time; it is the table being reset before the screen is
-- used in earnest.
update public.trainer_card_prints
set voided_at = now(),
    void_reason = 'Reset before the Trainer Card Creator went into use. These '
                || 'prints were made while the screen was being built.'
where voided_at is null;

-- ---------------------------------------------------------------------------
-- The roster has to agree
-- ---------------------------------------------------------------------------
-- Only the has_card line changes. Without it the voided rows would still
-- answer "yes, they have one" and the reset would do nothing visible, which is
-- the failure that would be easiest to miss -- the migration would apply
-- cleanly and the screen would look exactly the same.
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
             where t.player_id = p.player_id
               and t.season_year = p_card_season
               and t.voided_at is null)
  from public.players p
  order by p.first_name, p.last_name;
end;
$function$;

-- The lookup is now always "prints that still count", so the index matches it.
drop index if exists public.trainer_card_prints_lookup_idx;

create index trainer_card_prints_live_idx
  on public.trainer_card_prints (season_year, player_id)
  where voided_at is null;

-- No new grants. authenticated still holds select and insert only. Voiding a
-- print from the app arrives in the next migration as a SECURITY DEFINER
-- function, which is why no UPDATE grant is handed out here: a function can be
-- told exactly which rows it may touch, where a grant cannot.
