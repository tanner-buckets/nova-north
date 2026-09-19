import {
  supabase, el, problem, formatEventDay, formatEventTime, leagueDayKey,
  DIVISION_LABEL, byDivision
} from './supabase-client.js';

const list = document.querySelector('#event-list');

// Refusal codes from register_for_event(), turned into something a person can
// act on. An unrecognised code still produces a usable message rather than a
// blank.
const REGISTER_MESSAGES = {
  player_id_required: 'A Player ID is required to register.',
  missing_details: 'Please fill in every field except the contact, which is optional.',
  unknown_event: 'That event could not be found. Reload the page and try again.',
  registration_closed: 'Registration is not open for this event.',
  already_registered: 'That Player ID is already registered for this event.'
};

const TYPE_LABELS = {
  league: 'League', casual: 'Casual play', challenge: 'League Challenge',
  cup: 'League Cup', prerelease: 'Prerelease', special: 'Special event'
};

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// An event with a real capacity is one where a place can run out, so
// pre-registration means something. An uncapped event cannot fill, so saying
// "registration is not open yet" would be misleading -- there is nothing to open.
function takesRegistration(counts) {
  return counts.some((c) => c.capacity !== null);
}

function spotsLine(counts) {
  if (!counts.length) return null;

  // public_event_counts has no ORDER BY, so without this the divisions arrive in
  // whatever order the database felt like and Masters can sit above Juniors.
  const ordered = [...counts].sort((a, b) => byDivision(a.division, b.division));

  const rows = ordered.map((c) => {
    const label = c.division === 'all'
      ? 'Spots'
      : `${DIVISION_LABEL[c.division] || capitalise(c.division)}s`;
    let value;
    if (c.capacity === null) {
      value = c.confirmed_count > 0 ? `${c.confirmed_count} registered` : null;
    } else {
      const left = c.capacity - c.confirmed_count;
      value = left > 0 ? `${left} of ${c.capacity} left` : 'Full';
    }
    if (value === null) return null;
    const waiting = c.waitlist_count > 0 ? ` (${c.waitlist_count} waiting)` : '';
    return el('li', {}, [
      el('span', { text: label }),
      el('span', { className: 'count', text: value + waiting })
    ]);
  }).filter(Boolean);

  if (!rows.length) return null;
  return el('div', { className: 'event-spots' }, [
    el('ul', { className: 'division-list' }, rows)
  ]);
}

function registerForm(event) {
  const status = el('p', { className: 'form-status', role: 'status' });

  const field = (name, label, attrs = {}) => el('p', { className: 'field' }, [
    el('label', { for: `${name}-${event.id}`, text: label }),
    el('input', { id: `${name}-${event.id}`, name, ...attrs })
  ]);

  const form = el('form', { className: 'register-form' }, [
    field('player_id', 'Player ID', { required: 'required', inputmode: 'numeric', autocomplete: 'off' }),
    el('p', { className: 'field-help' }, [
      el('a', { href: 'id_help.html', text: 'I do not have a Player ID' })
    ]),
    field('first_name', 'First name', { required: 'required', autocomplete: 'given-name' }),
    field('last_name', 'Last name', { required: 'required', autocomplete: 'family-name' }),
    field('birth_year', 'Birth year', {
      required: 'required', type: 'number', inputmode: 'numeric',
      min: '1900', max: String(new Date().getFullYear()), placeholder: 'e.g. 2014'
    }),
    el('p', { className: 'field-help', text: 'Used to place you in the right age division. It is never shown publicly.' }),
    field('contact', 'Discord or email (optional)', { autocomplete: 'email' }),
    el('p', { className: 'field-help', text: 'Only so a professor can reach you if there is a problem with your registration.' }),
    el('p', {}, [el('button', { type: 'submit', className: 'button', text: 'Register' })]),
    status
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Sending...';

    const data = Object.fromEntries(new FormData(form).entries());
    const { data: result, error } = await supabase.rpc('register_for_event', {
      p_event_id: event.id,
      p_player_id: data.player_id,
      p_first_name: data.first_name,
      p_last_name: data.last_name,
      p_birth_year: Number(data.birth_year),
      p_contact: data.contact || null
    });

    button.disabled = false;

    if (error) {
      status.className = 'form-status is-error';
      status.textContent = 'That did not go through. Check your connection and try again.';
      return;
    }

    if (!result.ok) {
      status.className = 'form-status is-error';
      status.textContent = REGISTER_MESSAGES[result.code]
        || 'That did not go through. Please ask a professor.';
      return;
    }

    status.className = 'form-status is-good';
    if (result.status === 'confirmed') {
      status.textContent = `You are registered, in the ${capitalise(result.division)} division. `
        + 'There is no confirmation email, so this message is your confirmation.';
    } else {
      status.textContent = 'This event is full, so you are on the waiting list at number '
        + `${result.waitlist_position}, in the ${capitalise(result.division)} division. `
        + 'A professor will be in touch if a place opens up.';
    }
    form.querySelectorAll('input').forEach((i) => { i.value = ''; });
    refresh();
  });

  return form;
}

function cancelForm(event) {
  const status = el('p', { className: 'form-status', role: 'status' });

  const form = el('form', { className: 'cancel-form' }, [
    el('p', { className: 'field' }, [
      el('label', { for: `cancel-id-${event.id}`, text: 'Player ID' }),
      el('input', { id: `cancel-id-${event.id}`, name: 'player_id', required: 'required', inputmode: 'numeric' })
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: `cancel-name-${event.id}`, text: 'First name' }),
      el('input', { id: `cancel-name-${event.id}`, name: 'first_name', required: 'required' })
    ]),
    el('p', {}, [el('button', { type: 'submit', className: 'button button-quiet', text: 'Request cancellation' })]),
    status
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Sending...';

    const data = Object.fromEntries(new FormData(form).entries());
    const { error } = await supabase.rpc('request_drop', {
      p_player_id: data.player_id,
      p_first_name: data.first_name,
      p_event_id: event.id
    });

    button.disabled = false;

    if (error) {
      status.className = 'form-status is-error';
      status.textContent = 'That did not go through. Check your connection and try again.';
      return;
    }

    // The function answers identically whether or not a registration matched, so
    // that it cannot be used to discover who is registered. The wording has to
    // hold up either way: it reports the request as sent, not a booking as found.
    status.className = 'form-status is-good';
    status.textContent = 'Your cancellation request has been sent. A professor will '
      + 'confirm it, and your place is not released until they do. If you do not hear '
      + 'back, speak to a professor at league.';
    form.querySelectorAll('input').forEach((i) => { i.value = ''; });
  });

  return form;
}

function disclosure(summaryText, content) {
  return el('details', { className: 'disclosure' }, [
    el('summary', { text: summaryText }),
    content
  ]);
}

function eventCard(event, counts) {
  const badges = [el('li', {
    className: `badge badge-${event.event_type}`,
    text: TYPE_LABELS[event.event_type] || event.event_type
  })];
  if (event.is_premier) {
    badges.push(el('li', { className: 'badge badge-note', text: 'Player ID required' }));
  }

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
    spotsLine(counts)
  ];

  if (event.registration_open) {
    body.push(disclosure('Register for this event', registerForm(event)));
    body.push(disclosure('Cancel a registration', cancelForm(event)));
  } else if (takesRegistration(counts)) {
    body.push(el('p', {
      className: 'event-note',
      text: 'Registration for this event has not opened yet. Check back closer to the date.'
    }));
  } else {
    body.push(el('p', {
      className: 'event-note',
      text: 'No pre-registration for this event. Just turn up.'
    }));
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

async function refresh() {
  try {
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
