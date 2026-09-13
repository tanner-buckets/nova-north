-- Phase 3: points and attendance.
--
-- attendance, point_ledger, loyalty_carryover, loyalty_results, the first public
-- RPC, and the consent expiry job.
--
-- This is the migration that switches the visibility model on. Until now
-- last_attendance_on() has returned null, so id_visible() was false for everyone
-- and public_players was empty. Replacing that one function body is all it takes.
--
-- Contains no personal data. Balances and carryover are imported out of band.

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  event_id uuid,
  attended_on date not null default current_date,
  source text not null check (source in ('tdf', 'manual', 'import')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  -- One loyalty week per calendar day. Attending league and playing the
  -- tournament on the same Sunday cannot produce two weeks. This single
  -- constraint is the whole enforcement.
  constraint attendance_one_per_day unique (player_id, attended_on)
);

-- Consent expiry asks for each player's most recent attendance on every public
-- read, so that lookup has to be cheap.
create index attendance_player_recent_idx
  on public.attendance (player_id, attended_on desc);

comment on table public.attendance is
  'One row per player per day attended. No public access: attendance is read through the RPC functions.';
comment on column public.attendance.created_by is
  'Professor who recorded it. Null for rows created by a bulk import rather than a person.';

-- ---------------------------------------------------------------------------
-- point_ledger
-- ---------------------------------------------------------------------------
-- Append only. Balance is sum(delta). There is deliberately no UPDATE or DELETE
-- policy below and no UPDATE or DELETE grant, so a row cannot be altered or
-- removed through the API at all. A mistake is corrected by writing a reversing
-- entry with voids_id set, never by editing the original.
create table public.point_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  delta integer not null,
  earning_action_id uuid references public.earning_actions (id),
  prize_item_id uuid references public.prize_items (id),
  event_id uuid,
  reason text,
  voids_id uuid references public.point_ledger (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index point_ledger_player_idx on public.point_ledger (player_id, created_at desc);

comment on table public.point_ledger is
  'Append only transaction log. Balance is sum(delta). Corrections are new rows with voids_id set.';
comment on column public.point_ledger.reason is
  'Free text for discretionary awards and opening balances. WARNING: this is returned by get_player_summary(), so it is publicly visible for a player whose ID visibility is in force. Never write anything private here.';
comment on column public.point_ledger.created_by is
  'Professor who recorded it. Null for opening balances carried forward from the spreadsheets, which no professor awarded.';

-- ---------------------------------------------------------------------------
-- loyalty_carryover
-- ---------------------------------------------------------------------------
-- A one-time bridge, not a mechanism. The previous tracking counted loyalty
-- weeks without recording the dates they happened on, so those weeks cannot
-- become attendance rows. They are recorded here instead and added to the live
-- count for the release they belong to.
--
-- This table should never gain a row after the initial import. From here on,
-- weeks are derived from dated attendance and nobody types a count again.
create table public.loyalty_carryover (
  release_id uuid not null references public.releases (id) on delete restrict,
  player_id text not null references public.players (player_id) on update cascade,
  weeks integer not null check (weeks >= 0),
  note text,
  recorded_at timestamptz not null default now(),
  primary key (release_id, player_id)
);

comment on table public.loyalty_carryover is
  'Weeks accrued before dated attendance tracking began. One-time import bridge; do not add rows going forward.';

-- ---------------------------------------------------------------------------
-- loyalty_results
-- ---------------------------------------------------------------------------
-- The one deliberate exception to "derive, do not store": a snapshot of a closed
-- period, written when a professor finalizes a release. History then cannot
-- drift if attendance is corrected afterwards.
create table public.loyalty_results (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete restrict,
  player_id text not null references public.players (player_id) on update cascade,
  weeks_attended integer not null,
  tier_id uuid references public.loyalty_tiers (id),
  recorded_at timestamptz not null default now(),
  constraint loyalty_results_one_per_release unique (release_id, player_id)
);

comment on table public.loyalty_results is
  'Snapshot of a completed release. Written by finalize_release(), which is not built until a release actually closes.';

-- ---------------------------------------------------------------------------
-- The attendance seam closes
-- ---------------------------------------------------------------------------
-- Phase 2 created this returning null so that nobody was visible before real
-- attendance existed. Replacing the body is what turns the visibility model on.
create or replace function public.last_attendance_on(p_player_id text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_last date;
begin
  select max(attended_on) into v_last
  from public.attendance
  where player_id = p_player_id;

  return v_last;
end;
$function$;

comment on function public.last_attendance_on(text) is
  'Most recent attendance date, or null if the player has never attended. Drives consent recency.';

-- ---------------------------------------------------------------------------
-- Loyalty helpers
-- ---------------------------------------------------------------------------
create or replace function public.active_release()
returns public.releases
language sql
stable
set search_path = ''
as $function$
  select r.* from public.releases r
  where current_date between r.starts_on and r.ends_on
  order by r.starts_on desc
  limit 1;
$function$;

comment on function public.active_release() is
  'The release whose window contains today. There is deliberately no is_active column.';

-- Weeks for an active release: carried-over weeks plus distinct days attended
-- inside the window. For a finalized release, read loyalty_results instead.
create or replace function public.loyalty_weeks(p_player_id text, p_release_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_starts date;
  v_ends date;
  v_carry integer;
  v_counted integer;
begin
  select starts_on, ends_on into v_starts, v_ends
  from public.releases where id = p_release_id;

  if not found then
    return 0;
  end if;

  select coalesce(weeks, 0) into v_carry
  from public.loyalty_carryover
  where release_id = p_release_id and player_id = p_player_id;

  select count(distinct attended_on) into v_counted
  from public.attendance
  where player_id = p_player_id
    and attended_on between v_starts and v_ends;

  return coalesce(v_carry, 0) + coalesce(v_counted, 0);
end;
$function$;

-- Highest tier whose threshold is met. Null when no tier is reached.
create or replace function public.tier_earned(p_weeks integer, p_release_id uuid)
returns text
language sql
stable
set search_path = ''
as $function$
  select t.tier_name
  from public.loyalty_tiers t
  where t.release_id = p_release_id
    and t.weeks_required <= p_weeks
  order by t.weeks_required desc
  limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- get_player_summary
-- ---------------------------------------------------------------------------
-- The first public RPC. Returns nothing for an unknown ID and nothing for a
-- player whose ID visibility is not in force -- those two cases are deliberately
-- indistinguishable, so the function cannot be used to probe who exists.
--
-- Never returns last name, birth year, contact, division or notes.
create or replace function public.get_player_summary(p_player_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_release_id uuid;
  v_release_name text;
  v_weeks integer;
  v_balance integer;
  v_history jsonb;
begin
  if not public.id_visible(p_player_id) then
    return null;
  end if;

  -- Read the columns directly rather than into a composite. Between releases
  -- there is no active row, and that path must return cleanly rather than
  -- depending on how a null composite behaves.
  select id, name into v_release_id, v_release_name
  from public.releases
  where current_date between starts_on and ends_on
  order by starts_on desc
  limit 1;

  if v_release_id is not null then
    v_weeks := public.loyalty_weeks(p_player_id, v_release_id);
  end if;

  select coalesce(sum(delta), 0) into v_balance
  from public.point_ledger where player_id = p_player_id;

  select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb) into v_history
  from (
    select l.created_at,
           l.delta,
           coalesce(l.reason, a.label, p.label) as description,
           l.voids_id is not null as is_correction
    from public.point_ledger l
    left join public.earning_actions a on a.id = l.earning_action_id
    left join public.prize_items p on p.id = l.prize_item_id
    where l.player_id = p_player_id
  ) h;

  return jsonb_build_object(
    'player_id', p_player_id,
    'display_label', public.display_label(p_player_id),
    'point_balance', v_balance,
    'release_name', v_release_name,
    'loyalty_weeks', v_weeks,
    'tier_earned', public.tier_earned(v_weeks, v_release_id),
    'history', v_history
  );
end;
$function$;

comment on function public.get_player_summary(text) is
  'Public player lookup. Returns null for an unknown ID and for a player without ID visibility, so it cannot be used to enumerate players.';

-- ---------------------------------------------------------------------------
-- expire_stale_consent
-- ---------------------------------------------------------------------------
-- Clears visibility flags for players with no recent attendance, writing a
-- consent_log row for each change. Idempotent: a player whose flags are already
-- clear is skipped, so repeated runs write nothing.
--
-- The read-time recency check in id_visible() is what actually guarantees
-- expiry. This job exists so the flags do not sit set in the database
-- indefinitely -- it makes the promise real rather than merely effective.
--
-- A player who has never attended is measured from when consent was recorded,
-- not from a null attendance date, so recording consent for a new player does
-- not expire it on the next run.
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
    select player_id, show_player_id, show_name
    from public.players
    where (show_player_id is not null or show_name is true)
      and coalesce(
            public.last_attendance_on(player_id),
            consent_recorded_at::date
          ) < current_date - interval '3 months'
  loop
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

    update public.players
       set show_player_id = null,
           show_name = false
     where player_id = v_row.player_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

comment on function public.expire_stale_consent() is
  'Clears stale visibility flags and logs each one. Idempotent. Schedule daily; read-time checks already fail closed if it never runs.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- anon gains exactly one thing in this migration: the right to call the player
-- lookup. It gets no table access at all.
grant execute on function public.get_player_summary(text) to anon, authenticated;

grant select, insert on public.attendance to authenticated;
grant update (event_id, attended_on, source) on public.attendance to authenticated;
grant delete on public.attendance to authenticated;

-- Insert only. No update, no delete, for anyone. This is what makes the ledger
-- append only in fact rather than by convention.
grant select, insert on public.point_ledger to authenticated;

grant select, insert, update, delete on public.loyalty_carryover to authenticated;
grant select, insert on public.loyalty_results to authenticated;

grant execute on function public.active_release() to anon, authenticated;
grant execute on function public.loyalty_weeks(text, uuid) to authenticated;
grant execute on function public.tier_earned(integer, uuid) to authenticated;

-- Not granted to anon or authenticated: this runs on a schedule, as the job owner.
revoke all on function public.expire_stale_consent() from public;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.attendance enable row level security;
alter table public.point_ledger enable row level security;
alter table public.loyalty_carryover enable row level security;
alter table public.loyalty_results enable row level security;

create policy attendance_select_professor
  on public.attendance for select to authenticated using (public.is_professor());
create policy attendance_insert_professor
  on public.attendance for insert to authenticated with check (public.is_professor());
create policy attendance_update_professor
  on public.attendance for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
-- Attendance can be deleted: a check-in recorded against the wrong player is a
-- clerical error, not a transaction, and leaving it would grant a loyalty week
-- that was never earned.
create policy attendance_delete_professor
  on public.attendance for delete to authenticated using (public.is_professor());

create policy point_ledger_select_professor
  on public.point_ledger for select to authenticated using (public.is_professor());
create policy point_ledger_insert_professor
  on public.point_ledger for insert to authenticated with check (public.is_professor());
-- No update or delete policy. Corrections are reversing entries.

create policy loyalty_carryover_select_professor
  on public.loyalty_carryover for select to authenticated using (public.is_professor());
create policy loyalty_carryover_insert_professor
  on public.loyalty_carryover for insert to authenticated with check (public.is_professor());
create policy loyalty_carryover_update_professor
  on public.loyalty_carryover for update to authenticated
  using (public.is_professor()) with check (public.is_professor());
create policy loyalty_carryover_delete_professor
  on public.loyalty_carryover for delete to authenticated using (public.is_professor());

create policy loyalty_results_select_professor
  on public.loyalty_results for select to authenticated using (public.is_professor());
create policy loyalty_results_insert_professor
  on public.loyalty_results for insert to authenticated with check (public.is_professor());
-- No update or delete policy. A finalized release is a historical record.
