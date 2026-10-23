// The Trainer Card Program information sheet.
//
// It exists because the Word version went stale: that document still said four
// badges for Cooltrainer and eight for Ace Trainer months after the ladder was
// shortened to three and six. A handout that repeats the rules is a second copy
// of them, and the second copy is the one nobody updates. This reads
// trainer_card_ranks and badges every time it draws.
import { supabase, el, badgeArtUrl } from '../supabase-client.js';
import { card } from './trainer-card-art.js';

export const NAME = 'Trainer Card Program information sheet';

let seasons = [];
let season = null;
let ranks = [];
let badges = [];

// --- Loading ------------------------------------------------------------------

async function loadSeasons() {
  // Which seasons are still being awarded, newest first. A retired season can
  // still be printed -- last year's sheet is a real thing somebody may want --
  // so the picker offers every season that has badges, not only the live ones.
  const { data, error } = await supabase
    .from('badges').select('season_year').order('season_year', { ascending: false });
  if (error) throw error;
  seasons = [...new Set((data || []).map((r) => r.season_year))];
  if (season === null) season = seasons[0] ?? null;
}

async function load() {
  const [rankRes, badgeRes] = await Promise.all([
    supabase.from('trainer_card_ranks').select('*').order('sort_order'),
    // Secret badges are deliberately absent. One kept off the programs page so
    // that nothing hints it exists would be announced by a handout listing it,
    // which is the whole of what secret means.
    supabase.from('badges').select('*')
      .eq('season_year', season).eq('is_active', true).eq('is_secret', false)
      .order('sort_order')
  ]);
  if (rankRes.error) throw rankRes.error;
  if (badgeRes.error) throw badgeRes.error;

  ranks = rankRes.data || [];
  badges = badgeRes.data || [];
}

// --- The specimen card ---------------------------------------------------------

// A card with nobody on it. It shows what a player is being handed rather than
// a particular player's: no badges, because a new Trainer has none, and an
// invented name and ID so that no real child's details are printed on a sheet
// that gets left on a table.
//
// Drawn by the same card() the Creator prints, so it cannot drift into showing
// a card the printer would never produce.
function specimenCard() {
  return el('div', { className: 'info-specimen' }, [
    card({
      first_name: 'Trainer',
      last_name: 'N',
      player_id: '00002',
      birth_year: 1992,
      rank_name: 'League Trainer',
      badges: []
    }),
    el('p', { className: 'info-specimen-note', text: 'Your card. Badges fill the ring as you earn them.' })
  ]);
}

// --- The sheet -----------------------------------------------------------------

// The badge threshold that opens the Elite 4, taken from the ladder rather than
// written here. It is the largest badges_required on any rank: the top rung you
// can reach on badges alone, which is exactly what qualifies a Champion
// attempt. Written as a number in this file it would be the fourth copy of a
// figure that has already changed once.
function eliteThreshold() {
  const counts = ranks.map((r) => r.badges_required || 0);
  return counts.length ? Math.max(...counts) : null;
}

function rankTable() {
  return el('table', { className: 'info-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Rank' }),
        el('th', { scope: 'col', text: 'Qualification' }),
        el('th', { scope: 'col', text: 'Reward' }),
        el('th', { scope: 'col', text: 'Benefit' })
      ])
    ]),
    el('tbody', {}, ranks.map((r) => el('tr', {}, [
      el('th', { scope: 'row', text: r.name }),
      el('td', { text: r.qualification || '' }),
      // The Word version typed "N/A" into the empty cells. A dash is quieter
      // and says the same thing.
      el('td', { text: r.reward || '—' }),
      el('td', { text: r.benefit || '—' })
    ])))
  ]);
}

// Two badges to a row, which is how the Word version laid them out and how a
// list of thirteen fits on one page. The picture goes first here rather than
// last: on the programs page the name is what somebody reads down the list for,
// but this is the sheet that teaches what the badges look like.
function badgeTable() {
  const rows = [];
  for (let i = 0; i < badges.length; i += 2) {
    rows.push(badges.slice(i, i + 2));
  }

  const cell = (b) => [
    el('td', { className: 'info-badge-art' }, [
      b ? el('img', {
        src: badgeArtUrl(b, '../'), alt: '', width: '48', height: '48',
        loading: 'eager', decoding: 'async'
      }) : null
    ]),
    el('th', { scope: 'row', className: 'info-badge-name', text: b ? b.name : '' }),
    el('td', { className: 'info-badge-task', text: b ? b.task : '' })
  ];

  return el('table', { className: 'info-table info-badges' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', colspan: '2', text: 'Badge' }),
        el('th', { scope: 'col', text: 'Task' }),
        el('th', { scope: 'col', colspan: '2', text: 'Badge' }),
        el('th', { scope: 'col', text: 'Task' })
      ])
    ]),
    el('tbody', {}, rows.map((pair) =>
      el('tr', {}, [...cell(pair[0]), ...cell(pair[1] || null)])))
  ]);
}

