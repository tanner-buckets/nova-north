import { supabase, el, problem } from './supabase-client.js';
import { currentProfessor } from './auth.js';

const form = document.querySelector('#lookup-form');
const input = document.querySelector('#player-id');
const result = document.querySelector('#result');
const listHost = document.querySelector('#visible-players');

// Resolved once. The lookup and the browse list both need the answer, and asking
// twice is two round trips for one fact.
let professor = null;
const professorReady = currentProfessor().then((p) => { professor = p; return p; });

// Set once a professor is signed in, and read by the one submit handler rather
// than by a second listener racing the first: two listeners on the same form
// fire in registration order at the target, so a later one cannot pre-empt an
// earlier one and the plain ID lookup would always win.
let searchFilter = null;

const NOT_FOUND =
  'No public record for that Player ID. If it is yours, ask a professor to turn '
  + 'on visibility — it is off by default, and always off for players under 18 '
  + 'unless a parent has agreed.';

function stat(label, value, extra) {
  return el('div', { className: 'stat' }, [
    el('span', { className: 'stat-label', text: label }),
    el('span', { className: 'stat-value', text: value }),
    extra ? el('span', { className: 'stat-extra', text: extra }) : null
  ]);
}

function championStars(seasons) {
  if (!seasons.length) return null;
  const label = seasons.length === 1
    ? `League Champion, ${seasons[0]}`
    : `League Champion in ${seasons.length} seasons: ${seasons.join(', ')}`;

  return el('p', { className: 'champion-stars', 'aria-label': label }, [
    ...seasons.map((year) => el('span', { className: 'champion-star' }, [
      el('span', { className: 'star', 'aria-hidden': 'true', text: '★' }),
      el('span', { className: 'star-year', text: year })
    ]))
  ]);
}

// code -> position in this season's badge list, filled once on load. Colouring by
// position rather than by name means next season's badges are covered without
// anyone assigning them a colour.
const badgeOrder = new Map();

