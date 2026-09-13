// TDF upload: the only way attendance normally gets recorded, and the main way
// new players enter the system.
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
import { supabase, el } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

// Expected labels in earning_actions, used only to preselect a dropdown. A
// professor can change either choice at entry, and a renamed action means
// nothing is preselected rather than a silently wrong award.
const ATTEND_LABEL = 'Attend Sunday League';
const CASUAL_LABEL = 'Play in casual league tournament';
const PREMIER_LABEL = 'Play in a league Championship Event';

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

function status(node, message, kind) {
  node.className = 'form-status' + (kind ? ` is-${kind}` : '');
  node.textContent = message;
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

function pointsFor(actionId) {
  const a = actions.find((x) => x.id === actionId);
  return a ? a.default_points : 0;
}

// --- Rendering ---------------------------------------------------------------

function actionField(id, label, preselectLabel) {
  const select = el('select', { id },
    actions.map((a) => el('option', {
      value: a.id, text: `${a.label} (${a.default_points})`
    })));
  const match = actions.find((a) => a.label === preselectLabel);
  if (match) select.value = match.id;

  return el('p', { className: 'field' }, [
    el('label', { for: id, text: label }),
    select
  ]);
}

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

function addExtraForm() {
  const idInput = el('input', { id: 'extra-id', inputmode: 'numeric', placeholder: '1234567' });
  const addById = el('button', { type: 'button', className: 'button button-quiet', text: 'Add by ID' });
  const nameInput = el('input', { id: 'extra-name', placeholder: 'Start typing a name' });
  const found = el('div', { className: 'search-results' });
  const note = el('p', { className: 'form-status', role: 'status' });

  addById.addEventListener('click', async () => {
    const id = idInput.value.trim();
    if (!id) return;
    const { data, error } = await supabase.from('players')
      .select('player_id, first_name, last_name').eq('player_id', id).maybeSingle();
    if (error) {
      status(note, `That lookup failed: ${error.message}. Try again.`, 'error');
      return;
    }
    if (!data) {
      status(note, 'No player has that ID. Check the digits, or search by name below.', 'error');
      return;
    }
    idInput.value = '';
    add(data, note);
  });

  nameInput.addEventListener('input', async () => {
    const q = nameInput.value.trim();
    if (q.length < 2) { found.replaceChildren(); return; }
    const { data } = await supabase.from('players')
      .select('player_id, first_name, last_name')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .order('first_name').limit(8);
    if (!data) return;

    found.replaceChildren(...data.map((p) => {
      const button = el('button', { type: 'button', className: 'player-button' }, [
        el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}` }),
        el('span', { className: 'player-id count', text: p.player_id })
      ]);
      button.addEventListener('click', () => {
        nameInput.value = '';
        found.replaceChildren();
        add(p, note);
      });
      return button;
    }));
  });

  return el('details', { className: 'disclosure' }, [
    el('summary', { text: 'Add someone who played but is not in the file' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field' }, [
        el('label', { for: 'extra-id', text: 'Player ID' }), idInput
      ]),
      el('p', {}, [addById]),
      el('p', { className: 'field' }, [
        el('label', { for: 'extra-name', text: 'Or look up an ID by name' }), nameInput
      ]),
      found,
      note
    ])
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
  const attendField = actionField('attend-action', 'Award for attending', ATTEND_LABEL);
  const playField = actionField('play-action', 'Award for playing', CASUAL_LABEL);

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
    addExtraForm(),
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
    note
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
    const attendees = allAttendees();
    const missing = attendees.filter((p) => !known.has(p.player_id));

    if (missing.length && createMissing) {
      // Only players being created. An import never overwrites an existing
      // birth year: division drives registration caps, and a professor who
      // corrected one by hand outranks a file.
      const { error } = await supabase.from('players').insert(missing.map((p) => ({
        player_id: p.player_id,
        first_name: p.first_name || 'Unknown',
        last_name: p.last_name || 'Unknown',
        birth_year: p.birth_year ?? null
        // Every consent column is deliberately omitted, and the grant would
        // refuse them anyway.
      })));
      if (error) throw error;
      await refreshKnown();
    }

    const eligible = attendees.filter((p) => known.has(p.player_id));
    if (!eligible.length) {
      throw new Error('Nobody on this list is a player yet, so there is nothing to record.');
    }

    // One loyalty week per calendar day. A second event on the same Sunday adds
    // no attendance row, and the unique constraint saying so is the rule working
    // rather than an error to report.
    const { data: inserted, error: attErr } = await supabase
      .from('attendance')
      .upsert(eligible.map((p) => ({
        player_id: p.player_id,
        attended_on: attendedOn,
        source: 'tdf',
        created_by: professor.userId
      })), { onConflict: 'player_id,attended_on', ignoreDuplicates: true })
      .select('player_id');
    if (attErr) throw attErr;

    // Attendance points go only to those whose attendance row is new. Play
    // points go to everyone who played, because two events in a day are two
    // things played even though they are one loyalty week.
    const newlyPresent = new Set((inserted || []).map((r) => r.player_id));

    const ledger = [];
    for (const p of eligible) {
      if (newlyPresent.has(p.player_id)) {
        ledger.push({
          player_id: p.player_id, delta: pointsFor(attendActionId),
          earning_action_id: attendActionId, created_by: professor.userId
        });
      }
      ledger.push({
        player_id: p.player_id, delta: pointsFor(playActionId),
        earning_action_id: playActionId, created_by: professor.userId,
        // Public through get_player_summary(). An event name is already public
        // on the schedule, so this is safe; never write anything private here.
        reason: `Played in ${parsed.eventName}`
      });
    }

    const { error: ledErr } = await supabase.from('point_ledger').insert(ledger);
    if (ledErr) throw ledErr;

    const repeats = eligible.length - newlyPresent.size;
    resultNode.className = 'form-status is-good';
    resultNode.replaceChildren(
      el('p', { text: `Recorded. ${newlyPresent.size} attendance row`
          + `${newlyPresent.size === 1 ? '' : 's'} for ${attendedOn}, and `
          + `${ledger.length} point entries across ${eligible.length} players.` }),
      repeats ? el('p', { className: 'muted-note',
        text: `${repeats} already had attendance for that day, so that day was not `
            + 'counted twice. They still received points for playing.' }) : null,
      el('p', { className: 'muted-note',
        text: 'The file itself was read in your browser and has not been stored '
            + 'anywhere.' }),
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

  const { data, error } = await supabase
    .from('earning_actions').select('*').eq('is_active', true).order('sort_order');
  if (error || !data) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'The list of point awards could not be loaded, so nothing can be '
          + 'recorded safely. Reload the page and try again.' }));
    return;
  }
  actions = data;
  app.replaceChildren(renderPicker());
})();
