// Manual attendance: the same grants as a tournament file, entered by hand.
//
// For the day the file will not export, the player who played but never got
// entered, and the casual league session that was never a tournament at all.
// The write is the shared one in attendance-core.js, so a manually recorded
// Sunday is worth exactly what an uploaded one is.
import { supabase, el } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import {
  ATTEND_LABEL, CASUAL_LABEL, PREMIER_LABEL,
  loadActions, actionField, status, playerPicker, recordAttendance, outcomeNodes
} from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let actions = [];
let attendees = [];
let known = new Set();

// League time, not the browser's. A professor entering Sunday's attendance late
// on Sunday night from a laptop set to another zone should still get Sunday.
const LEAGUE_DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York'
});

function today() {
  return LEAGUE_DAY.format(new Date());
}

function add(player, note) {
  if (attendees.some((p) => p.player_id === player.player_id)) {
    status(note, `${player.first_name} is already on the list.`);
    return;
  }
  attendees.push(player);
  known.add(player.player_id);
  redraw();
  status(note, `Added ${player.first_name}.`, 'good');
}

function remove(playerId) {
  attendees = attendees.filter((p) => p.player_id !== playerId);
  redraw();
}

export function attendeeList(attendees, onRemove) {
  if (!attendees.length) {
    return el('p', { className: 'muted-note',
      text: 'Nobody added yet. Everyone here gets a loyalty week for the day and '
          + 'points for attending and playing.' });
  }

  return el('ul', { className: 'player-list attendee-list' }, attendees.map((p) => {
    const drop = el('button', { type: 'button', className: 'link-button', text: 'Remove' });
    drop.addEventListener('click', () => onRemove(p.player_id));
    return el('li', { className: 'attendee' }, [
      el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}`.trim() }),
      el('span', { className: 'player-id count', text: p.player_id }),
      drop
    ]);
  }));
}

function render() {
  const dateInput = el('input', { type: 'date', id: 'attended-on', value: today() });
  const premier = el('input', { type: 'checkbox', id: 'premier' });
  const attendField = actionField(actions, 'attend-action', 'Award for attending', ATTEND_LABEL);
  const playField = actionField(actions, 'play-action', 'Award for playing', CASUAL_LABEL);

  premier.addEventListener('change', () => {
    const match = actions.find((a) => a.label === (premier.checked ? PREMIER_LABEL : CASUAL_LABEL));
    if (match) playField.querySelector('select').value = match.id;
  });

  const eventName = el('input', { id: 'event-name', placeholder: 'Sunday league' });
  const result = el('div', { id: 'result' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Record attendance and award points' });
  go.disabled = attendees.length === 0;

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'attended-on', text: 'Date attended' }), dateInput
    ]),
    el('p', { className: 'field-help',
      text: 'Defaults to today in league time. One calendar day is one loyalty '
          + 'week, however many events someone played.' }),
    el('p', { className: 'field field-inline' }, [
      premier, el('label', { for: 'premier', text: 'This was a premier event' })
    ]),
    attendField,
    playField,
    el('p', { className: 'field' }, [
      el('label', { for: 'event-name', text: 'What they played, optional' }), eventName
    ]),
    el('p', { className: 'field-help',
      text: 'Appears on the player’s own points history, which is public for '
          + 'anyone whose Player ID is visible. Nothing private belongs here.' }),
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit({
      attendedOn: dateInput.value,
      attendActionId: attendField.querySelector('select').value,
      playActionId: playField.querySelector('select').value,
      eventName: eventName.value.trim(),
      resultNode: result,
      button: go
    });
  });

  return [
    el('section', { className: 'card' }, [
      el('h2', { text: 'Who attended' }),
      playerPicker({ onPick: add }),
      el('p', { className: 'muted-note' }, [
        el('span', { text: 'Someone with no record yet? ' }),
        el('a', { href: 'players.html', text: 'Add them as a player first' }),
        el('span', { text: '. Manual entry never creates a player, so a typed ID '
          + 'cannot quietly become a new person.' })
      ]),
      el('h3', { text: `Attending (${attendees.length})` }),
      attendeeList(attendees, remove)
    ]),
    el('section', { className: 'card' }, [
      el('h2', { text: 'What they earn' }),
      form
    ])
  ];
}

function redraw() {
  app.replaceChildren(...render());
}

async function commit({ attendedOn, attendActionId, playActionId, eventName, resultNode, button }) {
  button.disabled = true;
  status(resultNode, 'Recording.');

  try {
    const outcome = await recordAttendance({
      attendees,
      known,
      attendedOn,
      attendActionId,
      playActionId,
      // Manual entry never creates a player. Every attendee here was picked from
      // a search, so they already exist; a typed ID that matched nobody was
      // refused at the picker rather than turned into a new person.
      createMissing: false,
      professor,
      actions,
      source: 'manual',
      reason: eventName ? `Played in ${eventName}` : null
    });

    resultNode.className = 'form-status is-good';
    resultNode.replaceChildren(...outcomeNodes(outcome, attendedOn));
    attendees = [];
    button.remove();
  } catch (err) {
    console.error(err);
    button.disabled = false;
    status(resultNode, `That did not go through: ${err.message || 'unknown error'}. `
        + 'Attendance and points are written separately, so check the ledger for '
        + 'partial entries before you try again.', 'error');
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

  try {
    actions = await loadActions();
  } catch (err) {
    console.error(err);
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'The list of point awards could not be loaded, so nothing can be '
          + 'recorded safely. Reload the page and try again.' }));
    return;
  }
  redraw();
})();