function chipClass(code) {
  const n = badgeOrder.has(code)
    ? badgeOrder.get(code)
    // Fallback for a badge not in the current season's list: a stable hash, so
    // the same badge always gets the same colour.
    : [...String(code)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return `badge-chip badge-c${n % 13}`;
}

function badgeList(summary) {
  const held = summary.badges || [];
  const available = summary.badges_available || 0;

  if (!available) {
    return el('p', { className: 'muted-note',
      text: 'No badge list has been set for this season yet.' });
  }

  return el('div', {}, [
    el('p', { className: 'badge-count' }, [
      el('span', { className: 'count', text: `${held.length} of ${available}` }),
      el('span', { text: ` badges earned in ${summary.season_year}` })
    ]),
    held.length
      ? el('ul', { className: 'badge-chips' },
          held.map((b) => el('li', { className: chipClass(b.code), text: b.name })))
      : el('p', { className: 'muted-note', text: 'No badges yet this season.' })
  ]);
}

function pastSeasons(summary) {
  // Only seasons other than the current one; the current season is shown above
  // in full, so repeating it here would just be noise.
  const past = (summary.badge_seasons || [])
    .filter((s) => s.season_year !== summary.season_year);
  if (!past.length) return null;

  return el('div', { className: 'past-seasons' }, [
    el('h3', { text: 'Previous seasons' }),
    el('ul', { className: 'season-list' },
      past.map((s) => el('li', {}, [
        el('span', { className: 'season-year count', text: s.season_year }),
        el('span', { text: `${s.rank} — ${s.badges_earned} badge`
          + (s.badges_earned === 1 ? '' : 's') })
      ])))
  ]);
}

// A professor looking somebody up is usually about to do one of three things.
// Each link carries the player, so none of the three screens has to be told who
// it is a second time.
export function adminLinks(playerId) {
  const id = encodeURIComponent(playerId);
  return el('nav', { className: 'admin-links', 'aria-label': 'Professor actions' }, [
    el('a', { href: `admin/points.html?id=${id}`, text: 'Prize points' }),
    el('a', { href: `admin/trainer-card.html?id=${id}`, text: 'Trainer Card' }),
    el('a', { href: `admin/consent.html?id=${id}`, text: 'Visibility and consent' })
  ]);
}

export function summaryCard(summary) {
  const champions = summary.champion_seasons || [];
  const elite = summary.elite_four_wins || 0;

  const loyalty = summary.release_name
    ? stat('Loyalty', `${summary.loyalty_weeks ?? 0} Sunday`
        + ((summary.loyalty_weeks === 1) ? '' : 's'),
        summary.tier_earned
          ? `${summary.tier_earned} tier reached, ${summary.release_name}`
          : `No tier yet, ${summary.release_name}`)
    : stat('Loyalty', 'Not counting', 'No release window is open');

  return el('section', { className: 'card summary', 'aria-label': 'Player summary' }, [
    el('h2', { className: 'summary-name', text: summary.display_label }),

    // Only ever present for a professor: a public caller receives nothing at all
    // for a player who is not visible, so this cannot appear to a player.
    summary.visible_publicly === false
      ? el('p', { className: 'not-public',
                  text: 'Not on the public site. Nobody has recorded consent for '
                      + 'this player, or it has lapsed.' })
      : null,

    professor ? adminLinks(summary.player_id) : null,

    championStars(champions),

    el('div', { className: 'stat-grid' }, [
      stat('Rank', summary.rank || 'League Trainer', `Season ${summary.season_year}`),
      stat('Prize points', summary.point_balance),
      loyalty,
      elite > 0 ? stat('Elite 4', `${elite} of 4`, 'battles won this season') : null
    ]),

    el('h3', { text: 'Badges' }),
    badgeList(summary),
    pastSeasons(summary)
  ]);
}

async function lookUp(playerId) {
  const id = String(playerId || '').trim();
  if (!id) return;

  if (!badgeOrder.size) await loadBadgeOrder();

  // Settled before the card is built, so the professor links are there on the
  // first render rather than appearing a moment later.
  await professorReady;

  result.replaceChildren(el('p', { className: 'notice', text: 'Looking that up.' }));

  try {
    const { data, error } = await supabase.rpc('get_player_summary', { p_player_id: id });
    if (error) throw error;

    if (!data) {
      result.replaceChildren(el('p', { className: 'notice notice-problem', text: NOT_FOUND }));
      return;
    }
    result.replaceChildren(summaryCard(data));
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    result.replaceChildren(problem('That player'));
  }
}

export async function loadBadgeOrder() {
  const { data, error } = await supabase
    .from('badges').select('code, sort_order, season_year')
    .order('season_year', { ascending: false }).order('sort_order');
  if (error || !data) return;
  const season = data.length ? data[0].season_year : null;
  data.filter((b) => b.season_year === season)
      .forEach((b, i) => badgeOrder.set(b.code, i));
}

// Guarded, so this module can be imported by a page that has no lookup form.
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value.trim();

    // A professor typing a name is the obvious thing to try, so it has to work.
    // Digits are always an ID lookup; a name that matches one player opens them,
    // and a name that matches several leaves the list filtered so they can pick.
    if (searchFilter && typed && !/^[0-9]+$/.test(typed)) {
      const shown = searchFilter(typed);
      if (shown.length === 1) {
        lookUp(shown[0].player_id);
        return;
      }
      result.replaceChildren(el('p', { className: 'notice',
        text: shown.length
          ? `${shown.length} players match. Pick one from the list.`
          : 'Nobody matches that name or ID.' }));
      return;
    }

    lookUp(input.value);
  });

  // A link can carry an ID, so a professor can hand someone a direct link.
  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) {
    input.value = fromUrl;
    lookUp(fromUrl);
  }
}

// The browse list, in two versions.
//
// For the public it is consent-gated: non-consented players are absent rather
// than anonymised, because this is a browse list rather than a set that has to
// be complete.
//
// For a signed-in professor it is everybody, with a name search. Consent decides
// what the public sees; it was never meant to decide what the people running the
// league can look up, and a professor who cannot find a player on the player
// page just goes and finds them on an admin screen anyway.

