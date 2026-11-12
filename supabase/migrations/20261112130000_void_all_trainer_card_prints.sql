-- Resetting who holds a Trainer Card, from the screen rather than a migration.
--
-- It has been done twice by hand now -- 20261022120000 when the programme
-- started over, and 20261031120000 when the artwork was redrawn and the print
-- size was corrected -- and both times the instruction was the same: everybody
-- needs a card again. A new season is the third time, and writing a migration
-- for it means a deploy for something a professor should be able to decide.
--
-- SECURITY DEFINER rather than an UPDATE grant on the table, for the reason
-- void_trainer_card_batch is: a grant would let any signed-in professor write
-- any column of any row from a browser. This touches three columns of the rows
-- that are not already voided and refuses everything else.
--
-- voided_by IS SET HERE, unlike in the two migrations. There it stayed null
-- because the table was being reset by a deploy and naming somebody would have
-- claimed a decision they did not make. Here a professor pressed a button, so
-- the row records who.
--
-- Already-voided rows are left alone rather than restamped, so a second press
-- is not a second, later-dated void of the same thing -- and it returns how
-- many it actually changed, which is what the screen reports. Rows are voided,
-- never removed: the print did happen, it just no longer counts toward whether
-- that player needs a card.

create or replace function public.void_all_trainer_card_prints(
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
    raise exception 'Only a professor may reset the Trainer Card prints';
  end if;

  update public.trainer_card_prints
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(nullif(btrim(p_reason), ''),
        'Reset so that every card is reissued.')
  where voided_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

comment on function public.void_all_trainer_card_prints(text) is
  'Professor only. Puts every card ever printed back on the list, for the start of a season or a change of artwork. Rows are voided, never removed. There is no single undo: use the Trainer Card Creator to reissue.';

revoke all on function public.void_all_trainer_card_prints(text) from anon;
grant execute on function public.void_all_trainer_card_prints(text) to authenticated;
