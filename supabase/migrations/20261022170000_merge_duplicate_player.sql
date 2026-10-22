-- Zane D exists twice. 6325247 is the right one.
--
-- A duplicate row is the same human entered twice, so this MERGES rather than
-- deletes: a Sunday's attendance or a prize point filed under the wrong id
-- belongs to that person and should move, not vanish. A plain delete would
-- either fail on a foreign key or quietly take history with it.
--
-- IT FINDS THE DUPLICATE ITSELF, by name, because the id was never written
-- down anywhere this file could read. That makes the matching the risky part,
-- so it is deliberately timid:
--
--   * exactly one other Zane D   -> merge it
--   * none                       -> do nothing, say so
--   * more than one              -> do NOTHING and say so loudly
--
-- The last case does not raise. Five other migrations ride in on the same push
-- and a failed deploy would be a worse outcome than a duplicate surviving one
-- more day. That is a trade: if the notices are not read, a no-op looks exactly
-- like a success. VERIFY AFTER MERGING -- look up Zane D on the players screen
-- and confirm there is one of him.
--
-- Where a move would collide -- the same badge twice, two attendance rows for
-- one day -- the duplicate's copy is dropped, because the keeper already has
-- that fact and the constraint says so.

do $merge$
declare
  v_keep text := '6325247';
  v_dupe text;
  v_count integer;
  v_moved integer;
begin
  if not exists (select 1 from public.players where player_id = v_keep) then
    raise notice 'MERGE SKIPPED: the keeper % is not in this database.', v_keep;
    return;
  end if;

  select count(*), min(player_id) into v_count, v_dupe
  from public.players
  where player_id <> v_keep
    and first_name ilike 'zane'
    and last_name ilike 'd%';

  if v_count = 0 then
    raise notice 'MERGE SKIPPED: no second Zane D found. Nothing to do.';
    return;
  end if;

  if v_count > 1 then
    raise notice 'MERGE SKIPPED: % players match Zane D besides %. '
      'Refusing to guess which one is the duplicate -- do it by hand.',
      v_count, v_keep;
    return;
  end if;

  raise notice 'Merging % into %.', v_dupe, v_keep;

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

  -- The ledger is append only and every row is its own transaction, so these
  -- all move: nothing here can collide and nothing is recalculated.
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
  -- own pending request wins if both have one.
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
