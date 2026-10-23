// Trainer Card Creator: choose players, check their ranks, print the cards.
//
// The output is a print stylesheet, not a generated file. No PDF library -- the
// sheet below is laid out at the real measurements of the template, Letter
// sized, eight to a page, and the professor saves it as a PDF from the browser's
// own print dialog. That is the same mechanism print.js uses.
//
// A card carries a full name and a birth year together, which nothing else on
// this site does. It is the player's own card, handed to the player, and this
// page is professor-only -- but the roster deliberately arrives without birth
// years, and only the chosen handful come back carrying one.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status, playerPicker } from './attendance-core.js';
// One copy of the card, shared with the printable information sheet. See
// trainer-card-art.js for why the measurements are what they are.
import { card, shortRank, badgeArtHref } from './trainer-card-art.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');

// The two seasons, and they are deliberately different.
//
// A card printed now is this season's card -- it is what a player carries
// through 2027 -- but what it SHOWS is what they earned in 2026, because that
// is the season that has been played. So the rank and the badge silhouettes
// come from 2026, while "who still needs a card" and the print log are 2027.
//
// Change these two numbers at the rollover. The database takes both as
// parameters precisely so that this pairing lives here, in one visible place,
// rather than being buried in a function nobody reads.
const BADGE_SEASON = 2026;
const CARD_SEASON = 2027;

// Used by the chosen-players table below. The card builds its own name from
// the same two columns; this one is about the roster, not the artwork.
function fullName(row) {
  return `${row.first_name || ''} ${row.last_name || ''}`.trim();
}

let professor = null;
let roster = [];               // every player, no birth years
let ranks = [];                // trainer_card_ranks, for the override dropdown
let championRanks = new Set(); // the names that earn a star
const chosen = new Map();      // player_id -> { ...roster row, rank_name }

// --- The sheet ---------------------------------------------------------------

// Eight to a page, and a page is a fixed box rather than something that flows:
// a card half on one sheet and half on the next is a wasted sheet of card stock.
function pages(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 8) {
    out.push(el('div', { className: 'card-page' },
      rows.slice(i, i + 8).map((row) =>
        card(row, { isChampion: championRanks.has(row.rank_name) }))));
  }
  return out;
}

// The background and every mask have to be decoded before the print dialog
// opens, or the first sheet comes out of the printer blank. Browsers do not
// wait for images when print() is called from script.
function artReady(urls) {
  return Promise.all([...new Set(urls)].map((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  })));
}

// --- Choosing ----------------------------------------------------------------

function add(row) {
  if (!chosen.has(row.player_id)) {
    chosen.set(row.player_id, { ...row });
  }
  drawChosen();
}

function addMany(rows) {
  for (const row of rows) {
    if (!chosen.has(row.player_id)) chosen.set(row.player_id, { ...row });
  }
  drawChosen();
}

function chosenRow(row) {
  const rank = el('select', { 'aria-label': `Rank for ${fullName(row)}` },
    ranks.map((r) => el('option', { value: r.name, text: shortRank(r.name) })));
  rank.value = row.rank_name || (ranks[0] && ranks[0].name) || '';
  rank.addEventListener('change', () => { row.rank_name = rank.value; });

  const drop = el('button', {
    type: 'button', className: 'link-button',
    text: 'Remove', 'aria-label': `Remove ${fullName(row)}`
  });
  drop.addEventListener('click', () => {
    chosen.delete(row.player_id);
    drawChosen();
  });

  return el('tr', {}, [
    el('td', {}, [el('span', { className: 'player-label', text: fullName(row) })]),
    el('td', {}, [el('span', { className: 'count', text: row.player_id })]),
    el('td', { className: 'tcard-badge-count',
               text: row.badge_count == null ? '' : String(row.badge_count) }),
    el('td', {}, [rank]),
    el('td', {}, [drop])
  ]);
}

let chosenHost = null;
let goButton = null;
let goNote = null;
let undoWrap = null;
let undoButton = null;
let activeButton = null;
let freshButton = null;

// The print run from the last press of Create the cards, so it can be undone
// without guessing which rows it was. Cleared once it has been undone, and
// whenever the list changes -- an undo button still sitting there after the
// list has moved on would undo something the professor is no longer looking at.
let lastBatch = null;

