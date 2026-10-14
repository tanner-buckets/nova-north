-- Registration opens before play starts.
--
-- Every event in the table was entered half an hour early, because the number a
-- professor had in front of them was when the desk opens rather than when play
-- starts. The schedule then printed that as the event time, so a player reading
-- "2:00 PM" turned up at 2:00 and waited thirty minutes.
--
-- Two facts, so two columns.
--
--   starts_at             when play starts. Unchanged in meaning, and it is
--                         what every existing rule already keys on: the
--                         registration cutoff, the division calculation, the
--                         drop screen, the printable desk list.
--   registration_opens_at when the desk opens on the day.
--
-- The new column is DISPLAYED AND NOTHING ELSE. It does not gate
-- register_for_event(): online pre-registration is open from the moment the
-- event exists and closes when play starts, which is the rule that was already
-- there. This column is about turning up in the room.

alter table public.events
  add column registration_opens_at timestamptz;

-- A check rather than a trigger, because both sides are stored instants and
-- neither needs a timezone lookup to compare -- "at time zone" is stable, not
-- immutable, and a check constraint cannot hold one.
--
-- The admin form asks for a time and composes the date from the event itself,
-- so in practice "before the start" and "earlier the same afternoon" are the
-- same thing. The constraint is the weaker of the two claims on purpose: it is
-- the one that stays true if an event is ever moved by hand.
alter table public.events
  add constraint events_registration_opens_before_start
  check (registration_opens_at is null or registration_opens_at < starts_at);

comment on column public.events.registration_opens_at is
  'When the desk opens on the day, for display on the schedule. Does not gate register_for_event(), which refuses once starts_at has passed. Null means the card says nothing about it.';

-- The correction, and it is the same for every row: what is stored is the time
-- registration opens, and play starts half an hour after it.
--
-- One statement, so every right-hand side reads the old row -- registration_opens_at
-- takes the old starts_at while starts_at takes the old value plus thirty minutes.
--
-- Past events are included. The afternoon really did start at half past, and
-- leaving history alone would mean starts_at meant one thing before today and
-- another after it. Nothing downstream recomputes from a past event's start:
-- attendance carries its own date, and registration refuses a started event
-- whatever the column says.
update public.events
set registration_opens_at = starts_at,
    starts_at = starts_at + interval '30 minutes';

-- No grant changes. The grants on events are table-level
-- (select to anon and authenticated, insert/update/delete to authenticated),
-- so a new column is covered by what is already there.
