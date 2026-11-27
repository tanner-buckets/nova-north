-- Incremental badge progress: the steps inside a badge that takes more than one
-- sitting to earn.
--
-- Some badges are really a short list of things. Raid is a Level 1, a Level 2
-- and a Level 3 raid; Expert is two judge qualifier questions, one attempt a
-- week, so it cannot be finished in an afternoon by definition. Until now the
-- only thing the site could record was the finished badge, so the half-done
-- state lived in a professor's head or on a piece of paper between Sundays --
-- which is the same failure the prize pack spreadsheet had, and it ends the
-- same way.
--
-- TICKING THE STEPS IS NOT HOW A BADGE IS EARNED, and nothing here gates the
-- award. A professor who watched all three raids gives the badge whether or not
-- anybody ticked a box, and a badge can be awarded with every box empty. The
-- moment this became a precondition it would stop being a notepad: somebody
-- would have to go back and fill in boxes for a badge already earned before the
-- site would let them record what they saw. It is an aid to remembering, and
-- the award stays one insert into player_badges.

-- ---------------------------------------------------------------------------
-- How many steps a badge has
-- ---------------------------------------------------------------------------
alter table public.badges
  add column step_count integer;

-- Nullable with no default, so every badge that already exists stays exactly
-- what it was and the ordinary kind needs nothing said about it.
--
-- NULL IS NOT ZERO here, the same rule loyalty_tiers.msrp follows: "this badge
-- is not earned in steps" and "this badge is earned in no steps" are not two
-- facts, and only the first one is real.
--
-- Two is the floor because a one-step badge is the badge. A single checkbox
-- beside the award would be the same fact written twice, and a tick with no
-- award -- or an award with no tick -- would be a disagreement with no right
-- answer. Twelve is the ceiling because these are drawn under a badge tile on
-- a phone, and because a professor who types 60 has mistyped something.
alter table public.badges
  add constraint badges_step_count_sensible
  check (step_count is null or step_count between 2 and 12);

comment on column public.badges.step_count is
  'How many steps this badge is earned in, or null for the ordinary kind that is simply awarded. For tracking only: it never gates the award.';

-- ---------------------------------------------------------------------------
-- badge_progress
-- ---------------------------------------------------------------------------
create table public.badge_progress (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players (player_id) on update cascade,
  badge_id uuid not null references public.badges (id),
  step_number integer not null,
  marked_on date not null default current_date,
  marked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  -- A step is done once. Two rows for step 2 is a double-tick, not two steps.
  constraint badge_progress_once unique (player_id, badge_id, step_number),
  constraint badge_progress_step_positive check (step_number >= 1)
);

create index badge_progress_player_idx on public.badge_progress (player_id);

comment on table public.badge_progress is
  'One row per step a player has completed towards a badge. Professor-only, like player_badges: a half-finished badge is a working note, not something about the player that anybody else reads.';
comment on column public.badge_progress.step_number is
  'Which step, counting from 1. Deliberately NOT checked against badges.step_count: a check constraint cannot read another table, and a trigger would refuse a row the day somebody lowered the count. A step above the current count lies dormant rather than being destroyed, and comes back if the count is raised again.';
comment on column public.badge_progress.marked_by is
  'Professor who ticked it. Null if the row outlived the account that wrote it.';

-- INSERT and DELETE and no UPDATE, the arrangement player_badges already has
-- and for the same reason: a step is ticked or cleared, never amended. There
-- is nothing in the row worth editing that is not simply the row existing.
grant select, insert, delete on public.badge_progress to authenticated;

alter table public.badge_progress enable row level security;

create policy badge_progress_select_professor
  on public.badge_progress for select to authenticated using (public.is_professor());
create policy badge_progress_insert_professor
  on public.badge_progress for insert to authenticated with check (public.is_professor());
create policy badge_progress_delete_professor
  on public.badge_progress for delete to authenticated using (public.is_professor());

-- ---------------------------------------------------------------------------
-- The three badges in play that have steps
-- ---------------------------------------------------------------------------
-- Named exactly, never searched for by shape. The two 2026 rows were seeded by
-- 20260913020725 and their codes are known; expert27 was created on the
-- reference screen and its code was given rather than guessed at.
update public.badges set step_count = 3 where season_year = 2026 and code = 'raid';
update public.badges set step_count = 2 where season_year = 2026 and code = 'expert';
update public.badges set step_count = 3 where season_year = 2027 and code = 'expert27';

-- A notice rather than an exception, so a code that has been reworded cannot
-- fail a deploy that other migrations are riding on. THE COST IS THAT AN
-- UNREAD NOTICE MAKES A NO-OP LOOK LIKE A SUCCESS, so verify on the reference
-- screen afterwards: each of these three should show its step count, and the
-- Trainer Card screen should draw that many boxes under the badge.
do $$
declare
  v_missing text;
begin
  select string_agg(format('%s/%s', w.season_year, w.code), ', ')
    into v_missing
    from (values (2026, 'raid'), (2026, 'expert'), (2027, 'expert27'))
           as w (season_year, code)
   where not exists (
           select 1 from public.badges b
            where b.season_year = w.season_year
              and b.code = w.code);

  if v_missing is not null then
    raise notice 'badge_steps: no badge matched %. Nothing was changed for those; set the step count on the reference screen instead.', v_missing;
  end if;
end $$;
