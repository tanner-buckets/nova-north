// Drop confirmation.
//
// A player asking to drop does not drop them: request_drop() only marks the
// registration, and nothing moves until a professor confirms here. That is the
// whole point of the two steps, because confirming is what promotes somebody off
// the waiting list, and a promotion should not happen on an anonymous click.
//
// The promotion rule lives in confirm_drop(), not here. It walks the waitlist in
// order, skips anyone already holding a confirmed spot on another flight of the
// same event, and skips anyone whose division is still full. This screen's job
// is to name who was promoted afterwards, because otherwise the professor has no
// way to know who to tell.
//
// Registration lists are never public. This page is professor-only and shows
// full names, the same disclosure as a printed desk list.
import {
  supabase, el, problem, formatEventDay, formatEventTime, DIVISION_LABEL
} from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;

// --- Event list --------------------------------------------------------------

async function loadEvents() {
  const { data, error } = await supabase
    .from('event_registration_summary')
    .select('*')
    .order('starts_at');
  if (error) throw error;
  return data || [];
}

export function eventRow(row, onPick) {
  const pending = Number(row.drop_requested_count) || 0;

  const button = el('button', { type: 'button', className: 'player-button event-row' }, [
    el('span', { className: 'event-row-main' }, [
      el('span', { className: 'player-label', text: row.name }),
      el('span', { className: 'muted-note',
        text: `${formatEventDay(row.starts_at)}, ${formatEventTime(row.starts_at)}` })
    ]),
    el('span', { className: 'event-row-counts' }, [
      pending ? el('span', { className: 'tag tag-new', text: `${pending} to confirm` }) : null,
      el('span', { className: 'count',
        text: `${row.confirmed_count} in, ${row.waitlist_count} waiting` })
    ])
  ]);

  button.addEventListener('click', () => onPick(row));
  return el('li', {}, [button]);
}

// --- One event ---------------------------------------------------------------

async function loadRegistrations(eventId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('id, player_id, first_name, last_name, division, status, waitlist_position, contact')
    .eq('event_id', eventId)
    .neq('status', 'dropped')
    .order('first_name');
  if (error) throw error;
  return data || [];
}

function personLine(r) {
  return el('span', { className: 'reg-person' }, [
    el('span', { className: 'player-label', text: `${r.first_name} ${r.last_name}` }),
    el('span', { className: 'player-id count', text: r.player_id }),
    el('span', { className: 'tag tag-division', text: DIVISION_LABEL[r.division] || r.division })
  ]);
}

export function registrationRow(r, event, refresh) {
  const note = el('p', { className: 'form-status', role: 'status' });

  // Someone who asked to drop has already confirmed it; the request is the
  // confirmation, so one click finishes it. Dropping someone who did not ask is
  // a different act: it takes their place away and promotes somebody else off
  // the waiting list, neither of which can be clicked back. That one asks first.
  const requested = r.status === 'drop_requested';

  const go = el('button', {
    type: 'button',
    className: requested ? 'button' : 'button button-quiet',
    text: requested ? 'Confirm the drop' : 'Drop them'
  });

  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: `Yes, drop ${r.first_name}` });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Keep them' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    go.hidden = false;
    status(note, '');
  });

  go.addEventListener('click', () => {
    if (requested) { drop(); return; }
    go.hidden = true;
    confirmRow.hidden = false;
    status(note, `${r.first_name} did not ask to drop. This gives their place `
      + 'away and may promote someone off the waiting list.');
  });

  yes.addEventListener('click', drop);

  async function drop() {
    go.disabled = true;
    yes.disabled = true;
    status(note, 'Confirming.');

    try {
      const { data, error } = await supabase.rpc('confirm_drop', { p_registration_id: r.id });
      if (error) throw error;

      if (!data?.ok) {
        go.disabled = false;
        yes.disabled = false;
        status(note, data?.code === 'unknown_registration'
          ? 'That registration is already gone. Reload the page.'
          : 'That could not be confirmed. Reload the page and try again.', 'error');
        return;
      }

      // Naming the promoted player is the point of doing this on a screen rather
      // than in the database: somebody has to be told they are in.
      if (data.promoted) {
        status(note, '');
        note.className = 'form-status is-good';
        note.replaceChildren(
          el('strong', { text: `${data.promoted.name} moves up off the waiting list.` }),
          el('span', { text: ` ${DIVISION_LABEL[data.promoted.division] || data.promoted.division}`
            + `, ${data.promoted.player_id}. Tell them.` })
        );
      } else {
        status(note, 'Dropped. Nobody was promoted: either the waiting list is '
          + 'empty, or everyone on it already has a spot on another flight or is '
          + 'in a division that is still full.', 'good');
      }

      go.remove();
      confirmRow.remove();
      // Left on screen for a moment so the promotion message is read, not
      // flashed past by an immediate reload.
      setTimeout(refresh, 6000);
    } catch (err) {
      console.error(err);
      go.disabled = false;
      yes.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  }

  return el('li', { className: 'reg-row' }, [
    personLine(r),
    r.waitlist_position
      ? el('span', { className: 'muted-note', text: `Waiting, number ${r.waitlist_position}` })
      : null,
    r.contact ? el('span', { className: 'muted-note', text: r.contact }) : null,
    el('p', {}, [go, confirmRow]),
    note
  ]);
}

