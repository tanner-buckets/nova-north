-- Prize packs: what arrives from Pokémon, and what goes out on a Sunday.
--
-- This was a spreadsheet with a block of columns per series: how many were
-- handed out each week, how many were left afterwards, and a figure typed in
-- beside the week a box arrived. It stopped being kept up, which is the usual
-- fate of a second place to write something down -- the packs go out at the
-- desk and the sheet is somewhere else.
--
-- WHAT IS SEEDED IS THE TWO SERIES AND NOTHING ELSE. The spreadsheet's history
-- is not imported: it is out of date, and a stock figure that is nearly right
-- is worse than no figure, because somebody would order against it. Series 8
-- and 9 are created with no packs at all, so the first thing recorded is a
-- professor counting what is actually on the shelf. The spent series -- 5, 6
-- and 7 -- are not created at all.
--
-- Remaining is never stored. It is received minus handed out, every time it is
-- asked for, which is the same rule the point ledger follows: a running total
-- in a column is a running total that can disagree with the rows under it.

-- --- The series --------------------------------------------------------------

-- A table rather than a number typed into page code, for the reason the rental
-- deck tags are a table: a new series arrives from Pokémon every few months and
-- adding one should not be a migration.
create table public.prize_pack_series (
  id uuid primary key default gen_random_uuid(),
  -- Series are numbered and that is the whole of their name. There is no free
  -- text here: "Series 8" is what the box says and what a professor calls it,
  -- and a name column would be a second spelling of the same fact.
  number integer not null unique check (number > 0),
  -- Retired, never deleted. A spent series keeps its history, and its handouts
  -- still have to point at a row.
  is_active boolean not null default true,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);

comment on table public.prize_pack_series is
  'One row per prize pack series. Retired when the last pack goes out; never deleted, because the handouts still point at it.';

-- --- Packs arriving ----------------------------------------------------------

