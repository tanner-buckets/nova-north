-- A gallery of league photographs, and the review every one of them passes
-- first.
--
-- This is the third public write surface on the site, after event registration
-- and drop requests, and it is the only one that publishes something. A
-- registration is a row a professor reads; a photograph is a picture of a room
-- full of children, shown to anybody who opens the page. So nothing a visitor
-- sends is visible to anybody but a professor until a professor says so, and
-- that is enforced in the database rather than by the page:
--
--   * The bucket is PRIVATE. Unlike badge-art, there is no public URL for an
--     object in it. A file can only be fetched through a signed URL, and
--     signing one needs select on storage.objects, which anon only has for an
--     object some approved row points at.
--   * So a photograph waiting for review is not merely unlisted. It is
--     unreadable by anybody without a professor session, even holding its exact
--     path.
--
-- Nothing identifying is attached to a published photograph. The submitter is
-- recorded so a professor knows who to ask, and that column never leaves the
-- professor side: approved_gallery() does not return it.

-- ---------------------------------------------------------------------------
-- 1. Somewhere for the pictures to live
-- ---------------------------------------------------------------------------
-- 3MB, which is comfortable for the 1600px JPEG the page produces and far below
-- what a phone camera hands over. The page resizes and re-encodes before it
-- uploads anything, so this limit is the backstop for somebody not using the
-- page rather than the normal path.
--
-- JPEG only, because that is the one format canvas.toBlob() is guaranteed to
-- produce. Narrowing the list narrows what can be stored at all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', false, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg'];

-- ---------------------------------------------------------------------------
-- 2. One row per photograph
-- ---------------------------------------------------------------------------
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),

  -- Two renditions. A phone on store wifi should not download twenty 1600px
  -- JPEGs to show a grid of thumbnails.
  storage_path text not null unique,
  thumb_path text not null unique,

  -- The full rendition's pixel size, shown on the review screen. It is one of
  -- the things a professor weighs: a picture going on a public page at 1600
  -- pixels is a different decision from a blurry one at 400.
  width integer,
  height integer,

  -- Optional, and a professor can rewrite it at approval. A caption is the one
  -- place a submitter can type a child's name onto a public page, which is
  -- exactly why the professor gets the last word on it.
  caption text,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  -- Who sent it. Never public: approved_gallery() does not return this column.
  -- A photograph is not anonymous for the same reason a registration is not --
  -- there has to be somebody to ask about it.
  submitted_by text not null references public.players (player_id),
  submitted_at timestamptz not null default now(),

  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decided_note text,

  -- Rejecting a photograph deletes the files. The row stays, because the record
  -- that somebody sent it and it was turned down is worth keeping; the picture
  -- itself is not. This stamp is what tells the two apart afterwards.
  files_removed_at timestamptz,

  constraint gallery_photos_caption_length
    check (caption is null or char_length(caption) <= 300),

  -- Pending and undecided are the same state. Letting them drift apart would
  -- leave a photograph that is approved according to one column and waiting
  -- according to the other.
  constraint gallery_photos_decision_is_complete
    check ((status = 'pending') = (decided_at is null))
);

comment on table public.gallery_photos is
  'One row per submitted photograph. Nothing here is readable by anon: the public page reads approved_gallery() and the professor screen reads gallery_review_list().';
comment on column public.gallery_photos.submitted_by is
  'Protected. The Player ID the photograph was sent under, so a professor can ask about it. Never returned to the public page.';
comment on column public.gallery_photos.files_removed_at is
  'When the two storage objects were deleted, which happens when a photograph is rejected or taken down. A row with this set can never be approved again -- there is nothing left to show.';

-- The public feed: approved, newest first.
create index gallery_photos_feed_idx
  on public.gallery_photos (status, submitted_at desc, id desc);

-- The per-submitter rate check.
create index gallery_photos_submitter_idx
  on public.gallery_photos (submitted_by, submitted_at desc);

alter table public.gallery_photos enable row level security;

-- Professors read the table directly; everybody else goes through a function.
-- There is no insert policy and no update policy on purpose: both writes run
-- inside security definer functions that validate first, so there is no way to
-- set status from outside them.
create policy gallery_photos_professor_read
  on public.gallery_photos for select
  to authenticated
  using (public.is_professor());

