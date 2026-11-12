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
import { printGuidelines } from './print-guidelines.js';
// The same card as a picture. It rasterises the DOM this screen already builds
// rather than drawing a second one -- see trainer-card-image.js.
import { cardImage, cardFileName, cardPixels, CARD_DPI }
  from './trainer-card-image.js';
import { zipStore } from './zip-store.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');
const calibration = document.querySelector('#calibration');

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

// How many Sundays in the last three months a player needs before the two
// source buttons count them as active. One is what the roster's old boolean
// meant, so that is the default and it changes nothing. Four is the ceiling
// because the window is roughly thirteen Sundays: past that the button starts
// refusing regulars who missed a fortnight, which is not what anybody meant by
// active. The window itself stays at three months -- it is the one consent
// uses, and active has to mean one thing across this site.
const RECENT_CHOICES = [1, 2, 3, 4];

let professor = null;
let recentDays = RECENT_CHOICES[0];
let promoteAces = false;       // print a qualifying Ace Trainer as a Champion
let roster = [];               // every player, no birth years
let ranks = [];                // trainer_card_ranks, for the override dropdown
let championRanks = new Set(); // the names that earn a star
let championRank = null;       // the rank that requires the Elite 4
let aceRank = null;            // the top rank reachable on badges alone
let eliteBadges = null;        // badges that qualify a challenge, from the table
const chosen = new Map();      // player_id -> { ...roster row, rank_name }

// --- Printing an Ace Trainer as a Champion -----------------------------------
//
// Eight badges is the condition an Ace Trainer meets on the way to Champion.
// The Elite 4 is run on a league day and the cards are printed the same
// afternoon, so the professor at the printer already knows who came through it
// -- and changing the rank one dropdown at a time, down a list of forty, is the
// long way round to saying so.
//
// It decides what is printed and nothing else. No rank is written anywhere:
// player_rank() still reads the badge ladder, the player's own page still says
// Ace Trainer, and the next print starts with the box unticked. Promoting
// somebody in the system is beating the Elite 4, which is not a checkbox.
//
// The number is read from the rank table, not typed. Eight is not a rank
// threshold -- badges_required is that, and it is six -- which is exactly why
// it has a column of its own, and a copy of it here would be the copy that
// goes stale.
function promotable(row) {
  return Boolean(championRank && aceRank && eliteBadges)
    && row.rank_name === aceRank.name
    && (row.badge_count || 0) >= eliteBadges;
}

// A rank set by hand wins over the box, the same way adding somebody by name
// ignores the attendance threshold: one is a decision about a person, the other
// a rule about a list. It is also the only way to leave one Ace Trainer out of
// a promotion that is right for everybody else on the sheet.
function promoted(row) {
  return promoteAces && !row.rank_set_by_hand && promotable(row);
}

// What the card will say, which is also what the dropdown in the list shows.
// One function for both, so the screen cannot promise a rank the sheet does
// not print.
function cardRank(row) {
  if (!row) return '';
  return promoted(row) ? championRank.name : row.rank_name;
}

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
  rank.value = cardRank(row) || (ranks[0] && ranks[0].name) || '';
  rank.addEventListener('change', () => {
    row.rank_name = rank.value;
    // Chosen by a person, so the box above stops deciding for this row.
    row.rank_set_by_hand = true;
    renderPromote();
    forgetImages();
  });

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
let promoteBox = null;
let promoteNote = null;
let imagesButton = null;
let imagesHost = null;

// The pictures from the last press of Make the images, with the object URL each
// one is being shown through. They are revoked when they go, because a few
// dozen megabytes of card held by a URL nothing points at is a leak that lasts
// as long as the tab does.
let made = [];

// The print run from the last press of Create the cards, so it can be undone
// without guessing which rows it was. Cleared once it has been undone, and
// whenever the list changes -- an undo button still sitting there after the
// list has moved on would undo something the professor is no longer looking at.
let lastBatch = null;

