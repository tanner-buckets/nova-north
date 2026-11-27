// Badge progress: every player against one season's badges.
//
// The other professor screens ask about one player. This asks about one badge,
// or one threshold, across everybody -- who has earned Raid, who is on five
// badges, who is one short of the next rank. Before this the only way to find
// that out was to open the Trainer Card forty times.
//
// READ ONLY, deliberately. Every name links to that player's own Trainer Card,
// which is where a badge is given or taken back. A grid of three hundred rows
// where every cell is a button is a grid where a mis-tap awards a badge to the
// wrong child, and the undo for that is a conversation.
//
// One fetch, then every filter and sort runs in the page. A professor moving a
// threshold is re-asking the same question of the same rows, and a round trip
// per keystroke would make it feel broken. badge_board() is what refuses the
// data to anybody who is not a professor; this file only decides what to draw.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
// Ranks are stored as "League Cooltrainer" and this column is narrow, so the
// prefix comes off. Imported rather than rewritten: the Trainer Card already
// strips it the same way, and two copies of that rule would drift the day a
// rank is reworded. trainer-card-art.js runs nothing on import, unlike
// trainer-cards.js, which mounts the Creator.
import { shortRank } from './trainer-card-art.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let seasons = [];
let season = null;
let badges = [];        // every badge in the season, retired and secret included
let ranks = [];         // the ladder, lowest first, for the filter and the sort
let rows = [];          // one per player, from badge_board()

// What the professor is looking at. Columns and rows are separate questions:
// `shown` decides which badges have a column, `have` decides which players have
// a row. Ticking Raid and leaving `have` on everyone answers "where is everyone
// up to"; ticking Raid and asking for "has any" answers "who has earned Raid".
const view = {
  shown: new Set(),
  have: 'all-players',
  rank: '',              // '' is any; otherwise the stored rank name
  minDays: 0,
  minBadges: '',
  maxBadges: '',
  sort: 'badges-desc'
};

const label = (row) => `${row.first_name} ${row.last_name}`.trim() || row.player_id;

// Where a rank sits on the ladder, for sorting. Ranks carry sort_order, so this
// reads it rather than assuming the order they arrived in -- and a rank the
// ladder no longer holds sorts below everything rather than throwing.
const rankOrder = (name) => {
  const found = ranks.find((r) => r.name === name);
  return found ? found.sort_order : -1;
};

// --- Filtering and sorting -----------------------------------------------------

function visible() {
  const chosen = badges.filter((b) => view.shown.has(b.id)).map((b) => b.id);
  const min = view.minBadges === '' ? null : Number(view.minBadges);
  const max = view.maxBadges === '' ? null : Number(view.maxBadges);

  const kept = rows.filter((row) => {
    if (row.recent_days < view.minDays) return false;
    if (view.rank && row.rank_name !== view.rank) return false;
    if (min !== null && row.badge_count < min) return false;
    if (max !== null && row.badge_count > max) return false;

    if (chosen.length && view.have !== 'all-players') {
      const held = new Set(row.earned || []);
      const got = chosen.filter((id) => held.has(id)).length;
      if (view.have === 'has-all' && got !== chosen.length) return false;
      if (view.have === 'has-any' && got === 0) return false;
      if (view.have === 'missing-any' && got === chosen.length) return false;
    }
    return true;
  });

  const byName = (a, b) => label(a).localeCompare(label(b));
  const sorters = {
    'badges-desc': (a, b) => b.badge_count - a.badge_count || byName(a, b),
    'badges-asc': (a, b) => a.badge_count - b.badge_count || byName(a, b),
    // By the ladder and not by the name: alphabetical order would put Ace
    // Trainer above Champion.
    'rank-desc': (a, b) =>
      rankOrder(b.rank_name) - rankOrder(a.rank_name)
      || b.badge_count - a.badge_count || byName(a, b),
    'name': byName,
    'recent-desc': (a, b) => b.recent_days - a.recent_days || byName(a, b)
  };
  return kept.sort(sorters[view.sort] || sorters['badges-desc']);
}

// --- One cell --------------------------------------------------------------------

