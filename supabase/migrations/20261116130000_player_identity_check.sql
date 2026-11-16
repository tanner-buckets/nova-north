-- Proving who you are on a form: last name and birth year, not a first name.
--
-- Three public functions asked for a Player ID and a FIRST NAME, and all three
-- carried the same comment: one refusal covers both halves, so the form cannot
-- be used to test which Player IDs exist. That part was right and is kept. The
-- part that was wrong is that a first name is not a secret on this site.
-- display_label() publishes "Maya R." for every player whose name visibility is
-- in force, and the list on players.html is a page of exactly those, each with
-- its Player ID beside it. For a listed player, both halves of the proof were
-- already on screen.
--
-- A LAST NAME AND A BIRTH YEAR ARE NEVER PUBLIC, at any consent level. They are
-- both in the never-public list at the top of CLAUDE.md, no page renders either
-- one, and get_player_summary() does not return them. They are the two facts on
-- a player's row that somebody reading the site cannot already have, which is
-- what a proof has to be made of.
--
-- Birth year is a protected field and this does not change that. It is ASKED
-- FOR, NEVER SHOWN: nothing here returns it, nothing here writes it, and the
-- registration form already asks a player for their own. No fuller date than
-- the year is taken, here or anywhere.
--
-- The three functions are dropped and recreated rather than replaced, because
-- the argument list is part of a function's identity -- `create or replace`
-- with a different one makes a second overload and leaves the old one callable.
-- A DROP TAKES THE GRANTS WITH IT, so every one is reissued at the foot.

-- ---------------------------------------------------------------------------
-- player_identity_matches
-- ---------------------------------------------------------------------------
-- One copy of the rule. Three callers had three copies of the old one, which is
-- how a check ends up tightened in two places out of three.
--
-- NOT CALLABLE FROM A BROWSER. Execute is revoked from everybody: a boolean
-- that answers "is this the right birth year" would be a guessing oracle with
-- no rate limit on it. The callers below are security definer and run as the
-- owner, so they can call it while nobody else can.
--
-- A player whose birth year is null falls back to the last name alone. Some
-- rows predate the registration form and have no year on file, and the
-- alternative is a player who can never prove who they are and is told only
-- that nothing matched. A last name is still never public, so this is a weaker
-- proof rather than no proof, and it fixes itself the moment a professor
-- records the year.
create or replace function public.player_identity_matches(
  p_player_id text,
  p_last_name text,
  p_birth_year integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.players p
    where p.player_id = btrim(coalesce(p_player_id, ''))
      and lower(p.last_name) = lower(btrim(coalesce(p_last_name, '')))
      and (p.birth_year is null or p.birth_year = p_birth_year)
  );
$function$;

comment on function public.player_identity_matches(text, text, integer) is
  'Whether a Player ID, last name and birth year belong together. Internal: execute is revoked from every browser role, because a boolean answer is a guessing oracle.';

revoke all on function public.player_identity_matches(text, text, integer) from public;
revoke all on function public.player_identity_matches(text, text, integer) from anon;
revoke all on function public.player_identity_matches(text, text, integer) from authenticated;

-- ---------------------------------------------------------------------------
-- request_visibility
-- ---------------------------------------------------------------------------
-- Unchanged but for the proof. It still changes nothing: a professor reads the
-- request on the consent screen and decides, and every flag still moves only
-- through set_player_visibility().
drop function if exists public.request_visibility(
  text, text, boolean, boolean, boolean, text, text, text);