// The table alone. Ticking the Champion box redraws it through here rather
// than through drawChosen(), because the list has not changed -- only what will
// be printed on the cards in it -- and forgetting the last run there would take
// away an undo that still belongs to the run on screen.
function renderChosen() {
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
  if (imagesButton) imagesButton.disabled = rows.length === 0;
  if (!rows.length) status(goNote, '');
  renderPromote();
  // A picture is of a particular card. Change the list, or change what a card
  // says, and the gallery is a set of pictures of something else -- which is
  // worse than an empty gallery, because every one of them is a file somebody
  // might save for the player whose name is under it.
  forgetImages();
}

function drawChosen() {
  renderChosen();
  forgetBatch();
}

// The live half of the explanation. A professor who ticks the box and reads
// "3 cards on this list print as Champion" has been told what it did; a box
// that silently moved three dropdowns further down a long table has not.
function renderPromote() {
  if (!promoteNote) return;
  const n = [...chosen.values()].filter(promoted).length;
  promoteNote.textContent = !promoteAces ? ''
    : n
      ? `${n} card${n === 1 ? '' : 's'} on this list print`
        + `${n === 1 ? 's' : ''} as ${shortRank(championRank.name)}. Change one `
        + 'in the table above to leave that player out.'
      : 'Nobody on this list qualifies, so no card changes.';
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

    // The professor may have overridden a rank on screen, or ticked the box
    // that prints a qualifying Ace Trainer as a Champion, so what the list
    // showed wins over what the season says. That is the point of both.
    const rows = (data || []).map((row) => ({
      ...row,
      rank_name: cardRank(chosen.get(row.player_id)) || row.rank_name
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

// --- The same cards as pictures ----------------------------------------------
//
// A professor wanted to hand a card over without a printer in the room: paste
// one into a message, or take the lot away as a folder. The pictures are the
// printed card exactly -- same artwork, same measurements, same badges -- at
// 300dpi with the physical size written into the file, so one dropped into a
// document arrives card sized rather than eleven inches wide.
//
// Making them counts as issuing them, like opening the print dialog, and for
// the same reason: nothing tells this page what happened next, and the costly
// mistake is the one where a player who has a card is still on the list.

function forgetImages() {
  for (const item of made) URL.revokeObjectURL(item.url);
  made = [];
  if (imagesHost) imagesHost.replaceChildren();
}

function imageFigure(item) {
  const note = el('p', { className: 'form-status', role: 'status' });

  const copy = el('button', { type: 'button', className: 'button button-quiet',
    text: 'Copy' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': item.blob })
      ]);
      status(note, 'Copied. Paste it wherever it is going.', 'good');
    } catch {
      // Writing an image to the clipboard is the one thing here a browser may
      // simply refuse, and it refuses quietly. Say so and point at the two
      // ways that always work rather than leaving a button that did nothing.
      status(note, 'This browser would not copy a picture. Use Save, or copy '
        + 'the picture itself from its right-click menu.', 'error');
    }
  });

  const save = el('a', { className: 'button button-quiet', href: item.url,
    download: item.name, text: 'Save' });

  const { width, height } = cardPixels();
  return el('figure', { className: 'card-image' }, [
    // No alt: the caption underneath names the player, and a screen reader
    // reading it twice is the same noise a badge tile was given a blank alt to
    // avoid.
    el('img', { src: item.url, width, height, alt: '', decoding: 'async' }),
    el('figcaption', {}, [
      el('span', { className: 'player-label', text: fullName(item.row) }),
      el('span', { className: 'count', text: item.row.player_id })
    ]),
    el('p', { className: 'button-row' }, [copy, save]),
    note
  ]);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have taken the bytes, which it does
  // synchronously on the click in every browser this runs in; revoking
  // immediately is the one way to hand over an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function downloadZip(button) {
  button.disabled = true;
  try {
    const entries = await Promise.all(made.map(async (item) => ({
      name: item.name,
      data: new Uint8Array(await item.blob.arrayBuffer())
    })));
    downloadBlob(zipStore(entries), `loco-trainer-cards-${CARD_SEASON}.zip`);
  } catch (err) {
    console.error(err);
    status(goNote, `The zip could not be built: ${err.message || 'unknown error'}. `
      + 'The pictures can still be saved one at a time.', 'error');
  } finally {
    button.disabled = false;
  }
}

function drawImages() {
  if (!made.length) {
    imagesHost.replaceChildren();
    return;
  }

  const zip = el('button', { type: 'button', className: 'button',
    text: `Download all ${made.length} as a zip` });
  zip.addEventListener('click', () => downloadZip(zip));

  imagesHost.replaceChildren(
    el('h3', { text: `${made.length} picture${made.length === 1 ? '' : 's'}` }),
    el('p', { className: 'field-help',
      text: `Each one is the printed card exactly, at ${CARD_DPI} dots per inch `
          + 'with the card’s real size written into the file, so dropping '
          + 'one into a document gives a card rather than a poster.' }),
    el('p', { className: 'section-note',
      text: 'A card carries a full name and a birth year, and a picture is far '
          + 'easier to forward than a piece of card. Send one to the player it '
          + 'belongs to.' }),
    el('p', { className: 'button-row' }, [zip]),
    el('div', { className: 'card-images' }, made.map(imageFigure))
  );
}

async function makeImages() {
  const ids = [...chosen.keys()];
  if (!ids.length) return;

  imagesButton.disabled = true;
  goButton.disabled = true;
  status(goNote, 'Getting the cards ready.');

  try {
    const { data, error } = await supabase.rpc('trainer_card_batch', {
      p_badge_season: BADGE_SEASON,
      p_player_ids: ids
    });
    if (error) throw error;

    const rows = (data || []).map((row) => ({
      ...row,
      rank_name: cardRank(chosen.get(row.player_id)) || row.rank_name
    }));

    forgetImages();
    const items = [];
    for (const row of rows) {
      // Drawn one at a time rather than all at once: each one rasterises a
      // card carrying the background artwork, and forty of those in flight
      // together is a lot of memory for no gain on a single-threaded encode.
      status(goNote, `Drawing card ${items.length + 1} of ${rows.length}.`);
      const blob = await cardImage(row, {
        isChampion: championRanks.has(row.rank_name)
      });
      items.push({
        row, blob,
        url: URL.createObjectURL(blob),
        name: cardFileName(row, CARD_SEASON)
      });
    }
    made = items;
    drawImages();

    const { data: batch, error: logError } = await supabase
      .rpc('record_trainer_card_prints', {
        p_card_season: CARD_SEASON,
        p_player_ids: ids
      });
    if (logError) {
      console.warn('The pictures were not recorded:', logError.message);
    } else {
      lastBatch = batch;
      undoButton.disabled = false;
      undoWrap.hidden = false;
    }

    imagesButton.disabled = false;
    goButton.disabled = false;
    status(goNote, `${items.length} picture${items.length === 1 ? '' : 's'} `
      + 'below, and those players now count as holding a card. If they are not '
      + 'going out after all, say so below.', 'good');
    await refreshRoster();
  } catch (err) {
    console.error(err);
    imagesButton.disabled = false;
    goButton.disabled = false;
    status(goNote, 'The pictures could not be made: '
      + `${err.message || 'unknown error'}.`, 'error');
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
  // recent_days is distinct days inside the window, counted in SQL. Two events
  // on one Sunday is one day there, which is the league's own rule about a
  // loyalty week and the reason this is not a count of attendance rows.
  const active = roster.filter((r) => (r.recent_days || 0) >= recentDays);
  const fresh = active.filter((r) => !r.has_card);
  return { active, fresh };
}

// The two numbers on those buttons are the whole point of them, and printing
// moves both. They were drawn once at startup, so they went stale the moment
// anybody pressed Create the cards and stayed stale through an undo.
function refreshCounts() {
  renderResetCount();
  if (!activeButton) return;
  const { active, fresh } = countsNote();
  activeButton.textContent = `Everyone active (${active.length})`;
  freshButton.textContent = `No ${CARD_SEASON} card yet (${fresh.length})`;
}

// --- Starting a season over --------------------------------------------------
//
// Every card ever printed, put back on the list. It has been done twice as a
// migration -- 20261022120000 when the programme started over, and
// 20261031120000 when the artwork was redrawn and the print size was corrected
// -- and both times the instruction was the same: everybody needs a card
// again. A new season is the third time, and a deploy is the wrong tool for a
// decision a professor should be able to make at the desk.
//
// It is the one action on this screen with no undo. `void_trainer_card_batch`
// names a run; this has no run to name, so what puts a card back is printing
// it again. That is why it asks for the word rather than a click: a dialog is
// dismissed by the same reflex that opened it, and the typing is the pause.
let resetNote = null;
let resetCount = null;

// What pressing it would actually cost, said before it is pressed rather than
// after. The figure is the whole of what the button does.
function renderResetCount() {
  if (!resetCount) return;
  const held = roster.filter((r) => r.has_card).length;
  resetCount.textContent = held
    ? `${held} player${held === 1 ? '' : 's'} count as holding a ${CARD_SEASON}`
      + ' card right now.'
    : `Nobody counts as holding a ${CARD_SEASON} card, so this would change `
      + 'nothing.';
}

async function resetEveryCard(input, button) {
  button.disabled = true;
  status(resetNote, 'Putting every card back on the list.');

  try {
    const { data, error } = await supabase.rpc('void_all_trainer_card_prints', {
      p_reason: 'Reset from the Trainer Card Creator so every '
        + `${CARD_SEASON} card is reissued.`
    });
    if (error) throw error;

    const n = Number(data) || 0;
    await refreshRoster();
    // Every run is voided now, the one the undo names included, so that offer
    // would do nothing and would have to explain why.
    forgetBatch();

    status(resetNote, n
      ? `${n} card${n === 1 ? '' : 's'} put back. Everybody is on the `
        + `“No ${CARD_SEASON} card yet” button again.`
      : 'Nothing to put back: no card counted as held.', 'good');
  } catch (err) {
    console.error(err);
    status(resetNote, 'Nothing was reset: '
      + `${err.message || 'unknown error'}. Every card still counts as held.`,
      'error');
  } finally {
    // The word is typed again either way. A button left armed after a reset is
    // a second reset one stray click away.
    input.value = '';
    button.disabled = true;
  }
}

function resetPanel() {
  resetNote = el('p', { className: 'form-status', role: 'status' });
  resetCount = el('p', { className: 'field-help' });
  // Filled here as well as from refreshCounts(). The roster is read before the
  // screen is drawn, so the first refresh happens while this element does not
  // exist yet and the line would otherwise sit empty until something else
  // moved -- on a panel whose whole job is to say what the button would cost.
  renderResetCount();

  const input = el('input', { type: 'text', id: 'reset-confirm', size: '14',
    autocomplete: 'off', spellcheck: 'false' });
  const button = el('button', { type: 'submit', className: 'button button-danger',
    text: 'Reset every card' });
  button.disabled = true;

  const armed = () => input.value.trim().toLowerCase() === 'confirm';
  input.addEventListener('input', () => { button.disabled = !armed(); });

  const form = el('form', { className: 'card-reset', novalidate: '' }, [
    el('p', { className: 'field-help',
      text: 'This marks every Trainer Card ever printed as no longer held, so '
          + `everybody appears on the “No ${CARD_SEASON} card yet” `
          + 'button again. It is for the start of a season, or after the card '
          + 'artwork changes — the whole league is reissued.' }),
    resetCount,
    el('p', { className: 'field-help',
      text: 'Nothing is deleted. Every print is kept and marked as reset, so '
          + 'what was printed and when is still on the record. There is no '
          + 'single undo for this: putting one card back means printing it '
          + 'again.' }),
    el('p', { className: 'field' }, [
      el('label', { for: 'reset-confirm',
        text: 'Type confirm to turn the button on' }),
      input
    ]),
    el('p', { className: 'button-row' }, [button]),
    resetNote
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (armed()) resetEveryCard(input, button);
  });

  // Folded away. It belongs at the top, where somebody starting a season will
  // look for it, but it is used twice a year and a destructive button should
  // not be the first thing on a screen opened every week to print four cards.
  return el('section', { className: 'panel' }, [
    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Start a season: reset who has a card' }),
      el('div', { className: 'disclosure-body' }, [form])
    ])
  ]);
}

