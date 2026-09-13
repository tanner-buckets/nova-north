-- Phase 4: events and registration.
--
-- events, event_capacities, registrations, public_event_counts, and the three
-- registration functions.
--
-- This is the first phase with PUBLIC WRITE. Until now a stranger with the anon
-- key could only read. They can now create a registration -- but only by calling
-- register_for_event(), never by inserting directly. That distinction is the
-- whole design: a direct insert would let a caller write their own status and
-- hand themselves a confirmed spot past a full division.
--
-- Contains no personal data.

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_type text not null
    check (event_type in ('league', 'casual', 'challenge', 'cup', 'prerelease', 'special')),
  starts_at timestamptz not null,
  is_premier boolean not null default false,
  registration_open boolean not null default false,
  linked_group_id uuid,
  created_at timestamptz not null default now()
);

create index events_starts_at_idx on public.events (starts_at);
create index events_linked_group_idx on public.events (linked_group_id)
  where linked_group_id is not null;

comment on table public.events is
  'Publicly readable. Professors create and edit them from the admin screens.';
comment on column public.events.linked_group_id is
  'Flights of the same event share a value. A player may hold one confirmed spot across the group and waitlist spots on the others.';
comment on column public.events.registration_open is
  'False refuses registration outright, whatever the capacity.';

-- ---------------------------------------------------------------------------
-- event_capacities
-- ---------------------------------------------------------------------------
-- One row per division, or a single row with division 'all' for an event capped
-- as a whole. An event with no rows here is uncapped.
create table public.event_capacities (
  event_id uuid not null references public.events (id) on delete cascade,
  division text not null check (division in ('all', 'junior', 'senior', 'master')),
  capacity integer not null check (capacity >= 0),
  primary key (event_id, division)
);

comment on table public.event_capacities is
  'Capacity per division, or one row with division all. No rows means uncapped. The admin screen should not let an event be saved with a partial set.';

-- ---------------------------------------------------------------------------
-- registrations
-- ---------------------------------------------------------------------------
-- Public INSERT happens only through register_for_event(). There is no public
-- SELECT at any consent level: who registered for an event is never public.
--
-- player_id is NOT NULL, which departs from the earlier design where prereleases
-- allowed a blank. Every registrant supplies a Player ID; someone without one is
-- sent to a help page rather than given an anonymous row. That makes duplicate
-- detection work everywhere and gives every registrant a way to drop.
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  player_id text not null,
  first_name text not null,
  last_name text not null,
  birth_year integer not null,
  contact text,
  division text not null check (division in ('junior', 'senior', 'master')),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'waitlist', 'drop_requested', 'dropped')),
  waitlist_position integer,
  source_ip inet,
  created_at timestamptz not null default now()
);

-- One live registration per player per event. Dropped rows are excluded so that
-- someone who drops can register again later if space reappears.
create unique index registrations_one_live_per_event
  on public.registrations (event_id, player_id)
  where status <> 'dropped';

create index registrations_event_status_idx on public.registrations (event_id, status);
create index registrations_waitlist_idx on public.registrations (event_id, waitlist_position)
  where status = 'waitlist';
-- Present so a per-IP throttle can be added later without reshaping the table.
create index registrations_created_at_idx on public.registrations (created_at desc);
create index registrations_ip_idx on public.registrations (event_id, source_ip)
  where source_ip is not null;

comment on table public.registrations is
  'Public INSERT through register_for_event() only. No public SELECT: pre-registration lists are never public.';
comment on column public.registrations.last_name is 'Protected. Never public.';
comment on column public.registrations.birth_year is 'Protected. Captured to derive division.';
comment on column public.registrations.contact is 'Protected. Optional.';
comment on column public.registrations.waitlist_position is
  'Position in one queue for the whole event. Promotion then picks the first person whose division has room.';
comment on column public.registrations.source_ip is
  'Protected. Recorded only to throttle bulk submissions. Never public, never returned by any function. Safe to clear once an event has passed.';

