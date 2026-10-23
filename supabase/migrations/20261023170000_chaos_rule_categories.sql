-- Chaos Cup rules are grouped by what kind of rule they are, not by a chain.
--
-- The catalogue was seeded from two documents, and one of them -- a workbook of
-- proposed "chains" where a round-2 option follows a particular round-1 rule --
-- turned out to be a direction that was being explored rather than how these
-- are picked. So the chain, the code and the round it was written for all go.
-- What is left is the rule and what kind of rule it is, which is what somebody
-- composing a sheet is actually choosing between.
--
-- SIXTEEN ROWS ARE REMOVED, NOT RETIRED. The chain structure repeated the same
-- rule under different parents -- "Pokemon may have 2 Tool cards attached to
-- them" was three rows, once under each of 2.a, 2.b and 2.c. They are identical
-- text, they were seeded by an import a few hours ago, and nothing has ever
-- referenced them: this is deduplicating an import rather than discarding
-- history, which is why they go rather than being flagged inactive and left to
-- clutter the list forever.
--
-- The categories were assigned by reading all seventy-six, not by keyword.
-- "Draw up to 4 extra cards and take a damage counter for each" is a drawing
-- rule with a cost; "play a Trainer card and take a damage counter" is a
-- Trainer rule with the same cost.

-- ---------------------------------------------------------------------------
-- 1. The duplicates
-- ---------------------------------------------------------------------------
-- Keyed on the body itself, keeping the lowest sort_order of each group, so
-- this says what it means without listing sixteen codes.
delete from public.chaos_cup_rules
where id in (
  select id from (
    select id,
           row_number() over (
             -- Normalised, because one pair differs only in whether Pokemon
             -- carries its accent -- one came from the spreadsheet and one from
             -- the rules document. Matching on the exact text would leave both.
             partition by lower(translate(body, 'é', 'e'))
             -- The accented spelling is the one worth keeping.
             order by (body like '%é%') desc, sort_order
           ) as rn
    from public.chaos_cup_rules
  ) ranked
  where rn > 1
);

-- ---------------------------------------------------------------------------
-- 2. The category
-- ---------------------------------------------------------------------------
alter table public.chaos_cup_rules
  add column category text;

