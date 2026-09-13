// Events: create one, edit one, and decide whether it takes registration.
//
// Events are publicly readable -- this is what the schedule page reads -- and
// professor-writable. Everything typed here reaches the public schedule, so
// nothing private belongs in a name or a description.
//
// Capacity is per division, and 'all' is the fallback the registration function
// looks for when a player's own division has no row. An event with no capacity
// rows at all is uncapped.
import { supabase, el, problem, formatEventDay, formatEventTime } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let events = [];

const TYPES = [
  ['league', 'League play'],
  ['casual', 'Casual tournament'],
  ['challenge', 'League Challenge'],
  ['cup', 'League Cup'],
  ['prerelease', 'Prerelease'],
  ['special', 'Something else']
];

const DIVISIONS = [
  ['all', 'Everyone'],
  ['junior', 'Junior'],
  ['senior', 'Senior'],
  ['master', 'Master']
];

const LEAGUE_ZONE = 'America/New_York';

// A datetime-local input has no time zone. The schedule is written and read in
// league time, so the value is composed and parsed in league time rather than
// the browser's, which would shift every event for anyone travelling.
const PARTS = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: LEAGUE_ZONE
});

function toLocalInput(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(PARTS.formatToParts(new Date(iso))
    .filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

// The offset is read from the date itself rather than assumed, so an event in
// November is not pushed an hour by a rule written in July.
function offsetFor(date) {
  const p = Object.fromEntries(PARTS.formatToParts(date)
    .filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute);
  return asUtc - date.getTime();
}

function fromLocalInput(value) {
  if (!value) return null;
  const [d, t] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, da, h, mi));
  // Two passes: the first offset is measured at the wrong instant on the two
  // days a year the clocks change, and the second lands on the right one.
  const once = new Date(guess.getTime() - offsetFor(guess));
  return new Date(guess.getTime() - offsetFor(once)).toISOString();
}

// --- Loading -----------------------------------------------------------------

async function load() {
  const { data, error } = await supabase
    .from('events').select('*').order('starts_at', { ascending: false });
  if (error) throw error;
  events = data || [];
}

async function loadCapacities(eventId) {
  const { data } = await supabase
    .from('event_capacities').select('*').eq('event_id', eventId);
  return data || [];
}

// --- Capacities --------------------------------------------------------------

// The caps themselves, without a form around them, so the same fields can sit
// inside the create form and inside the edit panel. Capacity used to exist only
// on an event that already existed, which meant creating one, finding it again
// and expanding it before it could be capped -- a cap you have to remember to go
// back for is a cap that does not get set.
function capacityFields(rows) {
  const inputs = new Map();

  const nodes = DIVISIONS.map(([key, label]) => {
    const existing = rows.find((r) => r.division === key);
    const input = el('input', {
      type: 'number', step: '1', min: '0',
      value: existing ? existing.capacity : ''
    });
    inputs.set(key, input);
    return el('p', { className: 'field' }, [el('label', { text: label }, [input])]);
  });

  const help = el('p', { className: 'field-help',
    text: 'Leave a division blank for no limit of its own. Everyone is the '
        + 'fallback, not a total: registration uses it when a player’s own '
        + 'division has no number of its own. All four blank means the event is '
        + 'uncapped.' });

  // Reads the fields and refuses anything that is not a whole count, so a
  // half-typed cap cannot be written as a limit somebody is then held to.
  function collect() {
    const wanted = [];
    for (const [key, input] of inputs) {
      const raw = input.value.trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`The ${key} capacity must be a whole number, zero or more.`);
      }
      wanted.push({ division: key, capacity: n });
    }
    return wanted;
  }

  return { nodes: [help, ...nodes], collect };
}

// Writes exactly what is on screen: every division present is upserted, and
// every division absent loses its row. A cleared field has to delete, or an old
// number keeps capping an event the professor believes is now open.
async function saveCapacities(eventId, wanted) {
  const gone = DIVISIONS.map(([k]) => k)
    .filter((k) => !wanted.some((w) => w.division === k));

  if (gone.length) {
    const { error } = await supabase.from('event_capacities')
      .delete().eq('event_id', eventId).in('division', gone);
    if (error) throw error;
  }

  if (wanted.length) {
    const { error } = await supabase.from('event_capacities')
      .upsert(wanted.map((w) => ({ ...w, event_id: eventId })),
              { onConflict: 'event_id,division' });
    if (error) throw error;
  }
}