-- ---------------------------------------------------------------------------
-- public_event_counts
-- ---------------------------------------------------------------------------
-- Numbers only. No names, no Player IDs, at any consent level. This is what a
-- registration form reads to decide whether to offer a confirmed spot.
--
-- security_invoker is off so the view can count rows in a table the caller
-- cannot read. Its safety is that it emits nothing but integers.
create view public.public_event_counts
with (security_invoker = false) as
-- Left joined from events, so an uncapped event still reports its counts as a
-- single row with division 'all' and a null capacity. A form needs the numbers
-- whether or not a limit was set.
select
  e.id as event_id,
  coalesce(c.division, 'all') as division,
  c.capacity,
  count(r.id) filter (where r.status = 'confirmed') as confirmed_count,
  count(r.id) filter (where r.status = 'waitlist') as waitlist_count
from public.events e
left join public.event_capacities c on c.event_id = e.id
left join public.registrations r
  on r.event_id = e.id
 and (c.division is null or c.division = 'all' or r.division = c.division)
group by e.id, coalesce(c.division, 'all'), c.capacity;

comment on view public.public_event_counts is
  'Per event and division: capacity, confirmed count, waitlist length. Numbers only.';

-- ---------------------------------------------------------------------------
-- Professor-facing views
-- ---------------------------------------------------------------------------
-- These are the opposite of public_event_counts: they exist to show a professor
-- who registered, which the public may never see. security_invoker is ON, so RLS
-- on registrations applies and a caller who is not a professor gets nothing.
-- That is the reverse of the public view's arrangement, and it is deliberate.

-- What a professor sees on logging in: every upcoming event with its numbers.
create view public.event_registration_summary
with (security_invoker = true) as
select
  e.id as event_id,
  e.name,
  e.starts_at,
  e.registration_open,
  count(r.id) filter (where r.status = 'confirmed')      as confirmed_count,
  count(r.id) filter (where r.status = 'waitlist')       as waitlist_count,
  count(r.id) filter (where r.status = 'drop_requested') as drop_requested_count,
  count(distinct r.source_ip)                            as distinct_addresses
from public.events e
left join public.registrations r on r.event_id = e.id
group by e.id, e.name, e.starts_at, e.registration_open;

comment on view public.event_registration_summary is
  'Professor dashboard counts, including drops awaiting confirmation. Not public: RLS on registrations applies.';

-- The surge signal. A shared address is normal -- a family, or the store wifi --
-- so this reports rather than judges. A professor decides whether twelve
-- registrations from one address is a scout troop or a script.
create view public.registration_ip_activity
with (security_invoker = true) as
select
  r.event_id,
  r.source_ip,
  count(*) as registration_count,
  min(r.created_at) as first_seen,
  max(r.created_at) as last_seen
from public.registrations r
where r.source_ip is not null
group by r.event_id, r.source_ip
having count(*) > 1
order by count(*) desc;

comment on view public.registration_ip_activity is
  'Addresses submitting more than one registration for an event. Informational: nothing is blocked on this basis.';

-- ---------------------------------------------------------------------------
-- register_for_event
-- ---------------------------------------------------------------------------
-- Returns a jsonb result rather than raising, so a form can show a useful
-- message. Refusals carry a code the page can branch on.
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
  v_capacity integer;
  v_cap_division text;
  v_taken integer;
  v_status text;
  v_position integer;
  v_existing text;
  v_ip inet;
