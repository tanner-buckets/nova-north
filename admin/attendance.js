// Manual attendance: turning up, and nothing more.
//
// One point and one loyalty week for the day. No play award, because nothing
// here claims a tournament was played -- a tournament file is that claim, so the
// upload screen adds the play point and this one does not. Anything else a
// player earns or spends goes through the points screen, where it can be
// described and, if it was wrong, reversed.
//
// New players can be added here. Somebody often comes along for a few Sundays
// before they ever enter a tournament, and those Sundays count. They are created
// when the attendance is recorded, not when they are typed in, so an abandoned
// form leaves nothing behind.
import { el } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import {
  ATTEND_LABEL, loadActions, actionField, status, playerPicker,
  recordAttendance, outcomeNodes, describeFailure
} from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let actions = [];
let attendees = [];
let known = new Set();   // those who already exist; the rest are created on record

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
  // Only existing players go in `known`. Leaving the new ones out is what tells
  // the shared write to create them.
  if (!player.isNew) known.add(player.player_id);
  redraw();
  status(note, `Added ${player.first_name}.`, 'good');
}

function remove(playerId) {
  attendees = attendees.filter((p) => p.player_id !== playerId);
  known.delete(playerId);
  redraw();
}

export function attendeeList(attendees, onRemove) {
  if (!attendees.length) {
    return el('p', { className: 'muted-note',
      text: 'Nobody added yet. Everyone here gets a loyalty week for the day and '
          + 'a point for attending.' });
  }

  return el('ul', { className: 'player-list attendee-list' }, attendees.map((p) => {
    const drop = el('button', { type: 'button', className: 'link-button', text: 'Remove' });
    drop.addEventListener('click', () => onRemove(p.player_id));
    return el('li', { className: 'attendee' }, [
      el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}`.trim() }),
      el('span', { className: 'player-id count', text: p.player_id }),
      p.isNew ? el('span', { className: 'tag tag-new', text: 'new' }) : null,
      drop
    ]);
  }));
}

// The award is stated rather than chosen. Manual entry pays for attending, once,
// and a dropdown would invite it to pay for something else. The fallback exists
// only for a league that has renamed the action out from under this screen.
function awardField() {
  const expected = actions.find((a) => a.label === ATTEND_LABEL);
  if (expected) {
    return {
      node: el('p', { className: 'stated-award' }, [
        el('span', { className: 'count', text: `${expected.default_points} point` }),
        el('span', { text: ` each, for ${expected.label.toLowerCase()}.` })
      ]),
      value: () => expected.id
    };
  }

  const field = actionField(actions, 'attend-action', 'Award for attending', ATTEND_LABEL);
  return {
    node: el('div', {}, [
      el('p', { className: 'field-help is-warning',
        text: `No earning action is called “${ATTEND_LABEL}” any more, so `
            + 'pick the one that replaced it. Only this single award is given.' }),
      field
    ]),
    value: () => field.querySelector('select').value
  };
}

function render() {
  const dateInput = el('input', { type: 'date', id: 'attended-on', value: today() });
  const award = awardField();
  const result = el('div', { id: 'result' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Record attendance' });
  go.disabled = attendees.length === 0;

  const newCount = attendees.filter((p) => p.isNew).length;

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'attended-on', text: 'Date attended' }), dateInput
    ]),
    el('p', { className: 'field-help',
      text: 'Defaults to today in league time. One calendar day is one loyalty '
          + 'week, however many times someone turned up.' }),
    award.node,
    el('p', { className: 'field-help' }, [
      el('span', { text: 'Attending is all this records. For anything else they '
        + 'earned, or points they spent at the prize wall, use ' }),
      el('a', { href: 'points.html', text: 'points' }),
      el('span', { text: '.' })
    ]),
    newCount ? el('div', { className: 'warn-block' }, [
      el('p', { text: `${newCount} of them ${newCount === 1 ? 'is' : 'are'} new and `
        + `will be created when you record this. They are not listed publicly, and `
        + 'stay that way until consent is recorded.' })
    ]) : null,
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit({
      attendedOn: dateInput.value,
      attendActionId: award.value(),
      resultNode: result,
      button: go
    });
  });

  return [
    el('section', { className: 'card' }, [
      el('h2', { text: 'Who attended' }),
      playerPicker({ onPick: add, allowCreate: true }),
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

async function commit({ attendedOn, attendActionId, resultNode, button }) {
  button.disabled = true;
  status(resultNode, 'Recording.');

  try {
    const outcome = await recordAttendance({
      attendees,
      known,
      attendedOn,
      attendActionId,
      // No play award. Turning up is the whole of what this screen records.
      playActionId: null,
      createMissing: true,
      professor,
      actions,
      source: 'manual'
    });

    resultNode.className = 'form-status is-good';
    resultNode.replaceChildren(...outcomeNodes(outcome, attendedOn));
    attendees = [];
    known = new Set();
    button.remove();
  } catch (err) {
    console.error(err);
    button.disabled = false;
    status(resultNode, describeFailure(err), 'error');
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
