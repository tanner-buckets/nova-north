// Visibility consent.
//
// The most sensitive screen in the project. Two independent switches decide
// whether a player appears publicly at all, most of the players are children,
// and the only lawful route to either switch is set_player_visibility(). A
// professor has no UPDATE grant on the consent columns, so this page cannot
// write them directly even if it tried -- the grant is the guarantee, and this
// page is only the interview that precedes it.
//
// Three rules the interface has to carry, because the database enforces only
// some of them:
//
//   1. A name is never shown without the Player ID. name_visible() returns false
//      when id_visible() does, so the database holds this one. The form still
//      says so, because a professor who records a name switch that silently does
//      nothing has been misled.
//   2. A minor's consent comes from a parent or guardian. The function accepts
//      either source for anybody; nothing but this screen enforces the rule, so
//      the choice is removed rather than defaulted.
//   3. Consent lapses without attendance in three months. The flag alone is not
//      visibility, so the card reports what is actually in force and why.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status, playerPicker } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;

const PLAYER_COLUMNS =
  'player_id, first_name, last_name, birth_year, show_player_id, show_name, '
  + 'consent_source, consent_recorded_at';

// --- Helpers -----------------------------------------------------------------

function fullName(p) {
  return `${p.first_name} ${p.last_name}`.trim();
}

const DAY = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York'
});

function day(value) {
  return value ? DAY.format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : null;
}

// show_player_id is a tri-state, and null is not "no": it means the age default
// is still in charge, which is a different thing from a professor deciding.
function idFlagWord(value) {
  if (value === true) return 'Yes, recorded';
  if (value === false) return 'No, recorded';
  return 'Not recorded, using the age default';
}

// show_name is not null and defaults to false, so false carries no information
// about whether anyone was ever asked. Saying "recorded" here would invent a
// decision nobody made.
function nameFlagWord(value) {
  return value === true ? 'Yes, recorded' : 'No';
}

// Everything the database knows about whether this player is actually visible.
// The flags alone do not answer it, so the helpers are asked rather than
// reimplemented here: they are the one source of truth and they move.
async function loadState(playerId) {
  const { data: player, error } = await supabase
    .from('players').select(PLAYER_COLUMNS).eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  if (!player) return null;

  const [idVisible, nameVisible, lastAttendance, division, minor, log] = await Promise.all([
    supabase.rpc('id_visible', { p_player_id: playerId }),
    supabase.rpc('name_visible', { p_player_id: playerId }),
    supabase.rpc('last_attendance_on', { p_player_id: playerId }),
    supabase.rpc('division', { p_birth_year: player.birth_year }),
    supabase.rpc('is_minor', { p_birth_year: player.birth_year }),
    supabase.from('consent_log').select('*')
      .eq('player_id', playerId).order('created_at', { ascending: false }).limit(20)
  ]);

  const state = {
    player,
    idVisible: idVisible.data === true,
    nameVisible: nameVisible.data === true,
    lastAttendance: lastAttendance.data || null,
    division: division.data || null,
    minor: minor.data === true,
    log: log.data || []
  };

  // Whether consent permits the Player ID to be public, setting attendance
  // recency aside. This is the question the checkbox asks, and it is not the
  // same as show_player_id being true: an adult with nothing recorded is listed
  // by the age default, so consent permits it even though the column is null.
  state.permits = player.show_player_id === true
    || (player.show_player_id === null && !state.minor);

  // Lapsed means consent permits but the player is still not public. The recency
  // test is not repeated here -- id_visible() already answered, and the only
  // remaining reason it can say no, once consent permits and there is attendance
  // on file, is that the attendance is too old. Deriving it this way cannot
  // drift from the three months the database actually enforces.
  state.lapsed = state.permits && !state.idVisible && !!state.lastAttendance;

  return state;
}

// --- The card ----------------------------------------------------------------

function whyNotVisible(state) {
  if (state.idVisible) return null;

  if (!state.lastAttendance) {
    return 'No attendance recorded, so nothing is public yet. Visibility needs '
         + 'attendance behind it as well as consent; upload a tournament file '
         + 'first.';
  }

  if (state.lapsed) {
    return `Last attended ${day(state.lastAttendance)}, more than three months `
         + 'ago, so visibility has lapsed. It does not come back on its own: a '
         + 'professor re-confirms consent, rather than assuming it still stands.';
  }

  if (state.player.show_player_id === false) {
    return 'The Player ID is switched off by an explicit decision.';
  }

  return 'The Player ID has no recorded decision and this player counts as a '
       + 'minor, so the default is off.';
}

