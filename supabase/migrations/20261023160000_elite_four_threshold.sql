-- The Elite 4 threshold is its own number, and it is eight.
--
-- Both pages that mention it were deriving it from max(badges_required) across
-- the ranks -- which is six, the Ace Trainer threshold -- on the assumption
-- that the top rung reachable on badges alone was also what qualified a
-- challenge. It is not. Ace Trainer is six badges; challenging the Elite 4
-- needs eight. Shortening the ladder to 3 and 6 moved the ranks and left this
-- figure where it was, and the derivation quietly followed the wrong one.
--
-- So it gets a column rather than a cleverer derivation. There is no
-- arrangement of the rank thresholds that implies eight, because eight is not
-- a rank: it is a condition an Ace Trainer meets on the way to Champion, which
-- is exactly why the programme describes it as a line between those two rows
-- rather than as a rank of its own.
--
-- It lives on the Champion row because that is the rank the condition guards,
-- and requires_elite_four already marks that row.

alter table public.trainer_card_ranks
  add column elite_four_badges integer;

comment on column public.trainer_card_ranks.elite_four_badges is
  'Badges needed in one season before an Ace Trainer may challenge the Elite 4. Set on the rank that requires_elite_four. Not a rank threshold -- badges_required is that -- and deliberately higher.';

update public.trainer_card_ranks
set elite_four_badges = 8
where requires_elite_four;