update public.chaos_cup_rules r
set category = v.category
from (values
    ('Draw 3 Cards at the start of your turn.', 'Drawing and your hand'),
    ('Discard 3 cards at the start of your turn, put 1 of those cards into your hand.', 'Drawing and your hand'),
    ('At the end of your turn you may draw 2 cards instead of attacking.', 'Drawing and your hand'),
    ('At the end of your turn you may put a card from your discard pile into your hand instead of attacking.', 'Drawing and your hand'),
    ('Draw 3 cards at the start of your turn. Add one to your hand, discard 1, and put 1 at the bottom of your deck.', 'Drawing and your hand'),
    ('Draw an extra card for each prize your opponent took since the end of your last turn, at the start of your turn.', 'Drawing and your hand'),
    ('If your opponent knocked out 1 of your pokemon last turn, do not draw any cards at the start of your turn.', 'Drawing and your hand'),
    ('Draw 3 cards at the start of your turn and show them to your opponent. They choose 1 for you to discard, put the other 2 cards into your hand.', 'Drawing and your hand'),
    ('If your hand is empty at the end of your turn you may place a card from your discard pile into your hand.', 'Drawing and your hand'),
    ('You may draw up to 4 additional cards at the start of your turn (for up to 5 total), for each additional card drawn place 1 damage counter on each of your Pokemon.', 'Drawing and your hand'),
    ('At the end of your turn if you do not attack, place 3 damage counters on your active Pokemon.', 'Damage and knockouts'),
    ('Instead of 1 damage counter per extra card drawn place 3 damage counters on each of your Pokemon for each additional card drawn.', 'Drawing and your hand'),
    ('At the end of your turn you may move all the damage counters from 1 of your benched Pokemon to another one of your benched Pokemon', 'Damage and knockouts'),
    ('Each time you play a Trainer card you must place a damage counter on your active Pokemon', 'Trainer cards'),
    ('After you play a supporter you may flip a coin, if heads shuffle it back into your deck', 'Trainer cards'),
    ('Pokemon may have 2 Tool cards attached to them', 'Trainer cards'),
    ('Up to 2 stadiums can be in play (you can still only play one stadium card per turn).', 'Trainer cards'),
    ('All Ace Specs now only have the effect of Computer Search 2.0 and let you "Discard 2 cards to search your deck for any 2 cards, add those 2 cards to your hand".', 'Trainer cards'),
    ('All Supporters now only have the "Draw 3" effect, unless you discard your entire hand after resolving thier effect, otherwise ignore all other supporter effects.', 'Trainer cards'),
    ('All Ace Specs now only have the effect of Dowsing Machine 2.0 "Discard a card from your hand to return a card form your discard pile to your hand".', 'Trainer cards'),
    ('In order to play a Supporter card, you must confuse your active Pokemon.', 'Trainer cards'),
    ('All Ace Specs now only have the effect of VS Seeker "Return a supporter from the discard pile to your hand".', 'Trainer cards'),
    ('Play with 2 active Pokemon and up to 4 benched Pokemon. During setup draw cards faceup until you find 2 basic Pokemon (the first 2 you find go toyour active spots), then shuffle the other cards back into your deck and draw a hand of 5 cards. On your turn you may attack once with each Pokemon, each attach only targets one of your opponent''s active Pokemon. The player who goes first can attack with one of thier Pokemon on thier first turn. Promotoe new Pokemon to the active spot after all effects of attacks are resolved.', 'The bench and the board'),
    ('Play with 3 active Pokemon and up to 3 benched Pokemon. Your active Pokemon can only attack defending Pokemon adjacent to them (either diagonally or orthagonally). Otherwise follow all previous double battle rules.', 'The bench and the board'),
    ('Instead of attacking with each of your active Pokemon you can have 1 attack target all adjacent defending Pokemon, the damage is split evenly (rounding up) between each of the targeted Pokemon.', 'The bench and the board'),
    ('Once per turn you may switch the positions of 2 of your active Pokemon.', 'The bench and the board'),
    ('You can only have 1 benched Pokemon.', 'The bench and the board'),
    ('Once per game you may choose to have an attack target both defending Pokemon (similar to a Vstar attack this can only be done once).', 'The bench and the board'),
    ('At the start of your turn draw 2 cards.', 'Drawing and your hand'),
    ('You can only have up to 2 benched Pokemon.', 'The bench and the board'),
    ('Instead of attacking with both of your active Pokemon you can have 1 attack target both defending Pokemon, but the damage is split evenly (rounding up) between the 2 defending Pokemon.', 'The bench and the board'),
    ('Once per game you can either switch 1 or 2 benched Pokemon with your active Pokemon without paying the retreat cost or you may gust up one of your opponenet''s benched Pokemon (Similar to a Vstar Ability this can only be done once).', 'The bench and the board'),
    ('At the end of your turn roll a 6 sided die, your active Pokemon is now afflicted with the status associated with your roll:
1 - Sleep
2 - Burn
3 - Confusion
4 - Paralysis
5 - Poison
6 - Remove all status conditions
Pokemon cannot be Asleep & Confused at the same time, so these statuses replace each other.', 'Status conditions'),
    ('Benched Pokemon can also have Status Conditions (Pokemon do not recover when moved to the bench). All conditions can be removed from benched Pokemon by flipping heads during Checkup. When flipping for recovery flip for each status seperately.', 'Status conditions'),
    ('If your active Pokemon is still affected by a Status Condition choose 1 of your benched Pokemon to roll an effect for.', 'Status conditions'),
    ('If you have 3 or more Pokemon afflicted with a Status Condition at the end of your turn take a prize card.', 'Status conditions'),
    ('At then end of your turn (before your status roll) you can discard the top 2 cards of your deck to recover all Pokemon from all status conditions.', 'Status conditions'),
    ('Double all damage associated with status conditions. Aka double poison damage, double burn damage, and 60 damage for failing a confusion flip.', 'Status conditions'),
    ('Poison and Burn can be applied twice, if applied twice apply the effect trwice between turns.', 'Status conditions'),
    ('Paralysis does not recover unless replaced by another incompatible condition or by the effect of another card.', 'Status conditions'),
    ('Confused Pokemon deal double Damage.', 'Status conditions'),
    ('At then end of your turn you can discard the top 2 cards of your deck to skip your status roll.', 'Status conditions'),
    ('Each Player can have up to 8 benched Pokemon.', 'The bench and the board'),
    ('Knocked out Pokemon go to the Lost Zone.', 'Damage and knockouts'),
    ('Whenever your Active Pokemon is knocked out shuffle your discard pile into your deck.', 'Damage and knockouts'),
    ('When declaring an attack that does damage, roll two die. If they are the same number, the attack does double damage.', 'Damage and knockouts'),
    ('After your turn, you may discard a card from your hand and play Rock, Paper Scissors with your opponent. Whoever loses that match, their Active Pokemon is now Burned.', 'Status conditions'),
    ('Instead of taking prize cards for knocking out your opponent''s Pokemon take prize cards when your Pokemon are knocked out. You win once all of your opponent''s Prize cards are taken.', 'Prize cards and winning'),
    ('Play with Prize Cards Face up. You choose what prize card your opponent takes.', 'Prize cards and winning'),
    ('During game setup, draw and set up 12 prize cards instead of 6. When drawing prize cards (after knockouts), always take double prizes.', 'Prize cards and winning'),
    ('Once per turn you may pick two random cards from your opponent’s hand. Look at the cards and choose one shuffle back into their deck. The other card goes back into their hand.', 'Drawing and your hand'),
    ('Instead of attacking you can discard the top 7 cards of your deck to draw a prize card.', 'Prize cards and winning'),
    ('When attacking instead of damaging the defending Pokemon you can discard the top card of your opponent''s deck for every 50 damage your attack would do.', 'Damage and knockouts'),
    ('You may attach up to 3 energy per turn.', 'Energy and attacks'),
    ('All energy counts as two of its energy type, but only when paying an attack cost.', 'Energy and attacks'),
    ('To attack you must shuffle the attack''s energy cost from the Pokemon back into your deck.', 'Energy and attacks'),
    ('Each time you attach energy to a Pokemon place 2 damage counters on that Pokemon.', 'Energy and attacks'),
    ('Whenever your Active Pokemon is knocked out shuffle your discard pile into your deck before placing the active Pokemon into the discard pile.', 'Damage and knockouts'),
    ('To attack you must discard an energy from the attacking Pokemon.', 'Energy and attacks'),
    ('All attacks cost one additional Colorless energy.', 'Energy and attacks'),
    ('If you attach an energy from hand to your active Pokémon it becomes confused.', 'Energy and attacks'),
    ('Confused Pokemon deal double Damage, when their attacks fail they do 60 damage to themselves instead of 30 damage.', 'Status conditions'),
    ('Once during your turn, you may discard your hand and roll a six-sided die. Draw twice as many cards as you rolled.', 'Drawing and your hand'),
    ('Once during your turn, you may discard up to two cards from your hand. For each card discarded, choose one of the following:
- Your active pokemon''s attacks do 40 more damage this turn
- During your opponent''s next turn, your Active Pokemon takes 40 less damage from attacks.', 'Damage and knockouts'),
    ('Whenever a player uses an ability during their turn, that player must switch their active Pokemon to the bench.', 'The bench and the board'),
    ('After you attack play Rock, Paper Scissors with your opponent. Whoever loses that match, their active Pokémon is now burned.', 'Status conditions'),
    ('Once during your turn, you may discard two cards of the same type and return a different card of the same type from the discard pile to your hand. Pokémon, Trainers, Energy are types.', 'Drawing and your hand'),
    ('When a player has three or fewer prize cards remaining, that player must shuffle their discard pile and trade it with their deck.', 'Prize cards and winning'),
    ('You must play the whole round with your hand face up so your opponent may see it at all times.', 'Drawing and your hand'),
    ('During game setup, draw a 13 card hand to start. From that hand pick a starting active Pokemon and your 6 prizes. Randomize the 6 prize cards before placing them face down.', 'Drawing and your hand'),
    ('Play with your prize cards face up. When you take prize cards your opponent chooses for you.', 'Prize cards and winning'),
    ('At the beginning of each turn draw three cards instead of just one. Keep one, discard one, and return one to the bottom of your deck.', 'Drawing and your hand'),
    ('When your active Pokémon is the target of an attack that does damage, roll two die. If they are the same number, the active Pokémon avoids the attack.', 'Damage and knockouts'),
    ('Treat supporters as items and items as supporters. You may only play one item per turn. You may play as many supporters per turn as you wish. First turn going first you may not play an item.', 'Trainer cards'),
    ('During setup, do not put out prize cards. When you would normally take prize cards, place cards from your hand down as prize cards up to the number of prize cards you would have taken. The win condition of the game is now once you have put down six prize cards.', 'Prize cards and winning'),
    ('All evolution Pokémon keep the base HP of their basic Pokémon.', 'Damage and knockouts')
) as v(body, category)
where r.body = v.body;

-- Anything the update missed -- there should be nothing, but a rule added by
-- hand between the two migrations would land here rather than block the
-- not-null below.
update public.chaos_cup_rules
set category = 'Other'
where category is null;

alter table public.chaos_cup_rules
  alter column category set not null;

comment on column public.chaos_cup_rules.category is
  'What kind of rule it is. Free text rather than an enum, so a professor can group a new rule without a migration -- the same arrangement rental deck tags have.';

create index chaos_cup_rules_category_idx on public.chaos_cup_rules (category);

grant insert (body, category, sort_order) on public.chaos_cup_rules to authenticated;
grant update (body, category, is_active, sort_order) on public.chaos_cup_rules to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The chain machinery goes
-- ---------------------------------------------------------------------------
drop index if exists public.chaos_cup_rules_code_idx;
drop index if exists public.chaos_cup_rules_chain_idx;

alter table public.chaos_cup_rules
  drop column chain,
  drop column code,
  drop column stage;

comment on table public.chaos_cup_rules is
  'Rules a professor picks from when composing a Chaos Cup sheet, grouped by category. Professor-only: a sheet is handed out on the day, and publishing the catalogue would give away every event in advance.';
