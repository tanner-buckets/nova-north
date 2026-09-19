// Players: add someone who did not arrive through a tournament file, and correct
// a record that is wrong.
//
// This screen can write names, birth year, contact and notes. It cannot write a
// visibility flag, and not because it declines to: professors hold no UPDATE
// grant on the consent columns, so the attempt would be refused. Consent lives
// on its own screen, behind set_player_visibility(), where every change is
// logged.
//
// There is no delete. A player record is never removed -- attendance, ledger
// entries and registrations all point at it, and history has to keep resolving.
import { supabase, el, problem, playerLinks } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;

const COLUMNS = 'player_id, first_name, last_name, birth_year, contact, notes, '
  + 'show_player_id, show_name';

// --- Add ---------------------------------------------------------------------

export function addPanel() {
  const id = el('input', { id: 'new-id', inputmode: 'numeric', placeholder: '1234567' });
  const first = el('input', { id: 'new-first' });
  const last = el('input', { id: 'new-last' });
  const year = el('input', { id: 'new-year', type: 'number', min: '1900', max: '2100', placeholder: '2014' });
  const contact = el('input', { id: 'new-contact' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Add player' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [el('label', { for: 'new-id', text: 'Player ID' }), id]),
    el('p', { className: 'field-help' }, [
      el('span', { text: 'Every player needs one. If they do not have it to hand, ' }),
      el('a', { href: '../id_help.html', text: 'the help page' }),
      el('span', { text: ' explains how to look it up or create one.' })
    ]),
    el('p', { className: 'field' }, [el('label', { for: 'new-first', text: 'First name' }), first]),
    el('p', { className: 'field' }, [el('label', { for: 'new-last', text: 'Last name' }), last]),
    el('p', { className: 'field' }, [el('label', { for: 'new-year', text: 'Birth year' }), year]),
    el('p', { className: 'field-help',
      text: 'Sets their division, and whether they count as a minor. Leaving it '
          + 'blank is safe but not free: they count as a minor until it is filled '
          + 'in, and cannot register for an event that caps by division.' }),
    el('p', { className: 'field' }, [el('label', { for: 'new-contact', text: 'Contact, optional' }), contact]),
    el('p', { className: 'field-help',
      text: 'Never public. Used only to reach them about an event.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const playerId = id.value.trim();

    if (!playerId || !first.value.trim() || !last.value.trim()) {
      status(note, 'Player ID, first name and last name are all needed.', 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Adding.');

    try {
      // Checked first so a duplicate reads as a duplicate rather than as a
      // primary key violation, and so the professor is sent to the existing
      // record instead of being told to try again.
      const { data: existing } = await supabase.from('players')
        .select('player_id').eq('player_id', playerId).maybeSingle();
      if (existing) {
        go.disabled = false;
        note.className = 'form-status is-error';
        note.replaceChildren(
          el('span', { text: 'A player already has that ID. ' }),
          linkTo(playerId, 'Open their record')
        );
        return;
      }

      const { error } = await supabase.from('players').insert({
        player_id: playerId,
        first_name: first.value.trim(),
        last_name: last.value.trim(),
        birth_year: year.value ? Number(year.value) : null,
        contact: contact.value.trim() || null
      });
      if (error) throw error;

      form.reset();
      go.disabled = false;
      note.className = 'form-status is-good';
      note.replaceChildren(
        el('span', { text: 'Added. They are not listed publicly until consent is '
          + 'recorded. ' }),
        el('a', { href: `consent.html?id=${encodeURIComponent(playerId)}`, text: 'Record it now' })
      );
      show(playerId);
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Add a player' }),
    el('p', { text: 'For someone who did not come in through a tournament file. '
      + 'Most players do, so reach for this when they have not played yet.' }),
    form
  ]);
}

function linkTo(playerId, text) {
  const a = el('a', { href: '#', text });
  a.addEventListener('click', (e) => { e.preventDefault(); show(playerId); });
  return a;
}

// --- Edit --------------------------------------------------------------------

export function editPanel(player) {
  const first = el('input', { id: 'edit-first', value: player.first_name });
  const last = el('input', { id: 'edit-last', value: player.last_name });
  const year = el('input', {
    id: 'edit-year', type: 'number', min: '1900', max: '2100',
    value: player.birth_year ?? ''
  });
  const contact = el('input', { id: 'edit-contact', value: player.contact ?? '' });
  const notes = el('textarea', { id: 'edit-notes', rows: '3' });
  notes.value = player.notes ?? '';

  const idInput = el('input', { id: 'edit-id', inputmode: 'numeric', value: player.player_id });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Save changes' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [el('label', { for: 'edit-first', text: 'First name' }), first]),
    el('p', { className: 'field' }, [el('label', { for: 'edit-last', text: 'Last name' }), last]),
    el('p', { className: 'field' }, [el('label', { for: 'edit-year', text: 'Birth year' }), year]),
    el('p', { className: 'field' }, [el('label', { for: 'edit-contact', text: 'Contact' }), contact]),
    el('p', { className: 'field' }, [el('label', { for: 'edit-notes', text: 'Professor notes' }), notes]),
    el('p', { className: 'field-help',
      text: 'Never public, at any consent level. Visible only to a signed-in '
          + 'professor.' }),

    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Correct the Player ID' }),
      el('div', { className: 'disclosure-body' }, [
        el('p', { className: 'field' }, [
          el('label', { for: 'edit-id', text: 'Player ID' }), idInput
        ]),
        el('p', { className: 'field-help',
          text: 'Only for an ID typed in wrong. Every table that references a '
              + 'player cascades, so attendance, points, badges and registrations '
              + 'follow the correction rather than being orphaned. If this is a '
              + 'different person, add them separately instead.' })
      ])
    ]),

    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newId = idInput.value.trim();

    if (!first.value.trim() || !last.value.trim() || !newId) {
      status(note, 'Player ID, first name and last name are all needed.', 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Saving.');

    try {
      const patch = {
        first_name: first.value.trim(),
        last_name: last.value.trim(),
        birth_year: year.value ? Number(year.value) : null,
        contact: contact.value.trim() || null,
        notes: notes.value.trim() || null
      };
      if (newId !== player.player_id) patch.player_id = newId;

      const { error } = await supabase.from('players')
        .update(patch).eq('player_id', player.player_id);
      if (error) throw error;

      status(note, 'Saved.', 'good');
      show(newId);
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: `${player.first_name} ${player.last_name}`.trim() }),
    el('p', { className: 'player-id count', text: player.player_id }),
    playerLinks(player.player_id, { current: 'players' }),

    // Stated rather than editable. The switches are on the consent screen because
    // changing one is a record of a conversation, not a field edit.
    el('p', { className: 'muted-note' }, [
      el('span', { text: player.show_player_id === true
        ? 'Consent recorded to show their Player ID. '
        : (player.show_player_id === false
            ? 'Recorded as not wanting to be listed. '
            : 'No visibility decision recorded; the age default applies. ') }),
      el('a', { href: `consent.html?id=${encodeURIComponent(player.player_id)}`,
        text: 'Visibility and consent' })
    ]),

    form
  ]);
}

// --- Find --------------------------------------------------------------------

function findPanel() {
  const nameInput = el('input', { id: 'find-name', placeholder: 'Start typing a name or paste an ID' });
  const found = el('div', { className: 'search-results' });

  nameInput.addEventListener('input', async () => {
    const q = nameInput.value.trim();
    if (q.length < 2) { found.replaceChildren(); return; }

    const { data } = await supabase.from('players')
      .select('player_id, first_name, last_name')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,player_id.ilike.%${q}%`)
      .order('first_name').limit(12);
    if (!data) return;

    if (!data.length) {
      found.replaceChildren(el('p', { className: 'muted-note', text: 'Nobody matches that.' }));
      return;
    }

    found.replaceChildren(...data.map((p) => {
      const button = el('button', { type: 'button', className: 'player-button' }, [
        el('span', { className: 'player-label', text: `${p.first_name} ${p.last_name}` }),
        el('span', { className: 'player-id count', text: p.player_id })
      ]);
      button.addEventListener('click', () => show(p.player_id));
      return button;
    }));
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Find a player' }),
    el('p', { className: 'field' }, [
      el('label', { for: 'find-name', text: 'Name or Player ID' }), nameInput
    ]),
    found
  ]);
}

// --- Render ------------------------------------------------------------------

const detail = el('div', { id: 'detail' });

async function show(playerId) {
  detail.replaceChildren(el('p', { className: 'notice', text: 'Loading that player.' }));
  try {
    const { data, error } = await supabase.from('players')
      .select(COLUMNS).eq('player_id', playerId).maybeSingle();
    if (error) throw error;
    if (!data) {
      detail.replaceChildren(el('p', { className: 'notice notice-problem',
        text: 'No player has that ID.' }));
      return;
    }
    detail.replaceChildren(editPanel(data));
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    detail.replaceChildren(problem('That player'));
  }
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

  app.replaceChildren(findPanel(), detail, addPanel());

  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) show(fromUrl);
})();
