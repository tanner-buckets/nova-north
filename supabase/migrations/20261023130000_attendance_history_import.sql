-- Two years of league days, from the spreadsheet that was keeping them.
--
-- The attendance table holds one row per person per day and needs a Player ID
-- on every one of them. These records are counts: 12 players, 2 judges, no
-- names. They cannot go in there, and pretending they can would mean inventing
-- a hundred people.
--
-- So they go in a table of their own, and attendance_by_day() reads both.
--
-- WHERE THE TWO OVERLAP, THE LIVE RECORDS WIN. A Sunday with even one row in
-- attendance is reported from attendance and this table is ignored for it.
-- Nothing already entered by a professor can be contradicted by a spreadsheet,
-- and re-importing is therefore safe.
--
-- How the sheet's three columns map:
--
--   Players            people holding a Player ID who played      -> played
--   Judges / staff     people holding a Player ID who did not     -> attended
--   Learn-to-play      visitors and guests with no Player ID      -> others
--
-- Players + Judges is the site's "Total", Learn-to-play is "Others", and the
-- three together are the sheet's own TOTAL column, which is what it should be.
--
-- Divisions are not here because the sheet never had them. An imported week
-- reports its age split as unknown rather than guessing, and the chart gives
-- those weeks a band of their own so it is obvious which weeks have per-player
-- detail behind them.
--
-- Two dates were corrected on the way in: the sheet's 1/5/24 and 1/12/24 sit
-- between 12/29/24 and 1/19/25, so they are 2025. Every date below was checked
-- to be a Sunday.
--
-- 11/03/24 is a real zero: "Sportsball watch party", nobody came. It is kept,
-- because a week nobody attended is a fact about the league and dropping it
-- would quietly lift every average that spans it.

create table public.attendance_history (
  attended_on date primary key,
  players integer not null check (players >= 0),
  learn_to_play integer not null check (learn_to_play >= 0),
  judges integer not null check (judges >= 0),
  note text,
  imported_at timestamptz not null default now()
);

comment on table public.attendance_history is
  'Counted-by-hand league days from before per-player records. Read only where attendance has nothing for that date.';
comment on column public.attendance_history.judges is
  'Judges and staff. They hold Player IDs and they attended without playing, so they count as attended rather than played.';

grant select on public.attendance_history to authenticated;

alter table public.attendance_history enable row level security;

create policy attendance_history_select_professor
  on public.attendance_history for select to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- league_day_notes
