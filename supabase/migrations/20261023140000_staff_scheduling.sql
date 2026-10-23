-- Staff scheduling: who can come, and who is doing what when they do.
--
-- Modelled on the two sheets the league has been keeping by hand. The first
-- asks every staff member whether they can make each event; the second assigns
-- the roles for the day once the answers are in.
--
-- WHY A NEW TABLE AND NOT public.professors. That table's primary key is
-- user_id, a reference to auth.users, so a row cannot exist without a login.
-- Half the people on the staff sheet have never had one -- a volunteer who
-- floor-judges twice a year does not need an account, and giving them one to
-- get their name onto a rota would be handing out read access to every child's
-- full name and birth year to solve a scheduling problem. So professors stays
-- what it is, the authorization table that is_professor() checks, and staff is
-- the roster. A person can be in one, the other, or both.
--
-- This migration therefore adds NO privilege to anybody. Nothing here is
-- consulted by any policy.

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  -- The short name the rota is read by: Alice, Avery, Michael. Not the player's
  -- full name, which is too wide for a column heading and is a protected field
  -- besides.
  display_name text not null check (length(trim(display_name)) > 0),
  -- Nullable, and the reason the staff screen offers to find or create a
  -- player. A judge earns a loyalty week and an attendance point like anybody
  -- else, and that award needs a Player ID to hang on: a regular with no link
  -- here cannot be ticked on the upload screen, because there would be nobody
  -- to pay.
  player_id text unique references public.players (player_id),
  -- regular: here most weeks, offered as a judge on the upload screen.
  -- volunteer: helps when they can, and is not.
  kind text not null default 'regular' check (kind in ('regular', 'volunteer')),
  -- Retired, never deleted, like every other reference row here. A past event's
  -- staffing has to keep pointing at a row that still exists.
  is_active boolean not null default true,
  retired_at timestamptz,
  added_at timestamptz not null default now()
);

-- Active names only. The rota is read by first name, so two live Michaels would
-- make every column heading a guess. A retired one is out of the way and does
-- not block the name coming back.
create unique index staff_active_name_idx
  on public.staff (lower(display_name)) where is_active;

comment on table public.staff is
  'The staffing roster. Not an authorization table -- no policy consults it. professors is what is_professor() checks.';
comment on column public.staff.player_id is
  'Their own player record, where they have one. Required before they can be ticked as a judge on the TDF upload screen, because that award needs somebody to pay.';
comment on column public.staff.kind is
  'regular appears in the judges list on the TDF upload screen; volunteer does not.';

revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;
grant insert (display_name, player_id, kind) on public.staff to authenticated;
grant update (display_name, player_id, kind, is_active, retired_at) on public.staff to authenticated;

alter table public.staff enable row level security;

create policy staff_read on public.staff
  for select to authenticated using (public.is_professor());
create policy staff_write on public.staff
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- ---------------------------------------------------------------------------
-- Who last touched a row
-- ---------------------------------------------------------------------------
-- One function for the three tables below, for the same reason league_day_notes
-- has one: an upsert that carries its own author is an upsert that could name
-- somebody else, and the second write of a row would otherwise keep the first
-- writer's name.
--
-- Invoker, not definer: it needs no privilege of its own, only the signed-in
-- caller's identity, which is exactly what it is recording.
create function public.stamp_staff_row()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- staff_availability
-- ---------------------------------------------------------------------------
-- One answer per person per event. The vocabulary comes from what the sheet was
-- already using, which had grown four states rather than two:
--
--   available  can staff it
--   out        cannot come
--   playing    will be here, but playing rather than staffing
--   unsure     has not decided
--
-- `playing` is the one worth keeping separate. Somebody entered in the side
-- event is in the room and is not a judge, and folding that into `out` would
-- have a professor ringing round looking for a body who is standing ten feet
-- away. It does not count toward the staff present figure, which is what the
-- sheet already did.
--
-- A row that does not exist means nobody has answered, which is different from
-- `unsure`: one is a person who has not been asked, the other is a person who
-- has been asked and does not know.
create table public.staff_availability (
  event_id uuid not null references public.events (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  status text not null check (status in ('available', 'out', 'playing', 'unsure')),
  -- "NAIC", "GLC", "Baltimore". The sheet kept these inside the cell as
  -- "OUT / NAIC"; they are a reason, not a fifth status.
  note text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, staff_id)
);

comment on table public.staff_availability is
  'One answer per staff member per event. No row means nobody has answered, which is not the same as unsure.';

create index staff_availability_event_idx on public.staff_availability (event_id);

