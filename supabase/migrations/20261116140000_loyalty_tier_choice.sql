-- A player saying which PRODUCT they want for the open release.
--
-- Reaching Crystal is the right to BUY a Booster Box at MSRP, and the price is
-- now on the page beside it -- which is where this came from. $161.64 is a lot
-- of money, and a player who turned up eleven Sundays may well want the Elite
-- Trainer Box or the Booster Bundle instead. Until now the sheet the store
-- works from said one thing per tier, so the conversation happened at the till
-- with a queue behind it, or did not happen at all.
--
-- THE CHOICE IS A PRODUCT, NOT A TIER NAME. Crystal, Gold and Silver are how
-- the thresholds are written down; what somebody is actually deciding between
-- is a Booster Box, an Elite Trainer Box and a Booster Bundle. So the form
-- offers products and this function takes the tier's id rather than its name --
-- the row is the thing being picked, and nothing has to match a product string
-- that a professor is free to retype on the releases screen.
--
-- A CHOICE IS A CEILING, NOT A CLAIM. It never grants anything: what a player
-- may buy is still the tier their Sundays earned. A choice they have not
-- reached does nothing at all -- the store's sheet moves them into the product
-- they chose only where their Sundays reach that product's tier, and otherwise
-- leaves them where they earned. That is also why nothing here checks the
-- weeks: a choice made in week two has to still be right in week eleven.
--
-- IT IS PER RELEASE. Tiers, products and prices all change between sets, so a
-- preference about a Booster Box in one release says nothing about the next.
-- The row keys on (release, player) and a new release starts everybody blank.
--
-- IT IS PUBLIC, under the loyalty figure on the player's own card. The decision
-- was weighed the other way first, on the grounds that the commonest reason to
-- take the smaller product is that it costs less and that most of these players
-- are children. What settles it is that a card is only reachable at all through
-- get_player_summary(), which returns nothing for a player whose ID visibility
-- is not in force -- so the cards this can appear on are the ones belonging to
-- people who asked to be listed, which in this league is the adults. A child's
-- card is not public, so there is nothing on it to protect.

-- ---------------------------------------------------------------------------
-- A choice has to be a tier of the release it is filed under
-- ---------------------------------------------------------------------------
-- Said by the database rather than by the function, so a row cannot be wrong
-- even if something writes one some other way later. Postgres needs the two
-- columns unique together before it will let a foreign key reference them, and
-- id is the primary key already, so this costs an index and nothing else.
alter table public.loyalty_tiers
  add constraint loyalty_tiers_id_release_key unique (id, release_id);

-- ---------------------------------------------------------------------------
-- loyalty_tier_choices
-- ---------------------------------------------------------------------------
create table public.loyalty_tier_choices (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null,
  player_id text not null references public.players (player_id) on update cascade,
  tier_id uuid not null,
  chosen_at timestamptz not null default now(),

  constraint loyalty_tier_choices_one_per_release unique (release_id, player_id),

  -- Both halves at once: the tier exists, and it belongs to this release.
  --
  -- on delete cascade, deliberately. Tiers are rows a professor edits on the
  -- releases screen, and one that is removed takes any preference for it with
  -- it -- a choice of a product that is no longer on offer is not history worth
  -- keeping, it is a row that would print a tier nobody can reach. The record
  -- of a finished release is loyalty_results, which this does not touch.
  constraint loyalty_tier_choices_tier_fk
    foreign key (tier_id, release_id)
    references public.loyalty_tiers (id, release_id) on delete cascade
);

comment on table public.loyalty_tier_choices is
  'Which product a player wants for one release. A ceiling, never a grant: it counts only where their Sundays reach that product tier. Read publicly through get_player_summary(), written only through choose_loyalty_product().';
comment on column public.loyalty_tier_choices.tier_id is
  'The tier whose PRODUCT they want. The form offers products; the tier row is what identifies one, because a product name is free text a professor can retype.';

