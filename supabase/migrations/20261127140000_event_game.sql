-- Which game an event is for.
--
-- The schedule draws a card symbol on a trading card event and a controller on
-- a video game one, and until now there was nothing on the row to ask. The only
-- place the distinction lived was the name: "TCG League Cup", "Standard + VGC".
--
-- Matching on the name was the cheaper option and is how the Chaos Cup link
-- works, but the note on that match already says what is wrong with it -- a
-- cleverer match is not a flag. A symbol is a claim about what somebody will be
-- playing, and it should not appear or vanish because of how an event was
-- typed into a box. So it is a column, set on the events screen like the entry
-- fee and the capacity.
--
-- DISPLAY ONLY. Nothing keys on this: not registration, not the division caps,
-- not rank, not the badge list. An event with no game set simply has no symbol,
-- which is why the column is nullable with no default rather than carrying a
-- guess for every event ever created.

alter table public.events
  add column game text check (game in ('tcg', 'vgc'));

comment on column public.events.game is
  'Which game the event is for: tcg, vgc, or null where it is neither, both, or nobody has said. Display only -- the schedule draws a symbol from it and nothing else reads it.';

-- Grants on events are table-wide rather than per column, so the new column
-- needs nothing reissued. Checked rather than assumed: players has per-column
-- grants and a new column there would be invisible to a professor until it was
-- added to both lists.

-- ---------------------------------------------------------------------------
-- Backfill from the names, where a name says so unambiguously
-- ---------------------------------------------------------------------------
-- The events already carry this in their names, and leaving several years of
-- schedule blank would mean a professor editing every past event to get the
-- symbols the screen was built for.
--
-- ONLY WHERE EXACTLY ONE MATCHES. "Standard + VGC" is a real event name from
-- the attendance import, and a day running both is not a tcg event with a
-- footnote -- it is a day this column cannot describe, so it stays null and a
-- professor decides. Guessing on a name holding both would be the backfill
-- quietly inventing a fact, and a WRONG value is worse here than a blank one:
-- a blank asks somebody to set it, and a wrong one tells them not to bother.
--
-- Which is why the card side looks for the formats too, not only the letters
-- "TCG". Without "Standard" and "Expanded" in this list, "Standard + VGC" sees
-- one match instead of two and gets labelled a video game event -- the exact
-- mislabelling the both-ways test is here to prevent. A prerelease is judged on
-- event_type rather than its name, because a prerelease is a trading card set
-- launch by definition and the names never say so.
--
-- This is a one-off convenience whose misses are reported below and fixable on
-- the events screen. The COLUMN is the flag; being a little clever here is not
-- the same as matching on a name forever, which is what this replaces.
--
-- Word boundaries, not a bare substring: \y is what stops a future "VGCorner"
-- counting as a video game event.
with judged as (
  select
    e.id,
    (e.name ~* '\ytcg\y' or e.name ~* '\ytrading card\y'
      or e.name ~* '\ystandard\y' or e.name ~* '\yexpanded\y'
      or e.name ~* '\yglc\y' or e.event_type = 'prerelease') as looks_tcg,
    (e.name ~* '\yvgc\y' or e.name ~* '\yvideo game\y') as looks_vgc
  from public.events e
)
update public.events e
   set game = case when j.looks_tcg then 'tcg' else 'vgc' end
  from judged j
 where j.id = e.id
   and (j.looks_tcg or j.looks_vgc)
   and not (j.looks_tcg and j.looks_vgc);

-- What the backfill did and did not do, because a silent run leaves nobody any
-- the wiser about the events it declined to judge -- and those are exactly the
-- ones somebody has to go and set by hand.
do $$
declare
  v_tcg integer;
  v_vgc integer;
  v_blank integer;
begin
  select count(*) filter (where game = 'tcg'),
         count(*) filter (where game = 'vgc'),
         count(*) filter (where game is null)
    into v_tcg, v_vgc, v_blank
    from public.events;

  raise notice 'event_game: % set to tcg, % to vgc, % left unset. The unset ones draw no symbol until somebody picks one on the events screen.',
    v_tcg, v_vgc, v_blank;
end $$;