revoke all on public.staff_availability from anon, authenticated;
grant select on public.staff_availability to authenticated;
grant insert (event_id, staff_id, status, note) on public.staff_availability to authenticated;
grant update (event_id, staff_id, status, note) on public.staff_availability to authenticated;
grant delete on public.staff_availability to authenticated;

alter table public.staff_availability enable row level security;

create policy staff_availability_read on public.staff_availability
  for select to authenticated using (public.is_professor());
create policy staff_availability_write on public.staff_availability
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

create trigger staff_availability_stamp
  before insert or update on public.staff_availability
  for each row execute function public.stamp_staff_row();

-- ---------------------------------------------------------------------------
-- event_staffing
-- ---------------------------------------------------------------------------
-- One row per person per job. A row rather than a column per role, because the
-- sheet's single Floor Judge cell was already holding two names on a busy day,
-- and because Other Staff is a list by definition.
--
-- EITHER a staff_id OR a guest_name, never both and never neither. The guest is
-- the point: the sheet has people in it who are not on the roster and should
-- not be added to it to be written down once. Somebody who turns up often
-- enough to matter gets a staff row and stops being a guest.
create table public.event_staffing (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  role text not null
    check (role in ('organizer', 'head_judge', 'floor_judge', 'free_play', 'other')),
  staff_id uuid references public.staff (id),
  guest_name text check (guest_name is null or length(trim(guest_name)) > 0),
  sort_order integer not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint event_staffing_one_person check (
    (staff_id is not null and guest_name is null)
    or (staff_id is null and guest_name is not null)
  )
);

-- The same person twice in the same job is a double entry, not a roster. Being
-- in two different jobs at one event is left alone: it is usually a mistake and
-- occasionally a small league, so the screen warns and the table permits.
create unique index event_staffing_once_idx
  on public.event_staffing (event_id, role, staff_id) where staff_id is not null;

create index event_staffing_event_idx on public.event_staffing (event_id);

comment on table public.event_staffing is
  'Who is doing what at one event. Either a roster member or a one-off name, never both.';

revoke all on public.event_staffing from anon, authenticated;
grant select on public.event_staffing to authenticated;
grant insert (event_id, role, staff_id, guest_name, sort_order) on public.event_staffing to authenticated;
grant update (role, staff_id, guest_name, sort_order) on public.event_staffing to authenticated;
grant delete on public.event_staffing to authenticated;

alter table public.event_staffing enable row level security;

create policy event_staffing_read on public.event_staffing
  for select to authenticated using (public.is_professor());
create policy event_staffing_write on public.event_staffing
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

create trigger event_staffing_stamp
  before insert or update on public.event_staffing
  for each row execute function public.stamp_staff_row();

-- ---------------------------------------------------------------------------
-- event_staffing_notes
-- ---------------------------------------------------------------------------
-- The sheet's "Other Events" column: what else is on that weekend, somewhere
-- else. It is why half the roster is out, and without it a thin Sunday reads as
-- people not turning up rather than as a Regional in another state.
--
-- Its own table rather than a column on events, because it is a professor-only
-- working note and events is publicly readable. A column there would be one
-- `select *` away from being on the schedule.
create table public.event_staffing_notes (
  event_id uuid primary key references public.events (id) on delete cascade,
  other_events text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.event_staffing_notes is
  'Professor-only working notes against an event. Separate from events, which is public.';

revoke all on public.event_staffing_notes from anon, authenticated;
grant select on public.event_staffing_notes to authenticated;
grant insert (event_id, other_events) on public.event_staffing_notes to authenticated;
grant update (event_id, other_events) on public.event_staffing_notes to authenticated;
grant delete on public.event_staffing_notes to authenticated;

alter table public.event_staffing_notes enable row level security;

create policy event_staffing_notes_read on public.event_staffing_notes
  for select to authenticated using (public.is_professor());
create policy event_staffing_notes_write on public.event_staffing_notes
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

create trigger event_staffing_notes_stamp
  before insert or update on public.event_staffing_notes
  for each row execute function public.stamp_staff_row();

-- ---------------------------------------------------------------------------
-- The roster starts as the professors who are already here
-- ---------------------------------------------------------------------------
-- Read from the table rather than written out, so no name goes into a public
-- repository and the seed cannot disagree with who is actually a professor.
-- They start as regulars, which is what they are; the screen can change it.
--
-- player_id is carried across where the professor row has one. Where it does
-- not, the staff screen will ask: a regular without a Player ID cannot be
-- ticked as a judge, because the award would have nobody to land on.
insert into public.staff (display_name, player_id, kind)
select p.display_name, p.player_id, 'regular'
from public.professors p
on conflict do nothing;