begin
  -- The caller's address is recorded, but nothing is refused on the strength of
  -- it. Everyone on the store's wifi shares one public address, so a per-address
  -- cap would turn a busy prerelease sign-up into a wall of rejections for
  -- legitimate players. Detection is the right tool here, not prevention:
  -- registration_ip_activity below shows professors where a surge came from, and
  -- they can judge it.
  --
  -- A missing or unparseable header is fine; the column is simply left null.
  begin
    v_ip := split_part(
              coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
              ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  -- Every registrant needs a Player ID. Someone without one is sent to the help
  -- page rather than given an anonymous registration.
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
    -- Capacity for this division, falling back to a whole-event cap. Neither
    -- present means uncapped.
    select division, capacity into v_cap_division, v_capacity
    from public.event_capacities
    where event_id = p_event_id and division = v_division;

    if not found then
      select division, capacity into v_cap_division, v_capacity
      from public.event_capacities
      where event_id = p_event_id and division = 'all';
    end if;

    if v_capacity is null then
      v_status := 'confirmed';
    else
      select count(*) into v_taken
      from public.registrations
      where event_id = p_event_id
        and status = 'confirmed'
        and (v_cap_division = 'all' or division = v_cap_division);

      if v_taken < v_capacity then
        v_status := 'confirmed';
      else
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
  'The only public way to create a registration. Derives division, checks capacity, and assigns status, so a caller cannot write their own.';

-- ---------------------------------------------------------------------------
-- request_drop
-- ---------------------------------------------------------------------------
-- Requires Player ID and a matching first name, and does not remove anything --
-- a professor confirms it.
--
-- An unknown Player ID, a name mismatch and a player with no registration all
-- return the SAME result. Otherwise this becomes a way to test which IDs are
-- registered for an event, and then to guess names against them.
create or replace function public.request_drop(
  p_player_id text,
  p_first_name text,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  select id into v_id
  from public.registrations
  where event_id = p_event_id
    and player_id = btrim(coalesce(p_player_id, ''))
    and lower(first_name) = lower(btrim(coalesce(p_first_name, '')))
    and status in ('confirmed', 'waitlist');

  if found then
    update public.registrations
       set status = 'drop_requested'
     where id = v_id;
  end if;

  -- Deliberately identical whether or not anything matched.
  return jsonb_build_object('ok', true, 'code', 'drop_requested');
end;
$function$;

comment on function public.request_drop(text, text, uuid) is
  'Flags a drop for professor confirmation. Returns the same result whether or not a registration matched, so it cannot be used to enumerate registrants.';

-- ---------------------------------------------------------------------------
-- confirm_drop
-- ---------------------------------------------------------------------------
-- Professor only. Marks the registration dropped, then promotes the first person
-- in the event's waitlist whose division has room and who does not already hold
-- a confirmed spot on another flight of the same event.
--
-- Returns who was promoted so the professor can be told on screen. This is
-- professor-only output, so a full name is appropriate here.
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
  v_capacity integer;
  v_cap_division text;
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

    select division, capacity into v_cap_division, v_capacity
    from public.event_capacities
    where event_id = v_reg.event_id and division = v_candidate.division;

    if not found then
      select division, capacity into v_cap_division, v_capacity
      from public.event_capacities
      where event_id = v_reg.event_id and division = 'all';
    end if;

    if v_capacity is not null then
      select count(*) into v_taken
      from public.registrations
      where event_id = v_reg.event_id
        and status = 'confirmed'
        and (v_cap_division = 'all' or division = v_cap_division);

      if v_taken >= v_capacity then
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

comment on function public.confirm_drop(uuid) is
  'Professor only. Drops a registration and promotes the first eligible waitlister, skipping anyone already confirmed in the same linked group.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

grant select on public.event_capacities to anon, authenticated;
grant insert, update, delete on public.event_capacities to authenticated;

-- No grant of any kind to anon on registrations. Public writes arrive only
-- through register_for_event(), which is security definer.
grant select, update, delete on public.registrations to authenticated;

grant select on public.public_event_counts to anon, authenticated;

-- Professor views: authenticated only, and security_invoker means RLS still
-- decides. A signed-in non-professor sees zero rows.
grant select on public.event_registration_summary to authenticated;
grant select on public.registration_ip_activity to authenticated;

grant execute on function
  public.register_for_event(uuid, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.request_drop(text, text, uuid) to anon, authenticated;
revoke all on function public.confirm_drop(uuid) from public;
grant execute on function public.confirm_drop(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_capacities enable row level security;
alter table public.registrations enable row level security;

create policy events_select_public
  on public.events for select to anon, authenticated using (true);
create policy events_insert_professor
  on public.events for insert to authenticated with check (public.is_professor());
create policy events_update_professor
  on public.events for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy events_delete_professor
  on public.events for delete to authenticated using (public.is_professor());

create policy event_capacities_select_public
  on public.event_capacities for select to anon, authenticated using (true);
create policy event_capacities_insert_professor
  on public.event_capacities for insert to authenticated with check (public.is_professor());
create policy event_capacities_update_professor
  on public.event_capacities for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy event_capacities_delete_professor
  on public.event_capacities for delete to authenticated using (public.is_professor());

-- Professors only, and no public policy at all. There is deliberately no INSERT
-- policy: even a professor adds a registration through register_for_event(), so
-- capacity and the linked-group rule are applied the same way every time.
create policy registrations_select_professor
  on public.registrations for select to authenticated using (public.is_professor());
create policy registrations_update_professor
  on public.registrations for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy registrations_delete_professor
  on public.registrations for delete to authenticated using (public.is_professor());