// Earned, part way through, or nothing. A badge with no steps has only the
// first and last of those.
//
// The mark is drawn in CSS rather than typed as a character: there are no web
// fonts here, so a tick glyph is whatever shape the reading font happens to
// carry, and the UI takes no emoji. The accessible name is a word either way,
// because a column of silent cells tells a screen reader nothing.
function cell(row, badge) {
  const held = (row.earned || []).includes(badge.id);
  if (held) {
    return el('td', { className: 'bp-cell is-earned' }, [
      el('span', { className: 'bp-mark', role: 'img',
        'aria-label': `${badge.name}: earned` })
    ]);
  }

  const done = badge.step_count ? Number((row.steps || {})[badge.id] || 0) : 0;
  if (badge.step_count && done > 0) {
    // Every step ticked and the badge still not given is the most actionable
    // cell on this page -- somebody did the work and nobody recorded it. It is
    // not an error, because the steps are a note and a professor may simply not
    // have handed it over yet, but it should not read the same as "one of
    // three".
    const all = done >= badge.step_count;
    return el('td', { className: 'bp-cell' + (all ? ' is-ready' : '') }, [
      el('span', {
        className: 'bp-steps' + (all ? ' is-ready' : ''),
        text: `${done} of ${badge.step_count}`,
        'aria-label': all
          ? `${badge.name}: all ${badge.step_count} steps done, badge not awarded`
          : `${badge.name}: ${done} of ${badge.step_count} steps`
      })
    ]);
  }

  // Nothing. A fraction reading "0 of 3" in every untouched cell is noise, and
  // the column heading already says how many steps the badge takes.
  return el('td', { className: 'bp-cell' }, [
    el('span', { className: 'bp-none', 'aria-label': `${badge.name}: not earned`,
      text: '—' })
  ]);
}

// --- The table ----------------------------------------------------------------------

function table(list) {
  const shown = badges.filter((b) => view.shown.has(b.id));

  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Player' }),
    // Rank and the count come before the badge columns, not after them. A table
    // with a column per badge is wide by nature, and a summary at the far right
    // is the first thing off the side of a phone -- the mistake the attendance
    // table made with Total. Rank leads because it is what a professor scans
    // for; the count behind it says how it was reached.
    el('th', { scope: 'col', text: 'Rank' }),
    el('th', { scope: 'col', className: 'bp-num', text: `Badges` }),
    el('th', { scope: 'col', className: 'bp-num', text: 'Days' }),
    // The spaces between these are written, not left to the layout. They are
    // adjacent boxes and the gap that separates them on screen is margin,
    // which is not in the text -- so without them this heading's accessible
    // name runs together as "Raid3 steps". The same trap the rental shelf hit
    // with "Standard decks3 decks".
    ...shown.map((b) => el('th', { scope: 'col', className: 'bp-badge-head' }, [
      el('span', { className: 'bp-badge-name', text: b.name }),
      b.step_count ? ' ' : null,
      b.step_count
        ? el('span', { className: 'bp-badge-note', text: `${b.step_count} steps` })
        : null,
      b.is_secret ? ' ' : null,
      b.is_secret ? el('span', { className: 'tag tag-secret', text: 'secret' }) : null,
      b.is_active ? null : ' ',
      b.is_active ? null : el('span', { className: 'tag tag-voided', text: 'retired' })
    ]))
  ]);

  const body = list.map((row) => el('tr', {}, [
    el('th', { scope: 'row', className: 'bp-player' }, [
      el('a', { href: `trainer-card.html?id=${encodeURIComponent(row.player_id)}`,
        text: label(row) }),
      el('span', { className: 'count', text: row.player_id })
    ]),
    el('td', { className: 'bp-rank' }, [
      // The full stored name is the title, because the column shows it with
      // "League " taken off and that is the name on the ranks table.
      el('span', { text: shortRank(row.rank_name) || '—',
        title: row.rank_name || '' })
    ]),
    el('td', { className: 'bp-num' }, [
      el('span', { className: 'bp-count', text: `${row.badge_count} of ${badges.length}` })
    ]),
    el('td', { className: 'bp-num', text: row.recent_days }),
    ...shown.map((b) => cell(row, b))
  ]));

  return el('div', { className: 'table-wrap' }, [
    el('table', { className: 'data-table bp-table' }, [
      el('thead', {}, [head]),
      el('tbody', {}, body)
    ])
  ]);
}

// --- The controls -------------------------------------------------------------------

