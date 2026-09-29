// TDF upload: the usual way attendance gets recorded, and the main way new
// players enter the system.
//
// The file is read here in the browser and thrown away. It is never uploaded and
// never stored. The birth year is kept, because it is what gives a new player a
// division; the month and day are dropped inside the parser rather than carried
// and trimmed later, so a full date of birth never reaches a variable this code
// could write.
//
// Appearing in a tournament file is not consent. Nothing here touches a
// visibility flag, so a player added from a file starts hidden and stays hidden
// until a professor records consent on the visibility screen.
//
// The writing itself lives in attendance-core.js, shared with manual entry.
import { supabase, el } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import {
  ATTEND_LABEL, CASUAL_LABEL, PREMIER_LABEL,
  loadActions, actionField, status, playerPicker, recordAttendance, outcomeNodes,
  describeFailure, alreadyPaidFor, otherAttendeesField
} from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let parsed = null;      // { eventName, attendedOn, players: [...] }
let known = new Set();  // player_ids already in the players table
let extras = [];        // attendees added by hand
let actions = [];       // earning_actions rows
let alreadyPaid = new Set();   // already have the play point for this tournament
let judges = [];        // professors with a player record of their own
let judgesError = false;

// --- Parsing -----------------------------------------------------------------

// The year, and nothing else. The month and day are discarded here, at the only
// point in the program where they exist, so no later change can start storing
// them by accident. An unreadable date gives null, which reads as a minor until
// a professor records one.
function birthYear(text) {
  const m = String(text || '').trim().match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
  return m ? Number(m[1]) : null;
}

function parseTdf(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('That file could not be read as XML. Export it again from TOM.');
  }

  const data = doc.querySelector('tournament > data');
  const eventName = data?.querySelector('name')?.textContent?.trim() || 'Untitled event';
  const startdate = data?.querySelector('startdate')?.textContent?.trim() || '';

  // The file writes MM/DD/YYYY. The database wants a plain calendar day.
  const m = startdate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const attendedOn = m
    ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    : null;

  // Scoped to the players block on purpose: the standings block repeats the same
  // tag and would otherwise be counted as a second roster.
  const players = [...doc.querySelectorAll('tournament > players > player')]
    .map((p) => ({
      player_id: (p.getAttribute('userid') || '').trim(),
      first_name: p.querySelector('firstname')?.textContent?.trim() || '',
      last_name: p.querySelector('lastname')?.textContent?.trim() || '',
      birth_year: birthYear(p.querySelector('birthdate')?.textContent),
      // In the file means they played. Anyone added by hand later is not.
      played: true
    }))
    .filter((p) => p.player_id);

  return { eventName, attendedOn, players };
}

// --- Helpers -----------------------------------------------------------------

function playReason() {
  return `Played in ${parsed.eventName}`;
}

function allAttendees() {
  const seen = new Set();
  return [...parsed.players, ...extras].filter((p) => {
    if (seen.has(p.player_id)) return false;
    seen.add(p.player_id);
    return true;
  });
}

async function refreshKnown() {
  const ids = allAttendees().map((p) => p.player_id);
  if (!ids.length) { known = new Set(); return; }
  const { data, error } = await supabase
    .from('players').select('player_id').in('player_id', ids);
  if (error) throw error;
  known = new Set(data.map((r) => r.player_id));
}

