-- A prize wall item can carry a picture.
--
-- The wall is a price list: a name, a note and a number. That is the right
-- shape for reading down, and the wrong shape for "which booster box is that,
-- the one with the dragon on it". A professor stands next to the wall and can
-- answer; the page could not.
--
-- The same shape as badge art, deliberately. image_path null means no picture,
-- a path names an object in a public bucket, and the page builds the URL. There
-- is no fallback to a committed file, because unlike the original thirteen
-- badges no prize item has ever had artwork beside the page.

alter table public.prize_items
  add column image_path text;

comment on column public.prize_items.image_path is
  'Object path inside the prize-art storage bucket. Null means no picture, which is every item until a professor adds one.';

-- ---------------------------------------------------------------------------
-- Somewhere for the pictures to live
-- ---------------------------------------------------------------------------
-- PUBLIC, unlike the gallery bucket and like badge-art. A prize wall picture is
-- a photograph of a product on a shelf: there is nobody in it, nothing to
-- approve, and the page that shows it is open to everybody. Making it private
-- would mean signing a URL per item on a page anyone can read, which is work
-- and latency bought for no privacy at all.
--
-- 1MB. The screen resizes to an 800px JPEG before it uploads, which lands
-- around 150KB, so this is the backstop for somebody not using the screen
-- rather than the normal path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prize-art', 'prize-art', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg'];

-- These policies are scoped to this one bucket and leave every other bucket
-- alone. Nothing here is public write: a picture on the prize wall is the
-- league saying what is on the wall, so only a professor puts one there.
drop policy if exists prize_art_read on storage.objects;
create policy prize_art_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'prize-art');

drop policy if exists prize_art_insert on storage.objects;
create policy prize_art_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'prize-art' and public.is_professor());

drop policy if exists prize_art_update on storage.objects;
create policy prize_art_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'prize-art' and public.is_professor())
  with check (bucket_id = 'prize-art' and public.is_professor());

-- Replacing a picture, or taking one off, would otherwise leave the old file
-- behind for ever. Nothing else in this project deletes, but an orphaned image
-- is not history worth keeping.
drop policy if exists prize_art_delete on storage.objects;
create policy prize_art_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'prize-art' and public.is_professor());

-- No grant or policy change on prize_items. Select is granted at table level to
-- anon and authenticated, insert, update and delete to authenticated, so the
-- new column is already covered -- and a column does not change who may read a
-- row.
