-- Two columns on events, so the schedule can answer the questions people
-- actually arrive with: what is this, and what does it cost?
--
-- Without them an event is a name, a type and a time. League play is free while
-- the weekly casual tournament is typically $5, a prerelease $30 -- and someone
-- checking the schedule had no way to find that out.
--
-- Both are nullable. A free event leaves entry_fee null rather than storing '$0',
-- which the page renders as "Free" so there is no ambiguity between "free" and
-- "we forgot to say".

alter table public.events
  add column description text,
  add column entry_fee text;

comment on column public.events.description is
  'A short line shown under the event name. What to bring, what the format is, anything a first-timer would want warned about.';
comment on column public.events.entry_fee is
  'Text rather than a number, because "$5" and "$30, includes a sealed kit" are both legitimate answers. Null means free.';

-- The column grants on events were table-level, so the new columns are already
-- covered. Nothing to re-grant; the public read policy covers them too.