// The threshold is the only thing on this screen that changes what those two
// numbers mean, so it redraws them as it moves. A professor raising it from
// one to three and watching forty become nine has been told what the filter
// does without having to press anything.
function thresholdField() {
  const select = el('select', { id: 'recent-days' },
    RECENT_CHOICES.map((n) => el('option', {
      value: n, text: `${n} Sunday${n === 1 ? '' : 's'}` })));
  select.value = String(recentDays);
  select.addEventListener('change', () => {
    recentDays = Number(select.value) || RECENT_CHOICES[0];
    refreshCounts();
  });

  return el('p', { className: 'field' }, [
    el('label', { for: 'recent-days', text: 'Active means at least' }), select
  ]);
}

// --- The test sheet --------------------------------------------------------------
//
// Eight empty card boxes at exactly the positions real cards print at, each
// with a rounded rectangle the size of a credit card centred inside it.
//
// It exists because "the cards print at the wrong size" is not a thing a page
// can see. Nothing reports back what the printer did, and a card that is 94%
// of the right size still looks like a trainer card -- the only way to know is
// to put a ruler on it, and the only way to know what to blame is a sheet with
// nothing on it but the measurements.
//
// ID-1 is the card standard: 85.60 by 53.98 mm. In points, at 72 to the inch,
// that is 242.65 by 153.01 -- which is why it sits inside the 251.97 by 158.70
// card box with a little air around it rather than filling it.
const CREDIT_W = 242.65;
const CREDIT_H = 153.01;

