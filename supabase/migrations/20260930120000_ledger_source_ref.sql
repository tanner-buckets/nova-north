-- The repeat-upload check was keyed on the tournament's name.
--
-- point_ledger.reason reads "Played in Sunday League Challenge", and the upload
-- screen asked which of the players in the file already held a row with that
-- exact text. That works for a re-upload of the same file and fails everywhere
-- else:
--
--   * A league that exports the same event name every Sunday flags every
--     returning player from the second week onward. The default is to skip
--     paying them, so regulars quietly stop earning the play point unless a
--     professor notices the warning and overrides it every single week.
--   * Two genuinely different tournaments exported under one name -- two flights
--     of a prerelease, say -- look identical to it.
--
-- A tournament file carries an id of its own, directly after the name. It is
-- the thing that actually identifies the tournament, so the check belongs on it.
--
-- It goes in a column rather than into reason, because reason is returned by
-- get_player_summary() and shows on a player's public card. "Played in Sunday
-- League Challenge" is a sentence somebody reads; "Played in Sunday League
-- Challenge (16-05-000123)" is a sentence with a filing reference in it.

alter table public.point_ledger
  add column source_ref text;

comment on column public.point_ledger.source_ref is
  'What outside thing this row came from: the tournament id out of a TDF file. Not public -- unlike reason, this column is never returned by get_player_summary(). Null for everything not recorded from a file, and for rows written before this column existed, so a re-upload of a tournament recorded before then is not caught.';

-- The check asks "which of these players already hold a row for this
-- tournament", so it filters on both and never on source_ref alone.
create index point_ledger_source_ref_idx
  on public.point_ledger (source_ref, player_id)
  where source_ref is not null;

-- No grant needed: select and insert on point_ledger are granted at table level
-- to authenticated, so the new column is already covered. Nothing is granted to
-- anon, here or anywhere on this table.
--
-- No policy change either. The existing professor-only select and insert
-- policies apply to the row, and a column does not change who may read it.
