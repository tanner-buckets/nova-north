-- Players can ask to be listed, and say how to reach them.
--
-- Until now visibility moved in one direction only: a professor asked a player
-- at the desk and set a flag. A player who decided at home that they wanted to
-- be on the site had nowhere to say so, and nobody collected a Pokémon TCG Live
-- name at all.
--
-- Three parts:
--   1. Two new columns on players -- ptcg_live, and show_contact.
--   2. visibility_requests, which is what the form on players.html writes.
--   3. The professor side: a list of what is waiting, and one function that
--      applies a decision.
--
-- CONTACT CAN NOW BE PUBLIC, BY REQUEST. This reverses a rule that said contact
-- details are never public at any consent level. It was asked for deliberately
-- and CLAUDE.md is rewritten to match. The shape of it matters, so:
--
--   * show_contact defaults FALSE and never defaults true for anybody, the same
--     posture show_name has. Nothing becomes public by sitting still.
--   * It is only ever set through set_player_visibility(), so every change
--     writes a consent_log row naming who recorded it and on whose say-so.
--   * Public means show_contact AND id_visible() -- it rides on the same
--     consent and the same three-month lapse as everything else. A contact
--     detail cannot outlive the consent that published it.
--   * expire_stale_consent() clears it with the rest. That is the part worth
--     checking in a year: a Discord handle left public after consent lapsed
--     would be the worst version of this feature.
--
-- Most of these players are children. A professor reviewing a request sees the
-- player's minor status on the row, because guardian consent is the rule for
-- one and the screen should not make them go and look it up.

-- ---------------------------------------------------------------------------
-- players: two new columns
-- ---------------------------------------------------------------------------
alter table public.players
  add column ptcg_live text,
  add column show_contact boolean not null default false;

comment on column public.players.ptcg_live is
  'Pokemon TCG Live username. Public wherever the player is public -- it is a game handle, not a way to reach somebody.';
comment on column public.players.show_contact is
  'Whether contact renders publicly. False for everybody by default and never defaults true. Public also requires id_visible(), so it lapses with everything else.';

-- ---------------------------------------------------------------------------
-- consent_log has to be able to record the third flag
-- ---------------------------------------------------------------------------
alter table public.consent_log
  drop constraint consent_log_field_check;

alter table public.consent_log
  add constraint consent_log_field_check
  check (field in ('show_player_id', 'show_name', 'show_contact'));

