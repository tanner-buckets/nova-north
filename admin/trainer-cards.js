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
  if (!activeButton) return;
  const { active, fresh } = countsNote();
  activeButton.textContent = `Everyone active (${active.length})`;
  freshButton.textContent = `No ${CARD_SEASON} card yet (${fresh.length})`;
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
      el('p', { className: 'button-row' }, [activeButton, freshButton]),
      el('p', { className: 'field-help',
        text: 'Both buttons follow the threshold. Adding somebody by name below '
            + 'ignores it, because that is a decision rather than a filter.' }),
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