export function capacityPanel(eventId, rows) {
  const note = el('p', { className: 'form-status', role: 'status' });
  const caps = capacityFields(rows);
  const go = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save capacities' });

  const form = el('form', {}, [
    ...caps.nodes,
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status(note, 'Saving.');
    try {
      await saveCapacities(eventId, caps.collect());
      go.disabled = false;
      status(note, 'Saved.', 'good');
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('div', {}, [el('h4', { text: 'Capacity' }), form]);
}

// --- One event ---------------------------------------------------------------

export function eventForm(event, { onSaved }) {
  const isNew = !event.id;

  // This form renders twice on the page, once to add and once per event being
  // edited, so every id has to be unique or a label would point at the wrong
  // checkbox.
  const uid = Math.random().toString(36).slice(2, 8);

  const name = el('input', { value: event.name ?? '' });
  const type = el('select', {}, TYPES.map(([v, t]) =>
    el('option', { value: v, text: t })));
  type.value = event.event_type || 'casual';

  const starts = el('input', { type: 'datetime-local', value: toLocalInput(event.starts_at) });
  const fee = el('input', { value: event.entry_fee ?? '' });
  const description = el('input', { value: event.description ?? '' });

  const premier = el('input', { type: 'checkbox', id: `premier-${uid}` });
  premier.checked = !!event.is_premier;

  const open = el('input', { type: 'checkbox', id: `open-${uid}` });
  open.checked = !!event.registration_open;

  const linked = el('input', { value: event.linked_group_id ?? '' });

  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button',
    text: isNew ? 'Create the event' : 'Save changes' });

  // Only on the create form. An event that already exists has its own capacity
  // panel below, which can read what is stored; repeating the fields here would
  // give two places to set one number.
  const caps = isNew ? capacityFields([]) : null;

  // A cap on an event that refuses registration outright caps nothing, so the
  // fields are not offered. Hidden rather than disabled: an input nobody can use
  // is still a question the professor has to read and dismiss.
  const capsBlock = caps
    ? el('div', { className: 'caps-block' }, [el('h4', { text: 'Capacity' }), ...caps.nodes])
    : null;

  function syncCaps() {
    if (capsBlock) capsBlock.hidden = !open.checked;
  }
  open.addEventListener('change', syncCaps);

  const form = el('form', {}, [
    el('p', { className: 'field' }, [el('label', { text: 'Name' }, [name])]),
    el('p', { className: 'field' }, [el('label', { text: 'Kind' }, [type])]),
    el('p', { className: 'field' }, [el('label', { text: 'Starts' }, [starts])]),
    el('p', { className: 'field-help', text: 'League time. Shown on the public schedule.' }),

    el('p', { className: 'field' }, [el('label', { text: 'Entry fee' }, [fee])]),
    el('p', { className: 'field-help',
      text: 'Text, not a number, so “$30, includes a sealed kit” works. '
          + 'Leave it blank for a free event; the schedule says Free.' }),

    el('p', { className: 'field' }, [el('label', { text: 'Description' }, [description])]),
    el('p', { className: 'field-help',
      text: 'One line under the name. What to bring, what the format is, anything '
          + 'a first-timer would want warned about. Public.' }),

    el('p', { className: 'field field-inline' }, [
      premier, el('label', { for: premier.id, text: 'Premier event' })
    ]),
    el('p', { className: 'field-help',
      text: 'Playing in a premier event is worth an extra point when the '
          + 'tournament file is uploaded.' }),

    el('p', { className: 'field field-inline' }, [
      open, el('label', { for: open.id, text: 'Take registration' })
    ]),
    el('p', { className: 'field-help',
      text: 'Off refuses registration whatever the capacity, and keeps the event '
          + 'off the drop confirmation screen. The schedule says nothing about '
          + 'registration for an event that never takes it.' }),

    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Part of a group of flights' }),
      el('div', { className: 'disclosure-body' }, [
        el('p', { className: 'field' }, [el('label', { text: 'Linked group' }, [linked])]),
        el('p', { className: 'field-help',
          text: 'Flights of the same event share one value, any text you like as '
              + 'long as it is a UUID. A player may hold one confirmed place '
              + 'across the group and wait on the others, and a drop skips anyone '
              + 'who already has a place elsewhere in it. Leave blank for a '
              + 'standalone event.' })
      ])
    ]),

    capsBlock,

    el('p', {}, [go]),
    note
  ]);

  syncCaps();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!name.value.trim()) { status(note, 'An event needs a name.', 'error'); return; }
    if (!starts.value) { status(note, 'An event needs a start time.', 'error'); return; }

    go.disabled = true;
    status(note, isNew ? 'Creating.' : 'Saving.');

    try {
      // Read before the insert, so a capacity typed wrong stops the whole thing
      // rather than leaving an event created with no cap on it. Skipped entirely
      // when registration is off: a number typed and then hidden is not a number
      // the professor meant to set.
      const wanted = (caps && open.checked) ? caps.collect() : null;

      const row = {
        name: name.value.trim(),
        event_type: type.value,
        starts_at: fromLocalInput(starts.value),
        entry_fee: fee.value.trim() || null,
        description: description.value.trim() || null,
        is_premier: premier.checked,
        registration_open: open.checked,
        linked_group_id: linked.value.trim() || null
      };

      if (isNew) {
        const { data, error } = await supabase.from('events').insert(row).select('id').single();
        if (error) throw error;
        if (wanted && wanted.length) {
          try {
            await saveCapacities(data.id, wanted);
          } catch (capErr) {
            // The event exists; only the caps failed. Say which, because
            // creating it again would make a duplicate.
            console.error(capErr);
            go.disabled = false;
            status(note, `The event was created, but its capacity was not saved: `
              + `${capErr.message}. Open it below and set the capacity there. Do `
              + 'not create it again.', 'error');
            await onSaved();
            return;
          }
        }
        form.reset();
      } else {
        const { error } = await supabase.from('events').update(row).eq('id', event.id);
        if (error) throw error;
      }

      go.disabled = false;
      status(note, isNew ? 'Created.' : 'Saved.', 'good');
      await onSaved();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return form;
}

