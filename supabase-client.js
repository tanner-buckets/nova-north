// Shared Supabase client.
//
// The anon key is public by design. It ships inside every page that talks to the
// database, so there is nothing to hide and no point pretending otherwise. What
// keeps data safe is row level security and column grants, which were tested
// from outside the database rather than assumed: this key can read the prize
// wall and the schedule, and is refused on players, registrations and
// consent_log.
//
// The service_role key must never appear in this repository.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://hmlecwwtgsaoxodceezz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtbGVjd3d0Z3Nhb3hvZGNlZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODA2NDksImV4cCI6MjEwMTk1NjY0OX0.3KqglOYZf0G07vOPSqT5ioZR50FFtTQ9HphqlToAxbs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Shared formatting -------------------------------------------------------

// Always league time. "2:00 PM" has to mean the same thing to everyone reading
// it; someone checking the schedule from a hotel in Denver should not be told
// the prerelease starts at noon.
const LEAGUE_TIME_ZONE = 'America/New_York';

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', timeZone: LEAGUE_TIME_ZONE
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone: LEAGUE_TIME_ZONE
});

export function formatEventDay(startsAt) {
  return DAY_FORMAT.format(new Date(startsAt));
}

export function formatEventTime(startsAt) {
  return TIME_FORMAT.format(new Date(startsAt));
}

// When to turn up. The large figure on every public card shows this rather than
// starts_at: the start time was accurate and still read as "be there at half
// past", because the big number is the one a reader takes away, and half past
// is after registration has closed.
//
// starts_at is the fallback and not a second meaning -- an event with no desk
// time recorded has only the one time to show.
//
// Display only. starts_at remains what the registration cutoff, the division
// calculation and the drop screen key on.
export function arriveAt(event) {
  return event.registration_opens_at || event.starts_at;
}

// A YYYY-MM-DD key in league time, for grouping. Using the visitor's day would
// slide an 11:00 AM event onto a different date for someone reading abroad.
const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LEAGUE_TIME_ZONE
});

export function leagueDayKey(startsAt) {
  return DAY_KEY_FORMAT.format(new Date(startsAt));
}

// A list price, to the cent. Always two decimals: these are shop prices, and
// $49.9 is not a price anybody has ever seen written down.
//
// Null is not zero. A tier whose price nobody has recorded gets nothing printed,
// rather than a free Booster Box.
const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

export function formatMsrp(amount) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) {
    return null;
  }
  return USD_FORMAT.format(n);
}

// The release whose window contains today, with its tiers, cheapest first.
//
// One copy, because three screens now ask the same question -- the programs
// page draws the tier table, the players page offers the choice of product, and
// active_release() in the database decides what a write lands on. The SQL one
// is authoritative; this is the same rule for the two pages that read, so they
// cannot drift apart from each other.
//
// Null for no open window, and null for one already finalized: a release that
// has been snapshotted into loyalty_results is a record, and a record takes no
// more Sundays and no more preferences.
export async function openRelease() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: releases, error } = await supabase
    .from('releases').select('*')
    .lte('starts_on', today).gte('ends_on', today)
    .order('starts_on', { ascending: false }).limit(1);
  if (error) throw error;

  const release = releases && releases[0];
  if (!release || release.finalized_at) return null;

  const { data: tiers, error: tierError } = await supabase
    .from('loyalty_tiers').select('*')
    .eq('release_id', release.id).order('weeks_required');
  if (tierError) throw tierError;

  return { release, tiers: tiers || [] };
}

// --- Divisions ---------------------------------------------------------------

// Age divisions are always shown youngest first: Junior, Senior, Master. That is
// the order the programme itself uses, and a list that changes order between two
// screens reads as two different lists.
//
// 'all' leads where it appears, because it is the whole event rather than an age
// group. Nothing here is a source of truth for what a division *is* -- division()
// in the database decides that -- this is only the order and the wording.
export const DIVISION_ORDER = ['all', 'junior', 'senior', 'master'];

export const DIVISION_LABEL = {
  all: 'Everyone',
  junior: 'Junior',
  senior: 'Senior',
  master: 'Master'
};

// Anything unrecognised sorts last rather than first, so a division added to the
// database later appears at the end instead of silently jumping the queue.
function divisionRank(value) {
  const i = DIVISION_ORDER.indexOf(value);
  return i === -1 ? DIVISION_ORDER.length : i;
}

export function byDivision(a, b) {
  return divisionRank(a) - divisionRank(b);
}