function controls(onChange) {
  const seasonSelect = el('select', { id: 'bp-season' },
    seasons.map((s) => el('option', { value: s.season_year,
      text: `Season ${s.season_year} (${s.badge_count} badges)` })));
  seasonSelect.value = String(season);
  seasonSelect.addEventListener('change', async () => {
    season = Number(seasonSelect.value);
    await load();
    draw();
  });

  const boxes = badges.map((badge) => {
    const id = `bp-badge-${badge.id}`;
    const box = el('input', { type: 'checkbox', id });
    box.checked = view.shown.has(badge.id);
    box.addEventListener('change', () => {
      if (box.checked) view.shown.add(badge.id); else view.shown.delete(badge.id);
      onChange();
    });
    return el('span', { className: 'bp-pick' }, [
      box,
      el('label', { for: id }, [
        el('span', { text: badge.name }),
        badge.is_active ? null
          : el('span', { className: 'tag tag-voided', text: 'retired' }),
        badge.is_secret ? el('span', { className: 'tag tag-secret', text: 'secret' }) : null
      ])
    ]);
  });

  const all = el('button', { type: 'button', className: 'link-button', text: 'All' });
  const none = el('button', { type: 'button', className: 'link-button', text: 'None' });
  all.addEventListener('click', () => {
    badges.forEach((b) => view.shown.add(b.id));
    draw();
  });
  none.addEventListener('click', () => { view.shown.clear(); draw(); });

  const have = el('select', { id: 'bp-have' }, [
    el('option', { value: 'all-players', text: 'Everyone' }),
    el('option', { value: 'has-any', text: 'Who has any of the ticked badges' }),
    el('option', { value: 'has-all', text: 'Who has all of them' }),
    el('option', { value: 'missing-any', text: 'Who is missing any of them' })
  ]);
  have.value = view.have;
  have.addEventListener('change', () => { view.have = have.value; onChange(); });

  // Highest first, because that is the end of the ladder somebody is usually
  // asking about, and because the badge range below already answers the other
  // end. Every player has a rank -- player_rank() falls back to the entry rank
  // rather than returning null -- so there is no "no rank" to offer.
  const rank = el('select', { id: 'bp-rank' }, [
    el('option', { value: '', text: 'Any rank' }),
    ...[...ranks].sort((a, b) => b.sort_order - a.sort_order)
      .map((r) => el('option', { value: r.name, text: shortRank(r.name) }))
  ]);
  rank.value = view.rank;
  rank.addEventListener('change', () => { view.rank = rank.value; onChange(); });

  const days = el('input', { type: 'number', step: '1', min: '0', id: 'bp-days',
    value: String(view.minDays) });
  days.addEventListener('input', () => {
    view.minDays = Math.max(0, Number(days.value) || 0);
    onChange();
  });

  const minBadges = el('input', { type: 'number', step: '1', id: 'bp-min',
    value: view.minBadges });
  const maxBadges = el('input', { type: 'number', step: '1', id: 'bp-max',
    value: view.maxBadges });
  minBadges.addEventListener('input', () => { view.minBadges = minBadges.value.trim(); onChange(); });
  maxBadges.addEventListener('input', () => { view.maxBadges = maxBadges.value.trim(); onChange(); });

  const sort = el('select', { id: 'bp-sort' }, [
    el('option', { value: 'badges-desc', text: 'Most badges first' }),
    el('option', { value: 'badges-asc', text: 'Fewest badges first' }),
    el('option', { value: 'rank-desc', text: 'Highest rank first' }),
    el('option', { value: 'recent-desc', text: 'Here most recently' }),
    el('option', { value: 'name', text: 'By name' })
  ]);
  sort.value = view.sort;
  sort.addEventListener('change', () => { view.sort = sort.value; onChange(); });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'What to show' }),

    el('p', { className: 'field' }, [
      el('label', { for: seasonSelect.id, text: 'Season' }), seasonSelect
    ]),

    el('fieldset', { className: 'bp-badges' }, [
      el('legend', {}, [
        el('span', { text: 'Badges to show' }),
        el('span', { className: 'bp-pick-actions' }, [all, none])
      ]),
      el('div', { className: 'bp-pick-grid' }, boxes)
    ]),
    el('p', { className: 'field-help',
      text: 'These are the columns. The Badges count beside each name is the '
          + 'whole season either way, so it stays the number rank is judged on '
          + 'however few you tick.' }),

    el('p', { className: 'field' }, [
      el('label', { for: have.id, text: 'Rows to list' }), have
    ]),
    el('p', { className: 'field-help',
      text: 'Tick one badge and ask for “who has any” to read off who has '
          + 'earned it. “Missing any” is the list worth a word at the desk.' }),

    el('p', { className: 'field' }, [
      el('label', { for: rank.id, text: 'Rank' }), rank
    ]),
    el('p', { className: 'field-help',
      text: 'The rank this season’s badges give, which is not necessarily the '
          + 'one on their card: rank there is the best any season still being '
          + 'awarded gives, so a player part way into a new list keeps last '
          + 'season’s until this one overtakes it.' }),

    el('p', { className: 'field' }, [
      el('label', { for: days.id, text: 'Here at least this many days in the last three months' }),
      days
    ]),
    el('p', { className: 'field-help',
      text: 'Zero lists everybody on the books, including people who have not '
          + 'been in a long time. One is the same test consent uses.' }),

    el('p', { className: 'field field-inline bp-range' }, [
      el('label', { for: minBadges.id, text: 'Badges from' }), minBadges,
      el('label', { for: maxBadges.id, text: 'to' }), maxBadges
    ]),
    el('p', { className: 'field-help',
      text: 'Leave either empty for no limit. “From 2 to 2” is everybody sitting '
          + 'on exactly two.' }),

    el('p', { className: 'field' }, [
      el('label', { for: sort.id, text: 'Order' }), sort
    ])
  ]);
}

