-- The Chaos Cup rule catalogue.
--
-- Until now these lived in two documents: a list of seventeen that have been
-- played, and a spreadsheet proposing six chains of rules that build on each
-- other across rounds. Composing a sheet meant copying out of both by hand,
-- which is how the same rule ended up in one event twice.
--
-- WHAT IS SEEDED, AND WHAT IS NOT. The seventeen and the six chains are
-- finished text and come across. The workbook also has a sheet called
-- "Complicated", which is a scratchpad -- half-written chains with placeholders
-- like "big change" and "small buff" where the rule should be. It is left out:
-- a catalogue a professor picks from on a Sunday must not contain notes to
-- self, because the sheet gets printed and handed to players.
--
-- One rule appeared in both sources. It is one rule, so it has one row, and the
-- chain is recorded on it rather than creating a second copy that would drift.
--
-- The text is the organiser's own, as the Chaos Cup page already is. Nothing
-- here is lifted from an official source.

create table public.chaos_cup_rules (
  id uuid primary key default gen_random_uuid(),
  -- The rule as it is read out. Multi-line on purpose: one of them is a die
  -- roll with six outcomes, and flattening that to a sentence would make it
  -- unreadable on the sheet it is printed on.
  body text not null check (length(trim(body)) > 0),
  -- The chain this belongs to, where it belongs to one. "Draw Crazy",
  -- "Status Report". Null for a rule that stands on its own, which is most of
  -- what has actually been played.
  chain text,
  -- The organiser's own code: 1.0, 1.a, 1.a.i. It is what records the tree --
  -- which round-2 options follow which round-1 rule, and so on -- without this
  -- table having to model a tree it does not yet need to enforce.
  code text,
  -- Which round of its chain it is written for: 1, 2 or 3. Null for a
  -- standalone rule, which can be used in any round.
  stage integer check (stage is null or stage between 1 and 4),
  -- Retired, never deleted. A rule that was played is part of what happened.
  is_active boolean not null default true,
  sort_order integer not null default 0,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);

create unique index chaos_cup_rules_code_idx
  on public.chaos_cup_rules (code) where code is not null;

create index chaos_cup_rules_chain_idx
  on public.chaos_cup_rules (chain) where chain is not null;

comment on table public.chaos_cup_rules is
  'Rules a professor picks from when composing a Chaos Cup sheet. Professor-only: a sheet is handed out on the day, and publishing the catalogue would give away every event in advance.';
comment on column public.chaos_cup_rules.code is
  'The organiser''s own numbering. 1.a.i is the first round-3 option under round-2 option a of chain 1, which is how the chains are recorded without modelling a tree.';

-- Professor-only, unlike badges and prize items. The whole point of a Chaos Cup
-- is that nobody knows the rules until the day, and a public catalogue would be
-- every future event posted in advance.
revoke all on public.chaos_cup_rules from anon, authenticated;
grant select on public.chaos_cup_rules to authenticated;
grant insert (body, chain, code, stage, sort_order) on public.chaos_cup_rules to authenticated;
grant update (body, chain, code, stage, is_active, sort_order) on public.chaos_cup_rules to authenticated;

alter table public.chaos_cup_rules enable row level security;

create policy chaos_cup_rules_read on public.chaos_cup_rules
  for select to authenticated using (public.is_professor());
create policy chaos_cup_rules_write on public.chaos_cup_rules
  for all to authenticated
  using (public.is_professor()) with check (public.is_professor());

-- Stamped rather than sent, like every other table on these screens.
create function public.stamp_chaos_rule()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.added_by := auth.uid();
  return new;
end;
$function$;