export function currentState(state) {
  const p = state.player;
  const why = whyNotVisible(state);

  return el('section', { className: 'card' }, [
    el('h2', { text: fullName(p) }),
    el('p', { className: 'player-id count', text: p.player_id }),

    el('p', {
      className: state.idVisible ? 'live-state is-on' : 'live-state is-off',
      text: state.idVisible
        ? (state.nameVisible
            ? 'Public right now, ID and name.'
            : 'Public right now, Player ID only.')
        : 'Not public right now.'
    }),
    why ? el('p', { className: 'field-help', text: why }) : null,

    el('dl', { className: 'summary-list' }, [
      el('dt', { text: 'Birth year' }),
      el('dd', { text: p.birth_year || 'Not recorded' }),
      el('dt', { text: 'Division' }),
      el('dd', { text: p.birth_year ? (state.division || 'Unknown') : 'Unknown without a birth year' }),
      el('dt', { text: 'Counts as a minor' }),
      el('dd', { text: state.minor ? 'Yes' : 'No' }),
      el('dt', { text: 'Last attended' }),
      el('dd', { text: day(state.lastAttendance) || 'Never' }),
      el('dt', { text: 'Player ID switch' }),
      el('dd', { text: idFlagWord(p.show_player_id) }),
      el('dt', { text: 'Name switch' }),
      el('dd', { text: nameFlagWord(p.show_name) }),
      el('dt', { text: 'Consent last recorded' }),
      el('dd', { text: p.consent_recorded_at
        ? `${day(p.consent_recorded_at)}, by the ${p.consent_source || 'unknown'}`
        : 'Never' })
    ])
  ]);
}

// --- The form ----------------------------------------------------------------

export function consentForm(state) {
  const p = state.player;

  const showId = el('input', { type: 'checkbox', id: 'show-id' });

  // Ticked when the Player ID is public for any reason, including the age
  // default that lists adults without anything being recorded. Reading the raw
  // column here showed an adult who IS listed as unticked, which is confusing on
  // its own and leaves no obvious way to take somebody off at their request:
  // the box they need unticked already looked unticked.
  showId.checked = state.permits;

  const showName = el('input', { type: 'checkbox', id: 'show-name' });
  showName.checked = p.show_name === true;

  const note = el('input', { id: 'consent-note', placeholder: 'Who you spoke to, anything worth recording' });
  const result = el('p', { className: 'form-status', role: 'status' });
  const nameWarning = el('p', { className: 'field-help' });
  const go = el('button', { type: 'submit', className: 'button',
    text: state.lapsed ? 'Re-confirm consent' : 'Record consent' });

  // A minor's consent comes from a parent or guardian, and that is not the
  // professor's call to make on the day. There is no control here for a reason.
  const sourceField = state.minor
    ? el('div', {}, [
        el('p', { className: 'field-help',
          text: p.birth_year
            ? 'This player is a minor, so this is recorded as a parent or '
              + 'guardian giving consent. Do not record it on the word of the '
              + 'player alone.'
            : 'No birth year is recorded, so this player counts as a minor '
              + 'until one is. Consent is recorded as coming from a parent or '
              + 'guardian. If they are an adult, add the birth year on the '
              + 'players screen first.' })
      ])
    : el('p', { className: 'field' }, [
        el('label', { for: 'consent-source', text: 'Who gave consent' }),
        el('select', { id: 'consent-source' }, [
          el('option', { value: 'player', text: 'The player' }),
          el('option', { value: 'guardian', text: 'A parent or guardian' })
        ])
      ]);

  function syncWarning() {
    if (showName.checked && !showId.checked) {
      nameWarning.className = 'field-help is-warning';
      nameWarning.textContent = 'A name is never shown without the Player ID, so '
        + 'this will record the name switch but nothing will appear publicly '
        + 'until the Player ID is on as well.';
    } else {
      nameWarning.className = 'field-help';
      nameWarning.textContent = '';
    }
  }
  showId.addEventListener('change', syncWarning);
  showName.addEventListener('change', syncWarning);
  syncWarning();

  const form = el('form', {}, [
    el('h3', { text: state.lapsed ? 'Re-confirm consent' : 'Record consent' }),
    state.lapsed ? el('p', { className: 'field-help is-warning',
      text: 'Consent has lapsed. Ask again and record the answer, even if it is '
          + 'the same as before. It takes effect once this player has attendance '
          + 'inside the last three months, so upload the file for the day as '
          + 'well.' }) : null,
    el('p', { className: 'field field-inline' }, [
      showId, el('label', { for: 'show-id', text: 'Show their Player ID publicly' })
    ]),
    (p.show_player_id === null && !state.minor) ? el('p', { className: 'field-help',
      text: 'Ticked because adults are listed by default and nobody has recorded '
          + 'a decision for this player. Untick it to take them off at their '
          + 'request; that records an explicit no, which outlasts the default.' }) : null,
    el('p', { className: 'field field-inline' }, [
      showName, el('label', { for: 'show-name', text: 'Show their first name and last initial' })
    ]),
    nameWarning,
    sourceField,
    el('p', { className: 'field' }, [
      el('label', { for: 'consent-note', text: 'Note, optional' }), note
    ]),
    el('p', { className: 'field-help',
      text: 'Recording a switch replaces the age default for good. A player left '
          + 'on the default follows their age as they get older; one with a '
          + 'recorded decision keeps it until a professor records another.' }),
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const source = state.minor
      ? 'guardian'
      : form.querySelector('#consent-source').value;

    // A lapsed player is the case that most needs recording and the one where
    // the switches already match, so "unchanged" cannot mean "nothing to do".
    // Re-confirming writes both switches and a fresh consent date, which is the
    // conversation that actually happened.
    const changes = [];
    if (state.lapsed || showId.checked !== state.permits) {
      changes.push({ field: 'show_player_id', value: showId.checked });
    }
    if (state.lapsed || showName.checked !== (p.show_name === true)) {
      changes.push({ field: 'show_name', value: showName.checked });
    }

    if (!changes.length) {
      status(result, 'Nothing changed, so nothing was recorded.');
      return;
    }

    go.disabled = true;
    status(result, 'Recording.');

    try {
      // One call per field, so consent_log keeps one row per switch rather than
      // one row covering two decisions.
      for (const change of changes) {
        const { error } = await supabase.rpc('set_player_visibility', {
          p_player_id: p.player_id,
          p_field: change.field,
          p_value: change.value,
          p_source: source,
          p_note: note.value.trim() || null
        });
        if (error) throw error;
      }
      await show(p.player_id);
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(result, `That did not go through: ${err.message || 'unknown error'}. `
          + 'Check the history below before trying again, in case part of it was '
          + 'recorded.', 'error');
    }
  });

  return el('section', { className: 'card' }, [form]);
}

