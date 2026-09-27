-- Professors were never recorded as attending, so their loyalty for Delta Reign
-- reads zero. They were there. This gives them the weeks back.
--
-- The week counts are known; the dates are not. Nobody wrote down which Sundays
-- each professor was at the store, and attendance is a record of days somebody
-- was present -- picking the most recent Sundays until the numbers came out
-- right would put twenty-nine fabrications into a factual table, and a later
-- reader would have no way to tell them from the real thing.
--
-- loyalty_carryover is the table for exactly this: weeks accrued without dated
-- attendance behind them, added to the live count by loyalty_weeks(). Its own
-- comment says "One-time import bridge; do not add rows going forward", and
-- this is a second use of it, which is a thing worth being uncomfortable about.
-- The alternative was worse. The rule is there to stop carryover replacing
-- attendance as the ordinary way weeks are recorded; it is not there to force
-- undated weeks to be written as dated ones.
--
-- WHAT THIS DOES NOT DO. It creates no attendance rows, so it does not satisfy
-- the three month attendance recency that ID visibility depends on. A professor
-- whose Player ID is meant to show publicly still needs real attendance, from a
-- TDF upload or the manual entry screen, like anybody else.

do $backfill$
declare
  v_release_id uuid;
  v_starts date;
  v_ends date;
  v_target integer;
  v_dated integer;
  v_owed integer;
  v_player text;
  v_missing text[] := '{}';

  -- Player ID and the total weeks each should end on for this release, from the
  -- organiser. First names are deliberately absent: a comment in a public
  -- repository does not need them, and the ID is the key anyway.
  v_targets constant jsonb := jsonb_build_object(
    '3334937', 8,
    '1515243', 6,
    '4712303', 9,
    '3587149', 6
  );
begin
  -- Pinned by name and start date rather than "whichever release contains
  -- today", so this migration means the same thing whenever it is applied.
  select id, starts_on, ends_on into v_release_id, v_starts, v_ends
  from public.releases
  where name = 'Delta Reign' and starts_on = date '2026-07-19';

  if not found then
    raise exception 'Delta Reign starting 2026-07-19 was not found. This backfill is scoped to that release and will not guess at another one.';
  end if;

  -- A missing player would otherwise surface as a foreign key violation naming
  -- a constraint rather than a person.
  for v_player in select jsonb_object_keys(v_targets) loop
    if not exists (select 1 from public.players where player_id = v_player) then
      v_missing := v_missing || v_player;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'No players row for: %. Create them before running this.',
      array_to_string(v_missing, ', ');
  end if;

  for v_player in select jsonb_object_keys(v_targets) loop
    v_target := (v_targets ->> v_player)::integer;

    -- Anything already recorded as dated attendance inside the window is
    -- already counted by loyalty_weeks(), so the carryover is the shortfall,
    -- not the total. Without this, a professor who had two Sundays recorded
    -- would finish on ten rather than eight.
    select count(distinct attended_on) into v_dated
    from public.attendance
    where player_id = v_player
      and attended_on between v_starts and v_ends;

    v_owed := greatest(v_target - coalesce(v_dated, 0), 0);

    -- Set, not added. Re-applying this leaves the same answer rather than
    -- doubling it, and the number is the one the organiser gave.
    insert into public.loyalty_carryover (release_id, player_id, weeks, note)
    values (v_release_id, v_player, v_owed,
            'League days before professors were being recorded. Weeks known, dates not.')
    on conflict (release_id, player_id) do update
      set weeks = excluded.weeks,
          note = excluded.note,
          recorded_at = now();

    -- One prize point per league day, which is what attending is worth. Only
    -- for the days being added here: any dated attendance they already have
    -- earned its point through the ordinary flow.
    --
    -- The wording is deliberately plain. point_ledger.reason is returned by
    -- get_player_summary(), so it shows on a public player card, and "because
    -- they are a professor" is not something a card should announce about
    -- somebody. The full explanation lives on the carryover note above, which
    -- only a professor can read.
    --
    -- The ledger is append only and has no unique constraint to lean on, so
    -- the guard is that same text. Re-applying this does not pay twice.
    if v_owed > 0 and not exists (
      select 1 from public.point_ledger
      where player_id = v_player and reason = 'League days recorded late'
    ) then
      insert into public.point_ledger (player_id, delta, reason, created_by)
      values (v_player, v_owed, 'League days recorded late',
              null);   -- no professor awarded these; the same case as an opening balance
    end if;

    raise notice 'Player %: target % weeks, % already dated, % carried over',
      v_player, v_target, coalesce(v_dated, 0), v_owed;
  end loop;
end;
$backfill$;
