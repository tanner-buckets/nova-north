// Staff scheduling: who can come, and who is doing what once they can.
//
// Two screens from the sheet this replaces, kept as two sections rather than
// two pages, because they are read together: the answer to "who is head judge
// on the 8th" is usually "whoever said they were free", and that is one scroll
// rather than one navigation.
//
// UPCOMING IS EDITABLE AND PAST IS READ ONLY. A rota is a plan, and a plan
// stops being one the moment the day has happened -- what is left is a record,
// and a record with a dropdown on it invites somebody to tidy history. It also
// keeps the editable grid down to the handful of events anybody is actually
// deciding about, instead of two years of selects.
//
// ADDING SOMEBODY HERE DOES NOT GIVE THEM A LOGIN. This writes to staff, which
// is a roster and not an authorization table -- no policy consults it. Making
// an account is still a thing that happens in the Supabase dashboard, and the
// screen says so rather than letting somebody believe they have just granted
// access to every child's name in the league.
import { supabase, el, problem, formatEventDay } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status, playerPicker } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

// '' is a real choice and means nobody has been asked, which is why it is not
// called "none". The table has no row for it at all.
const STATUSES = [
  ['', 'Not asked'],
  ['available', 'Available'],
  ['out', 'Out'],
  ['playing', 'Playing'],
  ['unsure', 'Unsure']
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map(([v, t]) => [v, t]));

const ROLES = [
  ['organizer', 'Organizer'],
  ['head_judge', 'Head judge'],
  ['floor_judge', 'Floor judge'],
  ['free_play', 'Free play volunteer'],
  ['other', 'Other staff']
];

const KINDS = [['regular', 'Regular'], ['volunteer', 'Volunteer']];

let roster = [];
let events = [];
let availability = new Map();   // `${eventId}:${staffId}` -> row
let staffing = new Map();       // eventId -> [row]
let notes = new Map();          // eventId -> other_events text
let showPast = false;

const availKey = (eventId, staffId) => `${eventId}:${staffId}`;
const active = () => roster.filter((p) => p.is_active);

// --- Loading ------------------------------------------------------------------

async function load() {
  const { data: staffRows, error: staffError } = await supabase
    .from('staff').select('*').order('is_active', { ascending: false })
    .order('display_name');
  if (staffError) throw staffError;
  roster = staffRows || [];

  // The cutoff is the start of today rather than this instant, so an event
  // earlier today is still on the upcoming list while the day is being run.
  // A rota that drops the event you are standing in is a rota that is wrong
  // exactly when somebody reaches for it.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const cutoff = midnight.toISOString();

  const query = supabase.from('events').select('id, name, starts_at, event_type');
  const { data: eventRows, error: eventError } = showPast
    ? await query.lt('starts_at', cutoff).order('starts_at', { ascending: false }).limit(60)
    : await query.gte('starts_at', cutoff).order('starts_at').limit(40);
  if (eventError) throw eventError;
  events = eventRows || [];

  availability = new Map();
  staffing = new Map();
  notes = new Map();
  if (!events.length) return;

  const ids = events.map((e) => e.id);
  const [avail, staffed, noteRows] = await Promise.all([
    supabase.from('staff_availability').select('*').in('event_id', ids),
    supabase.from('event_staffing').select('*').in('event_id', ids).order('sort_order'),
    supabase.from('event_staffing_notes').select('*').in('event_id', ids)
  ]);
  if (avail.error) throw avail.error;
  if (staffed.error) throw staffed.error;
  if (noteRows.error) throw noteRows.error;

  for (const r of avail.data || []) availability.set(availKey(r.event_id, r.staff_id), r);
  for (const r of staffed.data || []) {
    if (!staffing.has(r.event_id)) staffing.set(r.event_id, []);
    staffing.get(r.event_id).push(r);
  }
  for (const r of noteRows.data || []) notes.set(r.event_id, r.other_events || '');
}

// --- Small builders -----------------------------------------------------------

function pick(options, value) {
  const sel = el('select', {}, options.map(([v, t]) =>
    el('option', { value: v, text: t })));
  sel.value = value || '';
  return sel;
}

function personName(staffId) {
  const person = roster.find((p) => p.id === staffId);
  return person ? person.display_name : 'Removed';
}

// How many people said yes. `playing` deliberately does not count: somebody
// entered in the side event is in the room and is not a judge, and counting
// them would have a professor think the day is covered when it is not.
function presentCount(event) {
  return active().filter((p) =>
    availability.get(availKey(event.id, p.id))?.status === 'available').length;
}

