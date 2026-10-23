-- The Ace Trainer row no longer says it can challenge the Elite 4.
--
-- It is said once, on its own line between Ace Trainer and Champion, because
-- the condition is eight badges rather than the rank. Leaving it in the benefit
-- cell as well put the same fact in two places on one table, and the two did
-- not agree: the cell said reaching Ace Trainer was enough, and the line two
-- rows down said it takes eight badges.
--
-- What is left is the benefit that really does come with the rank.

update public.trainer_card_ranks
set benefit = '10% prize wall discount'
where benefit = 'Can challenge the Elite 4, and a 10% prize wall discount';