create or replace function public.request_visibility(
  p_player_id text,
  p_last_name text,
  p_birth_year integer,
  p_want_player_id boolean default null,
  p_want_name boolean default null,
  p_want_contact boolean default null,
  p_contact text default null,
  p_ptcg_live text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id text;
begin
  if not public.player_identity_matches(p_player_id, p_last_name, p_birth_year) then
    return jsonb_build_object('ok', false, 'code', 'not_matched');
  end if;

  v_id := btrim(coalesce(p_player_id, ''));

  -- Asking for nothing is not a request. Without this, an empty form would
  -- land on a professor's screen saying nothing at all.
  if p_want_player_id is null and p_want_name is null and p_want_contact is null
     and nullif(btrim(coalesce(p_contact, '')), '') is null
     and nullif(btrim(coalesce(p_ptcg_live, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'nothing_asked');
  end if;

  insert into public.visibility_requests as r
    (player_id, want_player_id, want_name, want_contact, contact, ptcg_live, note)
  values
    (v_id, p_want_player_id, p_want_name, p_want_contact,
     nullif(btrim(coalesce(p_contact, '')), ''),
     nullif(btrim(coalesce(p_ptcg_live, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (player_id) where status = 'pending'
  do update set
    want_player_id = excluded.want_player_id,
    want_name      = excluded.want_name,
    want_contact   = excluded.want_contact,
    contact        = coalesce(excluded.contact, r.contact),
    ptcg_live      = coalesce(excluded.ptcg_live, r.ptcg_live),
    note           = coalesce(excluded.note, r.note),
    submitted_at   = now();

  return jsonb_build_object('ok', true, 'code', 'received');
end;
$function$;

comment on function public.request_visibility(text, text, integer, boolean, boolean, boolean, text, text, text) is
  'Public. A player asking to be listed, unlisted, or to record a TCG Live name. Changes nothing by itself: a professor decides.';

-- ---------------------------------------------------------------------------
-- submit_gallery_photo
-- ---------------------------------------------------------------------------
-- Same body, same one refusal for a wrong ID and a wrong name, same landing on
-- pending so a caller cannot publish anything.
drop function if exists public.submit_gallery_photo(
  text, text, text, text, integer, integer, text);

create or replace function public.submit_gallery_photo(
  p_player_id text,
  p_last_name text,
  p_birth_year integer,
  p_storage_path text,
  p_thumb_path text,
  p_width integer default null,
  p_height integer default null,
  p_caption text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player text;
  v_recent integer;
  v_caption text;
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if not public.player_identity_matches(p_player_id, p_last_name, p_birth_year) then
    return jsonb_build_object('ok', false, 'code', 'not_matched');
  end if;

  v_player := btrim(coalesce(p_player_id, ''));

  -- The paths are written by the page, so they are checked here rather than
  -- trusted. A row may only ever point at a submission named after a uuid.
  if coalesce(p_storage_path, '') !~ ('^submissions/' || v_uuid || '\.jpg$')
     or coalesce(p_thumb_path, '') !~ ('^submissions/' || v_uuid || '-thumb\.jpg$') then
    return jsonb_build_object('ok', false, 'code', 'bad_path');
  end if;

  -- A day of league is a handful of pictures. Twenty leaves room for an
  -- enthusiastic parent and still caps what one person can put in front of a
  -- professor overnight.
  select count(*) into v_recent
  from public.gallery_photos
  where submitted_by = v_player
    and submitted_at > now() - interval '24 hours';

  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  v_caption := left(nullif(btrim(coalesce(p_caption, '')), ''), 300);

  insert into public.gallery_photos
    (storage_path, thumb_path, width, height, caption, submitted_by)
  values (p_storage_path, p_thumb_path, p_width, p_height, v_caption, v_player);

  return jsonb_build_object('ok', true, 'code', 'submitted');
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_submitted');
end;
$function$;

comment on function public.submit_gallery_photo(text, text, integer, text, text, integer, integer, text) is
  'The only public way to create a gallery row. Always lands on status pending, so a caller cannot publish anything.';

-- ---------------------------------------------------------------------------
-- request_drop
-- ---------------------------------------------------------------------------
-- THIS ONE MATCHES THE REGISTRATION, NOT THE PLAYER ROW, and deliberately so: a
-- drop is about a particular booking, and the person proving it is proving they
-- are the one who made it. The registration carries its own last name and birth
-- year -- register_for_event() refuses without both and the columns are NOT
-- NULL -- so there is no null year to fall back around here, unlike the players
-- table.
--
-- An unknown Player ID, a mismatch and a player with no registration all return
-- the SAME result, as before. Otherwise this becomes a way to test which IDs
-- are registered for an event and then to guess details against them.
drop function if exists public.request_drop(text, text, uuid);

create or replace function public.request_drop(
  p_player_id text,
  p_last_name text,
  p_birth_year integer,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  select id into v_id
  from public.registrations
  where event_id = p_event_id
    and player_id = btrim(coalesce(p_player_id, ''))
    and lower(last_name) = lower(btrim(coalesce(p_last_name, '')))
    and birth_year = p_birth_year
    and status in ('confirmed', 'waitlist');

  if found then
    update public.registrations
       set status = 'drop_requested'
     where id = v_id;
  end if;

  -- Deliberately identical whether or not anything matched.
  return jsonb_build_object('ok', true, 'code', 'drop_requested');
end;
$function$;

comment on function public.request_drop(text, text, integer, uuid) is
  'Flags a drop for professor confirmation. Returns the same result whether or not a registration matched, so it cannot be used to enumerate registrants.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Reissued because the drops above took the old ones with them.
revoke all on function public.request_visibility(text, text, integer, boolean, boolean, boolean, text, text, text) from public;
revoke all on function public.submit_gallery_photo(text, text, integer, text, text, integer, integer, text) from public;
revoke all on function public.request_drop(text, text, integer, uuid) from public;

grant execute on function public.request_visibility(text, text, integer, boolean, boolean, boolean, text, text, text) to anon, authenticated;
grant execute on function public.submit_gallery_photo(text, text, integer, text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.request_drop(text, text, integer, uuid) to anon, authenticated;