create trigger chaos_cup_rules_stamp
  before insert on public.chaos_cup_rules
  for each row execute function public.stamp_chaos_rule();

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
insert into public.chaos_cup_rules (body, chain, code, stage, sort_order)
values
  ('Draw 3 Cards at the start of your turn.', 'Draw Crazy', '1.0', 1, 1),
  ('Discard 3 cards at the start of your turn, put 1 of those cards into your hand.', 'Draw Crazy', '1.a', 2, 2),
  ('At the end of your turn you may draw 2 cards instead of attacking.', 'Draw Crazy', '1.a.i', 3, 3),
  ('At the end of your turn you may put a card from your discard pile into your hand instead of attacking.', 'Draw Crazy', '1.a.ii', 3, 4),
  ('Draw 3 cards at the start of your turn. Add one to your hand, discard 1, and put 1 at the bottom of your deck.', 'Draw Crazy', '1.b', 2, 5),
  ('At the end of your turn you may draw 2 cards instead of attacking.', 'Draw Crazy', '1.b.i', 3, 6),
  ('Draw an extra card for each prize your opponent took since the end of your last turn, at the start of your turn.', 'Draw Crazy', '1.b.ii', 3, 7),
  ('If your opponent knocked out 1 of your pokemon last turn, do not draw any cards at the start of your turn.', 'Draw Crazy', '1.b.iii', 3, 8),
  ('Draw 3 cards at the start of your turn and show them to your opponent. They choose 1 for you to discard, put the other 2 cards into your hand.', 'Draw Crazy', '1.c', 2, 9),
  ('At the end of your turn you may put a card from your discard pile into your hand instead of attacking.', 'Draw Crazy', '1.c.i', 3, 10),
  ('If your hand is empty at the end of your turn you may place a card from your discard pile into your hand.', 'Draw Crazy', '1.c.ii', 3, 11),
  ('You may draw up to 4 additional cards at the start of your turn (for up to 5 total), for each additional card drawn place 1 damage counter on each of your Pokemon.', 'Draw Crazy', '1.d', 2, 12),
  ('At the end of your turn if you do not attack, place 3 damage counters on your active Pokemon.', 'Draw Crazy', '1.d.i', 3, 13),
  ('Instead of 1 damage counter per extra card drawn place 3 damage counters on each of your Pokemon for each additional card drawn.', 'Draw Crazy', '1.d.ii', 3, 14),
  ('At the end of your turn you may move all the damage counters from 1 of your benched Pokemon to another one of your benched Pokemon', 'Draw Crazy', '1.d.iii', 3, 15),
  ('Each time you play a Trainer card you must place a damage counter on your active Pokemon', 'Trainer Card Chaos', '2.0', 1, 16),
  ('After you play a supporter you may flip a coin, if heads shuffle it back into your deck', 'Trainer Card Chaos', '2.a', 2, 17),
  ('Pokemon may have 2 Tool cards attached to them', 'Trainer Card Chaos', '2.a.i', 3, 18),
  ('Up to 2 stadiums can be in play (you can still only play one stadium card per turn).', 'Trainer Card Chaos', '2.a.ii', 3, 19),
  ('All Ace Specs now only have the effect of Computer Search 2.0 and let you "Discard 2 cards to search your deck for any 2 cards, add those 2 cards to your hand".', 'Trainer Card Chaos', '2.a.iii', 3, 20),
  ('All Supporters now only have the "Draw 3" effect, unless you discard your entire hand after resolving thier effect, otherwise ignore all other supporter effects.', 'Trainer Card Chaos', '2.b', 2, 21),
  ('Pokemon may have 2 Tool cards attached to them', 'Trainer Card Chaos', '2.b.i', 3, 22),
  ('Up to 2 stadiums can be in play (you can still only play one stadium card per turn).', 'Trainer Card Chaos', '2.b.ii', 3, 23),
  ('All Ace Specs now only have the effect of Dowsing Machine 2.0 "Discard a card from your hand to return a card form your discard pile to your hand".', 'Trainer Card Chaos', '2.b.iii', 3, 24),
  ('In order to play a Supporter card, you must confuse your active Pokemon.', 'Trainer Card Chaos', '2.c', 2, 25),
  ('Pokemon may have 2 Tool cards attached to them', 'Trainer Card Chaos', '2.c.i', 3, 26),
  ('Up to 2 stadiums can be in play (you can still only play one stadium card per turn).', 'Trainer Card Chaos', '2.c.ii', 3, 27),
  ('All Ace Specs now only have the effect of VS Seeker "Return a supporter from the discard pile to your hand".', 'Trainer Card Chaos', '2.c.iii', 3, 28),
  ('Play with 2 active Pokemon and up to 4 benched Pokemon. During setup draw cards faceup until you find 2 basic Pokemon (the first 2 you find go toyour active spots), then shuffle the other cards back into your deck and draw a hand of 5 cards. On your turn you may attack once with each Pokemon, each attach only targets one of your opponent''s active Pokemon. The player who goes first can attack with one of thier Pokemon on thier first turn. Promotoe new Pokemon to the active spot after all effects of attacks are resolved.', 'Double Battle', '3.0', 1, 29),
  ('Play with 3 active Pokemon and up to 3 benched Pokemon. Your active Pokemon can only attack defending Pokemon adjacent to them (either diagonally or orthagonally). Otherwise follow all previous double battle rules.', 'Double Battle', '3.a', 2, 30),
  ('Instead of attacking with each of your active Pokemon you can have 1 attack target all adjacent defending Pokemon, the damage is split evenly (rounding up) between each of the targeted Pokemon.', 'Double Battle', '3.a.i', 3, 31),
  ('Once per turn you may switch the positions of 2 of your active Pokemon.', 'Double Battle', '3.a.ii', 3, 32),
  ('You can only have 1 benched Pokemon.', 'Double Battle', '3.a.iii', 3, 33),
  ('Once per game you may choose to have an attack target both defending Pokemon (similar to a Vstar attack this can only be done once).', 'Double Battle', '3.b', 2, 34),
  ('At the start of your turn draw 2 cards.', 'Double Battle', '3.b.i', 3, 35),
  ('You can only have up to 2 benched Pokemon.', 'Double Battle', '3.b.ii', 3, 36),
  ('Up to 2 stadiums can be in play (you can still only play one stadium card per turn).', 'Double Battle', '3.b.iii', 3, 37),
  ('Instead of attacking with both of your active Pokemon you can have 1 attack target both defending Pokemon, but the damage is split evenly (rounding up) between the 2 defending Pokemon.', 'Double Battle', '3.c', 2, 38),
  ('At the start of your turn draw 2 cards.', 'Double Battle', '3.c.i', 3, 39),
  ('You can only have up to 2 benched Pokemon.', 'Double Battle', '3.c.ii', 3, 40),
  ('Once per game you can either switch 1 or 2 benched Pokemon with your active Pokemon without paying the retreat cost or you may gust up one of your opponenet''s benched Pokemon (Similar to a Vstar Ability this can only be done once).', 'Double Battle', '3.c.iii', 3, 41),
  ('At the end of your turn roll a 6 sided die, your active Pokemon is now afflicted with the status associated with your roll:
1 - Sleep
2 - Burn
3 - Confusion
4 - Paralysis
5 - Poison
6 - Remove all status conditions
Pokemon cannot be Asleep & Confused at the same time, so these statuses replace each other.', 'Status Report', '4.0', 1, 42),
  ('Benched Pokemon can also have Status Conditions (Pokemon do not recover when moved to the bench). All conditions can be removed from benched Pokemon by flipping heads during Checkup. When flipping for recovery flip for each status seperately.', 'Status Report', '4.a', 2, 43),
  ('If your active Pokemon is still affected by a Status Condition choose 1 of your benched Pokemon to roll an effect for.', 'Status Report', '4.a.i', 3, 44),
  ('If you have 3 or more Pokemon afflicted with a Status Condition at the end of your turn take a prize card.', 'Status Report', '4.a.ii', 3, 45),
  ('At then end of your turn (before your status roll) you can discard the top 2 cards of your deck to recover all Pokemon from all status conditions.', 'Status Report', '4.a.iii', 3, 46),
  ('Double all damage associated with status conditions. Aka double poison damage, double burn damage, and 60 damage for failing a confusion flip.', 'Status Report', '4.b', 2, 47),
  ('Poison and Burn can be applied twice, if applied twice apply the effect trwice between turns.', 'Status Report', '4.b.i', 3, 48),
  ('Paralysis does not recover unless replaced by another incompatible condition or by the effect of another card.', 'Status Report', '4.b.ii', 3, 49),
  ('Confused Pokemon deal double Damage.', 'Status Report', '4.b.iii', 3, 50),
  ('At then end of your turn you can discard the top 2 cards of your deck to skip your status roll.', 'Status Report', '4.c', 2, 51),
  ('Poison and Burn can be applied twice, if applied twice apply the effect trwice between turns.', 'Status Report', '4.c.i', 3, 52),
  ('Paralysis does not recover unless replaced by another incompatible condition or by the effect of another card.', 'Status Report', '4.c.ii', 3, 53),
  ('Confused Pokemon deal double Damage.', 'Status Report', '4.c.iii', 3, 54),
  ('Each Player can have up to 8 benched Pokemon.', 'Warped Dimension', '5.0', 1, 55),
  ('Knocked out Pokemon go to the Lost Zone.', 'Warped Dimension', '5.a', 2, 56),
  ('Whenever your Active Pokemon is knocked out shuffle your discard pile into your deck.', 'Warped Dimension', '5.a.i', 3, 57),
  ('When declaring an attack that does damage, roll two die. If they are the same number, the attack does double damage.', 'Warped Dimension', '5.a.ii', 3, 58),
  ('After your turn, you may discard a card from your hand and play Rock, Paper Scissors with your opponent. Whoever loses that match, their Active Pokemon is now Burned.', 'Warped Dimension', '5.a.iii', 3, 59),
  ('Instead of taking prize cards for knocking out your opponent''s Pokemon take prize cards when your Pokemon are knocked out. You win once all of your opponent''s Prize cards are taken.', 'Warped Dimension', '5.b', 2, 60),
  ('Play with Prize Cards Face up. You choose what prize card your opponent takes.', 'Warped Dimension', '5.b.i', 3, 61),
  ('During game setup, draw and set up 12 prize cards instead of 6. When drawing prize cards (after knockouts), always take double prizes.', 'Warped Dimension', '5.b.ii', 3, 62),
  ('You may draw up to 4 additional cards at the start of your turn (for up to 5 total), for each additional card drawn place 1 damage counter on each of your Pokemon.', 'Warped Dimension', '5.c', 2, 63),
  ('Once per turn you may pick two random cards from your opponent’s hand. Look at the cards and choose one shuffle back into their deck. The other card goes back into their hand.', 'Warped Dimension', '5.c.i', 3, 64),
  ('Instead of attacking you can discard the top 7 cards of your deck to draw a prize card.', 'Warped Dimension', '5.c.ii', 3, 65),
  ('When attacking instead of damaging the defending Pokemon you can discard the top card of your opponent''s deck for every 50 damage your attack would do.', 'Warped Dimension', '5.c.iii', 3, 66),
  ('You may attach up to 3 energy per turn.', 'Energy Party', '6.0', 1, 67),
  ('All energy counts as two of its energy type, but only when paying an attack cost.', 'Energy Party', '6.a', 2, 68),
  ('To attack you must shuffle the attack''s energy cost from the Pokemon back into your deck.', 'Energy Party', '6.a.i', 3, 69),
  ('Each time you attach energy to a Pokemon place 2 damage counters on that Pokemon.', 'Energy Party', '6.a.ii', 3, 70),
  ('Whenever your Active Pokemon is knocked out shuffle your discard pile into your deck before placing the active Pokemon into the discard pile.', 'Energy Party', '6.b', 2, 71),
  ('To attack you must discard an energy from the attacking Pokemon.', 'Energy Party', '6.b.i', 3, 72),
  ('All attacks cost one additional Colorless energy.', 'Energy Party', '6.b.ii', 3, 73),
  ('Each time you attach energy to a Pokemon place 2 damage counters on that Pokemon.', 'Energy Party', '6.b.iii', 3, 74),
  ('If you attach an energy from hand to your active pokemon it becomes confused.', 'Energy Party', '6.c', 2, 75),
  ('Confused Pokemon deal double Damage, when their attacks fail they do 60 damage to themselves instead of 30 damage.', 'Energy Party', '6.c.i', 3, 76),
  ('All attacks cost one additional Colorless energy.', 'Energy Party', '6.c.ii', 3, 77),
  ('Once during your turn, you may discard your hand and roll a six-sided die. Draw twice as many cards as you rolled.', null, null, null, 78),
  ('Once during your turn, you may discard up to two cards from your hand. For each card discarded, choose one of the following:
- Your active pokemon''s attacks do 40 more damage this turn
- During your opponent''s next turn, your Active Pokemon takes 40 less damage from attacks.', null, null, null, 79),
  ('Whenever a player uses an ability during their turn, that player must switch their active Pokemon to the bench.', null, null, null, 80),
  ('After you attack play Rock, Paper Scissors with your opponent. Whoever loses that match, their active Pokémon is now burned.', null, null, null, 81),
  ('Once during your turn, you may discard two cards of the same type and return a different card of the same type from the discard pile to your hand. Pokémon, Trainers, Energy are types.', null, null, null, 82),
  ('When a player has three or fewer prize cards remaining, that player must shuffle their discard pile and trade it with their deck.', null, null, null, 83),
  ('You must play the whole round with your hand face up so your opponent may see it at all times.', null, null, null, 84),
  ('During game setup, draw a 13 card hand to start. From that hand pick a starting active Pokemon and your 6 prizes. Randomize the 6 prize cards before placing them face down.', null, null, null, 85),
  ('Play with your prize cards face up. When you take prize cards your opponent chooses for you.', null, null, null, 86),
  ('If you attach an energy from hand to your active Pokémon it becomes confused.', null, null, null, 87),
  ('At the beginning of each turn draw three cards instead of just one. Keep one, discard one, and return one to the bottom of your deck.', null, null, null, 88),
  ('When your active Pokémon is the target of an attack that does damage, roll two die. If they are the same number, the active Pokémon avoids the attack.', null, null, null, 89),
  ('Treat supporters as items and items as supporters. You may only play one item per turn. You may play as many supporters per turn as you wish. First turn going first you may not play an item.', null, null, null, 90),
  ('During setup, do not put out prize cards. When you would normally take prize cards, place cards from your hand down as prize cards up to the number of prize cards you would have taken. The win condition of the game is now once you have put down six prize cards.', null, null, null, 91),
  ('All evolution Pokémon keep the base HP of their basic Pokémon.', null, null, null, 92);