// --- Availability -------------------------------------------------------------

function availabilityCell(event, person, note) {
  const row = availability.get(availKey(event.id, person.id));
  const sel = pick(STATUSES, row?.status || '');
  sel.setAttribute('aria-label', `${person.display_name}, ${event.name}`);

  // The reason only appears once there is something to explain. "Out" on its
  // own is the common case and an empty box beside every one of them is a
  // column of nothing.
  const why = el('input', {
    className: 'avail-why', value: row?.note || '',
    placeholder: 'why', 'aria-label': `Reason for ${person.display_name}`
  });
  const showWhy = () => { why.hidden = !sel.value || sel.value === 'available'; };
  showWhy();

  async function save() {
    sel.removeAttribute('aria-invalid');
    const next = sel.value;

    // No status is no row. The table says "nobody has been asked" by the
    // absence of a record, so clearing a cell has to actually clear it rather
    // than leave an empty string behind pretending to be an answer.
    const result = next
      ? await supabase.from('staff_availability').upsert({
          event_id: event.id, staff_id: person.id,
          status: next, note: why.value.trim() || null
        }, { onConflict: 'event_id,staff_id' })
      : await supabase.from('staff_availability').delete()
          .eq('event_id', event.id).eq('staff_id', person.id);

    if (result.error) {
      sel.setAttribute('aria-invalid', 'true');
      status(note, `That did not save: ${result.error.message}`, 'error');
      return;
    }

    if (next) {
      availability.set(availKey(event.id, person.id),
        { event_id: event.id, staff_id: person.id, status: next, note: why.value.trim() || null });
    } else {
      availability.delete(availKey(event.id, person.id));
    }
    status(note, 'Saved.');
    // The present count sits in the same row and is now wrong.
    const cell = document.querySelector(`[data-present="${event.id}"]`);
    if (cell) cell.textContent = String(presentCount(event));
  }

  sel.addEventListener('change', () => { showWhy(); save(); });
  why.addEventListener('change', save);

  return el('td', { className: 'avail-cell' }, [sel, why]);
}

function availabilityPanel(note) {
  if (!active().length) {
    return el('p', { className: 'muted-note',
      text: 'Nobody is on the roster yet. Add somebody below and they get a column here.' });
  }
  if (!events.length) {
    return el('p', { className: 'muted-note',
      text: showPast
        ? 'No past events.'
        : 'No events coming up. Create one on the events screen and it appears here.' });
  }

  const people = active();

  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Event' }),
    // Before the names, not after them. A table with a column per person is
    // wide by nature, and a summary at the far right is the first thing off
    // the side of a phone -- which is exactly how Players got read as the
    // total on the attendance table.
    el('th', { scope: 'col', text: 'Present',
      title: 'How many said Available. Playing does not count: they are here, but not staffing.' }),
    ...people.map((p) => el('th', { scope: 'col', text: p.display_name }))
  ]);

  const rows = events.map((event) => el('tr', {}, [
    el('th', { scope: 'row' }, [
      el('span', { className: 'avail-day', text: formatEventDay(event.starts_at) }),
      el('span', { className: 'avail-name', text: event.name })
    ]),
    el('td', { className: 'count', 'data-present': event.id,
      text: String(presentCount(event)) }),
    ...people.map((p) => showPast
      ? readOnlyCell(event, p)
      : availabilityCell(event, p, note))
  ]));

  return el('div', { className: 'table-wrap' }, [
    el('table', { className: 'data-table avail-table' }, [
      el('thead', {}, [head]),
      el('tbody', {}, rows)
    ])
  ]);
}

function readOnlyCell(event, person) {
  const row = availability.get(availKey(event.id, person.id));
  if (!row) return el('td', { className: 'muted-note', text: '—' });
  return el('td', { className: `avail-static is-${row.status}` }, [
    el('span', { text: STATUS_LABEL[row.status] || row.status }),
    row.note ? el('span', { className: 'muted-note', text: ` ${row.note}` }) : null
  ]);
}

// --- Event staffing -----------------------------------------------------------