// --- The printer correction --------------------------------------------------
//
// Some printers shrink every page they are sent, whatever the print dialog
// says. An Epson XP-330 printing straight from Chrome put the test rectangle
// at 83.2 mm instead of 85.6 -- about 97%, centred on the page -- with Scale at
// 100%, and Chrome's Scale set to 103 printed exactly the same sheet. So the
// dialog cannot undo it and the driver will not, which leaves the page:
// measure the test sheet, and the sheet is drawn that much bigger so the
// printer's shrink lands it on the right size.
//
// It is kept in this browser, not in the database. It belongs to a printer,
// and a professor at home and the same professor at the store are two
// printers. Browser storage can be missing or refuse, so every touch of it is
// guarded and the page simply prints at 100% without it.
const CORRECTION_KEY = 'loco.trainerCards.printCorrection';
const CREDIT_LONG_MM = 85.6;
const MM_PER_IN = 25.4;
// The sheet is scaled about the centre of the page, and the outermost card
// edge is 35.74pt from the side and 42pt from the top: past about 111% it
// would run off the paper. 90% is as far the other way as anything plausible.
// Anything outside this is a mismeasurement, not a printer.
const CORRECTION_MIN = 0.9;
const CORRECTION_MAX = 1.11;

let correction = readCorrection();

