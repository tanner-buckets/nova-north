-- Registration had no closing time and no way to close it.
--
-- register_for_event() checked one thing: events.registration_open. Nothing
-- looked at the date, so an event that happened last month would still take a
-- registration today, for ever. The schedule hides a past event and the event
-- page says it has happened, but both of those are page code, and the anon key
-- can call the function directly.
--
-- And there was no way for a professor to stop it early. The nearest thing was
-- turning registration_open off, which is the wrong switch: it means "this
-- event does not take registration at all", and it takes the event off the drop
-- confirmation screen and out of the printable desk list. Closing a full
-- prerelease the night before would have deleted the list somebody needed at the
-- desk the next morning.
--
-- So: one automatic rule in the database, and one flag a professor controls.

-- ---------------------------------------------------------------------------
-- 1. Closed by hand
-- ---------------------------------------------------------------------------
-- A timestamp rather than a boolean, because "when did we stop taking people"
-- is the question asked afterwards, and a boolean cannot answer it. Null means
-- nobody has closed it, which is the state every event starts in.
alter table public.events
  add column registration_closed_at timestamptz,
  add column registration_closed_by uuid references auth.users (id) on delete set null;

comment on column public.events.registration_closed_at is
  'When a professor closed registration early. Null means they have not. Separate from registration_open, which says whether the event takes registration at all: this one closes a door that was open, and leaves the event on the drop screen and the desk list where it belongs.';
comment on column public.events.registration_closed_by is
  'The professor who closed it. Null if it was never closed, or if their account has since been removed.';

-- A professor recorded against no closure is a half-written decision, and the
-- screen would have nothing to show for it. The other way round is allowed:
-- registration_closed_by goes null when an account is removed, and losing the
-- name must not lose the fact that somebody closed it.
alter table public.events
  add constraint events_registration_closed_by_needs_a_closure
  check (registration_closed_by is null or registration_closed_at is not null);

-- ---------------------------------------------------------------------------
-- 2. Closed by the clock
-- ---------------------------------------------------------------------------
-- Replaced whole. Changed from the previous version: two refusals added before
-- any row is written, and nothing else. The division logic, the one-confirmed-
-- place-per-flight-group rule, the capacity handling and the waitlist numbering
-- are carried across unaltered.
create or replace function public.register_for_event(
  p_event_id uuid,
  p_player_id text,
  p_first_name text,
  p_last_name text,
  p_birth_year integer,
  p_contact text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_division text;
  v_total_cap integer;
  v_division_cap integer;
  v_taken integer;
  v_status text;
  v_position integer;
  v_existing text;
  v_ip inet;
begin
  -- The caller's address is recorded, but nothing is refused on the strength of
  -- it. Everyone on the store's wifi shares one public address, so a per-address
  -- cap would turn a busy prerelease sign-up into a wall of rejections for
  -- legitimate players. Detection is the right tool here, not prevention.
  begin
    v_ip := split_part(
              coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
              ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;

  if p_player_id is null or btrim(p_player_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'player_id_required');
  end if;
  p_player_id := btrim(p_player_id);

  if p_first_name is null or btrim(p_first_name) = ''
     or p_last_name is null or btrim(p_last_name) = ''
     or p_birth_year is null then
    return jsonb_build_object('ok', false, 'code', 'missing_details');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_event');
  end if;

  if not v_event.registration_open then
    return jsonb_build_object('ok', false, 'code', 'registration_closed');
  end if;

  -- NEW. Pre-registration ends when play starts. Somebody arriving after that
  -- is a person standing in the shop, and a person standing in the shop is
  -- signed in at the desk by a professor who can see them. This is checked
  -- before the professor's own flag because "it has already started" is the
  -- plainer answer of the two when both are true.
  if v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'event_started');
  end if;

  -- NEW. A professor closed it early.
  if v_event.registration_closed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'closed_by_professor');
  end if;

  v_division := public.division(p_birth_year, v_event.starts_at::date);
  if v_division is null then
    return jsonb_build_object('ok', false, 'code', 'missing_details');
  end if;

  -- Already registered for this very event: refused, not queued again.
  select status into v_existing
  from public.registrations
  where event_id = p_event_id and player_id = p_player_id and status <> 'dropped';

  if found then
    return jsonb_build_object('ok', false, 'code', 'already_registered',
                              'status', v_existing);
  end if;

  -- Holding a confirmed spot on another flight of the same event means this one
  -- can only be a waitlist spot. One confirmed place across the group.
  if v_event.linked_group_id is not null
     and exists (
       select 1
       from public.registrations r
       join public.events e2 on e2.id = r.event_id
       where r.player_id = p_player_id
         and r.status = 'confirmed'
         and e2.linked_group_id = v_event.linked_group_id
     )
  then
    v_status := 'waitlist';
  else
    -- Both limits apply and both have to have room. The event total is a
    -- ceiling across every division; a division limit sits underneath it. An
    -- event may carry either, both, or neither, and neither means uncapped.
    select capacity into v_total_cap
    from public.event_capacities
    where event_id = p_event_id and division = 'all';

    select capacity into v_division_cap
    from public.event_capacities
    where event_id = p_event_id and division = v_division;

    v_status := 'confirmed';

    if v_total_cap is not null then
      select count(*) into v_taken
      from public.registrations
      where event_id = p_event_id and status = 'confirmed';

      if v_taken >= v_total_cap then
        v_status := 'waitlist';
      end if;
    end if;

    if v_status = 'confirmed' and v_division_cap is not null then
      select count(*) into v_taken
      from public.registrations
      where event_id = p_event_id
        and status = 'confirmed'
        and division = v_division;

      if v_taken >= v_division_cap then
        v_status := 'waitlist';
      end if;
    end if;
  end if;

  -- One queue for the whole event; promotion sorts out divisions later.
  if v_status = 'waitlist' then
    select coalesce(max(waitlist_position), 0) + 1 into v_position
    from public.registrations
    where event_id = p_event_id and status = 'waitlist';
  end if;

  insert into public.registrations
    (event_id, player_id, first_name, last_name, birth_year, contact, division,
     status, waitlist_position, source_ip)
  values
    (p_event_id, p_player_id, btrim(p_first_name), btrim(p_last_name), p_birth_year,
     nullif(btrim(coalesce(p_contact, '')), ''), v_division, v_status, v_position, v_ip);

  return jsonb_build_object('ok', true, 'status', v_status,
                            'waitlist_position', v_position,
                            'division', v_division);
