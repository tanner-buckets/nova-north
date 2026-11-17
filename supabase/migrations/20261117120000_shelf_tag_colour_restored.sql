-- The shelf lost its tag colours, and this puts them back.
--
-- WHAT WENT WRONG, because the shape of it will happen again otherwise.
-- `20261023120000_rental_tag_colour.sql` changed rental_deck_shelf() so that
-- tags came back as {label, color} objects instead of bare labels, which is
-- what `tagPill()` in rentals.js reads the colour from. Yesterday
-- `20261116160000_deck_list_formats.sql` had to add two columns to the same
-- function, and it was written by starting from the function body in
-- `20261022160000_rental_decks.sql` -- the migration that CREATED it -- rather
-- than from the newest one that redefined it. The deck list columns landed
-- correctly and the tag colours were silently reverted to labels, so every
-- coloured pill on the programs page fell back to the quiet grey one. Nothing
-- failed: readableOn(null) returns null and tagPill() draws tag-soft, which is
-- a legitimate state for a tag with no colour set.
--
-- THE RULE: recreating a function whole means starting from its CURRENT
-- definition, not from the migration that first wrote it. Where a function has
-- been redefined more than once, the newest migration naming it is the only
-- safe starting point. A `returns table` signature forces a drop and a create
-- often enough that this is a standing hazard rather than a one-off.
--
-- This is a replace, not a drop: the column list is identical to the one
-- 20261116160000 created, so the signature is unchanged and the execute grant
-- to anon and authenticated survives. Nothing to reissue.
create or replace function public.rental_deck_shelf()
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
      select jsonb_agg(
               jsonb_build_object('label', t.label, 'color', t.color)
               order by t.sort_order, t.label)
      from public.rental_deck_tag_links l
      join public.rental_deck_tags t on t.id = l.tag_id
      where l.deck_id = d.id and t.is_active
    ), '[]'::jsonb)
  from public.rental_decks d
  where d.is_active
  order by d.format, d.sort_order, d.name;
$function$;

comment on function public.rental_deck_shelf() is
  'Public. Every active rental deck with its tags -- each carrying its label and its colour -- and whichever way its list is given, for the programs page.';
