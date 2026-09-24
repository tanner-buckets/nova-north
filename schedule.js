import {
  supabase, el, problem, formatEventDay, formatEventTime, leagueDayKey
} from './supabase-client.js';
import {
  TYPE_LABELS, spotsHost, fillSpots, registrationBlock, eventPath
} from './event-registration.js';

const list = document.querySelector('#event-list');

// event id -> the element holding that card's places left. Rebuilt on every full
// render, and refilled on its own after somebody registers so the form keeps the
// confirmation it just printed.
const spots = new Map();

function eventCard(event, counts) {
  const badges = [el('li', {
    className: `badge badge-${event.event_type}`,
    text: TYPE_LABELS[event.event_type] || event.event_type
  })];
  if (event.is_premier) {
    badges.push(el('li', { className: 'badge badge-note', text: 'Player ID required' }));
  }

  const host = spotsHost(counts);
  spots.set(event.id, host);

  const body = [
    el('p', { className: 'event-when' }, [
      el('time', { datetime: event.starts_at, className: 'event-time',
                   text: formatEventTime(event.starts_at) })
    ]),
    el('h3', { className: 'event-name', text: event.name }),
    el('ul', { className: 'badges' }, badges),
    event.description ? el('p', { text: event.description }) : null,
    el('p', { className: 'event-fee' }, [
      el('span', { text: 'Entry: ' }),
      el('span', { className: 'count', text: event.entry_fee || 'Free' })
    ]),
    host
  ];

  body.push(...registrationBlock(event, counts, { onChange: refreshCounts }));

  // An event that takes registration gets a page of its own, so a professor has
  // something to post that is this event and not the whole schedule. Only where
  // registration is open: a link to a page saying "just turn up" is a link
  // nobody needs.
  if (event.registration_open) {
    body.push(el('p', { className: 'event-permalink' }, [
      el('a', { href: eventPath(event), text: 'Open this event on its own page' })
    ]));
  }

  // A League Cup or Challenge is a sanctioned premier event, which is a
  // different kind of afternoon from a casual Sunday. is_premier is the flag
  // that says so, and it is set on exactly those two.
  if (event.is_premier) {
    body.unshift(el('img', {
      className: 'event-premier-mark',
      src: 'images/worlds.png',
      width: '48', height: '49',
      alt: 'Premier event',
      loading: 'lazy', decoding: 'async'
    }));
  }

  return el('li', {
    className: 'card event' + (event.is_premier ? ' event-premier' : '')
  }, body);
}

// Days carrying more than one event get the same treatment as any other day: the
// date is the heading of the group. That makes a double-header obvious without
// needing to say so.
function dayGroup(dayKey, events, byEvent) {
  const heading = formatEventDay(events[0].starts_at);
  const multiple = events.length > 1;

  return el('section', {
    className: multiple ? 'day-group day-group-multi' : 'day-group',
    'aria-labelledby': `day-${dayKey}`
  }, [
    el('h2', { className: 'day-heading', id: `day-${dayKey}` }, [
      el('span', { text: heading }),
      multiple ? el('span', { className: 'day-count', text: `${events.length} events` }) : null
    ]),
    el('ul', { className: 'card-list' },
      events.map((e) => eventCard(e, byEvent.get(e.id) || [])))
  ]);
}

// Only the numbers. A full render would replace the form a player has just
// registered on, taking the confirmation with it.
async function refreshCounts() {
  const { data, error } = await supabase.from('public_event_counts').select('*');
  if (error) return;

  const byEvent = new Map();
  for (const row of data) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
    byEvent.get(row.event_id).push(row);
  }
  for (const [id, host] of spots) fillSpots(host, byEvent.get(id) || []);
}

async function refresh() {
  try {
    spots.clear();

    const nowIso = new Date().toISOString();

    const [{ data: events, error: eventError }, { data: counts, error: countError }] =
      await Promise.all([
        supabase.from('events').select('*').gte('starts_at', nowIso).order('starts_at'),
        supabase.from('public_event_counts').select('*')
      ]);

    if (eventError || countError) throw eventError || countError;

    if (!events.length) {
      list.replaceChildren(el('p', {
        className: 'notice notice-quiet',
        text: 'Nothing is scheduled yet. Check back soon, or ask a professor at league.'
      }));
      return;
    }

    const byEvent = new Map();
    for (const row of counts) {
      if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
      byEvent.get(row.event_id).push(row);
    }

    // Group by league-time day, not the visitor's day: an 11:00 AM event should
    // not slide onto a different date for someone reading in another zone.
    const days = new Map();
    for (const event of events) {
      const key = leagueDayKey(event.starts_at);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(event);
    }

    list.replaceChildren(...[...days.entries()].map(([key, dayEvents]) =>
      dayGroup(key, dayEvents, byEvent)));
  } catch (err) {
    console.error(err);
    list.replaceChildren(problem('The schedule'));
  } finally {
    list.removeAttribute('aria-busy');
  }
}

refresh();
