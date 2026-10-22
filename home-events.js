// What is on next, at the top of the home page.
//
// Two questions a visitor lands here with: is there league this Sunday, and is
// there anything I need to sign up for. The schedule answers both but costs a
// tap, and somebody checking on a phone on Saturday night should not have to
// take it.
//
// It reads the same table the schedule reads and shows strictly less: no
// description, no entry fee, no places left. A banner that repeats the schedule
// is a second schedule to keep in step.
import {
  supabase, el, formatEventDay, formatEventTime, leagueDayKey, arriveAt
} from './supabase-client.js';
import { eventPath, registrationState } from './event-registration.js';

const host = document.querySelector('#up-next');

function heading(text) {
  return el('h2', { id: 'up-next-heading', className: 'upnext-title', text });
}

function seeSchedule(text) {
  return el('p', { className: 'upnext-note' }, [
    el('span', { text: `${text} ` }),
    el('a', { href: 'schedule.html', text: 'See the schedule' })
  ]);
}

// Every state keeps a heading, because the section is labelled by its id. An
// empty banner that dropped it would leave aria-labelledby pointing at nothing.
function quiet(text) {
  host.replaceChildren(heading('What is on next'), seeSchedule(text));
}

// An event line. The time is when to turn up, the same figure the schedule
// leads with -- two surfaces disagreeing about when to arrive would be worse
// than neither of them saying.
function eventRow(event, { withDay = false } = {}) {
  const state = registrationState(event);
  const when = withDay
    ? `${formatEventDay(event.starts_at)}, ${formatEventTime(arriveAt(event))}`
    : formatEventTime(arriveAt(event));

  // No type chip here, although the schedule carries one. Every event this
  // league runs is named for its type -- "TCG League Cup", "Delta Reign
  // Prerelease" -- so the chip repeated the name back and pushed the sign-up
  // link onto a second line on a phone.
  return el('li', { className: 'upnext-event' }, [
    el('time', { className: 'upnext-when', datetime: arriveAt(event), text: when }),
    el('span', { className: 'upnext-name', text: event.name }),
    // Only where there is something to do. An event that takes no registration
    // has a page, but sending somebody to it to read "just turn up" is a tap
    // that gives nothing back.
    event.registration_open
      ? el('a', {
          className: 'upnext-link',
          href: eventPath(event),
          text: state === 'open' ? 'Sign up' : 'Details'
        })
      : null
  ]);
}

function render(events) {
  if (!events.length) {
    quiet('Nothing is on the calendar yet.');
    return;
  }

  // The soonest day with anything on it, which is a Sunday nearly every week
  // but is not assumed to be: a prerelease on a Saturday is still the next
  // thing happening, and a banner that skipped it would be wrong on exactly
  // the weekend it mattered most.
  const nextKey = leagueDayKey(events[0].starts_at);
  const nextDay = events.filter((e) => leagueDayKey(e.starts_at) === nextKey);

  // Everything further out that can be signed up for. Events on the next day
  // are left out because they are already above, with their own link.
  const laterOpen = events.filter((e) =>
    leagueDayKey(e.starts_at) !== nextKey && e.registration_open);

  const blocks = [
    heading(`Next: ${formatEventDay(events[0].starts_at)}`),
    el('ul', { className: 'upnext-list' }, nextDay.map((e) => eventRow(e)))
  ];

  if (laterOpen.length) {
    blocks.push(
      el('p', { className: 'upnext-subtitle', text: 'Open for sign-up' }),
      el('ul', { className: 'upnext-list' },
        laterOpen.map((e) => eventRow(e, { withDay: true })))
    );
  }

  blocks.push(seeSchedule('Everything else is on the schedule.'));
  host.replaceChildren(...blocks);
}

async function load() {
  try {
    // Upcoming means play has not started. An event whose desk is already open
    // is still ahead of you and still the thing to come to.
    const { data, error } = await supabase
      .from('events')
      .select('id, name, event_type, starts_at, registration_opens_at, '
            + 'registration_open, registration_closed_at')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');
    if (error) throw error;
    render(data || []);
  } catch (err) {
    console.error(err);
    // Quietly, and with a way on. This is a summary of a page that still
    // works; a red box across the top of the home page would be louder than
    // the problem.
    quiet('What is on could not be loaded just now.');
  } finally {
    host.removeAttribute('aria-busy');
  }
}

load();