// The professors who are also players. Read from the professors table rather
// than written into this file: who judges changes, and a list in page code would
// be wrong the first time somebody joined or left.
async function loadJudges() {
  const { data: profs, error } = await supabase
    .from('professors').select('display_name, player_id')
    .not('player_id', 'is', null);
  if (error) throw error;

  const ids = (profs || []).map((r) => r.player_id);
  if (!ids.length) return [];

  // Names come from players, not from display_name, because that is what goes
  // into the attendee list beside everybody else.
  const { data: rows, error: playerError } = await supabase
    .from('players').select('player_id, first_name, last_name').in('player_id', ids);
  if (playerError) throw playerError;

  return (rows || []).sort((a, b) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
}

// --- Rendering ---------------------------------------------------------------

function attendeeList() {
  return el('div', {}, [
    el('h3', { text: 'Attendees' }),
    el('ul', { className: 'player-list attendee-list' }, allAttendees().map((p) =>
      el('li', { className: 'attendee' }, [
        el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}`.trim() }),
        el('span', { className: 'player-id count', text: p.player_id }),
        known.has(p.player_id) ? null : el('span', { className: 'tag tag-new', text: 'new' }),
        p.judged ? el('span', { className: 'tag tag-added', text: 'judged' })
          : p.added ? el('span', { className: 'tag tag-added', text: 'added by hand' }) : null
      ])))
  ]);
}

function add(player, note) {
  if (allAttendees().some((p) => p.player_id === player.player_id)) {
    status(note, `${player.first_name} is already on the list.`);
    return;
  }
  // No `played` flag: someone remembered at the desk turned up, which is not the
  // same as having been in the tournament.
  extras.push({ ...player, added: true });

  // Someone picked from the search already exists, so they must go into `known`
  // or the write below will try to create them again and collide with their own
  // row. Only a player entered as new is left out, which is what asks for them
  // to be created.
  if (!player.isNew) known.add(player.player_id);

  redraw();
  status(note, `Added ${player.first_name}.`, 'good');
}

// Three steps, in the order a professor works: read the file, remember anyone
// it missed, then record.
function rosterCard() {
  const attendees = allAttendees();
  const unknown = attendees.filter((p) => !known.has(p.player_id));

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Check the file' }),
    el('dl', { className: 'summary-list' }, [
      el('dt', { text: 'Event in the file' }), el('dd', { text: parsed.eventName }),
      el('dt', { text: 'Attendees' }),
      el('dd', { text: `${attendees.length} — ${attendees.length - unknown.length} known, `
        + `${unknown.length} new` })
    ]),
    attendeeList()
  ]);
}

// The judges, as a fixed list of boxes rather than four more searches. A judge
// is at every event by definition, so asking by name every week is asking a
// professor to retype what the site already knows.
//
// A judge earns what anybody added by hand earns: the loyalty week and the point
// for attending, and no play award. Judging is not playing, and the file is the
// claim that somebody played.
export function judgesCard() {
  const note = el('p', { className: 'form-status', role: 'status' });

  if (judgesError) {
    return el('section', { className: 'card' }, [
      el('h2', { text: 'Which judges were here?' }),
      el('p', { className: 'form-status is-error',
        text: 'The list of judges could not be loaded. Add them by name below '
            + 'instead, in Was anyone else here.' })
    ]);
  }

  if (!judges.length) {
    return el('section', { className: 'card' }, [
      el('h2', { text: 'Which judges were here?' }),
      el('p', { className: 'muted-note',
        text: 'No professor has a player record linked yet, so there is nobody '
            + 'to tick. Add anyone who judged by name below.' })
    ]);
  }

  const boxes = judges.map((judge) => {
    // Somebody who played in the tournament is already counted, and cannot be
    // taken off the list by unticking a box here.
    const inFile = parsed.players.some((p) => p.player_id === judge.player_id);
    const added = extras.some((p) => p.player_id === judge.player_id);

    const box = el('input', { type: 'checkbox', id: `judge-${judge.player_id}` });
    box.checked = inFile || added;
    box.disabled = inFile;

    box.addEventListener('change', () => {
      if (box.checked) {
        extras.push({ ...judge, added: true, judged: true });
        known.add(judge.player_id);
        status(note, `${judge.first_name} added.`, 'good');
      } else {
        extras = extras.filter((p) => p.player_id !== judge.player_id);
        status(note, `${judge.first_name} taken off.`);
      }
      redraw();
      // redraw replaces the whole screen, so the box that was just clicked has
      // to be found again or a professor working by keyboard loses their place.
      document.getElementById(box.id)?.focus();
    });

    return el('li', {}, [
      el('span', { className: 'field field-inline' }, [
        box,
        el('label', { for: box.id,
          text: `${judge.first_name} ${judge.last_name}`.trim() })
      ]),
      inFile ? el('span', { className: 'tag tag-added', text: 'in the file' }) : null
    ]);
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Which judges were here?' }),
    el('p', { text: 'A judge earns the day like anyone who turned up: the '
      + 'loyalty week and the point for attending. Not the play award, because '
      + 'judging is not playing.' }),
    el('ul', { className: 'judge-list' }, boxes),
    note
  ]);
}

// Set by the local demo so the judges panel can be rendered and clicked without
// a session and without a tournament file.
export function _setUpload(j, p, e) {
  judges = j; parsed = p; extras = e || [];
  judgesError = false;
}

// A step of its own, open, between the roster and the button. It was a collapsed
// accordion, which is the same as not asking: a professor working through a
// queue closes the file and never sees it. Anyone who turned up without entering
// the tournament earns the same loyalty week as everybody else, and this is the
// only moment somebody is standing there to be remembered.
function othersCard() {
  return el('section', { className: 'card' }, [
    el('h2', { text: 'Was anyone else here?' }),
    el('p', { text: 'A tournament file lists who played, not who turned up. '
      + 'Anyone who came along without entering still earns the day: the same '
      + 'loyalty week, and the point for attending.' }),
    playerPicker({ onPick: add, allowCreate: true }),
    extras.length
      ? el('p', { className: 'form-status is-good',
          text: `${extras.length} added by hand. They are in the list above and `
              + 'will be recorded with everyone else.' })
      : el('p', { className: 'muted-note',
          text: 'Nobody added yet. Carry on if the file is the whole room.' })
  ]);
}

function recordCard() {
  const attendees = allAttendees();
  const unknown = attendees.filter((p) => !known.has(p.player_id));

  const dateInput = el('input', { type: 'date', id: 'attended-on', value: parsed.attendedOn });
  const others = otherAttendeesField(dateInput.value);
  dateInput.addEventListener('change', () => others.setDate(dateInput.value));
  const premier = el('input', { type: 'checkbox', id: 'premier' });
  const attendField = actionField(actions, 'attend-action', 'Award for attending', ATTEND_LABEL);
  const playField = actionField(actions, 'play-action', 'Award for playing', CASUAL_LABEL);

  premier.addEventListener('change', () => {
    const match = actions.find((a) => a.label === (premier.checked ? PREMIER_LABEL : CASUAL_LABEL));
    if (match) playField.querySelector('select').value = match.id;
  });

  const createMissing = el('input', { type: 'checkbox', id: 'create-missing', checked: 'checked' });
  const payAnyway = el('input', { type: 'checkbox', id: 'pay-anyway' });
  const result = el('div', { id: 'result' });
  const go = el('button', {
    type: 'submit', className: 'button', text: `Record ${attendees.length} attending`
  });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'attended-on', text: 'Date attended' }), dateInput
    ]),
    el('p', { className: 'field-help',
      text: 'Everyone listed above gets a loyalty week for this day. One calendar '
          + 'day is one week however many events they played.' }),
    el('p', { className: 'field field-inline' }, [
      premier, el('label', { for: 'premier', text: 'This was a premier event' })
    ]),
    el('p', { className: 'field-help',
      text: 'Premier play is worth an extra point. The play award goes to the '
          + 'players in the file. Anyone added by hand earns the day and the '
          + 'attendance point only — the file is what says somebody played.' }),
    attendField,
    playField,
    ...others.nodes,

    alreadyPaid.size ? el('div', { className: 'warn-block' }, [
      el('p', {}, [
        el('strong', { text: `${alreadyPaid.size} of these players ` }),
        el('span', { text: 'already hold points for a tournament with this name.' })
      ]),
      el('p', { className: 'field-help',
        text: 'By default they are not paid again, in case this file has been '
            + 'uploaded before. Their attendance counts either way and everyone '
            + 'else is unaffected.' }),
      el('p', { className: 'field field-inline' }, [
        payAnyway,
        el('label', { for: 'pay-anyway', text: 'Pay them anyway: this is a different tournament' })
      ]),
      el('p', { className: 'field-help',
        text: 'Tick this if they really did play in two tournaments. Playing twice '
            + 'earns twice — only the day itself is counted once. The check goes '
            + 'on the tournament’s name, which is all the ledger records, so two '
            + 'flights exported under one name look identical to it.' })
    ]) : null,

    unknown.length ? el('div', { className: 'warn-block' }, [
      el('p', {}, [
        el('strong', { text: `${unknown.length} attendee${unknown.length === 1 ? '' : 's'}` }),
        el('span', { text: ' not in the player list yet.' })
      ]),
      el('p', { className: 'field field-inline' }, [
        createMissing, el('label', { for: 'create-missing', text: 'Add them as players' })
      ]),
      el('p', { className: 'field-help',
        text: 'Their birth year comes from the file, which is what sets their '
            + 'division. Only the year is kept.' }),
      unknown.some((p) => !p.birth_year) ? el('p', { className: 'field-help',
        text: `${unknown.filter((p) => !p.birth_year).length} of them have no `
            + 'readable birth year in the file and count as a minor until a '
            + 'professor records one.' }) : null,
      el('p', { className: 'field-help',
        text: 'Either way they stay off the public site until consent is '
            + 'recorded: being in a tournament file is not consent.' })
    ]) : null,
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit({
      attendedOn: dateInput.value,
      attendActionId: attendField.querySelector('select').value,
      playActionId: playField.querySelector('select').value,
      createMissing: createMissing.checked,
      payAnyway: payAnyway.checked,
      otherAttendees: others.value(),
      resultNode: result,
      button: go
    });
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'What they earn' }),
    form
  ]);
}

function renderPicker() {
  const input = el('input', {
    type: 'file', id: 'tdf', accept: '.tdf,.xml,application/xml,text/xml'
  });
  const note = el('p', { className: 'form-status', role: 'status' });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      status(note, 'Reading the file.');
      parsed = parseTdf(await file.text());
      if (!parsed.players.length) throw new Error('That file lists no players.');
      if (!parsed.attendedOn) {
        throw new Error('That file has no readable start date. Use manual entry instead.');
      }
      extras = [];
      await refreshKnown();

      // Asked before anything is shown, so the warning is on screen while the
      // professor is still deciding rather than in the receipt afterwards.
      alreadyPaid = await alreadyPaidFor(
        playReason(), parsed.players.map((p) => p.player_id));

      redraw();
    } catch (err) {
      console.error(err);
      status(note, err.message, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Choose a tournament file' }),
    el('p', { text: 'A .tdf exported from TOM. It is read here in your browser '
        + 'and never uploaded or stored. Birth years are read from it for players '
        + 'who are new; only the year is kept.' }),
    el('p', { className: 'field' }, [
      el('label', { for: 'tdf', text: 'Tournament file' }), input
    ]),
    note,
    el('p', { className: 'muted-note' }, [
      el('span', { text: 'No file for the day? ' }),
      el('a', { href: 'attendance.html', text: 'Record attendance by hand' })
    ])
  ]);
}

function redraw() {
  app.replaceChildren(rosterCard(), judgesCard(), othersCard(), recordCard());
}

// --- Writing -----------------------------------------------------------------

async function commit({ attendedOn, attendActionId, playActionId, createMissing,
                        payAnyway, otherAttendees, resultNode, button }) {
  button.disabled = true;
  status(resultNode, 'Recording.');

  try {
    const outcome = await recordAttendance({
      attendees: allAttendees(),
      known,
      attendedOn,
      attendActionId,
      playActionId,
      createMissing,
      professor,
      actions,
      source: 'tdf',
      reason: playReason(),
      otherAttendees,
      // Detection is worth having; refusing is not the professor's decision to
      // lose. Playing in two tournaments earns two lots of points, and only the
      // day itself is counted once.
      skipPlayFor: payAnyway ? new Set() : alreadyPaid
    });

    resultNode.className = 'form-status is-good';
    resultNode.replaceChildren(
      ...outcomeNodes(outcome, attendedOn, { fileNote: true }),
      el('p', {}, [el('a', { href: 'upload.html', text: 'Upload another file' })])
    );
    button.remove();
  } catch (err) {
    console.error(err);
    button.disabled = false;
    status(resultNode, describeFailure(err), 'error');
  }
}

// --- Start -------------------------------------------------------------------

(async () => {
  professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  // The judges are a convenience, not a requirement: failing to load them is
  // worth saying on screen, not worth refusing the upload over, because every
  // one of them can still be added by name below.
  try {
    judges = await loadJudges();
  } catch (err) {
    console.error(err);
    judgesError = true;
  }

  try {
    actions = await loadActions();
  } catch (err) {
    console.error(err);
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'The list of point awards could not be loaded, so nothing can be '
          + 'recorded safely. Reload the page and try again.' }));
    return;
  }
  app.replaceChildren(renderPicker());
})();
