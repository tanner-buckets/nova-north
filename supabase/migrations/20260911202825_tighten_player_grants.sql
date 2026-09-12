-- Phase 2, follow-up: close two gaps found by auditing the grants.
--
-- 1. INSERT was granted at table level, which covers every column. A professor
--    could therefore create a player row with show_player_id or show_name
--    already set, bypassing set_player_visibility() and leaving no consent_log
--    row. The audit trail is only trustworthy if there is no other route.
--
-- 2. anon held REFERENCES on these tables, inherited from Supabase's default
--    privileges rather than granted here. It is close to inert, because creating
--    a foreign key also needs CREATE on the schema, which anon does not have.
--    It still should not be there.
--
-- Also: player_id becomes updatable. A Player ID mis-entered at registration has
-- to be correctable, and the foreign key from professors now cascades so the
-- correction carries across rather than being blocked.
--
-- Approach: revoke everything on these three tables from both API roles, then
-- grant back precisely what each needs. Explicit beats inherited.

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
revoke all on public.players from anon, authenticated;

grant select on public.players to authenticated;

-- Column lists on both INSERT and UPDATE. The consent columns appear in
-- neither, so set_player_visibility() is the only way they can ever change.
grant insert (player_id, first_name, last_name, birth_year, contact, notes)
  on public.players to authenticated;

grant update (player_id, first_name, last_name, birth_year, contact, notes)
  on public.players to authenticated;

comment on column public.players.player_id is
  'Play! Pokemon Player ID, and the key everything else joins on. Updatable so a mis-entry can be corrected; every foreign key referencing it must use ON UPDATE CASCADE.';

-- ---------------------------------------------------------------------------
-- professors
-- ---------------------------------------------------------------------------
revoke all on public.professors from anon, authenticated;
grant select, insert, update, delete on public.professors to authenticated;

-- Correcting a player_id must carry across to the professor row rather than
-- being refused. Every future table referencing players needs this too:
-- attendance, point_ledger, loyalty_results and registrations.
alter table public.professors
  drop constraint professors_player_id_fkey;

alter table public.professors
  add constraint professors_player_id_fkey
  foreign key (player_id) references public.players (player_id)
  on update cascade;

-- ---------------------------------------------------------------------------
-- consent_log
-- ---------------------------------------------------------------------------
revoke all on public.consent_log from anon, authenticated;
grant select on public.consent_log to authenticated;

-- The log points at a player too, so the same correction must carry across.
alter table public.consent_log
  drop constraint consent_log_player_id_fkey;

alter table public.consent_log
  add constraint consent_log_player_id_fkey
  foreign key (player_id) references public.players (player_id)
  on update cascade;

-- ---------------------------------------------------------------------------
-- The view is unaffected, but re-grant explicitly after the revokes above.
-- ---------------------------------------------------------------------------
grant select on public.public_players to anon, authenticated;
