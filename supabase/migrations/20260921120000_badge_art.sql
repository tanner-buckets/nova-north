-- A professor can add a badge, but not its artwork.
--
-- The image path was built in page code as images/badges/<code>.png, and the
-- tile colour came from one of twenty-six custom properties extracted offline
-- and written into styles.css by hand. Neither exists for a badge created
-- through the reference screen, so adding one produced a broken image on a
-- plain gold tile. The form never asked for a picture because there was nowhere
-- to put one.
--
-- This gives a badge somewhere to keep its own artwork and its own colours.

-- ---------------------------------------------------------------------------
-- badges gains its own art
-- ---------------------------------------------------------------------------
alter table public.badges
  add column image_path text,
  add column tile_color text,
  add column tile_edge text;

comment on column public.badges.image_path is
  'Object path inside the badge-art storage bucket. Null means the committed file at images/badges/<code>.png, which is where the original thirteen still live.';
comment on column public.badges.tile_color is
  'Tile fill, taken from the artwork when the image is uploaded. Six digit hex.';
comment on column public.badges.tile_edge is
  'Tile ring: the fill darkened until white text on it clears 4.5:1, so a pale badge still has an outline against a white card.';

-- Hex or nothing. A malformed value would land straight in a style attribute.
alter table public.badges
  add constraint badges_tile_color_hex
  check (tile_color is null or tile_color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint badges_tile_edge_hex
  check (tile_edge is null or tile_edge ~ '^#[0-9a-fA-F]{6}$');

-- The thirteen already on the site, moved out of the stylesheet so colour has
-- one home rather than two. Their images stay as committed files: uploading
-- them would need a professor session or the service_role key.
update public.badges set tile_color = v.fill, tile_edge = v.edge
from (values
  ('raid',       '#fed701', '#836f01'),
  ('points',     '#94b8d7', '#62798e'),
  ('prerelease', '#feda6a', '#836f36'),
  ('glc',        '#fe8647', '#a7582f'),
  ('vgc',        '#ff4344', '#d8393a'),
  ('snack',      '#57849f', '#507992'),
  ('builder',    '#d4cdba', '#777266'),
  ('teacher',    '#00b96c', '#00844d'),
  ('expert',     '#feeb4e', '#796f25'),
  ('attendance', '#0093ec', '#0072b8'),
  ('friendship', '#fefec5', '#6f6f56'),
  ('network',    '#fa919b', '#a55f66'),
  ('community',  '#ffcbde', '#846771')
) as v(code, fill, edge)
where public.badges.code = v.code and public.badges.season_year = 2026;

-- ---------------------------------------------------------------------------
-- Somewhere for an uploaded image to live
-- ---------------------------------------------------------------------------
-- Public read, because a badge tile is shown to anybody looking at a player
-- card. There is nothing private in a badge picture.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('badge-art', 'badge-art', true, 524288,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 524288,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- Half a megabyte is generous for a tile shown at about 110px. The limit is
-- here so a professor picking a 12 megapixel photo by mistake is refused by the
-- server rather than by a page that has already started uploading.

-- storage.objects has row level security on by default in Supabase. These
-- policies are scoped to this one bucket and leave every other bucket alone.
drop policy if exists badge_art_read on storage.objects;
create policy badge_art_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'badge-art');

drop policy if exists badge_art_insert on storage.objects;
create policy badge_art_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'badge-art' and public.is_professor());

drop policy if exists badge_art_update on storage.objects;
create policy badge_art_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'badge-art' and public.is_professor())
  with check (bucket_id = 'badge-art' and public.is_professor());

-- Delete is granted so replacing a badge's art does not leave the old file
-- behind for ever. Nothing else in this project deletes, but an orphaned image
-- is not history worth keeping.
drop policy if exists badge_art_delete on storage.objects;
create policy badge_art_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'badge-art' and public.is_professor());