revoke all on public.gallery_photos from anon, authenticated;
grant select on public.gallery_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What makes an object readable
-- ---------------------------------------------------------------------------
-- The storage policy has to ask "does an approved row point at this object",
-- and anon has no select on gallery_photos -- a policy expression runs with the
-- caller's privileges, so asking directly would be refused rather than answered
-- false. This answers the one question and nothing else.
create or replace function public.gallery_object_is_approved(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.gallery_photos g
    where g.status = 'approved'
      and (g.storage_path = p_name or g.thumb_path = p_name)
  );
$function$;

comment on function public.gallery_object_is_approved(text) is
  'Whether an object in the gallery bucket belongs to an approved photograph. Used by the storage select policy, which cannot read gallery_photos as the caller.';

revoke all on function public.gallery_object_is_approved(text) from public;
grant execute on function public.gallery_object_is_approved(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage policies, scoped to this one bucket
-- ---------------------------------------------------------------------------
-- Anybody may put a file in, and the path has to look like a submission. This
-- is a genuinely open door: somebody could upload files and never create a row
-- for them, and nothing here stops that. The size limit and the mime list keep
-- the damage to disk rather than to the page, and an orphan is invisible --
-- every screen reads rows, not the bucket. The same trade was made for
-- registration, where detection beat prevention because the alternative was
-- refusing real people.
drop policy if exists gallery_submit on storage.objects;
create policy gallery_submit
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'gallery' and name like 'submissions/%');

-- No update policy for anon: an upload cannot overwrite an object that is
-- already there, so an approved photograph cannot be swapped for another one
-- under the same path.

drop policy if exists gallery_read_approved on storage.objects;
create policy gallery_read_approved
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'gallery' and public.gallery_object_is_approved(name));

drop policy if exists gallery_read_all on storage.objects;
create policy gallery_read_all
  on storage.objects for select
  to authenticated
  using (bucket_id = 'gallery' and public.is_professor());

drop policy if exists gallery_delete on storage.objects;
create policy gallery_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery' and public.is_professor());

