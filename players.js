import { supabase, el, problem } from './supabase-client.js';

const form = document.querySelector('#lookup-form');
const input = document.querySelector('#player-id');
const result = document.querySelector('#result');
const listHost = document.querySelector('#visible-players');

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
    lookUp(input.value);
  });

  // A link can carry an ID, so a professor can hand someone a direct link.
  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) {
    input.value = fromUrl;
    lookUp(fromUrl);
  }
}

// The browse list. Only players whose visibility is in force appear here at all
// -- non-consented players are absent rather than anonymised, because this is a
// browse list rather than a set that has to be complete.
(async () => {
  if (!listHost) return;
  try {
    const { data, error } = await supabase
      .from('public_players').select('*').order('display_label');
    if (error) throw error;

    if (!data.length) {
      listHost.replaceChildren(el('p', { className: 'notice notice-quiet',
        text: 'No players are listed yet. Visibility is off by default, and a '
            + 'professor turns it on only with the player’s consent, or a '
            + 'parent’s for anyone under 18.' }));
      return;
    }

    listHost.replaceChildren(
      el('p', { className: 'muted-note',
        text: `${data.length} player` + (data.length === 1 ? '' : 's')
            + ' have chosen to be listed.' }),
      el('ul', { className: 'player-list' }, data.map((p) =>
        el('li', {}, [
          el('button', {
            type: 'button', className: 'player-button', 'data-id': p.player_id
          }, [
            el('span', { className: 'player-label', text: p.display_label }),
            el('span', { className: 'player-id count', text: p.player_id })
          ])
        ])))
    );

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