// --- Render ---------------------------------------------------------------------------

const board = el('div', { id: 'board' });

function draw() {
  const list = visible();
  const shownCount = badges.filter((b) => view.shown.has(b.id)).length;

  board.replaceChildren(
    controls(draw),
    el('section', { className: 'card' }, [
      el('h2', { text: 'Players' }),
      el('p', { className: 'count',
        text: `${list.length} of ${rows.length} players`
            + (shownCount ? `, ${shownCount} of ${badges.length} badges shown` : '') }),
      !badges.length
        ? el('p', { className: 'muted-note',
            text: 'That season has no badges, so there is nothing to track against it.' })
        : !list.length
          ? el('p', { className: 'muted-note',
              text: 'Nobody matches those filters. Widen one of them.' })
          : !shownCount
            ? el('div', {}, [
                el('p', { className: 'field-help',
                  text: 'No badge columns are ticked, so this is the count alone.' }),
                table(list)
              ])
            : table(list)
    ])
  );
}

async function load() {
  const [b, r] = await Promise.all([
    supabase.from('badges').select('*')
      .eq('season_year', season).order('sort_order'),
    supabase.rpc('badge_board', { p_season: season })
  ]);
  if (b.error) throw b.error;
  if (r.error) throw r.error;

  badges = b.data || [];
  rows = r.data || [];

  // Every badge ticked to begin with: the first question is usually "where is
  // everybody", and narrowing is easier than building a view up from nothing.
  view.shown = new Set(badges.map((x) => x.id));

  // The ladder is the same every season -- ranks carry no season_year -- but a
  // rank chosen for one season has to survive the move to another, and it does,
  // because it is matched on the stored name rather than on a position.
}

(async () => {
  const professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  try {
    const [seasonList, rankList] = await Promise.all([
      supabase.rpc('badge_seasons_all'),
      // Lowest first, the order a player climbs them, which is how the ranks
      // screen stores them. The filter reverses it for display.
      supabase.from('trainer_card_ranks').select('name, sort_order').order('sort_order')
    ]);
    if (seasonList.error || rankList.error) throw seasonList.error || rankList.error;
    seasons = seasonList.data || [];
    ranks = rankList.data || [];

    if (!seasons.length) {
      gate.replaceChildren(el('p', { className: 'notice notice-problem',
        text: 'No badges have been set up for any season yet, so there is '
            + 'nothing to track.' }));
      return;
    }

    const asked = Number(new URLSearchParams(location.search).get('season'));
    season = seasons.some((row) => row.season_year === asked)
      ? asked : seasons[0].season_year;

    await load();
  } catch (err) {
    console.error(err);
    gate.replaceChildren(problem('The badge board'));
    return;
  }

  app.replaceChildren(board);
  draw();
})();
