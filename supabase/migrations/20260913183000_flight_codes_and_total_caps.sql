-- Two changes a professor asked for, both of which the database has to hold
-- rather than the pages.
--
-- 1. Flights are grouped by a four digit code instead of a UUID. A UUID is not
--    something a person types at a desk, and the column exists to be typed.
--
-- 2. The 'all' capacity becomes a real total rather than a fallback. Today it is
--    consulted only when a player's own division has no row, so an event with
--    Junior 8 and Everyone 32 could seat 8 Juniors, 8 Seniors and 8 Masters and
--    never notice it had passed 32. A total that only applies sometimes is not a
--    total.
--
-- Both function bodies are replaced whole. Nothing is dropped and no data is
-- lost: existing flight groupings are carried across to codes so flights that
-- were linked stay linked.

-- ---------------------------------------------------------------------------
-- 1. linked_group_id becomes a four digit code
-- ---------------------------------------------------------------------------
-- The type changes first, because a code cannot be assigned to a uuid column.
-- Postgres rebuilds events_linked_group_idx as part of this.
alter table public.events
  alter column linked_group_id type text using linked_group_id::text;

-- Each distinct existing group becomes one code, so two flights that shared a
-- UUID still share a code. Numbered from 1001 in date order, which is arbitrary
-- but stable and readable.
with groups as (
  select linked_group_id as old_id,
         lpad((1000 + row_number() over (order by min(starts_at)))::text, 4, '0') as code
  from public.events
  where linked_group_id is not null
  group by linked_group_id
)
update public.events e
   set linked_group_id = g.code
  from groups g
 where e.linked_group_id = g.old_id;

-- Enforced, not merely expected. The column is typed by a person and a typo
-- that silently makes a group of one is worse than a refusal.
alter table public.events
  add constraint events_linked_group_id_is_code
  check (linked_group_id is null or linked_group_id ~ '^[0-9]{4}$');

comment on column public.events.linked_group_id is
  'Four digit code shared by flights of the same event. A player may hold one confirmed place across the group and wait on the others. Null for a standalone event.';

-- ---------------------------------------------------------------------------
-- 2. 'all' becomes a total
-- ---------------------------------------------------------------------------
comment on table public.event_capacities is
  'Per division limits plus an optional event total. The row with division = all is a ceiling on the whole event, applied on top of any division limit, not a fallback for divisions that have none.';

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
    -- CHANGED. Both limits apply and both have to have room. The event total is
    -- a ceiling across every division; a division limit sits underneath it. An
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

create or replace function public.confirm_drop(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reg public.registrations%rowtype;
  v_event public.events%rowtype;
  v_candidate public.registrations%rowtype;
  v_total_cap integer;
  v_division_cap integer;
  v_taken integer;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may confirm a drop';
  end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_registration');
  end if;

  update public.registrations set status = 'dropped', waitlist_position = null
   where id = p_registration_id;

  -- Dropping a waitlist spot frees nothing, so there is nobody to promote.
  if v_reg.status not in ('confirmed', 'drop_requested') then
    return jsonb_build_object('ok', true, 'promoted', null);
  end if;

  select * into v_event from public.events where id = v_reg.event_id;

  -- CHANGED. The event total is checked once, before walking the list. If the
  -- event is full overall then no division has room, whatever its own limit
  -- says, and walking the whole waitlist to reject everybody is wasted work.
  -- The row above is already dropped, so this count reflects the freed place.
  select capacity into v_total_cap
  from public.event_capacities
  where event_id = v_reg.event_id and division = 'all';

  if v_total_cap is not null then
    select count(*) into v_taken
    from public.registrations
    where event_id = v_reg.event_id and status = 'confirmed';

    if v_taken >= v_total_cap then
      return jsonb_build_object('ok', true, 'promoted', null, 'code', 'event_full');
    end if;
  end if;

  for v_candidate in
    select * from public.registrations
    where event_id = v_reg.event_id and status = 'waitlist'
    order by waitlist_position
  loop
    -- Skip anyone already confirmed on another flight of the same event.
    if v_event.linked_group_id is not null
       and exists (
         select 1 from public.registrations r
         join public.events e2 on e2.id = r.event_id
         where r.player_id = v_candidate.player_id
           and r.status = 'confirmed'
           and e2.linked_group_id = v_event.linked_group_id
       )
    then
      continue;
    end if;

    -- CHANGED. Only this candidate's own division limit, with no fallback to
    -- 'all': the total was settled above and applies to everybody equally.
    select capacity into v_division_cap
    from public.event_capacities
    where event_id = v_reg.event_id and division = v_candidate.division;

    if v_division_cap is not null then
      select count(*) into v_taken
      from public.registrations
      where event_id = v_reg.event_id
        and status = 'confirmed'
        and division = v_candidate.division;

      if v_taken >= v_division_cap then
        continue;   -- this candidate's division is still full
      end if;
    end if;

    update public.registrations
       set status = 'confirmed', waitlist_position = null
     where id = v_candidate.id;

    return jsonb_build_object(
      'ok', true,
      'promoted', jsonb_build_object(
        'registration_id', v_candidate.id,
        'player_id', v_candidate.player_id,
        'name', v_candidate.first_name || ' ' || v_candidate.last_name,
        'division', v_candidate.division));
  end loop;

  return jsonb_build_object('ok', true, 'promoted', null);
end;
$function$;
