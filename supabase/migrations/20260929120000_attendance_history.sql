-- Attendance is recorded but never read back. Nobody can answer "how many came
-- last Sunday", "is the Junior division growing", or "who was here on the 6th"
-- without going to the table by hand.
--
-- Two gaps have to be filled before a report can be honest about it.
--
-- 1. WHETHER SOMEBODY PLAYED IS NOT RECORDED. attendance says who was there on
--    what day. The play award is a point_ledger row, and the ledger carries no
--    attendance date -- only created_at, which is when a professor pressed the
--    button. A file uploaded on Monday for Sunday would put the play award on
--    Monday. So the split cannot be reconstructed for any day already recorded,
--    and guessing it would produce a number that looks like the others and is
--    not. attendance.played is nullable for exactly that reason: null means
--    "recorded before this was tracked", and the page says so rather than
--    printing a zero.
--
-- 2. PEOPLE WITHOUT PLAYER RECORDS ARE NOT COUNTED AT ALL. Parents and siblings
--    turn up, fill the room, and earn nothing, which is correct -- they have no
--    Player ID and no points. But the room was fuller than the attendance table
--    says. other_attendees holds one headcount per day, so the history can show
--    how many people were actually there.

-- ---------------------------------------------------------------------------
-- 1. Did they play
-- ---------------------------------------------------------------------------
alter table public.attendance
  add column played boolean;

comment on column public.attendance.played is
  'True for a player the tournament file listed, false for somebody remembered at the desk. Null means the day was recorded before this column existed and the split is not known: never treat null as false, because that would report a day of tournament players as a day of spectators.';

-- The play award already follows this distinction; the column is what lets it be
-- read back per day. Kept on attendance rather than derived from the ledger
-- because attendance is the thing that carries a date.
create index attendance_played_idx on public.attendance (attended_on, played);

-- UPDATE on attendance is granted per column, and played was not in the list.
-- It needs to be: a player who turned up in the morning and played in the
-- afternoon has a row already, and that row says they did not play.
grant update (played) on public.attendance to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Everybody else in the room
-- ---------------------------------------------------------------------------
-- One row per day, not per event. A parent is in the room once however many
-- tournaments run that afternoon, which is the same rule as the loyalty week.
create table public.other_attendees (
  attended_on date primary key,
  headcount integer not null check (headcount >= 0),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);

comment on table public.other_attendees is
  'How many people were present on a day without a player record: parents, siblings, anyone watching. They earn nothing and are not players. One row per day, replaced rather than added to, because it is a count of a room and not of an event.';

grant select, insert, update on public.other_attendees to authenticated;
-- No delete. A count corrected to zero is a professor saying nobody else came,
-- which is a different statement from never having counted, and the history
-- shows them differently.

alter table public.other_attendees enable row level security;

create policy other_attendees_select_professor
  on public.other_attendees for select to authenticated using (public.is_professor());
create policy other_attendees_insert_professor
  on public.other_attendees for insert to authenticated with check (public.is_professor());
create policy other_attendees_update_professor
  on public.other_attendees for update to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- Nothing for anon. How many children were in a shop on a given afternoon is
-- not public, and neither is anything else on this page.

-- ---------------------------------------------------------------------------
-- 3. The week by week figures
-- ---------------------------------------------------------------------------
-- Security definer so birth years stay on the server. A professor may read
-- them, but shipping a birth year to a browser to bucket it into a division is
-- handing out a protected field to do arithmetic that SQL can do here.
create or replace function public.attendance_by_day(
  p_from date default null,
  p_to date default null
)
returns table (
  attended_on date,
  total integer,
  played integer,
  attended_only integer,
  split_unknown integer,
  junior integer,
  senior integer,
  master integer,
  division_unknown integer,
  other_attendees integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    a.attended_on,
    (count(*))::integer,
    (count(*) filter (where a.played is true))::integer,
    (count(*) filter (where a.played is false))::integer,
    (count(*) filter (where a.played is null))::integer,
    -- Division is worked out as at the day itself, not today. A player who
    -- turned 13 in October was a Junior in September, and the history has to
    -- keep saying so.
    (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'junior'))::integer,
    (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'senior'))::integer,
    (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'master'))::integer,
    (count(*) filter (where public.division(p.birth_year, a.attended_on) is null))::integer,
    -- Not coalesced to zero. The whole point of keeping other_attendees
    -- undeletable is that "a professor counted and there were none" is a
    -- different statement from "nobody counted", and coalescing here would
    -- throw that away before the page ever saw it.
    o.headcount
  from public.attendance a
  join public.players p on p.player_id = a.player_id
  left join public.other_attendees o on o.attended_on = a.attended_on
  where public.is_professor()
    and (p_from is null or a.attended_on >= p_from)
    and (p_to is null or a.attended_on <= p_to)
  group by a.attended_on, o.headcount
  order by a.attended_on desc;
$function$;

-- other_attendees is null when nobody counted, and 0 when somebody counted and
-- there were none. The page shows a dash for the first and a 0 for the second.

comment on function public.attendance_by_day(date, date) is
  'One row per day attendance was recorded, for the professor history screen. Empty for anybody who is not a professor. split_unknown counts rows from before played was tracked; a day where it equals total has no split to show.';

revoke execute on function public.attendance_by_day(date, date) from anon;
grant execute on function public.attendance_by_day(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who was there on one day
-- ---------------------------------------------------------------------------
-- Names in full, and division, which is why this is professor only and why the
-- page it feeds is behind the sign in. Neither is ever public.
create or replace function public.attendance_on(p_day date)
returns table (
  player_id text,
  first_name text,
  last_name text,
  division text,
  played boolean,
  source text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select a.player_id, p.first_name, p.last_name,
         public.division(p.birth_year, a.attended_on),
         a.played, a.source
  from public.attendance a
  join public.players p on p.player_id = a.player_id
  where public.is_professor() and a.attended_on = p_day
  order by p.first_name, p.last_name;
$function$;

comment on function public.attendance_on(date) is
  'Everybody recorded as present on one day, with their division as at that day. Professor only: full names and division are never public.';

revoke execute on function public.attendance_on(date) from anon;
grant execute on function public.attendance_on(date) to authenticated;
