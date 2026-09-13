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
  loadActions, actionField, status, playerPicker, recordAttendance, outcomeNodes
} from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let parsed = null;      // { eventName, attendedOn, players: [...] }
let known = new Set();  // player_ids already in the players table
let extras = [];        // attendees added by hand
let actions = [];       // earning_actions rows

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
      birth_year: birthYear(p.querySelector('birthdate')?.textContent)
    }))
    .filter((p) => p.player_id);

  return { eventName, attendedOn, players };
}

// --- Helpers -----------------------------------------------------------------

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

// --- Rendering ---------------------------------------------------------------

function attendeeList() {
  return el('div', {}, [
    el('h3', { text: 'Attendees' }),
    el('ul', { className: 'player-list attendee-list' }, allAttendees().map((p) =>
      el('li', { className: 'attendee' }, [
        el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}`.trim() }),
        el('span', { className: 'player-id count', text: p.player_id }),
        known.has(p.player_id) ? null : el('span', { className: 'tag tag-new', text: 'new' }),
        p.added ? el('span', { className: 'tag tag-added', text: 'added by hand' }) : null
      ])))
  ]);
}

function add(player, note) {
  if (allAttendees().some((p) => p.player_id === player.player_id)) {
    status(note, `${player.first_name} is already on the list.`);
    return;
  }
  extras.push({ ...player, added: true });
  redraw();
}

function renderReview() {
  const attendees = allAttendees();
  const unknown = attendees.filter((p) => !known.has(p.player_id));

  const dateInput = el('input', { type: 'date', id: 'attended-on', value: parsed.attendedOn });
  const premier = el('input', { type: 'checkbox', id: 'premier' });
  const attendField = actionField(actions, 'attend-action', 'Award for attending', ATTEND_LABEL);
  const playField = actionField(actions, 'play-action', 'Award for playing', CASUAL_LABEL);

  premier.addEventListener('change', () => {
    const match = actions.find((a) => a.label === (premier.checked ? PREMIER_LABEL : CASUAL_LABEL));
    if (match) playField.querySelector('select').value = match.id;
  });

  const createMissing = el('input', { type: 'checkbox', id: 'create-missing', checked: 'checked' });
  const result = el('div', { id: 'result' });
  const go = el('button', {
    type: 'submit', className: 'button', text: 'Record attendance and award points'
  });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'attended-on', text: 'Date attended' }), dateInput
    ]),
    el('p', { className: 'field field-inline' }, [
      premier, el('label', { for: 'premier', text: 'This was a premier event' })
    ]),
    el('p', { className: 'field-help',
      text: 'Premier play is worth an extra point. Everyone in the file gets both '
          + 'the attendance award and the play award.' }),
    attendField,
    playField,
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
      resultNode: result,
      button: go
    });
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Check, then record' }),
    el('dl', { className: 'summary-list' }, [
      el('dt', { text: 'Event in the file' }), el('dd', { text: parsed.eventName }),
      el('dt', { text: 'Attendees' }),
      el('dd', { text: `${attendees.length} — ${attendees.length - unknown.length} known, `
        + `${unknown.length} new` })
    ]),
    attendeeList(),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Add someone who played but is not in the file' }),
      el('div', { className: 'disclosure-body' }, [playerPicker({ onPick: add })])
    ]),
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
  app.replaceChildren(renderReview());
}

// --- Writing -----------------------------------------------------------------

async function commit({ attendedOn, attendActionId, playActionId, createMissing, resultNode, button }) {
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
      reason: `Played in ${parsed.eventName}`
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
    status(resultNode, `That did not go through: ${err.message || 'unknown error'}. `
        + 'Attendance and points are written separately, so check the ledger for '
        + 'partial entries before you try again.', 'error');
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