function drawChosen() {
  const rows = [...chosen.values()];
  const sheets = Math.ceil(rows.length / 8);

  chosenHost.replaceChildren(
    el('h3', { text: rows.length
      ? `${rows.length} card${rows.length === 1 ? '' : 's'}, ${sheets} `
        + `page${sheets === 1 ? '' : 's'}`
      : 'Nobody chosen yet' }),
    rows.length
      ? el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Name' }),
              el('th', { text: 'Player ID' }),
              el('th', { text: `${BADGE_SEASON} badges` }),
              el('th', { text: 'Rank on the card' }),
              el('th', { text: '' })
            ])]),
            el('tbody', {}, rows.map(chosenRow))
          ])
        ])
      : el('p', { className: 'muted-note',
          text: 'Use a button above, or search for somebody, to start a list.' })
  );

  goButton.disabled = rows.length === 0;
  if (!rows.length) status(goNote, '');
  forgetBatch();
}

// The undo offer belongs to one print run and one list. Change either and it
// stops being an undo and starts being a trap.
function forgetBatch() {
  lastBatch = null;
  if (undoWrap) undoWrap.hidden = true;
  if (undoButton) undoButton.disabled = false;
}

// --- Printing ----------------------------------------------------------------

async function createCards() {
  const ids = [...chosen.keys()];
  if (!ids.length) return;

  goButton.disabled = true;
  status(goNote, 'Getting the cards ready.');

  try {
    const { data, error } = await supabase.rpc('trainer_card_batch', {
      p_badge_season: BADGE_SEASON,
      p_player_ids: ids
    });
    if (error) throw error;

    // The professor may have overridden a rank on screen, so what was chosen
    // wins over what the season says. That is the whole point of the dropdown.
    const rows = (data || []).map((row) => ({
      ...row,
      rank_name: chosen.get(row.player_id)?.rank_name || row.rank_name
    }));

    sheet.replaceChildren(...pages(rows));
    sheet.classList.add('is-ready');

    const art = ['../images/trainer-card-front.png'];
    for (const row of rows) {
      for (const b of (row.badges || [])) art.push(badgeArtHref(b));
    }
    await artReady(art);

    // Logged here rather than after the dialog, because nothing tells this page
    // whether the print went ahead. The undo below is the other half of that
    // bargain: assume printed, and offer a way back when it was not.
    const { data: batch, error: logError } = await supabase
      .rpc('record_trainer_card_prints', {
        p_card_season: CARD_SEASON,
        p_player_ids: ids
      });
    if (logError) {
      console.warn('The print was not recorded:', logError.message);
    } else {
      lastBatch = batch;
      // Re-enabled as well as shown: it was disabled by the last undo, and a
      // new run deserves its own.
      undoButton.disabled = false;
      undoWrap.hidden = false;
    }

    goButton.disabled = false;
    status(goNote, `${rows.length} card${rows.length === 1 ? '' : 's'} ready, `
      + 'below. The print dialog is opening — choose Save as PDF for a file, and '
      + 'set Margins to None so the cards land where the template expects.', 'good');

    window.print();
    await refreshRoster();
  } catch (err) {
    console.error(err);
    goButton.disabled = false;
    status(goNote, `The cards could not be built: ${err.message || 'unknown error'}.`,
      'error');
  }
}

// Everyone on the run goes back on the list. The rows are voided rather than
// removed -- the press of the button did happen, it just did not produce a
// card -- so what this undoes is the claim that somebody is holding one.
async function undoPrint() {
  if (!lastBatch) return;

  undoButton.disabled = true;
  status(goNote, 'Putting them back on the list.');

  try {
    const { data, error } = await supabase.rpc('void_trainer_card_batch', {
      p_batch_id: lastBatch,
      p_reason: 'The cards were not printed.'
    });
    if (error) throw error;

    const n = Number(data) || 0;
    forgetBatch();
    await refreshRoster();
    drawChosen();

    status(goNote, n
      ? `${n} card${n === 1 ? '' : 's'} put back. Nobody on that run counts as `
        + 'holding one, so they are on the button above again.'
      : 'That run had already been put back. Nothing changed.', 'good');
  } catch (err) {
    console.error(err);
    undoButton.disabled = false;
    status(goNote, 'They could not be put back: '
      + `${err.message || 'unknown error'}. The cards still count as printed.`,
      'error');
  }
}

// --- Screen ------------------------------------------------------------------

async function refreshRoster() {
  const { data, error } = await supabase.rpc('trainer_card_roster', {
    p_badge_season: BADGE_SEASON,
    p_card_season: CARD_SEASON
  });
  if (error) throw error;
  roster = data || [];

  // Anybody already on the list keeps the rank the professor set, but their
  // badge count and card state are refreshed.
  for (const row of roster) {
    const picked = chosen.get(row.player_id);
    if (picked) Object.assign(picked, row, { rank_name: picked.rank_name });
  }
  refreshCounts();
  return roster;
}

