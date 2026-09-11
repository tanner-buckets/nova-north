-- Phase 2: people and consent.
--
-- players, professors, consent_log, the visibility helpers, and public_players.
--
-- This migration contains NO personal data. Players are imported separately, out
-- of band, because this file is committed to a public repository. The professor
-- rows are inserted by hand for the same reason.
--
-- Creating professors also completes phase 1 retroactively: public.is_professor()
-- has been referenced by every write policy since the reference tables migration,
-- and starts returning real answers now that the table it reads exists.

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table public.players (
  player_id text primary key,
  first_name text not null,
  last_name text not null,
  birth_year integer,
  contact text,
  notes text,

  -- Consent. Null on show_player_id means "use the age-based default", which
  -- adjusts on its own when a minor becomes an adult. An explicit false is an
  -- adult opting out and must survive that birthday. show_name never defaults
  -- true for anyone.
  show_player_id boolean,
  show_name boolean not null default false,
  consent_source text check (consent_source in ('player', 'guardian')),
  consent_recorded_by uuid references auth.users (id) on delete set null,
  consent_recorded_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.players is
  'One row per player. No public access: the site reads public_players and the RPC functions.';
comment on column public.players.last_name is
  'Protected. Never public in full at any consent level. Professor-visible only.';
comment on column public.players.birth_year is
  'Protected. Drives minor status and age division. Nullable: a player added from a tournament file has no birth year until it is captured at registration.';
comment on column public.players.show_player_id is
  'Null uses the age default. True or false is an explicit, professor-recorded election.';

-- ---------------------------------------------------------------------------
-- professors
-- ---------------------------------------------------------------------------
create table public.professors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  player_id text references public.players (player_id),
  added_at timestamptz not null default now()
);

-- player_id is an addition to docs/SCHEMA.md. Professors are usually players
-- too, and the link lets the admin screens show who recorded a consent decision
-- without a second lookup. Nullable, because a professor need not be a player.
comment on table public.professors is
  'Membership here is what every professor-write policy checks, via auth.uid().';
comment on column public.professors.player_id is
  'Optional link to this professor''s own player record.';

-- ---------------------------------------------------------------------------
-- consent_log
-- ---------------------------------------------------------------------------
-- Append only. There are deliberately no UPDATE or DELETE policies below, so
-- rows cannot be altered or removed through the API at all. This is the record
-- if a parent ever asks why their child appeared on a website.
create table public.consent_log (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id),
  field text not null check (field in ('show_player_id', 'show_name')),
  old_value boolean,
  new_value boolean,
  source text not null check (source in ('player', 'guardian', 'expiry')),
  changed_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.consent_log is
  'Append only. Every visibility change, including automatic expiry, lands here.';