function drawSheet(sheet) {
  const threshold = eliteThreshold();
  const champion = ranks.find((r) => r.requires_elite_four);

  sheet.replaceChildren(
    el('div', { className: 'info-page' }, [
      el('header', { className: 'info-head' }, [
        el('div', {}, [
          el('h2', { className: 'info-title', text: 'Trainer Card Program' }),
          el('p', { className: 'info-subtitle', text: 'Information Sheet' }),
          el('p', { className: 'info-season', text: `${season} season` })
        ]),
        specimenCard()
      ]),

      el('section', { className: 'info-section' }, [
        el('h3', { text: 'What is the Trainer Card Program?' }),
        el('p', { text: 'The Trainer Card Program is a way for you to expand '
          + 'your skills as a Pokémon Trainer and prove your expertise by '
          + 'improving your rank and eventually becoming a League Champion.' })
      ]),

      el('section', { className: 'info-section' }, [
        el('h3', { text: 'Ranks? What ranks?' }),
        el('p', { text: `There are ${ranks.length} ranks in the Trainer Card `
          + 'Program and each gives you a different bonus or benefit for the '
          + 'achievement.' }),
        rankTable()
      ]),

      el('section', { className: 'info-section' }, [
        el('h3', { text: 'Badges? How can I earn Badges?' }),
        el('p', { text: `It depends. There are ${badges.length} Badges you can `
          + `earn this season`
          + (threshold
              ? `, and you only need ${threshold} to be eligible to `
                + `challenge the Elite 4 and become one of our League Champions.`
              : '.') }),
        badgeTable()
      ]),

      el('footer', { className: 'info-foot' }, [
        el('p', { text: 'Ask any professor to get started. '
          + 'LoCo League meets Sundays at Continental Cards, Ashburn — '
          + 'sign-in opens at 2:00 PM and play begins at 2:30 PM.' })
      ])
    ])
  );
}


// --- What the shell asks for ---------------------------------------------------

export async function mount(app, sheet) {
  await loadSeasons();
  if (season === null) {
    app.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'No badges exist yet, so there is nothing to print. Add them under '
          + 'Reference data.' }));
    return false;
  }
  await load();

  const picker = el('select', { id: 'season' },
    seasons.map((y) => el('option', { value: String(y), text: `${y} season` })));
  picker.value = String(season);
  picker.addEventListener('change', async () => {
    season = Number(picker.value);
    await load();
    drawSheet(sheet);
  });

  const go = el('button', { type: 'button', className: 'button', text: 'Print this sheet' });
  go.addEventListener('click', () => window.print());

  app.replaceChildren(...[
    el('section', { className: 'card' }, [
      el('h2', { text: NAME }),
      el('p', { className: 'field-help',
        text: 'One page for players: what the ranks are, what they earn, and every '
            + 'badge with the task that earns it. Built from the ranks and badges '
            + 'as they stand right now, so it cannot say four badges when the '
            + 'ladder says three.' }),
      seasons.length > 1
        ? el('p', { className: 'field' }, [
            el('label', { for: 'season', text: 'Season' }), picker,
            el('span', { className: 'field-help',
              text: 'Badges belong to a season. The ranks are the same for all of them.' })
          ])
        : null,
      el('p', {}, [go]),
      el('p', { className: 'field-help',
        text: 'Print in colour, and turn on background graphics if the card in the '
            + 'corner comes out blank — that is the browser refusing to print the '
            + 'card artwork, not a fault on the sheet.' })
    ]),
    badges.length
      ? null
      : el('p', { className: 'notice notice-problem',
          text: `No badges are recorded for ${season}, so the sheet would print `
              + 'with an empty table. Add them under Reference data first.' })
  ].filter(Boolean));

  drawSheet(sheet);
  return true;
}
