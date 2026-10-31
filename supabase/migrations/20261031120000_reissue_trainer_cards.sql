-- Everybody needs a card again, a second time.
--
-- The card artwork has been redrawn in a brighter gold, and the sheets were
-- printing at about 97% of their size on printers that shrink every page --
-- fixed by the printer correction on the Creator. A card printed before either
-- change is on the old art and possibly undersized, so every one is being
-- reissued, and the "no card yet" button has to say so or it is offering the
-- wrong list.
--
-- Same shape as 20261022120000_reset_trainer_card_prints.sql, deliberately:
--
-- VOIDED, NOT DELETED. trainer_card_prints is append only and the rule here
-- is void, never delete. Each row is still true -- a card was printed that day
-- -- it just no longer counts toward whether that player needs one.
--
-- voided_by STAYS NULL. No professor is voiding these one at a time; the
-- table is being reset, and naming somebody would claim a decision they did
-- not make at the moment it records.
--
-- ROWS ALREADY VOIDED ARE LEFT ALONE, so an undone print run or the first
-- reset keeps its own date and reason rather than being restamped with this
-- one.
--
-- Every season, not only 2027: "all cards" is the instruction, and the first
-- reset was not scoped by season either.
--
-- Nothing else changes. trainer_card_roster() already counts only prints
-- where voided_at is null, so this is a data change with no function, grant or
-- policy touched.

update public.trainer_card_prints
set voided_at = now(),
    void_reason = 'Reset when the card artwork was redrawn and the print size '
               || 'was corrected. Every card is being reissued.'
where voided_at is null;