-- ---------------------------------------------------------------------------
-- Attendance seam
-- ---------------------------------------------------------------------------
-- attendance is a phase 3 table. Visibility depends on attendance within three
-- months, so that dependency has to exist now or every adult imported today
-- would be publicly visible the moment the import finishes.
--
-- This stub returns null, and the recency test below treats null as "not
-- visible". The whole model therefore FAILS CLOSED until phase 3 replaces this
-- one function body to read from public.attendance. No policy or view changes.
create or replace function public.last_attendance_on(p_player_id text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  return null;
end;
$function$;

comment on function public.last_attendance_on(text) is
  'Phase 2 stub returning null, which makes everyone invisible. Phase 3 replaces the body with max(attended_on) from public.attendance.';

-- ---------------------------------------------------------------------------
-- Age helpers
-- ---------------------------------------------------------------------------
-- Minor status is a legal age question, not a Play! Pokemon division. A player
-- is treated as a minor if they are under 18 at any point in the current
-- calendar year, and an unknown birth year is treated as a minor.
create or replace function public.is_minor(p_birth_year integer)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_birth_year is null
      or p_birth_year > extract(year from current_date)::integer - 19;
$function$;

-- The Play! Pokemon season runs 1 September to 31 August and is named for the
-- calendar year it ends in, so the cutoffs roll up by one every September.
create or replace function public.season_year(p_on date default current_date)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select extract(year from p_on)::integer
       + case when extract(month from p_on)::integer >= 9 then 1 else 0 end;
$function$;

-- Junior: born in or after season_year - 12
-- Senior: born from season_year - 16 through season_year - 13
-- Masters: born in or before season_year - 17
create or replace function public.division(p_birth_year integer, p_on date default current_date)
returns text
language sql
stable
set search_path = ''
as $function$
  select case
    when p_birth_year is null then null
    when p_birth_year >= public.season_year(p_on) - 12 then 'junior'
    when p_birth_year >= public.season_year(p_on) - 16 then 'senior'
    else 'master'
  end;
$function$;

comment on function public.division(integer, date) is
  'Derived, never stored. Protected: a player''s division is never rendered publicly.';

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.id_visible(p_player_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_show boolean;
  v_birth integer;
  v_last date;
begin
  select show_player_id, birth_year
    into v_show, v_birth
  from public.players
  where player_id = p_player_id;

  if not found then
    return false;
  end if;

  v_last := public.last_attendance_on(p_player_id);
  if v_last is null or v_last < current_date - interval '3 months' then
    return false;
  end if;

  return coalesce(v_show, not public.is_minor(v_birth));
end;
$function$;

comment on function public.id_visible(text) is
  'Consent flag or age default, AND attendance within three months. Fails closed.';

create or replace function public.name_visible(p_player_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_show_name boolean;
begin
  if not public.id_visible(p_player_id) then
    return false;
  end if;

  select show_name into v_show_name
  from public.players
  where player_id = p_player_id;

  return coalesce(v_show_name, false);
end;
$function$;

comment on function public.name_visible(text) is
  'A name is never shown without the Player ID also being shown.';

create or replace function public.display_label(p_player_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_first text;
  v_last text;
begin
  if public.name_visible(p_player_id) then
    select first_name, last_name into v_first, v_last
    from public.players
    where player_id = p_player_id;

    return trim(v_first || ' ' || left(coalesce(v_last, ''), 1) || '.');
  end if;

  if public.id_visible(p_player_id) then
    return p_player_id;
  end if;

  return 'PLAYER';
end;
$function$;

comment on function public.display_label(text) is
  'The only supported way to render a player. Never assemble a name from columns in page code.';

-- ---------------------------------------------------------------------------
-- public_players
-- ---------------------------------------------------------------------------
-- security_invoker is off deliberately: the view runs as its owner so it can
-- read public.players, which anon has no access to. That is the mechanism for
-- exposing two safe columns out of a protected table.
--
-- Non-consented players are ABSENT from this view, not anonymized. The PLAYER
-- label is for result sets that must be complete; this is a browse list.
create view public.public_players
with (security_invoker = false) as
select
  p.player_id,
  public.display_label(p.player_id) as display_label
from public.players p
where public.id_visible(p.player_id);

comment on view public.public_players is
  'Browse and lookup list. Only players whose ID visibility is in force appear at all.';

-- ---------------------------------------------------------------------------
-- set_player_visibility
-- ---------------------------------------------------------------------------
-- The only supported way to change a visibility flag. Professors have no direct
-- UPDATE grant on the consent columns, so this function is not merely the
-- preferred route -- it is the only one the API allows.
create or replace function public.set_player_visibility(
  p_player_id text,
  p_field text,
  p_value boolean,
  p_source text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old boolean;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may change a visibility flag';
  end if;

  if p_field not in ('show_player_id', 'show_name') then
    raise exception 'Unknown visibility field: %', p_field;
  end if;

  -- expiry is written only by the scheduled job in phase 3, never by a person.
  if p_source not in ('player', 'guardian') then
    raise exception 'Consent source must be player or guardian, not %', p_source;
  end if;

  if p_field = 'show_player_id' then
    select show_player_id into v_old from public.players where player_id = p_player_id;
    if not found then
      raise exception 'Unknown player: %', p_player_id;
    end if;
    update public.players
       set show_player_id = p_value,
           consent_source = p_source,
           consent_recorded_by = auth.uid(),
           consent_recorded_at = now()
     where player_id = p_player_id;
  else
    select show_name into v_old from public.players where player_id = p_player_id;
    if not found then
      raise exception 'Unknown player: %', p_player_id;
    end if;
    update public.players
       set show_name = p_value,
           consent_source = p_source,
           consent_recorded_by = auth.uid(),
           consent_recorded_at = now()
     where player_id = p_player_id;
  end if;

  insert into public.consent_log (player_id, field, old_value, new_value, source, changed_by, note)
  values (p_player_id, p_field, v_old, p_value, p_source, auth.uid(), p_note);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- anon gets nothing on any of these tables. Public reads go through
-- public_players, which runs as its owner.
grant select on public.public_players to anon, authenticated;

grant select, insert on public.players to authenticated;
-- Column-level UPDATE, deliberately. The consent columns are absent from this
-- list, so a professor cannot change them directly even with a valid session.
-- RLS is row-level; keeping a column out of reach needs a grant, not a policy.
grant update (first_name, last_name, birth_year, contact, notes)
  on public.players to authenticated;

grant select, insert, update, delete on public.professors to authenticated;
grant select on public.consent_log to authenticated;

revoke all on function public.set_player_visibility(text, text, boolean, text, text) from public;
grant execute on function public.set_player_visibility(text, text, boolean, text, text) to authenticated;
grant execute on function public.id_visible(text) to authenticated;
grant execute on function public.name_visible(text) to authenticated;
grant execute on function public.display_label(text) to authenticated;
grant execute on function public.is_minor(integer) to authenticated;
grant execute on function public.division(integer, date) to authenticated;
grant execute on function public.season_year(date) to authenticated;
grant execute on function public.last_attendance_on(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.professors enable row level security;
alter table public.consent_log enable row level security;

create policy players_select_professor
  on public.players for select to authenticated using (public.is_professor());

create policy players_insert_professor
  on public.players for insert to authenticated with check (public.is_professor());

create policy players_update_professor
  on public.players for update to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- No delete policy on players: a player record is never removed.

create policy professors_select_professor
  on public.professors for select to authenticated using (public.is_professor());

create policy professors_insert_professor
  on public.professors for insert to authenticated with check (public.is_professor());

create policy professors_update_professor
  on public.professors for update to authenticated
  using (public.is_professor()) with check (public.is_professor());

create policy professors_delete_professor
  on public.professors for delete to authenticated using (public.is_professor());

create policy consent_log_select_professor
  on public.consent_log for select to authenticated using (public.is_professor());

-- No insert, update or delete policies on consent_log. Rows arrive only through
-- set_player_visibility(), which is security definer, and can never be changed.
