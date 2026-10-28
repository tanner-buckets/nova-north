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
import {
  supabase, el, problem, formatEventDay, formatEventTime,
  DIVISION_ORDER, DIVISION_LABEL
} from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');

let professor = null;

// Age groups only. 'all' is the event total, not somebody's division, so nobody
// is ever filed under it.
const AGE_DIVISIONS = DIVISION_ORDER.filter((d) => d !== 'all');

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

// How close to the bottom tier counts as nearly there. Three Sundays is about a
// month of league: near enough that a word at the desk still changes the
// outcome, and not so far back that the list is everybody who ever came once.
const NEARLY_WITHIN = 3;

// Where everybody lands. The tiers and the nearly-there list are worked out in
// one place because they are one walk down the sheet -- a player is in the best
// tier they reached, and nearly there is what is left immediately below the
// bottom one. Pure, so the panel can say what it is about to print without a
// second copy of the rule that could disagree with this one.
function placeRows(tiers, rows) {
  // Highest threshold first, so a player lands in the best tier they reached and
  // appears once.
  const ordered = [...tiers].sort((a, b) => b.weeks_required - a.weeks_required);
  const placed = new Set();

  const groups = ordered.map((tier) => {
    const members = rows
      .filter((r) => !placed.has(r.player_id) && r.weeks >= tier.weeks_required)
      .sort(byFirstName);
    members.forEach((m) => placed.add(m.player_id));
    return { tier, members };
  });

  const bottom = ordered[ordered.length - 1] || null;

  // Closest first: this list answers who to have a word with, and that is read
  // from the top rather than looked up by name. Somebody on no Sundays at all is
  // not nearly there -- they have not started -- and a carryover row of zero
  // weeks is how one of those gets this far.
  const nearly = bottom
    ? rows
        .filter((r) => !placed.has(r.player_id) && r.weeks > 0
          && r.weeks >= bottom.weeks_required - NEARLY_WITHIN)
        .sort((a, b) => b.weeks - a.weeks || byFirstName(a, b))
    : [];

  return { groups, nearly, bottom };
}

// Nobody on this list has earned anything, which is the whole of why it carries
// no tick column: a box to tick is an invitation to hand something over.
function nearlySection(bottom, members) {
  return el('section', { className: 'sheet-group' }, [
    el('h3', { text: `Nearly there — within ${NEARLY_WITHIN} Sundays of ${bottom.tier_name}` }),
    el('p', { className: 'muted-note',
      text: `${bottom.tier_name} is ${bottom.weeks_required} Sundays. Nothing here `
          + 'is earned yet.' }),
    members.length
      ? el('table', { className: 'sheet-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Name' }),
            el('th', { text: 'Player ID' }),
            el('th', { text: 'Sundays' }),
            el('th', { text: 'Short by' })
          ])]),
          el('tbody', {}, members.map((m) => el('tr', {}, [
            el('td', { text: `${m.first_name} ${m.last_name}`.trim() }),
            el('td', { className: 'count', text: m.player_id }),
            el('td', { className: 'count', text: m.weeks }),
            el('td', { className: 'count', text: bottom.weeks_required - m.weeks })
          ])))
        ])
      // Asked for and empty still prints, like a tier nobody reached. Leaving
      // the section out would read on paper as the box not having worked.
      : el('p', { className: 'muted-note', text: 'Nobody is this close yet.' })
  ]);
}

// Anyone below every threshold is left off unless the professor asked for them.
// The sheet is what the store hands out against, and a name on it that earns
// nothing is a name somebody has to check and then ignore.
export function loyaltySheet(release, tiers, rows, { nearly: showNearly = false } = {}) {
  const { groups, nearly, bottom } = placeRows(tiers, rows);

  return el('article', { className: 'sheet' }, [
    el('header', { className: 'sheet-head' }, [
      el('h2', { text: `${release.name} — loyalty` }),
      el('p', { text: `${day(release.starts_on)} to ${day(release.ends_on)}` }),
      el('p', { className: 'sheet-sub',
        text: 'LoCo League at Continental Cards' })
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

    showNearly && bottom ? nearlySection(bottom, nearly) : null,

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
    ...AGE_DIVISIONS.map((key) =>
      divisionBlock(DIVISION_LABEL[key], confirmed.filter((r) => r.division === key))),

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

  // A link can name the release, the same way one can name an event. The
  // loyalty button on the programs page uses this, so a professor who is
  // already looking at the open release does not have to find it again in a
  // list. An id that is not in the list is ignored and the newest stays
  // selected, which is what the dropdown would have shown anyway.
  const wanted = new URLSearchParams(location.search).get('release');
  if (wanted && releases.some((r) => r.id === wanted)) select.value = wanted;

  const nearly = el('input', { type: 'checkbox', id: 'nearly' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Build the loyalty sheet' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'release', text: 'Release' }), select
    ]),
    el('p', { className: 'field-help',
      text: 'For the store. Who reached which tier, with a column to tick as each '
          + 'is handed over. Building it opens the print dialog.' }),

    // Off by default, because the sheet's job is what the store is handing over
    // and a list of people owed nothing on the same paper is a list somebody has
    // to work out they can ignore. Worth asking every time, though: a word at the
    // desk is what turns three Sundays into four.
    el('p', { className: 'field field-inline' }, [
      nearly,
      el('label', { for: 'nearly', text: 'Add the players who are nearly there' })
    ]),
    el('p', { className: 'field-help',
      text: `Everybody within ${NEARLY_WITHIN} Sundays of the bottom tier, closest `
          + 'first, with how many they are short. Nothing on that list is earned '
          + 'yet, so there is nothing to tick.' }),

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
      show(loyaltySheet(release, tiers || [], rows, { nearly: nearly.checked }));
      go.disabled = false;

      // What is on the paper, not what was fetched. loyaltyRows() returns
      // everybody with attendance in the window, and the sheet leaves most of
      // them off, so counting that said forty where the sheet listed nine.
      const placed = placeRows(tiers || [], rows);
      const earned = placed.groups.reduce((n, g) => n + g.members.length, 0);
      const also = nearly.checked
        ? `, and ${placed.nearly.length} nearly there` : '';
      status(note,
        `${earned} player${earned === 1 ? '' : 's'} on the sheet${also}.`, 'good');
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
  const go = el('button', { type: 'submit', className: 'button', text: 'Build the player list' });

  // Arrived from the events screen with an event already in mind. The sheet is
  // not built automatically: building opens the print dialog, and a print
  // dialog nobody asked for is a print dialog somebody dismisses without
  // reading what was behind it.
  const wanted = new URLSearchParams(location.search).get('event');
  if (wanted && events.some((ev) => ev.id === wanted)) select.value = wanted;

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'event', text: 'Event' }), select
    ]),
    el('p', { className: 'field-help',
      text: 'For the desk. Registered players by division and the wait list in '
          + 'order, with a column to tick people off as they arrive. Building it '
          + 'opens the print dialog.' }),
    wanted && !events.some((ev) => ev.id === wanted)
      ? el('p', { className: 'field-help is-warning',
          text: 'The event you came from is not in this list, which means it has '
              + 'stopped taking registration. Turn it back on from the events '
              + 'screen, or pick another event.' })
      : null,
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