function playerButton(id, label, extra) {
  return el('li', {}, [
    el('button', { type: 'button', className: 'player-button', 'data-id': id }, [
      el('span', { className: 'player-label', text: label }),
      el('span', { className: 'player-id count', text: id }),
      extra || null
    ])
  ]);
}

async function professorList() {
  const { data, error } = await supabase
    .from('players')
    .select('player_id, first_name, last_name, show_player_id, show_name')
    .order('first_name');
  if (error) throw error;

  const rows = (data || []).map((p) => ({
    player_id: p.player_id,
    name: `${p.first_name} ${p.last_name}`.trim(),
    // Whether they are actually public also depends on recent attendance, which
    // this list does not ask about per player. The flag alone is enough to mark
    // the ones nobody has been asked about; the card says what is truly in force.
    recorded: p.show_player_id === true
  }));

  const listEl = el('ul', { className: 'player-list' });
  const count = el('p', { className: 'muted-note' });

  // No search box of its own. The page already has one field asking for a Player
  // ID, and two boxes doing the same job a few centimetres apart is the kind of
  // thing that makes a professor hesitate at the desk. The lookup field becomes
  // the search field instead.
  function draw(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const shown = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.player_id.includes(q))
      : rows;

    count.textContent = q
      ? `${shown.length} of ${rows.length} players match.`
      : `${rows.length} players. You are signed in, so you can see everybody.`;

    listEl.replaceChildren(...shown.map((r) => playerButton(
      r.player_id,
      r.name,
      r.recorded ? null : el('span', { className: 'tag tag-hidden', text: 'not public' })
    )));

    return shown;
  }

  draw('');
  listHost.replaceChildren(count, listEl);

  return draw;
}

function wireSearch(filter, signedIn) {
  searchFilter = filter;

  const label = document.querySelector('label[for="player-id"]');
  if (label) label.textContent = 'Player ID or name';
  input.placeholder = signedIn ? 'e.g. 1234567 or Maya' : 'e.g. 1234567 or Maya R.';
  input.removeAttribute('inputmode');
  input.removeAttribute('required');
  input.type = 'search';

  input.addEventListener('input', () => filter(input.value));
}

async function publicList() {
  const { data, error } = await supabase
    .from('public_players').select('*').order('display_label');
  if (error) throw error;

  if (!data.length) {
    listHost.replaceChildren(el('p', { className: 'notice notice-quiet',
      text: 'No players are listed yet. Visibility is off by default, and a '
          + 'professor turns it on only with the player’s consent, or a '
          + 'parent’s for anyone under 18.' }));
    return null;
  }

  const listEl = el('ul', { className: 'player-list' });
  const count = el('p', { className: 'muted-note' });

  // Searched on display_label, which is exactly what consent already decided:
  // a player whose name is public reads as "Maya R." and so can be found by
  // name, and one who consented only to their ID reads as the ID and can only
  // be found by that. Nothing here can match on a value the public may not see,
  // because there is no such value in this list to match against.
  function draw(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const shown = q
      ? data.filter((p) => p.display_label.toLowerCase().includes(q)
                        || p.player_id.includes(q))
      : data;

    count.textContent = q
      ? `${shown.length} of ${data.length} match.`
      : `${data.length} player` + (data.length === 1 ? '' : 's')
        + ' have chosen to be listed.';

    listEl.replaceChildren(...shown.map((p) =>
      playerButton(p.player_id, p.display_label)));

    return shown;
  }

  draw('');
  listHost.replaceChildren(count, listEl);

  return draw;
}

(async () => {
  if (!listHost) return;
  try {
    const signedIn = await professorReady;
    const filter = signedIn ? await professorList() : await publicList();

    // The public gets the same one field. It only ever searches what consent has
    // already made public, so a name finds somebody exactly when they agreed to
    // be found by name.
    if (filter) wireSearch(filter, signedIn);

    listHost.addEventListener('click', (e) => {
      const button = e.target.closest('.player-button');
      if (!button) return;
      input.value = button.dataset.id;
      lookUp(button.dataset.id);
    });
  } catch (err) {
    console.error(err);
    listHost.replaceChildren(problem('The player list'));
  } finally {
    listHost.removeAttribute('aria-busy');
  }
})();
