// One event, on a page of its own, so a professor has something to post.
//
// The schedule already carries every event and its registration form, but a
// link to the schedule is a link to everything: somebody following it from a
// Discord post has to find the right card, and by the following week the right
// card has moved. This page is the same registration, addressed to one event.
//
// The event is named in the query string by its own id -- ?e=<uuid> -- which
// needs nothing added to the database. Flights of one event share a four digit
// code, and ?g=<code> opens the whole group, because a player looking at a
// prerelease has to be able to pick a flight.
import {
  supabase, el, problem, formatEventDay, formatEventTime, leagueDayKey
} from './supabase-client.js';
import {
  TYPE_LABELS, spotsHost, fillSpots, registrationBlock
} from './event-registration.js';

const host = document.querySelector('#event');

// event id -> the element holding that event's places left. Refilled on its own
// after somebody registers, because redrawing the card would take away the
// message on the form, and that message is the only confirmation they get.
const spots = new Map();

const params = new URLSearchParams(window.location.search);
const eventId = params.get('e');
const groupCode = params.get('g');

// A mangled link -- one truncated by a chat client, or retyped with a character
// missing -- would otherwise reach Postgres as an invalid uuid and come back as
// an error. "That could not be found" is the true answer and the useful one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[0-9]{4}$/;

function notice(heading, body) {
  return el('div', {}, [
    el('h1', { text: heading }),
    el('p', { className: 'lede', text: body }),
    el('p', {}, [el('a', { className: 'button', href: 'schedule.html', text: 'See the schedule' })])
  ]);
}

// Past events are still reachable, because a link outlives the afternoon it was
// posted for and a dead link is worse than a page saying what happened.
function isPast(event) {
  return new Date(event.starts_at).getTime() < Date.now();
}

function detail(event, counts, { onChange, heading, tag = 'div' }) {
  const spotsFor = spotsHost(counts);
  spots.set(event.id, spotsFor);

  const badges = [el('li', {
    className: `badge badge-${event.event_type}`,
    text: TYPE_LABELS[event.event_type] || event.event_type
  })];
  if (event.is_premier) {
    badges.push(el('li', { className: 'badge badge-note', text: 'Player ID required' }));
  }

  // The name leads, unlike on the schedule, where the date is the heading of the
  // group and the card only has to say the time. Somebody arriving from a posted
  // link is asking what this is before they ask when it is.
  const body = [
    event.is_premier
      ? el('img', {
          className: 'event-premier-mark',
          src: 'images/worlds.png',
          width: '48', height: '49',
          alt: 'Premier event',
          loading: 'lazy', decoding: 'async'
        })
      : null,
    el(heading, { className: 'event-name', text: event.name }),
    el('p', { className: 'event-when' }, [
      el('time', { datetime: event.starts_at, className: 'event-time',
                   text: `${formatEventDay(event.starts_at)}, ${formatEventTime(event.starts_at)}` })
    ]),
    el('ul', { className: 'badges' }, badges),
    event.description ? el('p', { text: event.description }) : null,
    el('p', { className: 'event-fee' }, [
      el('span', { text: 'Entry: ' }),
      el('span', { className: 'count', text: event.entry_fee || 'Free' })
    ]),
    spotsFor
  ];

  if (isPast(event)) {
    body.push(el('p', { className: 'event-note',
      text: 'This event has already happened, so registration is closed.' }));
  } else {
    body.push(...registrationBlock(event, counts, { onChange, open: true }));
  }

  return el(tag, {
    className: 'card event' + (event.is_premier ? ' event-premier' : '')
  }, body);
}

async function countsFor(ids) {
  const { data, error } = await supabase
    .from('public_event_counts').select('*').in('event_id', ids);
  if (error) throw error;

  const byEvent = new Map(ids.map((id) => [id, []]));
  for (const row of data) byEvent.get(row.event_id)?.push(row);
  return byEvent;
}

// Only the numbers, for the reason spots is a map at all.
async function refreshCounts() {
  try {
    const byEvent = await countsFor([...spots.keys()]);
    for (const [id, node] of spots) fillSpots(node, byEvent.get(id) || []);
  } catch (err) {
    // A stale number is not worth an error message over a registration that
    // went through. The confirmation on the form is the part that matters.
    console.error(err);
  }
}

async function refresh() {
  try {
    if (!eventId && !groupCode) {
      host.replaceChildren(notice('No event in that link',
        'The link is missing the part that says which event it is for. The '
        + 'schedule has everything coming up, with registration on each one.'));
      return;
    }

    if (eventId ? !UUID.test(eventId) : !CODE.test(groupCode)) {
      host.replaceChildren(notice('That link is not complete',
        'Part of it seems to be missing, which happens when a link is split '
        + 'across two lines. Ask for it again, or find the event on the '
        + 'schedule.'));
      return;
    }

    // One event by id, or every flight sharing a code. A flight code is typed by
    // a professor, so it is matched exactly rather than cleaned up: a code that
    // was mistyped should find nothing, not find the wrong event.
    const query = supabase.from('events').select('*');
    const { data: found, error } = groupCode
      ? await query.eq('linked_group_id', groupCode).order('starts_at')
      : await query.eq('id', eventId);
    if (error) throw error;

    if (!found.length) {
      host.replaceChildren(notice('That event could not be found',
        'The link may be out of date, or the event may have been cancelled. '
        + 'The schedule has everything coming up.'));
      return;
    }

    // Following a link to one flight shows the others too, because a full flight
    // is a reason to take a different one rather than to give up. The link keeps
    // working on its own terms: the flight that was linked to is first.
    let events = found;
    if (eventId && found[0].linked_group_id) {
      const { data: group, error: groupError } = await supabase.from('events')
        .select('*').eq('linked_group_id', found[0].linked_group_id).order('starts_at');
      if (groupError) throw groupError;
      if (group.length > 1) events = group;
    }

    spots.clear();
    const counts = await countsFor(events.map((e) => e.id));
    const lead = events.find((e) => e.id === eventId) || events[0];

    document.title = `${lead.name} — LoCo League`;

    // One event is a heading and a form. A group needs a heading of its own, or
    // the first flight's name reads as the title of all of them.
    if (events.length === 1) {
      host.replaceChildren(
        detail(lead, counts.get(lead.id) || [], { onChange: refreshCounts, heading: 'h1' }));
      return;
    }

    const openCount = events.filter((e) => e.registration_open && !isPast(e)).length;
    const days = new Set(events.map((e) => leagueDayKey(e.starts_at)));
    const when = days.size === 1 ? `, on ${formatEventDay(events[0].starts_at)}` : '';

    host.replaceChildren(
      el('h1', { text: lead.name }),
      el('p', { className: 'lede',
        text: `${events.length} flights${when}. `
            + (openCount
                ? 'Register for the one you want to play. You can hold a place in '
                  + 'one flight and wait for a place in the others.'
                : 'Registration is not open yet.') }),
      el('ul', { className: 'card-list' },
        events.map((e) => detail(e, counts.get(e.id) || [],
          { onChange: refreshCounts, heading: 'h2', tag: 'li' })))
    );
  } catch (err) {
    console.error(err);
    host.replaceChildren(problem('That event'));
  } finally {
    host.removeAttribute('aria-busy');
  }
}

refresh();
