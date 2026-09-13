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

// Error messages say what happened and what to do about it.
export function problem(what) {
  return el('p', {
    className: 'notice notice-problem',
    role: 'status',
    text: `${what} could not be loaded. Check your connection and reload the page. `
        + 'If it still fails, tell a professor at league.'
  });
}
