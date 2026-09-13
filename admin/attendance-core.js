// Recording attendance, shared by the tournament file upload and manual entry.
//
// Both routes grant the same things -- a loyalty week and prize points -- so the
// write lives here once. Duplicating it would let the two drift, and the one
// that drifted would be the rarely used one, discovered only when somebody's
// points were wrong.
import { supabase, el } from '../supabase-client.js';

// Expected labels in earning_actions, used only to preselect a dropdown. A
// professor can change either choice at entry, and a renamed action means
// nothing is preselected rather than a silently wrong award.
export const ATTEND_LABEL = 'Attend Sunday League';
export const CASUAL_LABEL = 'Play in casual league tournament';
export const PREMIER_LABEL = 'Play in a league Championship Event';

export async function loadActions() {
  const { data, error } = await supabase
    .from('earning_actions').select('*').eq('is_active', true).order('sort_order');
  if (error || !data) throw error || new Error('No earning actions');
  return data;
}

export function pointsFor(actions, actionId) {
  const a = actions.find((x) => x.id === actionId);
  return a ? a.default_points : 0;
}

// --- Shared form pieces ------------------------------------------------------

export function actionField(actions, id, label, preselectLabel) {
  const select = el('select', { id },
    actions.map((a) => el('option', {
      value: a.id, text: `${a.label} (${a.default_points})`
    })));
  const match = actions.find((a) => a.label === preselectLabel);
  if (match) select.value = match.id;

  return el('p', { className: 'field' }, [
    el('label', { for: id, text: label }),
    select
  ]);
}

export function status(node, message, kind) {
  node.className = 'form-status' + (kind ? ` is-${kind}` : '');
  node.textContent = message;
}

