-- The badge ladder gets shorter: Cooltrainer at 3, Ace Trainer at 6.
--
-- Was 4 and 8. Thirteen badges a season made Ace Trainer a long way up, and
-- Ace Trainer is the rank that opens the Elite 4 and the prize wall discount --
-- so the ladder was gating the two things worth climbing it for.
--
-- This is the whole change. Nothing anywhere hardcodes a badge count:
--
--   * public.player_rank() picks the highest rank whose badges_required is at
--     or below what a player holds, reading this table every time.
--   * admin/points.js takes the discount threshold as max(badges_required)
--     from the same rows, so the discount moves with the ladder rather than
--     needing its own edit.
--   * The programs page prints `qualification` as written here.
--
-- IT APPLIES TO EVERY SEASON AT ONCE, and rank is derived rather than stored,
-- so this is not a change that takes effect going forward -- the moment it runs,
-- anyone already holding three badges in a season is a Cooltrainer and anyone
-- holding six is an Ace Trainer, with the discount that comes with it. That is
-- the intent. Nobody is demoted: both numbers only went down.

update public.trainer_card_ranks
set badges_required = 3,
    qualification = 'Earn 3 badges'
where sort_order = 2;

update public.trainer_card_ranks
set badges_required = 6,
    qualification = 'Earn 6 badges'
where sort_order = 3;

-- The table comment still said eight. It is on a migration that has already
-- been applied and must not be edited, so it is replaced here.
comment on table public.badges is
  'The badges a player can earn in a season. Six qualify a player for a Champion attempt; the threshold lives on trainer_card_ranks.badges_required and is never written in code.';