create table public.prize_pack_receipts (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.prize_pack_series (id) on delete restrict,
  received_on date not null,
  quantity integer not null check (quantity > 0),
  -- "Opening count", "second shipment". Free text, because what makes a
  -- delivery worth distinguishing is not a thing this table can anticipate.
  note text,
  -- Voided, never deleted, like every other correction here. A delivery that
  -- was typed as 600 instead of 60 is a row that happened and was wrong, and
  -- the void says which.
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index prize_pack_receipts_series_idx
  on public.prize_pack_receipts (series_id, received_on);

comment on table public.prize_pack_receipts is
  'Packs arriving: a shipment, or a professor counting what is already on the shelf. Voided, never deleted.';

-- --- Packs going out ---------------------------------------------------------

-- One row per series per day, not per event. Two tournaments on one Sunday are
-- one afternoon of packs going out, and a professor uploading the second file
-- is reporting the same afternoon again -- the same rule other_attendees
-- follows, and for the same reason: re-uploading a file to fix something must
-- not double the count.
create table public.prize_pack_handouts (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.prize_pack_series (id) on delete restrict,
  handed_out_on date not null,
  -- Zero is allowed and is not the same as no row. Zero is a professor saying
  -- none of this series went out that day; no row is nobody having said.
  quantity integer not null check (quantity >= 0),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (series_id, handed_out_on)
);

create index prize_pack_handouts_day_idx
  on public.prize_pack_handouts (handed_out_on);

comment on table public.prize_pack_handouts is
  'Packs handed out, one row per series per calendar day. Replaced rather than added to, because two files from one Sunday are one afternoon.';

-- --- Who may read and write --------------------------------------------------

-- Professor-only. There is nothing here about a player, but there is nothing
-- here for a player either: how much stock is in the cupboard is a question
-- about ordering, and a public count of what is left would read as a promise
-- about what is still available.
revoke all on public.prize_pack_series from anon, authenticated;
revoke all on public.prize_pack_receipts from anon, authenticated;
revoke all on public.prize_pack_handouts from anon, authenticated;

grant select on public.prize_pack_series to authenticated;
grant insert (number) on public.prize_pack_series to authenticated;
grant update (number, is_active) on public.prize_pack_series to authenticated;

grant select on public.prize_pack_receipts to authenticated;
grant insert (series_id, received_on, quantity, note) on public.prize_pack_receipts to authenticated;

grant select on public.prize_pack_handouts to authenticated;
grant insert (series_id, handed_out_on, quantity) on public.prize_pack_handouts to authenticated;
grant update (series_id, handed_out_on, quantity) on public.prize_pack_handouts to authenticated;

alter table public.prize_pack_series enable row level security;
alter table public.prize_pack_receipts enable row level security;
alter table public.prize_pack_handouts enable row level security;

create policy prize_pack_series_read on public.prize_pack_series
  for select to authenticated using (public.is_professor());
create policy prize_pack_series_write on public.prize_pack_series
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

create policy prize_pack_receipts_read on public.prize_pack_receipts
  for select to authenticated using (public.is_professor());
create policy prize_pack_receipts_write on public.prize_pack_receipts
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

create policy prize_pack_handouts_read on public.prize_pack_handouts
  for select to authenticated using (public.is_professor());
create policy prize_pack_handouts_write on public.prize_pack_handouts
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- Who recorded a row is stamped, not sent. An insert carrying its own author is
-- an insert that could name somebody else, and the grants above leave those
-- columns out so a browser cannot write them even with a valid session. Same
-- arrangement as league_day_notes and the staffing tables.
create function public.stamp_prize_pack_series()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.added_by := auth.uid();
  return new;
end;
$function$;

create trigger prize_pack_series_stamp
  before insert on public.prize_pack_series
  for each row execute function public.stamp_prize_pack_series();

create function public.stamp_prize_pack_movement()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  return new;
end;
$function$;

create trigger prize_pack_receipts_stamp
  before insert on public.prize_pack_receipts
  for each row execute function public.stamp_prize_pack_movement();

-- On update too: a handout is replaced when a day is recorded again, and
-- without this the row would keep naming whoever typed the first number.
create trigger prize_pack_handouts_stamp
  before insert or update on public.prize_pack_handouts
  for each row execute function public.stamp_prize_pack_movement();

-- --- Reading it back ---------------------------------------------------------

-- Where each series stands. One row per series, so a screen asking "what is
-- left" costs one request rather than one per series.
--
-- recent_out and recent_days are the last four days this series actually went
-- out on, which is what turns a remaining count into "about five more Sundays".
-- Days where none of a series went out are left out of that rate deliberately:
-- a series that has been superseded would otherwise look like it lasts forever.
create function public.prize_pack_stock()
returns table (
  series_id uuid,
  series_number integer,
  is_active boolean,
  received integer,
  handed_out integer,
  remaining integer,
  last_handout_on date,
  recent_out integer,
  recent_days integer
)
language sql stable
set search_path = ''
as $function$
  with got as (
    select rc.series_id as sid, sum(rc.quantity)::int as qty
    from public.prize_pack_receipts rc
    where rc.voided_at is null
    group by rc.series_id
  ),
  gave as (
    select ho.series_id as sid,
           sum(ho.quantity)::int as qty,
           max(ho.handed_out_on) as last_on
    from public.prize_pack_handouts ho
    group by ho.series_id
  ),
  ranked as (
    select ho.series_id as sid, ho.quantity as qty,
           row_number() over (partition by ho.series_id
                              order by ho.handed_out_on desc) as rn
    from public.prize_pack_handouts ho
    where ho.quantity > 0
  ),
  lately as (
    select ranked.sid, sum(ranked.qty)::int as qty, count(*)::int as days
    from ranked
    where ranked.rn <= 4
    group by ranked.sid
  )
  select s.id,
         s.number,
         s.is_active,
         coalesce(got.qty, 0),
         coalesce(gave.qty, 0),
         coalesce(got.qty, 0) - coalesce(gave.qty, 0),
         gave.last_on,
         coalesce(lately.qty, 0),
         coalesce(lately.days, 0)
  from public.prize_pack_series s
  left join got on got.sid = s.id
  left join gave on gave.sid = s.id
  left join lately on lately.sid = s.id
  order by s.number desc;
$function$;

-- Every movement, with what was left after it.
--
-- The running total is worked out here rather than on the page because it is
-- the one figure the chart is actually about, and a window function is the
-- right tool for it. A receipt and a handout on the same day collapse into one
-- row, so a week a box arrived reads as the net change the shelf saw.
create function public.prize_pack_history()
returns table (
  series_id uuid,
  series_number integer,
  moved_on date,
  received integer,
  handed_out integer,
  remaining_after integer
)
language sql stable
set search_path = ''
as $function$
  with moves as (
    select rc.series_id as sid, rc.received_on as on_day,
           sum(rc.quantity)::int as got, 0 as gave
    from public.prize_pack_receipts rc
    where rc.voided_at is null
    group by rc.series_id, rc.received_on
    union all
    select ho.series_id, ho.handed_out_on,
           0, sum(ho.quantity)::int
    from public.prize_pack_handouts ho
    group by ho.series_id, ho.handed_out_on
  ),
  byday as (
    select m.sid, m.on_day,
           sum(m.got)::int as got,
           sum(m.gave)::int as gave
    from moves m
    group by m.sid, m.on_day
  )
  select s.id,
         s.number,
         b.on_day,
         b.got,
         b.gave,
         (sum(b.got - b.gave) over (partition by b.sid order by b.on_day
            rows between unbounded preceding and current row))::int
  from byday b
  join public.prize_pack_series s on s.id = b.sid
  order by s.number desc, b.on_day;
$function$;

revoke all on function public.prize_pack_stock() from anon, authenticated;
revoke all on function public.prize_pack_history() from anon, authenticated;
grant execute on function public.prize_pack_stock() to authenticated;
grant execute on function public.prize_pack_history() to authenticated;

-- Voiding is a function, not a grant. An UPDATE grant on the receipts table
-- would let any signed-in professor write any column of any row from a browser,
-- which is the same reason void_trainer_card_batch() exists.
create function public.void_prize_pack_receipt(p_receipt uuid)
returns void
language plpgsql security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may void a prize pack delivery';
  end if;

  update public.prize_pack_receipts
  set voided_at = now(), voided_by = auth.uid()
  where id = p_receipt and voided_at is null;
end;
$function$;

revoke all on function public.void_prize_pack_receipt(uuid) from anon, authenticated;
grant execute on function public.void_prize_pack_receipt(uuid) to authenticated;

-- --- The two series still in play --------------------------------------------

-- No packs with them. added_by is left null by the trigger, as it should be: a
-- deploy created these rows and naming a professor would claim a decision
-- nobody made.
insert into public.prize_pack_series (number) values (8), (9);