// --- Small DOM helpers -------------------------------------------------------

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, html, ...attributes } = options;
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (html !== undefined) node.innerHTML = html;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) node.setAttribute(name, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

// --- Moving one player between screens ---------------------------------------

// The four professor screens that are all about a single player. A professor
// rarely wants just one of them: consent, points and the Trainer Card tend to
// come up in the same conversation at the desk, and having to search for the
// same person three times is the tax that made it feel slow.
//
// Every one of these reads ?id=, so a link carries the player with it.
export const PLAYER_SCREENS = [
  { key: 'points', href: 'points.html', label: 'Prize points' },
  { key: 'trainer-card', href: 'trainer-card.html', label: 'Trainer Card' },
  { key: 'consent', href: 'consent.html', label: 'Visibility and consent' },
  { key: 'players', href: 'players.html', label: 'Player record' }
];

// `current` is the screen doing the rendering, and it is left out: a link back
// to the page you are already on is noise.
export function playerLinks(playerId, { prefix = '', current = null } = {}) {
  const id = encodeURIComponent(playerId);
  return el('nav', {
    className: 'admin-links',
    'aria-label': 'This player on other screens'
  }, PLAYER_SCREENS
    .filter((screen) => screen.key !== current)
    .map((screen) => el('a', {
      href: `${prefix}${screen.href}?id=${id}`,
      text: screen.label
    })));
}

// --- Moving one event between screens ----------------------------------------

// The two professor screens an event leads to, both taking it in the URL so
// neither has to be picked out of a list a second time. The same pair appears on
// the events screen and on the public schedule, where it is rendered only for a
// signed-in professor -- so it lives here rather than in either page.
//
// Only where the event takes registration: the drop screen loads events that
// take it or have a request waiting, and the printable list loads only the
// former, so for anything else both links would land on a page the event is not
// on.
//
// `explain` says what to do about that instead of saying nothing. It is for the
// editing screen, where turning registration on is one checkbox away. On the
// schedule there is nothing to act on, so the block is simply absent.
export function eventShortcuts(event, { prefix = '', explain = false } = {}) {
  if (!event.registration_open) {
    return explain
      ? el('p', { className: 'field-help',
          text: 'This event does not take registration, so it has nobody to drop '
              + 'and no list to print. Turn registration on above to get both.' })
      : null;
  }

  const id = encodeURIComponent(event.id);
  return el('nav', {
    className: 'event-shortcuts', 'aria-label': `${event.name} on other screens`
  }, [
    el('a', { className: 'button button-quiet',
      href: `${prefix}drops.html?event=${id}`, text: 'Drops and waiting list' }),
    el('a', { className: 'button button-quiet',
      href: `${prefix}print.html?event=${id}`, text: 'Player list to print' })
  ]);
}

// --- Badges -------------------------------------------------------------------

// One tile, used by the public player card and by the Trainer Card screen, so a
// badge looks the same wherever it is shown.
//
// The colour comes from the artwork: styles.css carries a fill and an edge per
// badge code, extracted from the image once rather than sampled in the browser
// on every load.
// Where a badge's artwork lives. A row that carries an image_path uses the
// uploaded file; the original thirteen carry none and fall back to the file
// committed beside the page. One code path, two sources, and no re-upload of
// artwork that already works.
// Readable text on any background somebody picks.
//
// A professor choosing a pill colour cannot be asked to also work out whether
// white or dark sits better on it, and a palette of swatches only helps until
// somebody sets a colour another way. So the page decides: whichever of white
// and ink has more contrast against the chosen background wins, by the same
// WCAG relative-luminance maths the palette was validated with.
const PILL_INK = '#23252a';

function relativeLuminance(hex) {
  const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = parts.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function readableOn(background) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(background || ''))) return null;
  return contrast(background, '#ffffff') >= contrast(background, PILL_INK)
    ? '#ffffff'
    : PILL_INK;
}

// The mark on a premier event card.
//
// A League Cup and a League Challenge are different sanctioned events and have
// their own official marks, so the card carries the right one rather than a
// single stand-in for both. is_premier is still what decides whether a card is
// marked at all; the type decides which mark.
//
// worlds.png remains the fallback. is_premier is set on exactly Cups and
// Challenges today, but it is a column somebody can tick, and a premier event
// that is neither should still read as one rather than silently losing its
// mark.
const PREMIER_MARKS = {
  challenge: { file: 'league-challenge.png', alt: 'Pokémon League Challenge' },
  cup: { file: 'league-cup.png', alt: 'Pokémon League Cup' }
};

export function premierMark(event, prefix = '') {
  if (!event.is_premier) return null;
  const mark = PREMIER_MARKS[event.event_type]
    || { file: 'worlds.png', alt: 'Premier event' };
  return { src: `${prefix}images/${mark.file}`, alt: mark.alt };
}