async function eventRow(event) {
  const body = el('div', { className: 'disclosure-body' });
  const wrapper = el('details', { className: 'disclosure' }, [
    el('summary', {}, [
      el('span', { className: 'player-label', text: event.name }),
      el('span', { className: 'count',
        text: `${formatEventDay(event.starts_at)}, ${formatEventTime(event.starts_at)}` }),
      event.registration_open
        ? el('span', { className: 'tag tag-division', text: 'registration' })
        : null,
      event.is_premier ? el('span', { className: 'tag tag-new', text: 'premier' }) : null
    ]),
    body
  ]);

  // Capacities are fetched only when the row is opened. Loading them for every
  // event on the page would be a query per event to fill in panels nobody looked
  // at.
  let loaded = false;
  wrapper.addEventListener('toggle', async () => {
    if (!wrapper.open || loaded) return;
    loaded = true;
    body.replaceChildren(el('p', { className: 'notice', text: 'Loading.' }));
    const caps = await loadCapacities(event.id);
    body.replaceChildren(
      eventForm(event, { onSaved: refresh }),
      event.registration_open
        ? capacityPanel(event.id, caps)
        : el('p', { className: 'field-help',
            text: 'This event does not take registration, so a capacity would cap '
                + 'nothing. Turn registration on above and save to set one.' })
    );
  });

  return el('li', {}, [wrapper]);
}

// --- Render ------------------------------------------------------------------

async function render() {
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = events.filter((e) => new Date(e.starts_at).getTime() < now);

  const upcomingRows = await Promise.all(upcoming.map(eventRow));
  const pastRows = await Promise.all(past.slice(0, 30).map(eventRow));

  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('h2', { text: 'Add an event' }),
      eventForm({}, { onSaved: refresh })
    ]),

    el('section', { className: 'card' }, [
      el('h2', { text: `Coming up (${upcoming.length})` }),
      upcoming.length
        ? el('ul', { className: 'item-list' }, upcomingRows)
        : el('p', { className: 'muted-note', text: 'Nothing scheduled yet.' })
    ]),

    past.length
      ? el('section', { className: 'card' }, [
          el('h2', { text: `Already happened (${past.length})` }),
          el('p', { className: 'field-help',
            text: 'The thirty most recent. Kept so results and registrations stay '
                + 'attached to something.' }),
          el('ul', { className: 'item-list' }, pastRows)
        ])
      : null
  );
}

async function refresh() {
  await load();
  await render();
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
    await refresh();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The events'));
  }
})();
