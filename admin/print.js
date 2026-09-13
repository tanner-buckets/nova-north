// Printable lists: loyalty tiers for the store, and pre-registration for the
// desk.
//
// Both show full names. That is a disclosure to the venue and to the person
// running the desk, not publication -- these pages are professor-only, nothing
// here is ever rendered on a public page, and a printed sheet is handed to a
// person rather than left on the internet. The screen says so, because somebody
// holding a sheet of children's names should know what they are holding.
//
// The output is a print stylesheet, not a generated file. No PDF library.
import { supabase, el, problem, formatEventDay, formatEventTime } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');

let professor = null;

const DIVISIONS = [['junior', 'Junior'], ['senior', 'Senior'], ['master', 'Master']];
const DIVISION_LABEL = Object.fromEntries(DIVISIONS);

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});

function day(value) {
  return value ? DAY.format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '';
}

function byFirstName(a, b) {
  return (a.first_name || '').localeCompare(b.first_name || '')
      || (a.last_name || '').localeCompare(b.last_name || '');
}

function printedAt() {
  return el('p', { className: 'sheet-foot',
    text: `Printed ${DAY.format(new Date())}. Contains names and Player IDs. `
        + 'Hand it to somebody; do not leave it out.' });
}

// --- Loyalty ------------------------------------------------------------------

// Weeks come from loyalty_weeks(), one call per player, rather than being
// counted here. The rule -- distinct days inside the window, plus the carryover
// bridge -- lives in the database, and a second copy in the browser would be a
// second answer that could disagree with the player's own card. It is a handful
// of calls for a sheet printed once a release, and only for players who have
// attendance in the window at all.
async function loyaltyRows(release) {
  const { data: attendance, error } = await supabase
    .from('attendance')
    .select('player_id')
    .gte('attended_on', release.starts_on)
    .lte('attended_on', release.ends_on);
  if (error) throw error;

  const { data: carryover } = await supabase
    .from('loyalty_carryover').select('player_id').eq('release_id', release.id);

  const ids = [...new Set([
    ...(attendance || []).map((r) => r.player_id),
    ...(carryover || []).map((r) => r.player_id)
  ])];
  if (!ids.length) return [];

  const { data: players, error: pErr } = await supabase
    .from('players').select('player_id, first_name, last_name').in('player_id', ids);
  if (pErr) throw pErr;

  const weeks = await Promise.all(ids.map(async (id) => {
    const { data } = await supabase.rpc('loyalty_weeks',
      { p_player_id: id, p_release_id: release.id });
    return [id, data || 0];
  }));
  const byId = new Map(weeks);

  return (players || []).map((p) => ({ ...p, weeks: byId.get(p.player_id) || 0 }));
}

export function loyaltySheet(release, tiers, rows) {
  // Highest threshold first, so a player lands in the best tier they reached and
  // appears once. Anyone below every threshold is left off entirely: the sheet is
  // what the store hands out against, and a name on it that earns nothing is a
  // name somebody has to check and then ignore.
  const ordered = [...tiers].sort((a, b) => b.weeks_required - a.weeks_required);
  const placed = new Set();

  const groups = ordered.map((tier) => {
    const members = rows
      .filter((r) => !placed.has(r.player_id) && r.weeks >= tier.weeks_required)
      .sort(byFirstName);
    members.forEach((m) => placed.add(m.player_id));
    return { tier, members };
  });

  return el('article', { className: 'sheet' }, [
    el('header', { className: 'sheet-head' }, [
      el('h2', { text: `${release.name} — loyalty` }),
      el('p', { text: `${day(release.starts_on)} to ${day(release.ends_on)}` }),
      el('p', { className: 'sheet-sub',
        text: 'NoVa North League at Continental Cards' })
    ]),

    ...groups.map(({ tier, members }) => el('section', { className: 'sheet-group' }, [
      el('h3', { text: `${tier.tier_name} — ${tier.weeks_required} Sundays `
        + `— ${tier.product}` }),
      members.length
        ? el('table', { className: 'sheet-table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Name' }),
              el('th', { text: 'Player ID' }),
              el('th', { text: 'Sundays' }),
              el('th', { className: 'sheet-tick', text: 'Given' })
            ])]),
            el('tbody', {}, members.map((m) => el('tr', {}, [
              el('td', { text: `${m.first_name} ${m.last_name}`.trim() }),
              el('td', { className: 'count', text: m.player_id }),
              el('td', { className: 'count', text: m.weeks }),
              el('td', { className: 'sheet-tick', text: '' })
            ])))
          ])
        : el('p', { className: 'muted-note', text: 'Nobody has reached this tier.' })
    ])),

    printedAt()
  ]);
}

// --- Pre-registration ---------------------------------------------------------

