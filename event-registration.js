// Registering for an event, and asking to be taken off it.
//
// Shared by the schedule and by an event's own page. The refusal codes, the
// division wording and the "your place is not released until a professor
// confirms" sentence all have to be identical in both places: two copies of a
// form that writes to the database is two places for a message to go stale, and
// the one that goes stale is the one nobody is looking at.
import { supabase, el, DIVISION_LABEL, byDivision } from './supabase-client.js';

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

export const TYPE_LABELS = {
  league: 'League', casual: 'Casual play', challenge: 'League Challenge',
  cup: 'League Cup', prerelease: 'Prerelease', special: 'Special event'
};

export function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The page a link can be posted to. Relative, so it works from the project
// subpath GitHub Pages serves this site from without anybody writing the host
// into the code.
export function eventPath(event, prefix = '') {
  return `${prefix}event.html?e=${encodeURIComponent(event.id)}`;
}

// An event with a real capacity is one where a place can run out, so
// pre-registration means something. An uncapped event cannot fill, so saying
// "registration is not open yet" would be misleading -- there is nothing to open.
export function takesRegistration(counts) {
  return counts.some((c) => c.capacity !== null);
}

// The places left, in an element that can be refilled.
//
// A successful registration has to change this number without re-rendering the
// form, because the form is holding the only confirmation the player gets:
// there is no email, and the message on the form says so. Redrawing the card
// would take it away before they had read it.
export function spotsHost(counts) {
  const host = el('div', { className: 'event-spots' });
  fillSpots(host, counts);
  return host;
}

export function fillSpots(host, counts) {
  const rows = spotRows(counts);
  host.replaceChildren(rows ? el('ul', { className: 'division-list' }, rows) : null);
  host.hidden = !rows;
}

function spotRows(counts) {
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

  return rows.length ? rows : null;
}

// onChange is called after a successful registration so the page can re-read the
// counts. The schedule and the event page hold different things on screen, so
// each says how to refresh itself rather than this knowing.
export function registerForm(event, { onChange, prefix = '' } = {}) {
  const status = el('p', { className: 'form-status', role: 'status' });

  const field = (name, label, attrs = {}) => el('p', { className: 'field' }, [
    el('label', { for: `${name}-${event.id}`, text: label }),
    el('input', { id: `${name}-${event.id}`, name, ...attrs })
  ]);

  const form = el('form', { className: 'register-form' }, [
    field('player_id', 'Player ID', { required: 'required', inputmode: 'numeric', autocomplete: 'off' }),
    el('p', { className: 'field-help' }, [
      el('a', { href: `${prefix}id_help.html`, text: 'I do not have a Player ID' })
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
    if (onChange) onChange();
  });

  return form;
}

export function cancelForm(event) {
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

// The register and cancel forms, or the reason there are none.
//
// Folded away on the schedule, where a card is one of many and the forms would
// bury the next event. Open on an event's own page, where registering is the
// only reason anybody followed the link.
export function registrationBlock(event, counts, { onChange, open = false, prefix = '' } = {}) {
  if (!event.registration_open) {
    return [el('p', {
      className: 'event-note',
      text: takesRegistration(counts)
        ? 'Registration for this event has not opened yet. Check back closer to the date.'
        : 'No pre-registration for this event. Just turn up.'
    })];
  }

  const register = registerForm(event, { onChange, prefix });
  const cancel = cancelForm(event);

  if (!open) {
    return [
      el('details', { className: 'disclosure' }, [
        el('summary', { text: 'Register for this event' }), register
      ]),
      el('details', { className: 'disclosure' }, [
        el('summary', { text: 'Cancel a registration' }), cancel
      ])
    ];
  }

  return [
    el('h3', { text: 'Register' }),
    register,
    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Cancel a registration' }), cancel
    ])
  ];
}