-- ---------------------------------------------------------------------------
-- Separate from the import, because a note is wanted for every Sunday and not
-- only the imported ones. "Challenge / Louisville" explains this week's dip the
-- same way "Pgh regionals" explains one from last year, and a professor should
-- be able to write it down on the day rather than waiting for somebody to
-- import a spreadsheet.
create table public.league_day_notes (
  attended_on date primary key,
  note text not null,
  -- Both are set by the trigger below, never by the page. An upsert that
  -- carried its own author would be an upsert that could lie about one, and
  -- the second write of a note would otherwise keep the first writer's name.
  -- Nullable, because the rows seeded below are written by the migration
  -- itself, where there is no signed-in anybody.
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Invoker, not definer: it needs no privilege of its own, only the signed-in
-- caller's identity, which is exactly what it is recording.
create function public.stamp_league_day_note()
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

create trigger league_day_notes_stamp
  before insert or update on public.league_day_notes
  for each row execute function public.stamp_league_day_note();

comment on table public.league_day_notes is
  'Why a week looks the way it does. Professor-only, like the rest of the attendance history.';

-- The note and the day, and nothing else. Without the column list a signed-in
-- professor could write updated_by straight from a browser, which is the thing
-- the trigger exists to take out of their hands.
grant select on public.league_day_notes to authenticated;
grant insert (attended_on, note) on public.league_day_notes to authenticated;
grant update (attended_on, note) on public.league_day_notes to authenticated;
grant delete on public.league_day_notes to authenticated;

alter table public.league_day_notes enable row level security;

create policy league_day_notes_read on public.league_day_notes
  for select to authenticated using (public.is_professor());
create policy league_day_notes_write on public.league_day_notes
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- ---------------------------------------------------------------------------
-- The records
-- ---------------------------------------------------------------------------
insert into public.attendance_history
  (attended_on, players, learn_to_play, judges, note)
values
  ('2024-09-22', 12, 0, 2, null),
  ('2024-09-29', 11, 2, 1, null),
  ('2024-10-06', 14, 0, 1, null),
  ('2024-10-13', 20, 1, 1, null),
  ('2024-10-20', 16, 2, 2, null),
  ('2024-10-27', 18, 4, 3, null),
  ('2024-11-03', 0, 0, 0, 'Sportsball watch party'),
  ('2024-11-10', 20, 4, 3, null),
  ('2024-11-17', 12, 2, 3, null),
  ('2024-11-24', 18, 1, 2, null),
  ('2024-12-01', 21, 0, 2, null),
  ('2024-12-08', 18, 0, 3, null),
  ('2024-12-15', 12, 0, 2, null),
  ('2024-12-22', 15, 1, 1, null),
  ('2024-12-29', 24, 2, 3, null),
  ('2025-01-05', 30, 2, 2, null),
  ('2025-01-12', 19, 4, 2, null),
  ('2025-01-19', 26, 0, 3, 'Challenge'),
  ('2025-01-26', 14, 0, 1, null),
  ('2025-02-02', 26, 5, 2, null),
  ('2025-02-09', 17, 5, 3, null),
  ('2025-02-16', 28, 5, 3, 'Challenge'),
  ('2025-02-23', 28, 3, 2, null),
  ('2025-03-02', 32, 5, 2, null),
  ('2025-03-09', 27, 5, 2, null),
  ('2025-03-16', 30, 6, 3, 'Prerelease'),
  ('2025-03-23', 30, 8, 4, 'Challenge'),
  ('2025-03-30', 21, 2, 2, null),
  ('2025-04-06', 30, 4, 2, null),
  ('2025-04-13', 29, 0, 2, null),
  ('2025-04-20', 22, 4, 2, null),
  ('2025-04-27', 34, 1, 2, 'Challenge'),
  ('2025-05-04', 38, 2, 2, null),
  ('2025-05-11', 28, 0, 2, 'Challenge'),
  ('2025-05-18', 32, 2, 2, 'Prerelease'),
  ('2025-05-25', 33, 0, 4, 'Cup'),
  ('2025-06-01', 34, 1, 3, 'Chaos Cup'),
  ('2025-06-08', 28, 4, 2, null),
  ('2025-06-15', 24, 0, 2, 'NAIC'),
  ('2025-06-22', 29, 2, 2, null),
  ('2025-06-29', 25, 2, 3, 'Format-a-thon'),
  ('2025-07-06', 29, 4, 2, 'New season'),
  ('2025-07-13', 31, 3, 2, 'GLC / Standard'),
  ('2025-07-20', 28, 1, 2, null),
  ('2025-07-27', 31, 3, 4, 'Challenge'),
  ('2025-08-03', 32, 1, 2, null),
  ('2025-08-10', 29, 5, 2, null),
  ('2025-08-17', 36, 1, 3, 'Worlds Party'),
  ('2025-08-24', 32, 1, 4, 'Challenge'),
  ('2025-08-31', 23, 1, 2, null),
  ('2025-09-07', 36, 1, 4, 'Cup'),
  ('2025-09-14', 40, 2, 2, 'Prerelease'),
  ('2025-09-21', 13, 1, 2, 'Pgh regionals'),
  ('2025-09-28', 29, 2, 2, null),
  ('2025-10-05', 25, 2, 3, null),
  ('2025-10-12', 28, 1, 3, null),
  ('2025-10-19', 34, 5, 3, 'Anniversary Party'),
  ('2025-10-26', 37, 3, 2, 'GLC / Standard'),
  ('2025-11-02', 38, 2, 2, 'Prerelease'),
  ('2025-11-09', 27, 0, 2, 'Challenge'),
  ('2025-11-16', 23, 7, 2, 'Vegas regionals'),
  ('2025-11-23', 29, 1, 2, 'GLC / Standard'),
  ('2025-11-30', 29, 3, 2, null),
  ('2025-12-07', 30, 0, 3, 'Cup'),
  ('2025-12-14', 26, 0, 2, null),
  ('2025-12-21', 26, 2, 3, 'Holiday Party'),
  ('2025-12-28', 35, 5, 3, null),
  ('2026-01-04', 36, 5, 2, null),
  ('2026-01-11', 29, 12, 3, null),
  ('2026-01-18', 28, 6, 2, null),
  ('2026-01-25', 25, 0, 0, 'Online tournament'),
  ('2026-02-01', 32, 7, 2, null),
  ('2026-02-08', 29, 4, 3, 'Challenge'),
  ('2026-02-15', 27, 6, 2, 'GLC / Standard'),
  ('2026-02-22', 31, 6, 3, null),
  ('2026-03-01', 47, 5, 3, 'Pokemon Day'),
  ('2026-03-08', 41, 6, 4, 'Challenge'),
  ('2026-03-15', 50, 6, 3, 'Prerelease'),
  ('2026-03-22', 58, 4, 3, 'Cup'),
  ('2026-03-29', 34, 7, 1, 'GLC / Standard'),
  ('2026-04-05', 25, 4, 3, 'Orlando regionals'),
  ('2026-04-12', 29, 3, 3, null),
  ('2026-04-19', 42, 8, 3, 'Challenge'),
  ('2026-04-26', 43, 5, 2, 'GLC / Standard'),
  ('2026-05-03', 54, 5, 4, 'Cup'),
  ('2026-05-10', 50, 3, 3, 'Prerelease'),
  ('2026-05-17', 29, 4, 3, null),
  ('2026-05-24', 40, 7, 3, 'Challenge'),
  ('2026-05-31', 30, 6, 3, 'GLC / Standard'),
  ('2026-06-07', 34, 7, 3, 'Chaos Cup'),
  ('2026-06-14', 29, 10, 4, 'NAIC'),
  ('2026-06-21', 35, 13, 3, null),
  ('2026-06-28', 32, 11, 4, 'GLC / Standard'),
  ('2026-07-05', 47, 3, 4, 'Prerelease'),
  ('2026-07-12', 29, 2, 3, null),
  ('2026-07-19', 31, 4, 4, 'Format-a-thon'),
  ('2026-07-26', 46, 2, 3, 'GLC / Standard'),
  ('2026-08-02', 25, 6, 3, null),
  ('2026-08-09', 39, 2, 3, 'Standard + VGC'),
  ('2026-08-16', 44, 5, 3, null),
  ('2026-08-23', 41, 5, 3, 'GLC / Standard'),
  ('2026-08-30', 60, 7, 3, 'Worlds Celebration'),
  ('2026-09-06', 46, 4, 3, 'Challenge'),
  ('2026-09-13', 31, 10, 3, null),
  ('2026-09-20', 21, 2, 2, 'Baltimore'),
  ('2026-09-27', 40, 5, 4, 'Anniversary party'),
  ('2026-10-04', 36, 4, 3, null),
  ('2026-10-11', 27, 2, 2, 'Challenge / Louisville'),
  ('2026-10-18', 48, 2, 4, null)
on conflict (attended_on) do update set
  players = excluded.players,
  learn_to_play = excluded.learn_to_play,
  judges = excluded.judges,
  note = excluded.note;

-- The imported notes become editable notes, so the page has one place to read
-- them from and a professor correcting "Lousiville" fixes it for good.
insert into public.league_day_notes (attended_on, note)
select attended_on, note
from public.attendance_history
where note is not null
on conflict (attended_on) do nothing;

-- ---------------------------------------------------------------------------
-- attendance_by_day, reading both eras
-- ---------------------------------------------------------------------------
-- Two sources, one shape. `counted_by_hand` is what tells them apart, and the
-- page uses it to draw those weeks as their own band rather than pretending an
-- age split it never had.
--
-- The imported half reports its divisions as zero and its split as unknown,
-- which is already how the page says "nobody recorded this". It is not a
-- special case so much as the existing one, arrived at from a different
-- direction.
-- Dropped rather than replaced. Three columns are being added to the returned
-- row, and Postgres refuses to change the shape of an existing function in
-- place -- "cannot change return type of existing function". Dropping takes the
-- grants with it, so they are written again below.
drop function if exists public.attendance_by_day(date, date);

create function public.attendance_by_day(
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
  other_attendees integer,
  judges integer,
  counted_by_hand boolean,
  note text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with live as (
    select
      a.attended_on,
      (count(*))::integer as total,
      (count(*) filter (where a.played is true))::integer as played,
      (count(*) filter (where a.played is false))::integer as attended_only,
      (count(*) filter (where a.played is null))::integer as split_unknown,
      -- Division is worked out as at the day itself, not today. A player who
      -- turned 13 in October was a Junior in September, and the history has to
      -- keep saying so.
      (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'junior'))::integer as junior,
      (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'senior'))::integer as senior,
      (count(*) filter (where public.division(p.birth_year, a.attended_on) = 'master'))::integer as master,
      (count(*) filter (where public.division(p.birth_year, a.attended_on) is null))::integer as division_unknown,
      -- Not coalesced to zero. The whole point of keeping other_attendees
      -- undeletable is that "a professor counted and there were none" is a
      -- different statement from "nobody counted", and coalescing here would
      -- throw that away before the page ever saw it.
      o.headcount as other_attendees,
      null::integer as judges,
      false as counted_by_hand
    from public.attendance a
    join public.players p on p.player_id = a.player_id
    left join public.other_attendees o on o.attended_on = a.attended_on
    group by a.attended_on, o.headcount
  ),
  imported as (
    select
      h.attended_on,
      (h.players + h.judges)::integer as total,
      h.players::integer as played,
      h.judges::integer as attended_only,
      0::integer as split_unknown,
      0::integer as junior,
      0::integer as senior,
      0::integer as master,
      (h.players + h.judges)::integer as division_unknown,
      h.learn_to_play::integer as other_attendees,
      h.judges::integer as judges,
      true as counted_by_hand
    from public.attendance_history h
    -- The live records win. A Sunday with even one person recorded against it
    -- is reported from attendance, so re-importing cannot overwrite anything a
    -- professor entered.
    where not exists (
      select 1 from public.attendance a where a.attended_on = h.attended_on
    )
  ),
  -- Not named "both": that is a reserved word in Postgres, from
  -- trim(both ... from ...), and will not serve as a CTE name.
  either_era as (
    select * from live
    union all
    select * from imported
  )
  select
    b.attended_on, b.total, b.played, b.attended_only, b.split_unknown,
    b.junior, b.senior, b.master, b.division_unknown, b.other_attendees,
    b.judges, b.counted_by_hand, n.note
  from either_era b
  left join public.league_day_notes n on n.attended_on = b.attended_on
  where public.is_professor()
    and (p_from is null or b.attended_on >= p_from)
    and (p_to is null or b.attended_on <= p_to)
  order by b.attended_on desc;
$function$;

comment on function public.attendance_by_day(date, date) is
  'Professor only. Every league day from both eras: per-player records where they exist, counted-by-hand figures where they do not.';

revoke execute on function public.attendance_by_day(date, date) from anon;
grant execute on function public.attendance_by_day(date, date) to authenticated;