// Anybody known not to be staffing, with their reason. Derived from the grid
// above rather than typed again: the sheet kept this as its own column and it
// was the column most often out of date with the one beside it.
function unavailableLine(event) {
  const away = active()
    .map((p) => ({ p, row: availability.get(availKey(event.id, p.id)) }))
    .filter(({ row }) => row && (row.status === 'out' || row.status === 'playing'));

  const unanswered = active().filter((p) => !availability.get(availKey(event.id, p.id))).length;

  if (!away.length && !unanswered) return null;

  return el('p', { className: 'field-help' }, [
    away.length
      ? el('span', { text: 'Not staffing: ' + away.map(({ p, row }) => {
          const why = [row.status === 'playing' ? 'playing' : null, row.note]
            .filter(Boolean).join(', ');
          return p.display_name + (why ? ` (${why})` : '');
        }).join(', ') + '. ' })
      : null,
    unanswered
      ? el('span', { className: 'muted-note',
          text: `${unanswered} ${unanswered === 1 ? 'person has' : 'people have'} not answered.` })
      : null
  ]);
}

function roleBlock(event, role, label, reload, note) {
  const assigned = (staffing.get(event.id) || []).filter((r) => r.role === role);

  const chips = assigned.map((row) => {
    const name = row.staff_id ? personName(row.staff_id) : row.guest_name;
    const remove = el('button', {
      type: 'button', className: 'chip-remove', title: `Remove ${name}`,
      'aria-label': `Remove ${name} from ${label}`, text: '×'
    });
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const { error } = await supabase.from('event_staffing').delete().eq('id', row.id);
      if (error) {
        remove.disabled = false;
        status(note, `That did not save: ${error.message}`, 'error');
        return;
      }
      await reload();
    });
    return el('span', { className: row.staff_id ? 'staff-chip' : 'staff-chip is-guest' }, [
      el('span', { text: name }),
      showPast ? null : remove
    ]);
  });

  if (showPast) {
    return el('div', { className: 'role-block' }, [
      el('span', { className: 'role-label', text: label }),
      chips.length
        ? el('span', { className: 'chip-row' }, chips)
        : el('span', { className: 'muted-note', text: 'Nobody' })
    ]);
  }

  // The roster first, because four names out of five assignments come from it.
  // "Somebody else" is the escape hatch the sheet needed for a visiting judge,
  // and it writes a name rather than quietly creating a roster entry for
  // somebody who helped once.
  const taken = new Set(assigned.filter((r) => r.staff_id).map((r) => r.staff_id));
  const options = [['', 'Add somebody…']]
    .concat(active().filter((p) => !taken.has(p.id)).map((p) => [p.id, p.display_name]))
    .concat([['__guest', 'Somebody else…']]);

  const sel = pick(options, '');
  sel.setAttribute('aria-label', `Add to ${label}`);
  const guest = el('input', {
    className: 'guest-name', placeholder: 'Name', hidden: 'hidden',
    'aria-label': `Name for ${label}`
  });

  async function addRow(payload) {
    const { error } = await supabase.from('event_staffing').insert({
      event_id: event.id, role, sort_order: assigned.length, ...payload
    });
    if (error) {
      status(note, `That did not save: ${error.message}`, 'error');
      return;
    }
    await reload();
  }

  sel.addEventListener('change', async () => {
    if (!sel.value) return;
    if (sel.value === '__guest') {
      guest.hidden = false;
      guest.focus();
      return;
    }
    const staffId = sel.value;
    sel.value = '';
    await addRow({ staff_id: staffId });
  });

  const commitGuest = async () => {
    const name = guest.value.trim();
    if (!name) { guest.hidden = true; sel.value = ''; return; }
    guest.value = '';
    guest.hidden = true;
    sel.value = '';
    await addRow({ guest_name: name });
  };
  guest.addEventListener('blur', commitGuest);
  guest.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitGuest(); }
    if (e.key === 'Escape') { e.preventDefault(); guest.value = ''; guest.hidden = true; sel.value = ''; }
  });

  return el('div', { className: 'role-block' }, [
    el('span', { className: 'role-label', text: label }),
    el('span', { className: 'chip-row' }, chips),
    el('span', { className: 'role-add' }, [sel, guest])
  ]);
}

// Somebody down for two jobs at one event. The table permits it -- a small
// league sometimes means the organiser also floor-judges -- so this is a word
// on the screen rather than a refusal in the database.
function doubleBooked(event) {
  const seen = new Map();
  for (const row of staffing.get(event.id) || []) {
    if (!row.staff_id) continue;
    seen.set(row.staff_id, (seen.get(row.staff_id) || 0) + 1);
  }
  const names = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => personName(id));
  if (!names.length) return null;
  return el('p', { className: 'notice notice-problem',
    text: `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} down for more than one job.` });
}