-- ---------------------------------------------------------------------------
-- set_player_visibility: now three fields
-- ---------------------------------------------------------------------------
-- Rewritten rather than extended with a third branch. The old body repeated the
-- same update once per field; adding a third copy would have made the next one
-- a fourth.
create or replace function public.set_player_visibility(
  p_player_id text,
  p_field text,
  p_value boolean,
  p_source text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old boolean;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may change a visibility flag';
  end if;

  if p_field not in ('show_player_id', 'show_name', 'show_contact') then
    raise exception 'Unknown visibility field: %', p_field;
  end if;

  -- expiry is written only by the scheduled job, never by a person.
  if p_source not in ('player', 'guardian') then
    raise exception 'Consent source must be player or guardian, not %', p_source;
  end if;

  select case p_field
           when 'show_player_id' then show_player_id
           when 'show_name' then show_name
           else show_contact
         end
    into v_old
  from public.players
  where player_id = p_player_id;

  if not found then
    raise exception 'Unknown player: %', p_player_id;
  end if;

  update public.players
     set show_player_id = case when p_field = 'show_player_id'
                               then p_value else show_player_id end,
         show_name      = case when p_field = 'show_name'
                               then coalesce(p_value, false) else show_name end,
         show_contact   = case when p_field = 'show_contact'
                               then coalesce(p_value, false) else show_contact end,
         consent_source = p_source,
         consent_recorded_by = auth.uid(),
         consent_recorded_at = now()
   where player_id = p_player_id;

  insert into public.consent_log
    (player_id, field, old_value, new_value, source, changed_by, note)
  values (p_player_id, p_field, v_old, p_value, p_source, auth.uid(), p_note);
end;
$function$;

-- ---------------------------------------------------------------------------
-- expire_stale_consent: contact lapses with the rest
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_consent()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select player_id, show_player_id, show_name, show_contact
    from public.players
    where (show_player_id is not null or show_name is true or show_contact is true)
  loop
    if public.last_attendance_on(v_row.player_id) is null
       or public.last_attendance_on(v_row.player_id)
          < current_date - interval '3 months' then

      if v_row.show_player_id is not null then
        insert into public.consent_log (player_id, field, old_value, new_value, source, note)
        values (v_row.player_id, 'show_player_id', v_row.show_player_id, null, 'expiry',
                'Cleared automatically: no attendance in three months');
      end if;

      if v_row.show_name is true then
        insert into public.consent_log (player_id, field, old_value, new_value, source, note)
        values (v_row.player_id, 'show_name', true, false, 'expiry',
                'Cleared automatically: no attendance in three months');
      end if;

      -- The one that would be worst to forget. A contact detail left public
      -- after the consent that published it has lapsed is a way to reach
      -- somebody who never agreed to be reachable any more.
      if v_row.show_contact is true then
        insert into public.consent_log (player_id, field, old_value, new_value, source, note)
        values (v_row.player_id, 'show_contact', true, false, 'expiry',
                'Cleared automatically: no attendance in three months');
      end if;

      update public.players
         set show_player_id = null,
             show_name = false,
             show_contact = false
       where player_id = v_row.player_id;

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- visibility_requests
-- ---------------------------------------------------------------------------
-- A null want_* means "no change to this one". The form sends only what the
-- player touched, so a request to be listed does not quietly also ask for a
-- name to be published.
create table public.visibility_requests (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,

  want_player_id boolean,
  want_name boolean,
  want_contact boolean,

  contact text,
  ptcg_live text,
  note text,

  status text not null default 'pending'
    check (status in ('pending', 'applied', 'declined')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text,

  constraint visibility_requests_decision_is_complete
    check ((status = 'pending') = (decided_at is null))
);

-- One pending request per player: a second submission updates the first rather
-- than queueing behind it. Somebody correcting a typo in their own Discord
-- handle should not leave a professor two rows to reconcile.
create unique index visibility_requests_one_pending
  on public.visibility_requests (player_id)
  where status = 'pending';

create index visibility_requests_queue_idx
  on public.visibility_requests (submitted_at desc)
  where status = 'pending';

comment on table public.visibility_requests is
  'What a player has asked for. Not public at any level: it carries contact details and is a list of who is in the league.';

-- No anon grant of any kind. The write goes through request_visibility() and
-- the reads go through the professor functions below.
grant select on public.visibility_requests to authenticated;

alter table public.visibility_requests enable row level security;

create policy visibility_requests_select_professor
  on public.visibility_requests for select to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- request_visibility
-- ---------------------------------------------------------------------------
-- The public write. Player ID and first name together, the same proof a drop
-- request and a gallery submission ask for, and ONE refusal covering both --
-- telling a wrong ID from a wrong name apart would make this a way to test
-- which Player IDs exist.
create or replace function public.request_visibility(
  p_player_id text,
  p_first_name text,
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
  select player_id into v_id
  from public.players
  where player_id = btrim(coalesce(p_player_id, ''))
    and lower(first_name) = lower(btrim(coalesce(p_first_name, '')));

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_matched');
  end if;

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

comment on function public.request_visibility(text, text, boolean, boolean, boolean, text, text, text) is
  'Public. A player asking to be listed, unlisted, or to record a TCG Live name. Changes nothing by itself: a professor decides.';

-- ---------------------------------------------------------------------------
-- pending_visibility_requests
-- ---------------------------------------------------------------------------
-- What the consent screen shows at the top. Carries minor status, because
-- guardian consent is the rule for a child and a professor should not have to
-- go and look that up on another screen before deciding.
create or replace function public.pending_visibility_requests()
returns table (
  id uuid,
  player_id text,
  full_name text,
  is_minor boolean,
  submitted_at timestamptz,
  want_player_id boolean,
  want_name boolean,
  want_contact boolean,
  contact text,
  ptcg_live text,
  note text,
  now_player_id boolean,
  now_name boolean,
  now_contact boolean,
  now_listed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may read visibility requests';
  end if;

  return query
  select
    r.id,
    r.player_id,
    btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
    public.is_minor(p.birth_year),
    r.submitted_at,
    r.want_player_id,
    r.want_name,
    r.want_contact,
    r.contact,
    r.ptcg_live,
    r.note,
    p.show_player_id,
    p.show_name,
    p.show_contact,
    -- What is actually in force, which is not the flag: id_visible() resolves
    -- the age default and tests attendance recency.
    public.id_visible(r.player_id)
  from public.visibility_requests r
  join public.players p on p.player_id = r.player_id
  where r.status = 'pending'
  order by r.submitted_at;
end;
$function$;

-- ---------------------------------------------------------------------------
-- decide_visibility_request
-- ---------------------------------------------------------------------------
-- Every flag goes through set_player_visibility(), so each one writes its own
-- consent_log row naming who recorded it and on whose say-so. Writing the
-- columns directly from here would be the bug that rule exists to prevent.
--
-- A null decision means "leave that flag alone". Declining changes nothing at
-- all and still closes the request, because a professor who spoke to somebody
-- and agreed not to should not have the row sitting there for ever.
create or replace function public.decide_visibility_request(
  p_id uuid,
  p_apply boolean,
  p_source text default 'player',
  p_player_id_visible boolean default null,
  p_name_visible boolean default null,
  p_contact_visible boolean default null,
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
  v_req public.visibility_requests;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may decide a visibility request';
  end if;

  select * into v_req from public.visibility_requests where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_decided');
  end if;

  if p_apply then
    if p_player_id_visible is not null then
      perform public.set_player_visibility(
        v_req.player_id, 'show_player_id', p_player_id_visible, p_source, p_note);
    end if;
    if p_name_visible is not null then
      perform public.set_player_visibility(
        v_req.player_id, 'show_name', p_name_visible, p_source, p_note);
    end if;
    if p_contact_visible is not null then
      perform public.set_player_visibility(
        v_req.player_id, 'show_contact', p_contact_visible, p_source, p_note);
    end if;

    -- Blank leaves what is already recorded rather than erasing it: a
    -- professor approving a listing should not have to retype a Discord handle
    -- that was already on file.
    update public.players
       set contact   = coalesce(nullif(btrim(coalesce(p_contact, '')), ''), contact),
           ptcg_live = coalesce(nullif(btrim(coalesce(p_ptcg_live, '')), ''), ptcg_live)
     where player_id = v_req.player_id;
  end if;

  update public.visibility_requests
     set status = case when p_apply then 'applied' else 'declined' end,
         decided_at = now(),
         decided_by = auth.uid(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  return jsonb_build_object('ok', true, 'code',
    case when p_apply then 'applied' else 'declined' end);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.pending_visibility_requests() from anon;
revoke all on function public.decide_visibility_request(uuid, boolean, text, boolean, boolean, boolean, text, text, text) from anon;

grant execute on function public.request_visibility(text, text, boolean, boolean, boolean, text, text, text) to anon, authenticated;
grant execute on function public.pending_visibility_requests() to authenticated;
grant execute on function public.decide_visibility_request(uuid, boolean, text, boolean, boolean, boolean, text, text, text) to authenticated;
