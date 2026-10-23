-- A rental deck tag can carry a colour.
--
-- The colours were first written into page code, keyed on the label -- green
-- for "Good for beginners", gold for "Regional winner". That only works for
-- tags somebody has already thought of: rename one and it goes grey, invent
-- one and it cannot have a colour at all. The vocabulary was built to be
-- extended by a professor without a migration, and its colours should be too.
--
-- NULL means no colour, which is the quiet grey pill every tag wears today.
-- That is the default and most tags should keep it: a shelf where every pill
-- is coloured is a shelf where no pill means anything.
--
-- The check is on the SHAPE of the value, not on whether it is readable. A
-- database cannot judge contrast, so the page picks the text colour -- white
-- or ink, whichever has more contrast against the chosen background. That
-- makes any valid hex safe to render, including one typed straight into the
-- API by somebody bypassing the swatches on the screen.

alter table public.rental_deck_tags
  add column color text,
  add constraint rental_deck_tags_color_hex
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

comment on column public.rental_deck_tags.color is
  'Pill background as #rrggbb, or null for the quiet default. The page chooses the text colour by contrast, so any valid hex renders readably.';

-- The two that were hardcoded. Both are 5.37:1 against white, the same as
-- --gold, so a green pill and a gold one carry identical weight.
update public.rental_deck_tags set color = '#1b7a43' where label = 'Good for beginners';
update public.rental_deck_tags set color = '#8a6410' where label = 'Regional winner';
-- Professor's pick stays grey, as asked.

-- ---------------------------------------------------------------------------
-- The shelf has to carry the colour
-- ---------------------------------------------------------------------------
-- tags was an array of labels and is now an array of {label, color}. The only
-- caller is rentals.js on the programs page, which is updated with it.
create or replace function public.rental_deck_shelf()
returns table (
  id uuid,
  name text,
  format text,
  deck_list_url text,
  status text,
  notes text,
  tags jsonb
)
language sql
stable
set search_path = ''
as $function$
  select
    d.id, d.name, d.format, d.deck_list_url, d.status, d.notes,
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
  'Public. Every active rental deck with its tags, each tag carrying its label and its colour.';
