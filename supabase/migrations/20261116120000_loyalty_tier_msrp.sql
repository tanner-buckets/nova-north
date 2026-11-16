-- The price beside the product on the loyalty table.
--
-- A tier earns the right to BUY a product at MSRP, not to be handed one. The
-- programs page has always said that in a column heading and never in a number,
-- and "you may buy a Booster Box at MSRP" is not an answer to "how much should
-- I bring" -- which is the question a player weighing eleven Sundays is
-- actually asking. The store needs the same figure at the register, which is
-- why the printed loyalty sheet carries it too.
--
-- NULLABLE, AND NO DEFAULT. A tier whose price nobody has looked up has to read
-- as a product with no price recorded rather than as a product that costs
-- nothing, and zero is a real value here: a release could hand something over
-- free. Every page tests for null and prints nothing rather than printing $0.
--
-- numeric rather than a float, because these are prices, compared and shown to
-- the cent. 161.64 is 36 packs at 4.49 and binary floating point does not hold
-- it.

alter table public.loyalty_tiers
  add column msrp numeric(10, 2);

alter table public.loyalty_tiers
  add constraint loyalty_tiers_msrp_check
    check (msrp is null or msrp >= 0);

comment on column public.loyalty_tiers.msrp is
  'US list price of the product, in dollars. Null means nobody has recorded one; it is never rendered as zero. Set per release, because a price moves between sets.';

-- No grant or policy change. The existing grants on this table are table-level,
-- so they cover a column added afterwards, and the select policy is unchanged:
-- a list price is a shelf price in a shop, with nothing personal in it.

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- The list price each of these has carried across the Mega Evolution sets,
-- Delta Reign included: a Booster Box is 36 packs at 4.49, a Booster Bundle is
-- 6 at the same, and an Elite Trainer Box is 49.99 for 9 packs and the box of
-- kit around them.
--
-- FLOWING FISTS CARRIES DELTA REIGN'S PRICES, which was decided rather than
-- assumed. That set does not release until 5 February 2027, after the loyalty
-- window closes, and The Pokemon Company has not published prices for it; the
-- retailer pre-order listings that exist disagree with each other by a factor
-- of two. Delta Reign's are the last verified figures and the organiser's call
-- is to carry them forward. A professor corrects them on the releases screen if
-- the set lands at a different number, which is the whole reason this is an
-- editable column and not a figure written into a page.
--
-- Matched on the product rather than on the release and tier, so a release
-- entered since this was written is filled too, and guarded on null so it
-- cannot overwrite a price somebody has already recorded.
update public.loyalty_tiers
set msrp = case lower(btrim(product))
             when 'booster box' then 161.64
             when 'elite trainer box' then 49.99
             when 'booster bundle' then 26.94
           end
where msrp is null
  and lower(btrim(product)) in ('booster box', 'elite trainer box', 'booster bundle');
