-- check_registration: a player asking "am I registered for this event?"
--
-- The only confirmation a registration ever produced was the message on the
-- form, and there is no email, so somebody who closed the tab had no way to find
-- out short of asking at the desk. This answers it for one event.
--
-- Who registered is never public, so this is not a lookup. It takes the same
-- proof request_drop() takes -- Player ID AND the first name on the
-- registration -- and an unknown ID, a wrong name and no registration at all
-- return the SAME answer. Telling them apart would make it a way to test which
-- Player IDs are signed up, and then to guess names against them.
--
-- No player record is involved. The first name being checked is the one typed
-- on the registration, so this works for a first-timer the players table has
-- never heard of, for a child hidden by default, and for anybody whose listing
-- has lapsed -- which is most of the people who are unsure.
--
-- It returns the status and, on the waiting list, the place in the queue as it
-- stands now. Not the stored waitlist_position: that number keeps its gaps when
-- somebody ahead is promoted or drops, so the third person waiting could still
-- be "number 7". Division is not returned; it is protected, and the person
-- asking already gave the birth year it came from.

create or replace function public.check_registration(
  p_player_id text,
  p_first_name text,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_reg public.registrations%rowtype;
  v_place integer;
begin
  -- A live registration outranks an old dropped one: somebody who dropped and
  -- registered again wants to hear about the place they hold now.
  select * into v_reg
  from public.registrations
  where event_id = p_event_id
    and player_id = btrim(coalesce(p_player_id, ''))
    and lower(first_name) = lower(btrim(coalesce(p_first_name, '')))
  order by (status <> 'dropped') desc, created_at desc
  limit 1;

  -- Deliberately identical whatever the reason nothing matched.
  if not found then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  if v_reg.status = 'waitlist' then
    select count(*) into v_place
    from public.registrations
    where event_id = p_event_id
      and status = 'waitlist'
      and waitlist_position <= v_reg.waitlist_position;
  end if;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'status', v_reg.status,
    'waitlist_place', v_place);
end;
$function$;

comment on function public.check_registration(text, text, uuid) is
  'A player checking their own registration for one event. Requires Player ID and matching first name, and answers identically for every kind of no-match, so it cannot be used to discover who is registered.';

revoke all on function public.check_registration(text, text, uuid) from public;
grant execute on function public.check_registration(text, text, uuid) to anon, authenticated;