-- ---------------------------------------------------------------------------
-- 5. Sending one in
-- ---------------------------------------------------------------------------
-- Player ID and first name together, the same proof a drop request asks for,
-- and one refusal covers both a wrong ID and a wrong name. Telling the two
-- apart would make this a way to test which Player IDs exist.
create or replace function public.submit_gallery_photo(
  p_player_id text,
  p_first_name text,
  p_storage_path text,
  p_thumb_path text,
  p_width integer default null,
  p_height integer default null,
  p_caption text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player text;
  v_recent integer;
  v_caption text;
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  select p.player_id into v_player
  from public.players p
  where p.player_id = btrim(coalesce(p_player_id, ''))
    and lower(p.first_name) = lower(btrim(coalesce(p_first_name, '')));

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_matched');
  end if;

  -- The paths are written by the page, so they are checked here rather than
  -- trusted. A row may only ever point at a submission named after a uuid.
  if coalesce(p_storage_path, '') !~ ('^submissions/' || v_uuid || '\.jpg$')
     or coalesce(p_thumb_path, '') !~ ('^submissions/' || v_uuid || '-thumb\.jpg$') then
    return jsonb_build_object('ok', false, 'code', 'bad_path');
  end if;

  -- A day of league is a handful of pictures. Twenty leaves room for an
  -- enthusiastic parent and still caps what one person can put in front of a
  -- professor overnight.
  select count(*) into v_recent
  from public.gallery_photos
  where submitted_by = v_player
    and submitted_at > now() - interval '24 hours';

  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  v_caption := left(nullif(btrim(coalesce(p_caption, '')), ''), 300);

  insert into public.gallery_photos
    (storage_path, thumb_path, width, height, caption, submitted_by)
  values (p_storage_path, p_thumb_path, p_width, p_height, v_caption, v_player);

  return jsonb_build_object('ok', true, 'code', 'submitted');
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_submitted');
end;
$function$;

comment on function public.submit_gallery_photo(text, text, text, text, integer, integer, text) is
  'The only public way to create a gallery row. Always lands on status pending, so a caller cannot publish anything.';

revoke all on function public.submit_gallery_photo(text, text, text, text, integer, integer, text) from public;
grant execute on function public.submit_gallery_photo(text, text, text, text, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the public page reads
-- ---------------------------------------------------------------------------
-- Newest first, by when it was sent rather than when it was approved: a
-- professor clearing a backlog in one sitting should not scramble a Sunday into
-- whatever order they happened to click.
--
-- Keyset paging on (submitted_at, id) rather than offset, so a photograph
-- approved while somebody is part way down the page cannot shift the rest and
-- show one of them twice.
create or replace function public.approved_gallery(
  p_limit integer default 24,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  storage_path text,
  thumb_path text,
  caption text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select g.id, g.storage_path, g.thumb_path, g.caption, g.submitted_at
  from public.gallery_photos g
  where g.status = 'approved'
    and (p_before is null
         or (g.submitted_at, g.id)
            < (p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by g.submitted_at desc, g.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60);
$function$;

comment on function public.approved_gallery(integer, timestamptz, uuid) is
  'The public gallery feed. Approved rows only, and never submitted_by, decided_note or anything else from the professor side.';

revoke all on function public.approved_gallery(integer, timestamptz, uuid) from public;
grant execute on function public.approved_gallery(integer, timestamptz, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. What the review screen reads
-- ---------------------------------------------------------------------------
create or replace function public.gallery_review_list(
  p_status text default 'pending',
  p_limit integer default 50
)
returns table (
  id uuid,
  storage_path text,
  thumb_path text,
  caption text,
  status text,
  width integer,
  height integer,
  submitted_by text,
  submitter_name text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_note text,
  files_removed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may review gallery photographs';
  end if;

  return query
  select g.id, g.storage_path, g.thumb_path, g.caption, g.status,
         g.width, g.height,
         g.submitted_by,
         btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
         g.submitted_at, g.decided_at, g.decided_note, g.files_removed_at
  from public.gallery_photos g
  left join public.players p on p.player_id = g.submitted_by
  where g.status = coalesce(p_status, 'pending')
  order by g.submitted_at desc, g.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

comment on function public.gallery_review_list(text, integer) is
  'The review queue. Professor only, and it returns the submitter full name, so it belongs behind the sign-in with the printable lists.';

revoke all on function public.gallery_review_list(text, integer) from public;
grant execute on function public.gallery_review_list(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Deciding
-- ---------------------------------------------------------------------------
-- One function for approving, for rejecting and for taking a published
-- photograph down again, because the last of those is the same act as the
-- second: somebody asked, and it stops being visible. A parent changing their
-- mind is the likeliest thing this screen will ever be asked to do.
create or replace function public.decide_gallery_photo(
  p_id uuid,
  p_approve boolean,
  p_caption text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.gallery_photos%rowtype;
begin
  if not public.is_professor() then
    raise exception 'Only a professor may decide a gallery photograph';
  end if;

  select * into v_row from public.gallery_photos where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_photo');
  end if;

  -- Rejecting deletes the files, so an approval afterwards would publish an
  -- empty box. Reachable by reloading a stale screen rather than by clicking.
  if p_approve and v_row.files_removed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'files_gone');
  end if;

  update public.gallery_photos
     set status = case when p_approve then 'approved' else 'rejected' end,
         caption = case when p_approve
                        then left(nullif(btrim(coalesce(p_caption, '')), ''), 300)
                        else caption end,
         decided_at = now(),
         decided_by = auth.uid(),
         decided_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
   where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'storage_path', v_row.storage_path,
    'thumb_path', v_row.thumb_path);
end;
$function$;

comment on function public.decide_gallery_photo(uuid, boolean, text, text) is
  'Approve, reject, or take down an already published photograph. Returns the two object paths so the screen can delete the files when it is not an approval.';

revoke all on function public.decide_gallery_photo(uuid, boolean, text, text) from public;
grant execute on function public.decide_gallery_photo(uuid, boolean, text, text) to authenticated;

-- The screen deletes the objects itself, because storage is an HTTP API rather
-- than something SQL can reach. This records that it happened, so a row with no
-- files is distinguishable from one whose files are still there.
create or replace function public.mark_gallery_files_removed(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_professor() then
    raise exception 'Only a professor may mark gallery files removed';
  end if;

  update public.gallery_photos
     set files_removed_at = now()
   where id = p_id and files_removed_at is null;
end;
$function$;

revoke all on function public.mark_gallery_files_removed(uuid) from public;
grant execute on function public.mark_gallery_files_removed(uuid) to authenticated;