export function registrationSheet(event, rows) {
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  const waiting = rows.filter((r) => r.status === 'waitlist')
    .sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0));
  const asked = rows.filter((r) => r.status === 'drop_requested');

  const divisionBlock = (label, members) => el('section', { className: 'sheet-group' }, [
    el('h3', { text: `${label} (${members.length})` }),
    members.length
      ? el('table', { className: 'sheet-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { className: 'sheet-tick', text: 'Here' }),
            el('th', { text: 'Name' }),
            el('th', { text: 'Player ID' })
          ])]),
          el('tbody', {}, members.sort(byFirstName).map((m) => el('tr', {}, [
            el('td', { className: 'sheet-tick', text: '' }),
            el('td', { text: `${m.first_name} ${m.last_name}`.trim() }),
            el('td', { className: 'count', text: m.player_id })
          ])))
        ])
      : el('p', { className: 'muted-note', text: 'Nobody.' })
  ]);

  return el('article', { className: 'sheet' }, [
    el('header', { className: 'sheet-head' }, [
      el('h2', { text: event.name }),
      el('p', { text: `${formatEventDay(event.starts_at)}, ${formatEventTime(event.starts_at)}` }),
      el('p', { className: 'sheet-sub',
        text: `${confirmed.length} registered, ${waiting.length} on the wait list` })
    ]),

    el('h3', { className: 'sheet-section', text: 'Registered' }),
    ...DIVISIONS.map(([key, label]) =>
      divisionBlock(label, confirmed.filter((r) => r.division === key))),

    el('h3', { className: 'sheet-section', text: 'Wait list' }),
    waiting.length
      ? el('table', { className: 'sheet-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: '#' }),
            el('th', { text: 'Name' }),
            el('th', { text: 'Player ID' }),
            el('th', { text: 'Division' })
          ])]),
          // In queue order, not alphabetical. The order is the whole point of a
          // wait list, and sorting it by name would destroy the only piece of
          // information it carries.
          el('tbody', {}, waiting.map((m) => el('tr', {}, [
            el('td', { className: 'count', text: m.waitlist_position ?? '' }),
            el('td', { text: `${m.first_name} ${m.last_name}`.trim() }),
            el('td', { className: 'count', text: m.player_id }),
            el('td', { text: DIVISION_LABEL[m.division] || m.division })
          ])))
        ])
      : el('p', { className: 'muted-note', text: 'Nobody on the wait list.' }),

    asked.length
      ? el('section', { className: 'sheet-group' }, [
          el('h3', { text: `Asked to drop (${asked.length})` }),
          el('p', { className: 'muted-note',
            text: 'Not confirmed yet, so they still hold their place.' }),
          el('ul', {}, asked.sort(byFirstName).map((m) =>
            el('li', { text: `${m.first_name} ${m.last_name} — ${m.player_id}` })))
        ])
      : null,

    printedAt()
  ]);
}

// --- Choosing what to print ---------------------------------------------------

function show(node) {
  sheet.replaceChildren(node);
  sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Building a sheet and printing it are one action: nobody builds one to look
  // at it on screen. Two frames, so the browser has laid the new rows out before
  // the dialog freezes the page -- printing mid-layout gives a blank first page.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

async function loyaltyPanel(releases) {
  const select = el('select', { id: 'release' },
    releases.map((r) => el('option', { value: r.id, text: r.name })));
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Build the loyalty sheet' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'release', text: 'Release' }), select
    ]),
    el('p', { className: 'field-help',
      text: 'For the store. Who reached which tier, with a column to tick as each '
          + 'is handed over. Anyone short of every tier is left off. Building it '
          + 'opens the print dialog.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status(note, 'Working out the weeks. This asks the database once per player, '
      + 'so it takes a moment.');
    try {
      const release = releases.find((r) => r.id === select.value);
      const { data: tiers } = await supabase.from('loyalty_tiers')
        .select('*').eq('release_id', release.id);
      const rows = await loyaltyRows(release);
      show(loyaltySheet(release, tiers || [], rows));
      go.disabled = false;
      status(note, `${rows.length} player${rows.length === 1 ? '' : 's'} on the sheet.`, 'good');
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That could not be built: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card no-print' }, [
    el('h2', { text: 'Loyalty tiers, for the store' }),
    releases.length ? form : el('p', { className: 'muted-note' }, [
      el('span', { text: 'No releases exist yet. ' }),
      el('a', { href: 'reference.html', text: 'Add one' })
    ])
  ]);
}

function registrationPanel(events) {
  const select = el('select', { id: 'event' },
    events.map((ev) => el('option', {
      value: ev.id,
      text: `${ev.name} — ${formatEventDay(ev.starts_at)}`
    })));
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Build the desk list' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'event', text: 'Event' }), select
    ]),
    el('p', { className: 'field-help',
      text: 'For the desk. Registered players by division and the wait list in '
          + 'order, with a column to tick people off as they arrive. Building it '
          + 'opens the print dialog.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status(note, 'Building.');
    try {
      const event = events.find((ev) => ev.id === select.value);
      const { data, error } = await supabase.from('registrations')
        .select('player_id, first_name, last_name, division, status, waitlist_position')
        .eq('event_id', event.id).neq('status', 'dropped');
      if (error) throw error;
      show(registrationSheet(event, data || []));
      go.disabled = false;
      status(note, `${(data || []).length} on the sheet.`, 'good');
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That could not be built: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card no-print' }, [
    el('h2', { text: 'Pre-registration, for the desk' }),
    events.length ? form : el('p', { className: 'muted-note' }, [
      el('span', { text: 'No events take registration. ' }),
      el('a', { href: 'events.html', text: 'Open one' })
    ])
  ]);
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
    const [rel, ev] = await Promise.all([
      supabase.from('releases').select('*').order('starts_on', { ascending: false }),
      supabase.from('events').select('*')
        .eq('registration_open', true).order('starts_at')
    ]);
    if (rel.error || ev.error) throw rel.error || ev.error;

    app.replaceChildren(
      await loyaltyPanel(rel.data || []),
      registrationPanel(ev.data || [])
    );
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The releases and events'));
  }
})();