export function group(title, rows, event, refresh, emptyText) {
  return el('section', { className: 'card' }, [
    el('h3', { text: `${title} (${rows.length})` }),
    rows.length
      ? el('ul', { className: 'reg-list' }, rows.map((r) => registrationRow(r, event, refresh)))
      : el('p', { className: 'muted-note', text: emptyText })
  ]);
}

async function showEvent(event) {
  const host = el('div', {});
  app.replaceChildren(host);

  const refresh = () => showEvent(event);

  host.replaceChildren(el('p', { className: 'notice', text: 'Loading registrations.' }));

  try {
    const rows = await loadRegistrations(event.event_id);
    const requested = rows.filter((r) => r.status === 'drop_requested');
    const confirmed = rows.filter((r) => r.status === 'confirmed');
    const waiting = rows.filter((r) => r.status === 'waitlist')
      .sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0));

    const back = el('button', { type: 'button', className: 'link-button', text: 'All events' });
    back.addEventListener('click', start);

    host.replaceChildren(
      el('p', {}, [back]),
      el('h2', { text: event.name }),
      el('p', { className: 'muted-note',
        text: `${formatEventDay(event.starts_at)}, ${formatEventTime(event.starts_at)}` }),

      requested.length
        ? group('Asked to drop', requested, event, refresh, '')
        : el('section', { className: 'card' }, [
            el('h3', { text: 'Asked to drop (0)' }),
            el('p', { className: 'muted-note',
              text: 'Nothing waiting. A request made on the schedule page appears '
                  + 'here until a professor confirms it.' })
          ]),

      group('Registered', confirmed, event, refresh,
        'Nobody is registered for this event yet.'),

      group('Waiting list', waiting, event, refresh,
        'Nobody is waiting. A drop frees a place with nobody to fill it.')
    );
  } catch (err) {
    console.error(err);
    host.replaceChildren(problem('The registrations'));
  }
}

// --- Start -------------------------------------------------------------------

async function start() {
  app.replaceChildren(el('p', { className: 'notice', text: 'Loading events.' }));

  try {
    const events = await loadEvents();

    // Anything with a request waiting is listed whatever its state. Registration
    // closes, and a request made before it closed still has to be confirmable --
    // hiding it would strand the player who asked.
    const pending = events.filter((e) => Number(e.drop_requested_count) > 0);

    // Everything else is narrowed to events that actually take registration.
    // A casual event nobody signs up for has no drops to confirm and no waiting
    // list to promote from, so listing it is noise at the desk.
    const open = events.filter((e) =>
      e.registration_open && !Number(e.drop_requested_count));

    app.replaceChildren(
      pending.length
        ? el('section', { className: 'card' }, [
            el('h2', { text: 'Waiting for you' }),
            el('ul', { className: 'player-list' },
              pending.map((row) => eventRow(row, showEvent)))
          ])
        : el('section', { className: 'card' }, [
            el('h2', { text: 'Waiting for you' }),
            el('p', { className: 'muted-note',
              text: 'No drop requests to confirm. Pick an event below to drop '
                  + 'somebody by hand.' })
          ]),

      el('section', { className: 'card' }, [
        el('h2', { text: 'Taking registration' }),
        open.length
          ? el('ul', { className: 'player-list' }, open.map((row) => eventRow(row, showEvent)))
          : el('p', { className: 'muted-note', text: 'No events are open for registration.' }),
        el('p', { className: 'field-help' }, [
          el('span', { text: 'Events that do not take registration are not listed: '
            + 'they have nobody to drop and no waiting list to promote from. '
            + 'Registration is opened and closed on the ' }),
          el('a', { href: 'events.html', text: 'events screen' }),
          el('span', { text: '.' })
        ])
      ])
    );
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The events'));
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
  start();
})();