end;
$function$;

comment on function public.register_for_event(uuid, text, text, text, integer, text) is
  'Registers a player, or puts them on the waiting list. Refuses an event that does not take registration, one that has already started, and one a professor has closed early. Nothing here refuses a drop: a player who cannot come must always be able to say so.';

-- ---------------------------------------------------------------------------
-- 3. Closing and reopening
-- ---------------------------------------------------------------------------
-- A function rather than a column update, so the professor is recorded without
-- the screen having to remember to send it, and so reopening cannot leave half
-- the pair behind.
--
-- Nothing is deleted and no registration is touched. Closing stops new ones
-- arriving; everyone already registered keeps their place, the waiting list
-- keeps its order, and a drop request still works. That is the point of closing
-- rather than turning registration off.
create or replace function public.set_registration_closed(
  p_event_id uuid,
  p_closed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
begin
  if not public.is_professor() then
    return jsonb_build_object('ok', false, 'code', 'not_a_professor');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_event');
  end if;

  if p_closed then
    update public.events
       set registration_closed_at = now(),
           registration_closed_by = auth.uid()
     where id = p_event_id;
  else
    update public.events
       set registration_closed_at = null,
           registration_closed_by = null
     where id = p_event_id;
  end if;

  select * into v_event from public.events where id = p_event_id;

  -- The start time comes back too, because reopening an event that has already
  -- started changes nothing a player can see: the clock refuses it either way,
  -- and the screen has to be able to say so rather than report success.
  return jsonb_build_object(
    'ok', true,
    'closed_at', v_event.registration_closed_at,
    'already_started', v_event.starts_at <= now()
  );
end;
$function$;

comment on function public.set_registration_closed(uuid, boolean) is
  'Closes registration early, or reopens it. Professors only. Records who and when, and touches no registration: closing stops new ones arriving and leaves every existing place, the waiting list order, and drop requests alone.';

revoke execute on function public.set_registration_closed(uuid, boolean) from anon;
grant execute on function public.set_registration_closed(uuid, boolean) to authenticated;