function countsNote() {
  const active = roster.filter((r) => r.attended_recently);
  const fresh = active.filter((r) => !r.has_card);
  return { active, fresh };
}

// The two numbers on those buttons are the whole point of them, and printing
// moves both. They were drawn once at startup, so they went stale the moment
// anybody pressed Create the cards and stayed stale through an undo.
function refreshCounts() {
  if (!activeButton) return;
  const { active, fresh } = countsNote();
  activeButton.textContent = `Everyone active (${active.length})`;
  freshButton.textContent = `No ${CARD_SEASON} card yet (${fresh.length})`;
}

function draw() {
  const { active, fresh } = countsNote();

  activeButton = el('button', { type: 'button', className: 'button button-quiet',
    text: `Everyone active (${active.length})` });
  // The roster is re-read on every click rather than closed over, or the
  // button would keep handing out the list as it was when the page loaded.
  activeButton.addEventListener('click', () => addMany(countsNote().active));

  freshButton = el('button', { type: 'button', className: 'button button-quiet',
    text: `No ${CARD_SEASON} card yet (${fresh.length})` });
  freshButton.addEventListener('click', () => addMany(countsNote().fresh));

  const clear = el('button', { type: 'button', className: 'link-button',
    text: 'Start the list again' });
  clear.addEventListener('click', () => { chosen.clear(); drawChosen(); });

  const picker = playerPicker({
    label: 'Add somebody by Player ID or name',
    onPick(player) {
      const row = roster.find((r) => r.player_id === player.player_id);
      add(row || {
        player_id: player.player_id,
        first_name: player.first_name,
        last_name: player.last_name,
        rank_name: ranks[0] && ranks[0].name,
        badge_count: 0
      });
    }
  });

  chosenHost = el('div', {});
  goNote = el('p', { className: 'form-status', role: 'status' });
  goButton = el('button', { type: 'button', className: 'button',
    text: 'Create the cards' });
  goButton.addEventListener('click', createCards);

  // Hidden until there is a run to undo. It appears under the status line the
  // moment cards are made and goes again as soon as the list changes, so it
  // only ever refers to the run the professor is looking at.
  undoButton = el('button', { type: 'button', className: 'button button-quiet',
    text: 'The cards did not print' });
  undoButton.addEventListener('click', undoPrint);

  undoWrap = el('div', { className: 'undo-print' }, [
    el('p', {}, [undoButton]),
    el('p', { className: 'field-help',
      text: 'Press this if the print was cancelled, the printer jammed, or the '
          + 'cards came out wrong. Everyone on that run goes back onto the '
          + 'button above. The record that a print was attempted is kept.' })
  ]);
  undoWrap.hidden = true;

  app.replaceChildren(
    el('section', { className: 'panel' }, [
      el('h2', { text: 'Who gets a card' }),
      el('p', { className: 'field-help',
        text: `Rank and badges come from the ${BADGE_SEASON} season, which is the `
            + `one that has been played. The card itself counts as a `
            + `${CARD_SEASON} card.` }),
      el('p', { className: 'button-row' }, [activeButton, freshButton]),
      el('p', { className: 'field-help',
        text: 'Active means somebody with attendance in the last three months, '
            + 'the same window consent uses everywhere else on this site.' }),
      picker
    ]),

    el('section', { className: 'panel' }, [
      el('h2', { text: 'The list' }),
      chosenHost,
      el('p', { className: 'button-row' }, [goButton, clear]),
      el('p', { className: 'field-help',
        text: 'A card is counted as printed the moment the dialog opens, because '
            + 'nothing tells this page whether you went through with it. If it '
            + 'did not print, say so below and everyone goes back on the list.' }),
      goNote,
      undoWrap
    ])
  );

  drawChosen();
}

async function start() {
  professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  try {
    const rankResult = await supabase
      .from('trainer_card_ranks')
      .select('name, sort_order, requires_elite_four').order('sort_order');
    if (rankResult.error) throw rankResult.error;
    ranks = rankResult.data || [];
    // Champion is the rank that needs the Elite 4 beaten, which is a column
    // rather than a word. Matching on the name would break the star the day
    // somebody rewords the ladder.
    championRanks = new Set(
      ranks.filter((r) => r.requires_elite_four).map((r) => r.name));

    await refreshRoster();
    draw();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The Trainer Card Creator'));
  }
}

start();