// --- History -----------------------------------------------------------------

export function history(state) {
  if (!state.log.length) {
    return el('section', { className: 'card' }, [
      el('h3', { text: 'History' }),
      el('p', { className: 'muted-note', text: 'Nothing recorded for this player yet.' })
    ]);
  }

  const SWITCH = { show_player_id: 'Player ID', show_name: 'Name' };
  const SOURCE = { player: 'the player', guardian: 'a parent or guardian', expiry: 'the expiry job' };

  return el('section', { className: 'card' }, [
    el('h3', { text: 'History' }),
    el('ul', { className: 'log-list' }, state.log.map((row) =>
      el('li', {}, [
        el('span', { className: 'log-when count', text: day(row.created_at) }),
        el('span', { text: `${SWITCH[row.field] || row.field} `
          + `${row.new_value ? 'on' : 'off'}, by ${SOURCE[row.source] || row.source}` }),
        row.note ? el('span', { className: 'log-note', text: row.note }) : null
      ])))
  ]);
}

// --- Search ------------------------------------------------------------------

// The same one-box picker every other professor screen uses. This page used to
// carry its own copy with two fields, which meant the lookup behaved differently
// depending on which screen you happened to be on.
function searchPanel() {
  return el('section', { className: 'card' }, [
    el('h2', { text: 'Find a player' }),
    playerPicker({ onPick: (p) => show(p.player_id) })
  ]);
}

// --- Render ------------------------------------------------------------------

const detail = el('div', { id: 'detail' });

async function show(playerId) {
  detail.replaceChildren(el('p', { className: 'notice', text: 'Loading that player.' }));
  try {
    const state = await loadState(playerId);
    if (!state) {
      detail.replaceChildren(el('p', { className: 'notice notice-problem',
        text: 'That player could not be loaded.' }));
      return;
    }
    detail.replaceChildren(currentState(state), consentForm(state), history(state));
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    detail.replaceChildren(problem('That player'));
  }
}

(async () => {
  professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  app.replaceChildren(searchPanel(), detail);

  // A link can carry an ID, so the upload screen or a printed list can point
  // straight at the player being asked.
  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) show(fromUrl);
})();
