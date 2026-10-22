-- Rentable resources: decks a player can borrow, and the ones we would like.
--
-- Nothing here is personal data. It is a catalogue, and the whole of it is
-- public: what we have, whether it is up to date, and what we are still after.
--
-- Four tables rather than one, because they answer different questions:
--
--   rental_decks            what is on the shelf
--   rental_deck_tags        a vocabulary a professor can extend
--   rental_deck_tag_links   which deck wears which tag
--   rental_deck_bounties    what we would like somebody to build
--
-- STATUS IS NOT A TAG. "Current" and "Needs updating" are a column with a
-- check, because exactly one of them is true at a time and a deck that managed
-- to wear both would be telling a player two different things. Everything else
-- -- good for beginners, regional winner, professor's pick -- is a tag, because
-- a deck can be any number of those at once and the list is meant to grow.

-- ---------------------------------------------------------------------------
-- rental_decks
-- ---------------------------------------------------------------------------
create table public.rental_decks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (format in ('standard', 'glc')),
  deck_list_url text,
  status text not null default 'current'
    check (status in ('current', 'needs_updating')),
  notes text,
  -- Retired, never deleted. A deck that leaves the shelf has been borrowed by
  -- people and may come back.
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index rental_decks_shelf_idx on public.rental_decks (format, sort_order)
  where is_active;

comment on table public.rental_decks is
  'Decks a player can borrow for the afternoon. Public: this is a catalogue, not a record of anybody.';
comment on column public.rental_decks.status is
  'current or needs_updating. A column rather than a tag because exactly one is true at a time.';
comment on column public.rental_decks.deck_list_url is
  'Where the list lives. Shown as a link on the programs page; null simply shows no link.';

-- ---------------------------------------------------------------------------
-- rental_deck_tags
-- ---------------------------------------------------------------------------
-- A vocabulary, not an enum, because the whole point is that a professor can
-- add one without a migration.
create table public.rental_deck_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint rental_deck_tags_label_once unique (label)
);

comment on table public.rental_deck_tags is
  'The tag vocabulary. Professors add to it from the rentals screen; rows are retired rather than deleted so a deck that wore one keeps its history.';

create table public.rental_deck_tag_links (
  deck_id uuid not null references public.rental_decks (id) on delete cascade,
  tag_id uuid not null references public.rental_deck_tags (id) on delete cascade,
  primary key (deck_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- rental_deck_bounties
-- ---------------------------------------------------------------------------
-- What we would like built. claimed_note is the duplicate guard: somebody says
-- they are building one, a professor writes it here, and the next person
-- reading the page can see it is spoken for before spending money on cards.
create table public.rental_deck_bounties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (format in ('standard', 'glc')),
  note text,
  claimed_note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.rental_deck_bounties is
  'Decks we would like somebody to build or donate. Public.';
comment on column public.rental_deck_bounties.claimed_note is
  'Set when somebody says they are building it, so two people do not build the same deck.';

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
-- Readable by everybody, writable by a professor. Same posture as the prize
-- wall and the badge list.
grant select on public.rental_decks to anon, authenticated;
grant select on public.rental_deck_tags to anon, authenticated;
grant select on public.rental_deck_tag_links to anon, authenticated;
grant select on public.rental_deck_bounties to anon, authenticated;

grant insert, update, delete on public.rental_decks to authenticated;
grant insert, update, delete on public.rental_deck_tags to authenticated;
grant insert, delete on public.rental_deck_tag_links to authenticated;
grant insert, update, delete on public.rental_deck_bounties to authenticated;

alter table public.rental_decks enable row level security;
alter table public.rental_deck_tags enable row level security;
alter table public.rental_deck_tag_links enable row level security;
alter table public.rental_deck_bounties enable row level security;

create policy rental_decks_read on public.rental_decks
  for select to anon, authenticated using (true);
create policy rental_decks_write on public.rental_decks
  for all to authenticated using (public.is_professor()) with check (public.is_professor());

create policy rental_deck_tags_read on public.rental_deck_tags
  for select to anon, authenticated using (true);
create policy rental_deck_tags_write on public.rental_deck_tags
  for all to authenticated using (public.is_professor()) with check (public.is_professor());

create policy rental_deck_tag_links_read on public.rental_deck_tag_links
  for select to anon, authenticated using (true);
create policy rental_deck_tag_links_write on public.rental_deck_tag_links
  for all to authenticated using (public.is_professor()) with check (public.is_professor());

create policy rental_deck_bounties_read on public.rental_deck_bounties
  for select to anon, authenticated using (true);
create policy rental_deck_bounties_write on public.rental_deck_bounties
  for all to authenticated using (public.is_professor()) with check (public.is_professor());

-- ---------------------------------------------------------------------------
-- The shelf, in one call
-- ---------------------------------------------------------------------------
-- Tags come back on the deck rather than as rows to regroup in a browser. A
-- page drawing a list of decks should not make one request per deck to find
-- out what each is labelled.
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
  'Public. Every active rental deck with its tags, for the programs page.';

grant execute on function public.rental_deck_shelf() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------
-- The vocabulary starts with the three that were asked for. The shelf and the
-- bounty list start empty on purpose: there is nothing on them yet, and a page
-- that invented examples would be a page somebody tried to borrow from.
insert into public.rental_deck_tags (label, sort_order) values
  ('Good for beginners', 10),
  ('Regional winner', 20),
  ('Professor''s pick', 30);

-- Donating a deck is worth points, so it needs an earning action to hang them
-- on. Two, because the bounty list pays double -- and the point of a bounty is
-- that it is worth more than a deck nobody asked for.
insert into public.earning_actions (label, default_points, eligibility_note, sort_order)
values
  ('Donate a rental deck', 10,
   'A complete, sleeved deck left with the league for players to borrow.', 300),
  ('Donate a rental deck from the bounty list', 20,
   'As above, and on the Rental Deck Bounties list at the time it was built.', 310);
