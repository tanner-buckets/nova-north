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

// A YYYY-MM-DD key in league time, for grouping. Using the visitor's day would
// slide an 11:00 AM event onto a different date for someone reading abroad.
const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LEAGUE_TIME_ZONE
});

export function leagueDayKey(startsAt) {
  return DAY_KEY_FORMAT.format(new Date(startsAt));
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

// --- Badges -------------------------------------------------------------------

// One tile, used by the public player card and by the Trainer Card screen, so a
// badge looks the same wherever it is shown.
//
// The colour comes from the artwork: styles.css carries a fill and an edge per
// badge code, extracted from the image once rather than sampled in the browser
// on every load.
export function badgeTile(badge, { earned, prefix = '' } = {}) {
  // Three layers: the colour from the artwork, the venue mark filling the tile
  // behind, and the badge art on top. The backdrop is a background rather than
  // an <img> so it cannot be mistaken for content by a screen reader.
  const tile = el('span', { className: 'badge-tile' },
    earned
      ? [el('img', {
          className: 'badge-art',
          src: `${prefix}images/badges/${badge.code}.png`,
          alt: '',                       // the name is right below it
          loading: 'lazy', decoding: 'async'
        })]
      : []);
  if (earned) tile.classList.add('has-backdrop');

  return el('span', {
    // bdg-, not badge-: event types on the schedule already use .badge-<type>
    // and "prerelease" is both an event type and a badge code.
    className: `badge-slot bdg-${badge.code} ${earned ? 'is-earned' : 'is-empty'}`
  }, [
    tile,
    el('span', { className: 'badge-name', text: badge.name })
  ]);
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