-- No anon grant, and no write grant to anybody. Reading goes through
-- get_player_summary() like everything else on a player card, and writing goes
-- through choose_loyalty_product() -- the same arrangement
-- void_trainer_card_batch() has. An UPDATE grant on the table would let any
-- signed-in professor write any row of it from a browser, and there is no
-- screen that needs to.
grant select on public.loyalty_tier_choices to authenticated;

alter table public.loyalty_tier_choices enable row level security;

create policy loyalty_tier_choices_select_professor
  on public.loyalty_tier_choices for select to authenticated
  using (public.is_professor());

-- ---------------------------------------------------------------------------
-- choose_loyalty_product
-- ---------------------------------------------------------------------------
-- The public write, and the one place a choice is ever recorded.
--
-- There is no matching read. The card already carries it: get_player_summary()
-- is the only thing a player card reads, and a second call the page would have
-- to keep in step with it is exactly what that rule exists to prevent.
--
-- A null p_tier_id is "no preference, give me whatever I earn" and removes the
-- row -- no row and the top product are the same thing said two ways, since
-- neither steps down from anything. The argument has no default, so clearing a
-- choice has to be asked for rather than arrived at by leaving a field out.
--
-- It takes effect immediately, unlike request_visibility(). A visibility flag
-- is a professor's decision because it publishes something about a child and
-- needs consent recorded against it; this records a preference about a purchase
-- on a card that is already public. Putting it in a queue would mean a player
-- at home could not answer a question about their own money without waiting for
-- somebody to approve it.
create or replace function public.choose_loyalty_product(
  p_player_id text,
  p_last_name text,
  p_birth_year integer,
  p_tier_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_release public.releases;
  v_player text;
  v_tier public.loyalty_tiers;
begin
  if not public.player_identity_matches(p_player_id, p_last_name, p_birth_year) then
    return jsonb_build_object('ok', false, 'code', 'not_matched');
  end if;

  v_player := btrim(coalesce(p_player_id, ''));
  v_release := public.active_release();

  -- No window open, or one already snapshotted into loyalty_results. Either way
  -- there is nothing to decide: finalising a release is what turns it into a
  -- record, and a record does not take preferences.
  if v_release.id is null or v_release.finalized_at is not null then
    return jsonb_build_object('ok', false, 'code', 'no_release');
  end if;

  if p_tier_id is null then
    delete from public.loyalty_tier_choices
     where release_id = v_release.id and player_id = v_player;

    return jsonb_build_object('ok', true, 'code', 'cleared',
      'release_name', v_release.name, 'ends_on', v_release.ends_on,
      'choice', null);
  end if;

  select t.* into v_tier
  from public.loyalty_tiers t
  where t.id = p_tier_id and t.release_id = v_release.id;

  -- A product that is not on this release. The form offers what the release
  -- has, so this is a stale page or a hand-made call rather than a typo, and it
  -- is told apart from a failed proof on purpose: nothing about which products
  -- a release offers is secret.
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_product');
  end if;

  insert into public.loyalty_tier_choices (release_id, player_id, tier_id)
  values (v_release.id, v_player, v_tier.id)
  on conflict (release_id, player_id)
  do update set tier_id = excluded.tier_id, chosen_at = now();

  return jsonb_build_object('ok', true, 'code', 'saved',
    'release_name', v_release.name,
    'ends_on', v_release.ends_on,
    'choice', jsonb_build_object(
      'tier_id', v_tier.id,
      'tier_name', v_tier.tier_name,
      'product', v_tier.product,
      'msrp', v_tier.msrp,
      'weeks_required', v_tier.weeks_required,
      'reached', public.loyalty_weeks(v_player, v_release.id) >= v_tier.weeks_required));
end;
$function$;

comment on function public.choose_loyalty_product(text, text, integer, uuid) is
  'Public. Records which product a player wants for the open release, or clears it when the tier id is null. A ceiling on what they may buy, never a grant.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.choose_loyalty_product(text, text, integer, uuid) from public;

grant execute on function public.choose_loyalty_product(text, text, integer, uuid) to anon, authenticated;