// Which game an event is for, as a chip for the badges row.
//
// Here and not in either page, for the reason premierMark() is here: the
// schedule and the event page both draw this row, and two copies would drift
// the first time one of them was touched.
//
// DRAWN, not typed. There are no web fonts on this site, so a card or gamepad
// character is whatever shape the reading font happens to carry -- and the UI
// takes no emoji, which is what a 🃏 would be. Inline SVG is the only way to
// put a shape on a page here and know what it will look like.
//
// Generic shapes on purpose: two overlapping cards, and a gamepad outline.
// Neither is anybody's mark, which keeps this clear of the rule about official
// Pokemon artwork -- that is supplied by the organiser and asked about first,
// and a symbol saying "this is the card game" needs none of it.
// OUTLINES, mostly, and that is not a style choice. These are drawn about
// sixteen pixels across inside a chip. Solid overlapping shapes at that size
// merge into one blob -- the first pair of filled cards came out as a smudge
// nobody could name -- so the back card is an outline and only the front one is
// solid, which is what makes two cards read as two. The gamepad is an outline
// for the same reason: filled, it is a pill.
const GAME_MARKS = {
  tcg: {
    label: 'Trading cards',
    // A card, tilted, with a second one solid in front of it.
    shapes: '<rect x="3.2" y="5" width="10.6" height="14.6" rx="2"'
          + ' transform="rotate(-16 8.5 12.3)"'
          + ' fill="none" stroke="currentColor" stroke-width="2"/>'
          + '<rect x="11" y="4" width="10.5" height="16" rx="2" fill="currentColor"/>'
  },
  vgc: {
    label: 'Video game',
    // A gamepad: the body, a d-pad on the left, two buttons on the right.
    shapes: '<rect x="2.4" y="7.4" width="19.2" height="10.4" rx="5.2"'
          + ' fill="none" stroke="currentColor" stroke-width="2"/>'
          + '<path d="M7.4 10.3v4.6M5.1 12.6h4.6" fill="none" stroke="currentColor"'
          + ' stroke-width="2" stroke-linecap="round"/>'
          + '<circle cx="16" cy="11.4" r="1.4" fill="currentColor"/>'
          + '<circle cx="18.6" cy="14" r="1.4" fill="currentColor"/>'
  }
};

export function gameMark(event) {
  const mark = GAME_MARKS[event && event.game];
  if (!mark) return null;

  // The word is in the chip beside the shape rather than left to it. A symbol
  // alone is a guess for anybody who has not been told what it means, and at
  // this size a card and a gamepad are two small rounded outlines. The shape is
  // hidden from a screen reader because the word beside it says the same thing
  // and twice is worse than once.
  const svg = el('span', {
    className: 'game-mark',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" focusable="false">${mark.shapes}</svg>`
  });

  return el('li', { className: `badge badge-game badge-game-${event.game}` }, [
    svg, el('span', { text: mark.label })
  ]);
}

export function badgeArtUrl(badge, prefix = '') {
  if (badge.image_path) {
    return `${SUPABASE_URL}/storage/v1/object/public/badge-art/${badge.image_path}`;
  }
  return `${prefix}images/badges/${badge.code}.png`;
}

// A prize wall item's picture, or null when it has none -- which is every item
// until a professor adds one. No fallback to a committed file, unlike a badge:
// no prize item has ever had artwork beside the page.
export function prizeArtUrl(item) {
  return item.image_path
    ? `${SUPABASE_URL}/storage/v1/object/public/prize-art/${item.image_path}`
    : null;
}

// A picture of a rental deck's list, or null when the list is given some other
// way -- which is most of them. Same arrangement as prize art: a public bucket,
// the row holding the path, and the URL built here rather than stored.
export function deckListImageUrl(deck) {
  return deck.deck_list_image_path
    ? `${SUPABASE_URL}/storage/v1/object/public/deck-lists/${deck.deck_list_image_path}`
    : null;
}

// One tile, used by the public player card and by the Trainer Card screen, so a
// badge looks the same wherever it is shown.
//
// Three layers: the colour taken from the artwork, the venue mark filling the
// tile behind, and the badge art on top. The backdrop is a background rather
// than an <img> so it cannot be mistaken for content by a screen reader.
// withName false leaves the label off, for somewhere the name is already beside
// the tile -- a table row whose first cell is the name. Repeating it would read
// twice to a screen reader and look like a mistake to everybody else.
export function badgeTile(badge, { earned, prefix = '', withName = true } = {}) {
  const tile = el('span', { className: 'badge-tile' },
    earned
      ? [el('img', {
          className: 'badge-art',
          src: badgeArtUrl(badge, prefix),
          alt: '',                       // the name is right below it
          loading: 'lazy', decoding: 'async'
        })]
      : []);
  if (earned) tile.classList.add('has-backdrop');

  const slot = el('span', {
    className: `badge-slot ${earned ? 'is-earned' : 'is-empty'}`
        + (withName ? '' : ' is-bare')
  }, [
    tile,
    withName ? el('span', { className: 'badge-name', text: badge.name }) : null
  ]);

  // Set from the row rather than from a class per badge code. A badge added by
  // a professor has no stylesheet entry and never could have: the colours are
  // worked out from the picture at upload.
  if (badge.tile_color) slot.style.setProperty('--tile', badge.tile_color);
  if (badge.tile_edge) slot.style.setProperty('--tile-edge', badge.tile_edge);

  return slot;
}

// Error messages say what happened and what to do about it.
export function problem(what) {
  return el('p', {
    className: 'notice notice-problem',
    role: 'status',
    text: `${what} could not be loaded. Check your connection and reload the page. `
        + 'If it still fails, tell a professor at league.'
  });
}