function eventCard(event, reload, note) {
  const other = el('input', {
    className: 'other-events', value: notes.get(event.id) || '',
    placeholder: 'Regionals, NAIC, Worlds…',
    'aria-label': `Other events on ${formatEventDay(event.starts_at)}`
  });

  other.addEventListener('change', async () => {
    const value = other.value.trim();
    const result = value
      ? await supabase.from('event_staffing_notes')
          .upsert({ event_id: event.id, other_events: value }, { onConflict: 'event_id' })
      : await supabase.from('event_staffing_notes').delete().eq('event_id', event.id);
    if (result.error) {
      status(note, `That did not save: ${result.error.message}`, 'error');
      return;
    }
    notes.set(event.id, value);
    status(note, 'Saved.');
  });

  const otherText = notes.get(event.id);

  return el('article', { className: 'card staff-event' }, [
    el('h3', {}, [
      el('span', { className: 'avail-day', text: formatEventDay(event.starts_at) }),
      el('span', { text: event.name })
    ]),
    showPast
      ? (otherText
          ? el('p', { className: 'field-help', text: `Also on: ${otherText}` })
          : null)
      : el('p', { className: 'field' }, [
          el('label', { text: 'Also on elsewhere' }, [other]),
          el('span', { className: 'field-help',
            text: 'What else is on that weekend. It is why half the roster is out.' })
        ]),
    unavailableLine(event),
    doubleBooked(event),
    el('div', { className: 'role-grid' },
      ROLES.map(([role, label]) => roleBlock(event, role, label, reload, note)))
  ]);
}

// --- The roster ---------------------------------------------------------------

function rosterRow(person, reload, note) {
  const name = el('input', { value: person.display_name, 'aria-label': 'Name on the rota' });
  const kind = pick(KINDS, person.kind);
  kind.setAttribute('aria-label', `What kind of staff ${person.display_name} is`);

  const save = el('button', { type: 'button', className: 'button button-quiet', text: 'Save' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const { error } = await supabase.from('staff')
      .update({ display_name: name.value.trim(), kind: kind.value })
      .eq('id', person.id);
    save.disabled = false;
    if (error) {
      status(note, `That did not save: ${error.message}`, 'error');
      return;
    }
    await reload();
  });

  // Retired, never deleted: a past event's staffing still points here.
  const toggle = el('button', {
    type: 'button', className: 'link-button',
    text: person.is_active ? 'Retire' : 'Bring back'
  });
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    const { error } = await supabase.from('staff').update({
      is_active: !person.is_active,
      retired_at: person.is_active ? new Date().toISOString() : null
    }).eq('id', person.id);
    toggle.disabled = false;
    if (error) {
      status(note, `That did not save: ${error.message}`, 'error');
      return;
    }
    await reload();
  });

  // A regular with no player record cannot be ticked as a judge on the upload
  // screen, because the loyalty week and the attendance point would have
  // nobody to land on. Said here, where it can be fixed.
  const needsPlayer = person.kind === 'regular' && !person.player_id;

  return el('li', { className: person.is_active ? 'roster-row' : 'roster-row is-retired' }, [
    el('span', { className: 'roster-fields' }, [name, kind]),
    el('span', { className: 'roster-meta' }, [
      person.player_id
        ? el('a', { className: 'player-id', href: `trainer-card.html?id=${person.player_id}`,
            text: person.player_id })
        : el('span', { className: 'muted-note', text: 'No player record' }),
      needsPlayer
        ? el('span', { className: 'tag tag-new',
            title: 'A regular needs a Player ID before they can be ticked as a judge on the upload screen.',
            text: 'not a judge yet' })
        : null,
      person.is_active ? null : el('span', { className: 'tag', text: 'retired' })
    ]),
    el('span', { className: 'roster-actions' }, [save, toggle])
  ]);
}

