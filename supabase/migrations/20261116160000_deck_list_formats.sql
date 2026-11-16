-- A deck list can be a link, the list itself, or a picture of it.
--
-- The shelf has only ever been able to point somewhere else. That works when
-- somebody has already put the list on Limitless and nowhere else: a deck built
-- by a professor out of what was in the box has no URL, and the list exists as
-- a sheet of paper in the deck box or as text in a message. Both of those are a
-- deck list; neither is a link, and "no list recorded" was the only thing the
-- page could say about them.
--
-- EXACTLY ONE WAY AT A TIME, enforced by a check. This is the same rule as
-- status: a deck list is one thing, and a row holding a link and a pasted copy
-- is a row holding two lists that will disagree the first time one of them is
-- corrected. The professor screen picks the way and clears the other two, so
-- the constraint is a backstop rather than something anybody meets.
--
-- Pasting the list in is the better of the two new ways wherever there is a
-- choice, and the screen says so: text can be read aloud, searched, and copied
-- into the game, and a photograph can do none of those. A photograph is for a
-- list that only exists on paper.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------
alter table public.rental_decks
  add column deck_list_text text,
  add column deck_list_image_path text;

comment on column public.rental_decks.deck_list_text is
  'The deck list itself, as pasted. Shown in a disclosure on the programs page with a copy button. Null means the list is not given this way.';
comment on column public.rental_decks.deck_list_image_path is
  'Object path inside the deck-lists storage bucket. Null means the list is not given this way.';

-- Null is "not given this way"; an empty string would be a third state meaning
-- the same thing, and the page would open an empty disclosure for it.
alter table public.rental_decks
  add constraint rental_decks_list_text_present
  check (deck_list_text is null or btrim(deck_list_text) <> '');

alter table public.rental_decks
  add constraint rental_decks_one_list
  check (
    (deck_list_url is not null)::integer
    + (deck_list_text is not null)::integer
    + (deck_list_image_path is not null)::integer <= 1
  );

-- ---------------------------------------------------------------------------
-- Somewhere for the pictures to live
-- ---------------------------------------------------------------------------
-- PUBLIC, like prize-art and badge-art and unlike gallery. A deck list is a
-- list of cards: there is nobody in it, nothing to approve, and the page that
-- shows it is open to everybody. Signing a URL per deck would be work and
-- latency bought for no privacy at all.
--
-- 4MB, where prize art gets 1MB. The screen resizes to a 2000px JPEG rather
-- than an 800px one, because this picture is text and has to be legible after
-- the resize -- 800px of booster box is still a booster box, 800px of a sixty
-- card list is a grey smear. This is the backstop for somebody not using the
-- screen rather than the normal path, which lands well under it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deck-lists', 'deck-lists', true, 4194304, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = 4194304,
      allowed_mime_types = array['image/jpeg'];

-- Scoped to this one bucket, leaving every other bucket alone. No public
-- write: what is on the shelf is the league saying what is on the shelf.
drop policy if exists deck_lists_read on storage.objects;
create policy deck_lists_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'deck-lists');

drop policy if exists deck_lists_insert on storage.objects;
create policy deck_lists_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'deck-lists' and public.is_professor());

drop policy if exists deck_lists_update on storage.objects;
create policy deck_lists_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'deck-lists' and public.is_professor())
  with check (bucket_id = 'deck-lists' and public.is_professor());

-- Changing a deck from a picture to a link, or replacing the picture, would
-- otherwise leave the old file behind for ever. Nothing else in this project
-- deletes, but an orphaned image is not history worth keeping.
drop policy if exists deck_lists_delete on storage.objects;
create policy deck_lists_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'deck-lists' and public.is_professor());

-- No grant or policy change on rental_decks. Select is granted at table level
-- to anon and authenticated and the write grants to authenticated, so the two
-- new columns are already covered -- a column does not change who may read a
-- row.

-- ---------------------------------------------------------------------------
-- The shelf, with the two new ways on it
-- ---------------------------------------------------------------------------
-- A returns-table column list is part of the signature, so this is a drop and
-- a create rather than a replace -- AND A DROP TAKES THE GRANT WITH IT, which
-- is why the execute grant is reissued below. Without that the programs page
-- gets "permission denied for function" for every reader.
drop function if exists public.rental_deck_shelf();

create function public.rental_deck_shelf()
returns table (
  id uuid,
  name text,
  format text,
  deck_list_url text,
  deck_list_text text,
  deck_list_image_path text,
  status text,
  notes text,
  tags jsonb
)
language sql
stable
set search_path = ''
as $function$
  select
    d.id, d.name, d.format,
    d.deck_list_url, d.deck_list_text, d.deck_list_image_path,
    d.status, d.notes,
    coalesce((
      select jsonb_agg(t.label order by t.sort_order, t.label)
      from public.rental_deck_tag_links l
      join public.rental_deck_tags t on t.id = l.tag_id
      where l.deck_id = d.id and t.is_active
    ), '[]'::jsonb)
  from public.rental_decks d
  where d.is_active
  order by d.format, d.sort_order, d.name;
$function$;

comment on function public.rental_deck_shelf() is
  'Public. Every active rental deck with its tags and whichever way its list is given, for the programs page.';

grant execute on function public.rental_deck_shelf() to anon, authenticated;