function readCorrection() {
  try {
    const value = Number(window.localStorage.getItem(CORRECTION_KEY));
    return value >= CORRECTION_MIN && value <= CORRECTION_MAX ? value : 1;
  } catch {
    return 1;
  }
}

function applyCorrection(value) {
  correction = value;
  // A custom property rather than an inline transform, so the print stylesheet
  // decides where it applies and the on-screen preview stays at its true size.
  document.documentElement.style.setProperty('--print-correction', String(value));
  try {
    if (value === 1) window.localStorage.removeItem(CORRECTION_KEY);
    else window.localStorage.setItem(CORRECTION_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// Accepts millimetres as a decimal, or inches as a decimal or a ruler reading
// like "3 5/16". Returns millimetres, or null for anything it cannot read.
function measuredMm(text, unit) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let value;
  const mixed = raw.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mixed) value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (fraction) value = Number(fraction[1]) / Number(fraction[2]);
  else if (/^\d*[.,]?\d+$/.test(raw)) value = Number(raw.replace(',', '.'));
  else return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit === 'in' ? value * MM_PER_IN : value;
}

// What the test sheet says about itself. A correction is measured on a sheet
// printed WITH the correction then in force, so the new one compounds the old
// -- and the only way to be sure which sheet is on the desk is for the sheet to
// say so.
function correctionLabel() {
  return correction === 1 ? 'Printed with no correction'
    : `Printed with a ${percent(correction)} correction`;
}

function calibrationCard() {
  return el('div', { className: 'cal-card' }, [
    el('div', { className: 'cal-credit' }, [
      // Printed inside the shape being measured, so whatever the professor
      // measures with, the target is on the paper next to it.
      el('span', { className: 'cal-mm', text: '85.6 \u00d7 54 mm' }),
      el('span', { className: 'cal-in', text: '3\u215c \u00d7 2\u215b in' }),
      el('span', { className: 'cal-note', text: correctionLabel() })
    ])
  ]);
}

function correctionField() {
  const statusLine = el('p', { className: 'form-status', role: 'status' });
  const describe = () => {
    statusLine.textContent = correction === 1
      ? 'No correction. Sheets print at their true size.'
      : `This browser enlarges every sheet by ${percent(correction)} to make up `
        + 'for the printer shrinking it.';
    reset.hidden = correction === 1;
  };

  const input = el('input', { id: 'cal-measured', type: 'text',
    inputmode: 'decimal', autocomplete: 'off', size: '8' });
  const unit = el('select', { id: 'cal-unit',
    'aria-label': 'Unit of the measurement' }, [
    el('option', { value: 'mm', text: 'mm' }),
    el('option', { value: 'in', text: 'inches' })
  ]);
  const save = el('button', { type: 'submit', className: 'button button-quiet',
    text: 'Correct for it' });
  const reset = el('button', { type: 'button', className: 'link-button',
    text: 'Remove the correction' });
  const problemLine = el('p', { className: 'form-status', role: 'alert' });

  const form = el('form', { className: 'cal-correct', novalidate: '' }, [
    el('h3', { text: 'If the test sheet is still the wrong size' }),
    el('p', { className: 'field-help',
      text: 'Some printers shrink every page whatever the print dialog says. '
          + 'Measure the long side of the rounded rectangle on a test sheet and '
          + 'enter it here, and every sheet from this browser is drawn that much '
          + 'bigger to make up for it. Millimetres are the more precise.' }),
    el('p', { className: 'field' }, [
      el('label', { for: 'cal-measured', text: 'The long side measured' }),
      el('span', { className: 'cal-input' }, [input, unit])
    ]),
    el('p', { className: 'button-row' }, [save, reset]),
    problemLine,
    statusLine,
    el('p', { className: 'field-help',
      text: 'Measure a sheet printed with the setting shown here: the sheet says '
          + 'on it which one it was printed with. This is kept in this browser '
          + 'only, because it belongs to the printer. Another computer, or '
          + 'another printer, needs its own test sheet.' })
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problemLine.textContent = '';
    const mm = measuredMm(input.value, unit.value);
    if (mm === null) {
      problemLine.textContent = 'That is not a measurement this can read. Enter '
        + 'a number, like 83.2 for millimetres or 3 5/16 for inches.';
      return;
    }
    const next = correction * (CREDIT_LONG_MM / mm);
    if (next < CORRECTION_MIN || next > CORRECTION_MAX) {
      problemLine.textContent = `That would scale the sheet to ${percent(next)}, `
        + 'which is further than any printer setting goes. Check it is the long '
        + 'side of the rounded rectangle, in the unit chosen, measured on a sheet '
        + `${correctionLabel().toLowerCase()}.`;
      return;
    }
    // Within a tenth of a millimetre of right is right: rounding the factor
    // keeps a second measurement of a good sheet from nudging it for nothing.
    const rounded = Math.abs(next - 1) < 0.0012 ? 1 : Math.round(next * 1000) / 1000;
    const kept = applyCorrection(rounded);
    input.value = '';
    describe();
    if (!kept) {
      problemLine.textContent = 'This browser would not save the setting, so it '
        + 'lasts until the page is closed. Print the cards before leaving it.';
    }
  });

  reset.addEventListener('click', () => {
    problemLine.textContent = '';
    applyCorrection(1);
    describe();
  });

  describe();
  return form;
}

function calibrationPage() {
  return el('div', { className: 'card-page cal-page' },
    Array.from({ length: 8 }, calibrationCard));
}

function showCalibration() {
  calibration.replaceChildren(
    el('div', { className: 'cal-explain no-print' }, [
      el('h3', { text: 'Test sheet' }),
      el('p', { text: 'Measure the rounded rectangle inside any '
        + 'box. It should be exactly the size of a credit card: 85.6 by 54 mm, '
        + 'or 3\u215c by 2\u215b inches. Hold a bank card against it \u2014 that '
        + 'is the quickest check there is.' }),
      el('p', { text: 'If it comes out smaller, the printer or the browser is '
        + 'scaling the page down. In the print dialog set Scale to 100% (not '
        + '\u201cFit to page\u201d), Margins to None, Paper to Letter, and turn '
        + 'headers and footers off. If it is still smaller with all of that '
        + 'right, enter what you measured under \u201cIf the test sheet is '
        + 'still the wrong size\u201d.' }),
      el('p', { className: 'field-help',
        text: 'Nothing is recorded by printing this, and no card is used up.' })
    ]),
    calibrationPage()
  );

  document.body.classList.add('is-calibrating');
  calibration.classList.add('is-ready');
  calibration.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Read a layout property before asking for the dialog. The page has just been
  // built, and printing into one the browser has not laid out yet is how a
  // sheet comes out blank -- reading offsetHeight forces that layout now,
  // synchronously. A requestAnimationFrame would do it too, right up until the
  // tab is not painting, at which point the callback never runs and the dialog
  // never opens. The preview stays on screen afterwards, so a cancelled dialog
  // can be printed again from the browser's own menu.
  void calibration.offsetHeight;
  window.print();
}

function hideCalibration() {
  document.body.classList.remove('is-calibrating');
  calibration.classList.remove('is-ready');
  calibration.replaceChildren();
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

  // Two of these, one beside the buttons that fill the list and one beside the
  // button that prints it. A professor who has just pressed "Everyone active"
  // and seen forty names wants to start over from where they are standing, not
  // from the bottom of the next panel. One handler, two buttons, because an
  // element cannot be in two places.
  const clearButton = () => {
    const button = el('button', { type: 'button', className: 'link-button',
      text: 'Start the list again' });
    button.addEventListener('click', () => { chosen.clear(); drawChosen(); });
    return button;
  };

  promoteBox = el('input', { type: 'checkbox', id: 'promote-aces' });
  promoteBox.addEventListener('change', () => {
    promoteAces = promoteBox.checked;
    renderChosen();
  });
  promoteNote = el('p', { className: 'form-status', role: 'status' });

  // Only where the rank table says what qualifies a challenge. Without that
  // number there is no question to ask, so the box is absent rather than
  // asking one with a blank in it.
  //
  // Both rank names are read rather than written, so the article in front of
  // them has to be worked out rather than typed -- the ladder has been
  // reworded once already, and "an Champion" is the sort of thing that
  // survives a rename unnoticed.
  const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
  const ace = aceRank ? shortRank(aceRank.name) : '';
  const champ = championRank ? shortRank(championRank.name) : '';
  const promoteField = eliteBadges && aceRank && championRank
    ? el('div', {}, [
        el('p', { className: 'field field-inline' }, [
          promoteBox,
          el('label', { for: 'promote-aces',
            text: `Print ${article(ace)} ${ace} with ${eliteBadges} or more `
                + `badges as ${article(champ)} ${champ}` })
        ]),
        el('p', { className: 'field-help',
          text: `${eliteBadges} badges is what lets ${article(ace)} ${ace} `
              + 'challenge the Elite 4, so this is for the afternoon it was '
              + 'run. It changes the cards being printed and nothing else: '
              + `the rank on the site is still ${ace} until the Elite 4 is `
              + 'actually beaten, and the box is off again the next time this '
              + 'page is opened.' }),
        promoteNote
      ])
    : null;

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

  imagesButton = el('button', { type: 'button', className: 'button button-quiet',
    text: 'Make the images' });
  imagesButton.addEventListener('click', makeImages);

  imagesHost = el('div', { className: 'card-image-wrap' });

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

  // One button. Building the sheet and then asking for it to be printed were
  // two presses for one intention, and the first of them put a page on screen
  // whose only purpose was to be printed.
  const calButton = el('button', { type: 'button', className: 'button',
    text: 'Print a test sheet' });
  calButton.addEventListener('click', showCalibration);

  const calHide = el('button', { type: 'button', className: 'link-button',
    text: 'Put it away' });
  calHide.addEventListener('click', hideCalibration);

  app.replaceChildren(
    resetPanel(),

    el('section', { className: 'panel' }, [
      el('h2', { text: 'Who gets a card' }),
      el('p', { className: 'field-help',
        text: `Rank and badges come from the ${BADGE_SEASON} season, which is the `
            + `one that has been played. The card itself counts as a `
            + `${CARD_SEASON} card.` }),
      thresholdField(),
      el('p', { className: 'field-help',
        text: 'Counted over the last three months, the same window consent uses '
            + 'everywhere else on this site. Roughly thirteen Sundays, so one '
            + 'means anybody who has been in at all and four means somebody who '
            + 'is actually around. A day is a day however many events were '
            + 'played on it.' }),
      el('p', { className: 'button-row' },
        [activeButton, freshButton, clearButton()]),
      el('p', { className: 'field-help',
        text: 'Both buttons follow the threshold. Adding somebody by name below '
            + 'ignores it, because that is a decision rather than a filter.' }),
      picker
    ]),

    el('section', { className: 'panel' }, [
      el('h2', { text: 'The list' }),
      chosenHost,
      promoteField,
      el('p', { className: 'button-row' },
        [goButton, imagesButton, clearButton()]),
      el('p', { className: 'field-help',
        text: 'Create the cards prints a sheet of eight. Make the images gives '
            + 'the same cards as pictures to copy, paste or take away as a zip '
            + '— for handing one over without a printer in the room.' }),
      el('p', { className: 'field-help',
        text: 'Either way a card counts as issued the moment you press the '
            + 'button, because nothing tells this page what happened next. If '
            + 'it did not go out, say so below and everyone goes back on the '
            + 'list.' }),
      goNote,
      undoWrap,
      imagesHost
    ]),

    el('section', { className: 'panel' }, [
      el('h2', { text: 'Printing at the right size' }),
      el('p', { className: 'field-help',
        text: 'A card is 251.97 by 158.70pt on a Letter page with no margin, and '
            + 'nothing tells this page what the printer actually did. If cards '
            + 'are coming out the wrong size, print a sheet with nothing on it '
            + 'but the measurements and hold a bank card against it.' }),
      el('p', { className: 'button-row' }, [calButton, calHide]),
      correctionField(),
      printGuidelines({ exact: true })
    ])
  );

  drawChosen();
}

async function start() {
  // Before anything is drawn, so a sheet printed from this visit carries it.
  applyCorrection(correction);
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
      .select('name, sort_order, requires_elite_four, elite_four_badges')
      .order('sort_order');
    if (rankResult.error) throw rankResult.error;
    ranks = rankResult.data || [];
    // Champion is the rank that needs the Elite 4 beaten, which is a column
    // rather than a word. Matching on the name would break the star the day
    // somebody rewords the ladder.
    championRanks = new Set(
      ranks.filter((r) => r.requires_elite_four).map((r) => r.name));
    championRank = ranks.find((r) => r.requires_elite_four) || null;
    // The rank the box promotes FROM is the top rung reachable on badges
    // alone: the last in sort order that does not need the Elite 4. Found by
    // the column for the same reason Champion is, since the ladder has already
    // been reworded once.
    const ladder = ranks.filter((r) => !r.requires_elite_four);
    aceRank = ladder[ladder.length - 1] || null;
    // Not max(badges_required). That is six, the Ace Trainer threshold, and
    // deriving this from it is the exact mistake the elite_four_badges column
    // was added to stop.
    eliteBadges =
      Math.max(0, ...ranks.map((r) => r.elite_four_badges || 0)) || null;

    await refreshRoster();
    draw();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The Trainer Card Creator'));
  }
}

start();