function addStaffPanel(reload, note) {
  const kind = pick(KINDS, 'regular');
  kind.setAttribute('aria-label', 'What kind of staff');
  const nameInput = el('input', { id: 'new-staff-name', placeholder: 'Alice',
    'aria-label': 'Name on the rota' });

  const pickerNote = el('p', { className: 'form-status', role: 'status' });

  async function create({ player, displayName }) {
    const name = (displayName || '').trim() || (player ? player.first_name : '');
    if (!name) {
      status(pickerNote, 'A name for the rota is needed.', 'error');
      return;
    }

    // The player is created first where they are new, because the staff row
    // points at it. The other way round leaves a staff row referring to a
    // player that does not exist.
    if (player && player.isNew) {
      const { error } = await supabase.from('players').insert({
        player_id: player.player_id,
        first_name: player.first_name,
        last_name: player.last_name,
        birth_year: player.birth_year ?? null
      });
      if (error) {
        status(pickerNote, `That player could not be created: ${error.message}`, 'error');
        return;
      }
    }

    const { error } = await supabase.from('staff').insert({
      display_name: name,
      player_id: player ? player.player_id : null,
      kind: kind.value
    });
    if (error) {
      status(pickerNote, `That did not save: ${error.message}`, 'error');
      return;
    }
    nameInput.value = '';
    status(pickerNote, `${name} is on the roster.`, 'good');
    await reload();
  }

  const picker = playerPicker({
    allowCreate: true,
    label: 'Their player record (Player ID or name)',
    onPick: (player) => create({ player, displayName: nameInput.value || player.first_name })
  });

  const withoutPlayer = el('button', {
    type: 'button', className: 'button button-quiet',
    text: 'Add without a player record'
  });
  withoutPlayer.addEventListener('click', () => create({ player: null, displayName: nameInput.value }));

  return el('details', { className: 'disclosure' }, [
    el('summary', { text: 'Add somebody to the roster' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: 'This adds a name to the rota. It does not create a login: an '
            + 'account to sign in with is still made in Supabase, and nothing '
            + 'on this page grants anybody access to player records.' }),
      el('p', { className: 'field' }, [
        el('label', { for: nameInput.id, text: 'Name on the rota' }), nameInput,
        el('span', { className: 'field-help',
          text: 'The short name the rota is read by. Left empty, their first name is used.' })
      ]),
      el('p', { className: 'field' }, [
        el('label', { text: 'Regular or volunteer' }, [kind]),
        el('span', { className: 'field-help',
          text: 'A regular is offered as a judge on the TDF upload screen. A volunteer is not.' })
      ]),
      el('p', { className: 'field-help',
        text: 'Find their player record so a judging week can be awarded, or add '
            + 'them without one — a volunteer who never plays does not need it.' }),
      picker,
      pickerNote,
      el('p', {}, [withoutPlayer])
    ])
  ]);
}

function rosterPanel(reload, note) {
  return el('section', { className: 'card' }, [
    el('h2', { text: 'The roster' }),
    el('p', { className: 'field-help',
      text: 'Everybody who staffs a league day. Retired, never deleted, so a past '
          + 'event keeps the names on it.' }),
    roster.length
      ? el('ul', { className: 'roster-list' }, roster.map((p) => rosterRow(p, reload, note)))
      : el('p', { className: 'muted-note', text: 'Nobody on the roster yet.' }),
    addStaffPanel(reload, note)
  ]);
}

// --- The page -----------------------------------------------------------------

function viewToggle(reload) {
  const make = (past, label) => {
    const b = el('button', {
      type: 'button',
      className: showPast === past ? 'button' : 'button button-quiet',
      'aria-pressed': String(showPast === past),
      text: label
    });
    b.addEventListener('click', async () => {
      if (showPast === past) return;
      showPast = past;
      await reload();
    });
    return b;
  };

  return el('div', { className: 'view-toggle', role: 'group',
    'aria-label': 'Which events to show' }, [
    make(false, 'Coming up'),
    make(true, 'Past events')
  ]);
}

async function draw() {
  const note = el('p', { className: 'form-status', role: 'status' });

  const reload = async () => {
    await load();
    await draw();
  };

  app.replaceChildren(...[
    viewToggle(reload),
    showPast
      ? el('p', { className: 'field-help',
          text: 'Past events, as they were staffed. Read only — a rota stops being '
              + 'a plan once the day has happened.' })
      : null,
    note,
    el('section', { className: 'card' }, [
      el('h2', { text: 'Staff availability' }),
      el('p', { className: 'field-help',
        text: 'Who can make each event. Playing means they will be here but in '
            + 'the tournament rather than staffing it, so they do not count '
            + 'toward the number present.' }),
      availabilityPanel(note)
    ]),
    el('section', { className: 'staff-events' }, [
      el('h2', { text: 'Event staffing' }),
      events.length
        ? el('div', {}, events.map((e) => eventCard(e, reload, note)))
        : el('p', { className: 'muted-note', text: 'No events to staff.' })
    ]),
    showPast ? null : rosterPanel(reload, note)
  ].filter(Boolean));
}

(async () => {
  const professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  try {
    await load();
    await draw();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The staff schedule'));
  }
})();
