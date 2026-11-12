-- Abbie Coppage exists twice. 6268899 is the right one; 6325239 is the
-- duplicate.
--
-- Same shape as 20261022170000_merge_duplicate_player.sql, deliberately, and
-- the reasoning there still holds: a duplicate row is the same human entered
-- twice, so this MERGES rather than deletes. A Sunday's attendance or a prize
-- point filed under the wrong id belongs to that person and should move, not
-- vanish. Both ids are named here rather than searched for -- an id is exact,
-- and a migration that went looking for "the other Abbie" would be guessing at
-- a real child's records.
--
-- IT COVERS FIVE TABLES THE ZANE MERGE DID NOT. Three existed then and were
-- simply missed (loyalty_carryover, loyalty_results, elite_four_wins); staff
-- arrived a day later in 20261023140000. That merge survived only because the
-- duplicate happened to have no rows in any of them -- the final DELETE would
-- have failed on a foreign key otherwise. Every table that references
-- players (player_id) is handled below; if a new one is added, it belongs in
-- the next one of these.
--
-- Guarded the same three ways, all of which no-op rather than raise. The cost
-- of not raising is that an unread notice makes a no-op look like a success.
-- VERIFY AFTER MERGING: look up Abbie Coppage on the players screen and
-- confirm there is one of her, with her attendance and points intact.
--
-- Where a move would collide -- the same badge twice, two attendance rows for
-- one day -- the duplicate's copy is dropped, because the keeper already has
-- that fact and the constraint says so.

do $merge$
declare
  v_keep text := '6268899';
  v_dupe text := '6325239';
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

  -- The id is exact, so this is a seatbelt rather than a search: if 6325239
  -- turns out to be somebody else entirely, stop before touching their records.
  if v_name not ilike 'abbie%coppage%' then
    raise notice 'MERGE SKIPPED: % is "%", which is not Abbie Coppage. '
      'Refusing to merge somebody else.', v_dupe, v_name;
    return;
  end if;

  raise notice 'Merging % ("%") into %.', v_dupe, v_name, v_keep;

  -- A birth year or a contact recorded on only one of the two rows is still a
  -- fact about the person, and deleting the duplicate would throw it away.
  -- Nulls are filled; nothing already on the keeper is overwritten, because a
  -- professor who corrected a field outranks whichever row happened to survive.
  update public.players k
  set birth_year = coalesce(k.birth_year, d.birth_year),
      contact    = coalesce(k.contact, d.contact)
  from public.players d
  where k.player_id = v_keep
    and d.player_id = v_dupe;

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

  -- One live registration per player per event, dropped rows excluded. A
  -- dropped row can sit beside a live one, so only the live collision goes.
  delete from public.registrations r
   where r.player_id = v_dupe
     and r.status <> 'dropped'
     and exists (select 1 from public.registrations k
                  where k.player_id = v_keep
                    and k.event_id = r.event_id
                    and k.status <> 'dropped');
  update public.registrations set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  registrations moved: %', v_moved;

  -- Champion once per season, so two rows for one year collapse to the
  -- keeper's. The star on a card counts rows, and she did not win it twice.
  delete from public.champion_awards c
   where c.player_id = v_dupe
     and exists (select 1 from public.champion_awards k
                  where k.player_id = v_keep and k.season_year = c.season_year);
  update public.champion_awards set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  champion awards moved: %', v_moved;

  -- One row per battle per season. The same battle won under both ids is one
  -- win, and four of them is what opens Champion.
  delete from public.elite_four_wins e
   where e.player_id = v_dupe
     and exists (select 1 from public.elite_four_wins k
                  where k.player_id = v_keep
                    and k.season_year = e.season_year
                    and k.battle_number = e.battle_number);
  update public.elite_four_wins set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  elite four wins moved: %', v_moved;

  -- (release_id, player_id) is the primary key here, so a release the keeper
  -- already carries over for cannot take a second row.
  delete from public.loyalty_carryover c
   where c.player_id = v_dupe
     and exists (select 1 from public.loyalty_carryover k
                  where k.player_id = v_keep and k.release_id = c.release_id);
  update public.loyalty_carryover set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  loyalty carryover moved: %', v_moved;

  -- One result per release per player. A closed release is a snapshot and is
  -- not recalculated here: the keeper's own row is the one that stands.
  delete from public.loyalty_results r
   where r.player_id = v_dupe
     and exists (select 1 from public.loyalty_results k
                  where k.player_id = v_keep and k.release_id = r.release_id);
  update public.loyalty_results set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  loyalty results moved: %', v_moved;

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

  -- staff.player_id is UNIQUE, so if both ids are on the roster the link
  -- cannot simply move. The roster row is kept and unlinked rather than
  -- deleted -- a rota entry is a record of who helped -- and this says so
  -- loudly, because two roster rows for one person is a second duplicate that
  -- only a person can settle on the staff screen.
  if exists (select 1 from public.staff where player_id = v_keep)
     and exists (select 1 from public.staff where player_id = v_dupe) then
    update public.staff set player_id = null where player_id = v_dupe;
    raise notice '  ATTENTION: both ids were on the staff roster. The duplicate''s '
      'roster row has been unlinked and kept. Tidy it on the staff screen.';
  else
    update public.staff set player_id = v_keep where player_id = v_dupe;
    get diagnostics v_moved = row_count;
    raise notice '  staff roster rows moved: %', v_moved;
  end if;

  -- Nullable and not unique, so this just moves. A duplicate player row that
  -- is also a professor's own link is unlikely and harmless either way.
  update public.professors set player_id = v_keep where player_id = v_dupe;
  get diagnostics v_moved = row_count;
  raise notice '  professor links moved: %', v_moved;

  delete from public.players where player_id = v_dupe;

  raise notice 'Done. % removed; everything it carried is now under %.',
    v_dupe, v_keep;
end;
$merge$;
