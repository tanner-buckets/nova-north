-- Undoing a print run that never reached paper.
--
-- A card counts as printed the moment the dialog opens, because nothing tells
-- a page whether somebody went through with it. That is the right default --
-- assuming a card was NOT printed when it was leaves a professor handing out
-- duplicates -- but it leaves the opposite mistake with no way back: cancel the
-- dialog, or find the printer out of card stock, and twenty people have come
-- off the list holding nothing.
--
-- So the screen gets a button, and this is what it calls.
--
-- WHICH PRINTS, EXACTLY. "The ones just made" has to mean something precise or
-- the button is a guess. Voiding by player and season would catch whatever is
-- newest for those players, which is usually right and occasionally not -- two
-- professors at one league day, or a reprint for somebody who was missed. A
-- print run is a real thing that happened at one moment, so it gets an id and
-- the button names it.

alter table public.trainer_card_prints
  add column batch_id uuid;

create index trainer_card_prints_batch_idx
  on public.trainer_card_prints (batch_id)
  where batch_id is not null;

comment on column public.trainer_card_prints.batch_id is
  'The print run this row belongs to. One id per press of Create the cards, so a run can be undone without guessing which rows it was.';

-- ---------------------------------------------------------------------------
-- record_trainer_card_prints, now returning the run it created
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: it used to return a row count, and a return
-- type cannot be changed by CREATE OR REPLACE. The page is its only caller.
drop function if exists public.record_trainer_card_prints(integer, text[]);

create function public.record_trainer_card_prints(
  p_card_season integer,
  p_player_ids text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch uuid := gen_random_uuid();
begin
  if not public.is_professor() then
    raise exception 'Only a professor may record a Trainer Card print';
  end if;

  insert into public.trainer_card_prints (player_id, season_year, printed_by, batch_id)
  select unnest(p_player_ids), p_card_season, auth.uid(), v_batch;

  return v_batch;
end;
$function$;

comment on function public.record_trainer_card_prints(integer, text[]) is
  'Professor only. Logs a print run and returns its id, so the screen can offer to undo exactly that run.';

-- ---------------------------------------------------------------------------
-- void_trainer_card_batch
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER rather than an UPDATE grant on the table. A grant would let
-- a signed-in professor write any column of any row from the browser; this
-- touches three columns of the rows in one run and refuses everything else.
--
-- Already-voided rows are left alone rather than restamped, so pressing the
-- button twice is not a second, later-dated void of the same thing. It returns
-- how many it actually changed, which is what the screen reports.
create or replace function public.void_trainer_card_batch(
  p_batch_id uuid,
  p_reason text default null
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
    raise exception 'Only a professor may void a Trainer Card print';
  end if;

  if p_batch_id is null then
    raise exception 'A print run has to be named to be undone';
  end if;

  update public.trainer_card_prints
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(nullif(btrim(p_reason), ''), 'The cards were not printed.')
  where batch_id = p_batch_id
    and voided_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

comment on function public.void_trainer_card_batch(uuid, text) is
  'Professor only. Puts one print run back on the list, for when the cards never reached paper. Rows are voided, never removed.';

revoke all on function public.record_trainer_card_prints(integer, text[]) from anon;
revoke all on function public.void_trainer_card_batch(uuid, text) from anon;
grant execute on function public.record_trainer_card_prints(integer, text[]) to authenticated;
grant execute on function public.void_trainer_card_batch(uuid, text) to authenticated;