// Find a player by ID or by name. Used wherever a professor has to name someone
// who is not already on the screen in front of them.
export function playerPicker({
  onPick, allowCreate = false,
  idLabel = 'Player ID', nameLabel = 'Or look up an ID by name'
}) {
  const idInput = el('input', { inputmode: 'numeric', placeholder: '1234567' });
  const addById = el('button', { type: 'button', className: 'button button-quiet', text: 'Add by ID' });
  const nameInput = el('input', { placeholder: 'Start typing a name' });
  const found = el('div', { className: 'search-results' });
  const note = el('p', { className: 'form-status', role: 'status' });

  const idFieldId = `pick-id-${Math.random().toString(36).slice(2, 8)}`;
  const nameFieldId = `pick-name-${Math.random().toString(36).slice(2, 8)}`;
  idInput.id = idFieldId;
  nameInput.id = nameFieldId;

  addById.addEventListener('click', async () => {
    const id = idInput.value.trim();
    if (!id) return;
    const { data, error } = await supabase.from('players')
      .select('player_id, first_name, last_name').eq('player_id', id).maybeSingle();
    if (error) {
      status(note, `That lookup failed: ${error.message}. Try again.`, 'error');
      return;
    }
    if (!data) {
      status(note, allowCreate
        ? 'No player has that ID yet. Check the digits, search by name, or add '
          + 'them as someone new below.'
        : 'No player has that ID. Check the digits, search by name, or add them '
          + 'on the players screen.', 'error');
      return;
    }
    idInput.value = '';
    onPick(data, note);
  });

  nameInput.addEventListener('input', async () => {
    const q = nameInput.value.trim();
    if (q.length < 2) { found.replaceChildren(); return; }
    const { data } = await supabase.from('players')
      .select('player_id, first_name, last_name')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .order('first_name').limit(8);
    if (!data) return;

    found.replaceChildren(...data.map((p) => {
      const button = el('button', { type: 'button', className: 'player-button' }, [
        el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}` }),
        el('span', { className: 'player-id count', text: p.player_id })
      ]);
      button.addEventListener('click', () => {
        nameInput.value = '';
        found.replaceChildren();
        onPick(p, note);
      });
      return button;
    }));
  });

  return el('div', { className: 'picker' }, [
    el('p', { className: 'field' }, [el('label', { for: idFieldId, text: idLabel }), idInput]),
    el('p', {}, [addById]),
    el('p', { className: 'field' }, [el('label', { for: nameFieldId, text: nameLabel }), nameInput]),
    found,
    note,
    allowCreate ? newPlayerForm(onPick) : null
  ]);
}

// Someone who has turned up but never played in a tournament, and so has never
// appeared in a file. They come a few times before their first event, and those
// visits count.
//
// Nothing is written here. The new player joins the pending list and is created
// when the attendance is recorded, so a form that gets abandoned leaves no
// half-made player behind.
function newPlayerForm(onPick) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const id = el('input', { id: `new-id-${suffix}`, inputmode: 'numeric', placeholder: '1234567' });
  const first = el('input', { id: `new-first-${suffix}` });
  const last = el('input', { id: `new-last-${suffix}` });
  const year = el('input', {
    id: `new-year-${suffix}`, type: 'number', min: '1900', max: '2100', placeholder: '2014'
  });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'button', className: 'button button-quiet', text: 'Add as someone new' });

  go.addEventListener('click', async () => {
    const playerId = id.value.trim();
    if (!playerId || !first.value.trim() || !last.value.trim()) {
      status(note, 'Player ID, first name and last name are all needed.', 'error');
      return;
    }

    go.disabled = true;
    // Checked against the table rather than against the list on screen: an ID
    // that already belongs to somebody is a typo, not a new person, and adding
    // them would attach this attendance to the wrong player.
    const { data, error } = await supabase.from('players')
      .select('player_id, first_name, last_name').eq('player_id', playerId).maybeSingle();
    go.disabled = false;

    if (error) {
      status(note, `That check failed: ${error.message}. Try again.`, 'error');
      return;
    }
    if (data) {
      status(note, `${playerId} already belongs to ${data.first_name} `
        + `${data.last_name}. Add them with the search above instead.`, 'error');
      return;
    }

    onPick({
      player_id: playerId,
      first_name: first.value.trim(),
      last_name: last.value.trim(),
      birth_year: year.value ? Number(year.value) : null,
      isNew: true
    }, note);

    id.value = '';
    first.value = '';
    last.value = '';
    year.value = '';
  });

  return el('details', { className: 'disclosure' }, [
    el('summary', { text: 'Not on the list yet? Add someone new' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: 'For a player who has come along before ever entering a tournament. '
            + 'They are created when you record the attendance, not now.' }),
      el('p', { className: 'field' }, [el('label', { for: id.id, text: 'Player ID' }), id]),
      el('p', { className: 'field' }, [el('label', { for: first.id, text: 'First name' }), first]),
      el('p', { className: 'field' }, [el('label', { for: last.id, text: 'Last name' }), last]),
      el('p', { className: 'field' }, [el('label', { for: year.id, text: 'Birth year' }), year]),
      el('p', { className: 'field-help',
        text: 'Sets their division. Leave it blank if you do not know: they count '
            + 'as a minor until it is filled in, which is the safe way round.' }),
      el('p', {}, [go]),
      note
    ])
  ]);
}

// --- The write ---------------------------------------------------------------

// attendees: [{ player_id, first_name, last_name, birth_year? }]
// known:     Set of player_ids that already exist
//
// Returns what actually happened, rather than what was asked for, because the
// two differ in the ordinary case and the screen has to report the difference.
export async function recordAttendance({
  attendees, known, attendedOn, attendActionId, playActionId,
  createMissing, professor, actions, source, reason
}) {
  const missing = attendees.filter((p) => !known.has(p.player_id));
  let created = [];

  if (missing.length && createMissing) {
    // Only players being created. An import never overwrites an existing birth
    // year: division drives registration caps, and a professor who corrected one
    // by hand outranks a file.
    const { error } = await supabase.from('players').insert(missing.map((p) => ({
      player_id: p.player_id,
      first_name: p.first_name || 'Unknown',
      last_name: p.last_name || 'Unknown',
      birth_year: p.birth_year ?? null
      // Every consent column is deliberately omitted, and the grant would refuse
      // them anyway.
    })));
    if (error) throw error;
    created = missing;
    missing.forEach((p) => known.add(p.player_id));
  }

  const eligible = attendees.filter((p) => known.has(p.player_id));
  if (!eligible.length) {
    throw new Error('Nobody on this list is a player yet, so there is nothing to record.');
  }

  // One loyalty week per calendar day. A second event on the same Sunday adds no
  // attendance row, and the unique constraint saying so is the rule working
  // rather than an error to report.
  const { data: inserted, error: attErr } = await supabase
    .from('attendance')
    .upsert(eligible.map((p) => ({
      player_id: p.player_id,
      attended_on: attendedOn,
      source,
      created_by: professor.userId
    })), { onConflict: 'player_id,attended_on', ignoreDuplicates: true })
    .select('player_id');
  if (attErr) throw attErr;

  // Attendance points go only to those whose attendance row is new. Play points
  // go to everyone who played, because two events in a day are two things played
  // even though they are one loyalty week.
  const newlyPresent = new Set((inserted || []).map((r) => r.player_id));

  const ledger = [];
  for (const p of eligible) {
    if (newlyPresent.has(p.player_id)) {
      ledger.push({
        player_id: p.player_id, delta: pointsFor(actions, attendActionId),
        earning_action_id: attendActionId, created_by: professor.userId
      });
    }

    // Optional. Manual entry pays for turning up and nothing else, because
    // nobody is claiming from it that a tournament was played. A file is that
    // claim, so an upload adds the play award as well.
    if (playActionId) {
      ledger.push({
        player_id: p.player_id, delta: pointsFor(actions, playActionId),
        earning_action_id: playActionId, created_by: professor.userId,
        // Public through get_player_summary(). Never write anything private here.
        reason: reason || null
      });
    }
  }

  // Every attendee already had the day recorded, and there is no play award to
  // pay twice. Nothing to write, and saying so beats an empty insert.
  if (!ledger.length) {
    return {
      created, eligibleCount: eligible.length, newCount: newlyPresent.size,
      repeatCount: eligible.length - newlyPresent.size, ledgerCount: 0,
      playAwarded: false
    };
  }

  const { error: ledErr } = await supabase.from('point_ledger').insert(ledger);
  if (ledErr) throw ledErr;

  return {
    created,
    eligibleCount: eligible.length,
    newCount: newlyPresent.size,
    repeatCount: eligible.length - newlyPresent.size,
    ledgerCount: ledger.length,
    playAwarded: !!playActionId
  };
}

// The same summary wording for both routes, so a professor reads one thing
// whichever way the attendance was entered.
export function outcomeNodes(outcome, attendedOn, { fileNote = false } = {}) {
  return [
    el('p', { text: `Recorded. ${outcome.newCount} attendance row`
      + `${outcome.newCount === 1 ? '' : 's'} for ${attendedOn}, and `
      + `${outcome.ledgerCount} point entries across ${outcome.eligibleCount} players.` }),

    outcome.repeatCount ? el('p', { className: 'muted-note',
      text: `${outcome.repeatCount} already had attendance for that day, so that `
          + 'day was not counted twice'
          + (outcome.playAwarded
              ? '. They still received points for playing.'
              : ' and they earned nothing further.') }) : null,

    fileNote ? el('p', { className: 'muted-note',
      text: 'The file itself was read in your browser and has not been stored anywhere.' }) : null,

    // New players are hidden until someone asks them, and the moment to ask is
    // while they are still standing at the desk.
    outcome.created.length ? el('div', { className: 'warn-block' }, [
      el('p', { text: `${outcome.created.length} new player`
        + `${outcome.created.length === 1 ? ' is' : 's are'} not listed publicly and `
        + 'will stay that way until consent is recorded. Ask them before they leave:' }),
      el('ul', { className: 'player-list' }, outcome.created.map((p) =>
        el('li', {}, [
          el('a', {
            className: 'player-button',
            href: `consent.html?id=${encodeURIComponent(p.player_id)}`
          }, [
            el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}`.trim() }),
            el('span', { className: 'player-id count', text: p.player_id })
          ])
        ])))
    ]) : null
  ];
}
