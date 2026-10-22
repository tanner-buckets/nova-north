-- Zane D exists twice. 6325247 is the right one; 63252467 is the duplicate.
--
-- An extra digit on the end, which is how it happened and why the two ids look
-- so alike. Both are named here rather than searched for: an id is exact, and
-- a migration that went looking for "the other Zane D" would be guessing at a
-- real person's records.
--
-- A duplicate row is the same human entered twice, so this MERGES rather than
-- deletes. A Sunday's attendance or a prize point filed under the wrong id
-- belongs to that person and should move, not vanish. A plain delete would
-- either fail on a foreign key or quietly take the history with it.
--
-- Guarded three ways, all of which no-op rather than raise. Six other
-- migrations ride in on the same push and a failed deploy is a worse outcome
-- than a duplicate surviving a day longer:
--
--   * the keeper has to exist
--   * the duplicate has to exist -- if it is already gone this has already run
--   * the duplicate has to still look like Zane D, so a mistyped id in this
--     file cannot merge away somebody else's records
--
-- The cost of not raising is that an unread notice makes a no-op look like a
-- success. VERIFY AFTER MERGING: look up Zane D on the players screen and
-- confirm there is one of him, with his attendance and points intact.
--
-- Where a move would collide -- the same badge twice, two attendance rows for
-- one day -- the duplicate's copy is dropped, because the keeper already has
-- that fact and the constraint says so.

do $merge$
declare
  v_keep text := '6325247';
  v_dupe text := '63252467';
  v_name text;
  v_moved integer;
begin
  if not exists (select 1 from public.players where player_id = v_keep) then
    raise notice 'MERGE SKIPPED: the keeper % is not in this database.', v_keep;
    return;
  end if;

  select btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    into v_name
  from public.players
  where player_id = v_dupe;

  if v_name is null then
    raise notice 'MERGE SKIPPED: % is not in this database. Already merged?', v_dupe;
    return;
  end if;

  -- The id is exact, so this is a seatbelt rather than a search: if 63252467
  -- turns out to be somebody else entirely, stop before touching their records.
  if v_name not ilike 'zane%' then
    raise notice 'MERGE SKIPPED: % is "%", which is not Zane D. '
      'Refusing to merge somebody else.', v_dupe, v_name;
    return;
  end if;

  raise notice 'Merging % ("%") into %.', v_dupe, v_name, v_keep;

  -- One attendance row per player per day is a unique constraint, so a day the
  -- keeper is already recorded for cannot take a second.
  delete from public.attendance a
   where a.player_id = v_dupe
     and exists (select 1 from public.attendance k
                  where k.player_id = v_keep and k.attended_on = a.attended_on);
  update public.attendance set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  attendance moved: %', v_moved;

  -- A badge is earned once, so the same badge under both ids collapses to one.
  delete from public.player_badges b
   where b.player_id = v_dupe
     and exists (select 1 from public.player_badges k
                  where k.player_id = v_keep and k.badge_id = b.badge_id);
  update public.player_badges set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  badges moved: %', v_moved;

  -- The ledger is append only and every row stands alone, so these all move:
  -- nothing here can collide and no total is recalculated, because there is no
  -- stored total to recalculate.
  update public.point_ledger set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  ledger rows moved: %', v_moved;

  update public.registrations set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  registrations moved: %', v_moved;

  update public.champion_awards set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  champion awards moved: %', v_moved;

  -- The consent history moves with the person. It is the record of what they
  -- agreed to, and it would be meaningless filed under an id that is gone.
  update public.consent_log set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  consent log rows moved: %', v_moved;

  update public.gallery_photos set submitted_by = v_keep where submitted_by = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  gallery submissions moved: %', v_moved;

  update public.trainer_card_prints set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  trainer card prints moved: %', v_moved;

  -- One pending request per player is a partial unique index, so the keeper's
  -- own pending request wins if both happen to have one.
  delete from public.visibility_requests r
   where r.player_id = v_dupe
     and r.status = 'pending'
     and exists (select 1 from public.visibility_requests k
                  where k.player_id = v_keep and k.status = 'pending');
  update public.visibility_requests set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  visibility requests moved: %', v_moved;

  delete from public.players where player_id = v_dupe;

  raise notice 'Done. % removed; everything it carried is now under %.',
    v_dupe, v_keep;
end;
$merge$;
