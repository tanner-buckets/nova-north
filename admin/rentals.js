// Rental decks, bounties, and the tag vocabulary.
//
// Everything on this screen is public the moment it is saved -- it draws the
// Rentable resources section of the league programs page -- so the screen says
// so once at the top rather than warning on every field.
//
// Three lists, one shape: a row per record with its fields inline and a save
// button. No modal, no separate edit page. These are short records a professor
// corrects between rounds, and a dialog for a four-field row is a dialog in the
// way.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

const FORMATS = [['standard', 'Standard'], ['glc', 'GLC']];
const STATUSES = [['current', 'Current'], ['needs_updating', 'Needs updating']];

let tags = [];       // the vocabulary
let decks = [];      // rows, with their tag ids
let bounties = [];

// --- Small builders -----------------------------------------------------------

function pick(options, value) {
  const sel = el('select', {}, options.map(([v, t]) =>
    el('option', { value: v, text: t })));
  sel.value = value;
  return sel;
}

function field(label, control) {
  return el('p', { className: 'field' }, [el('label', { text: label }, [control])]);
}

// --- Decks --------------------------------------------------------------------

function deckRow(deck, reload) {
  const isNew = !deck.id;

  const name = el('input', { value: deck.name || '' });
  const format = pick(FORMATS, deck.format || 'standard');
  const statusSel = pick(STATUSES, deck.status || 'current');
  const url = el('input', { type: 'url', value: deck.deck_list_url || '',
    placeholder: 'https://' });
  const notes = el('input', { value: deck.notes || '' });

  // Checkboxes rather than a multi-select: a professor should be able to see
  // every tag a deck could wear without opening anything.
  const chosen = new Set(deck.tag_ids || []);
  const boxes = tags.map((t) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = chosen.has(t.id);
    return { id: t.id, box,
      node: el('span', { className: 'field-inline' }, [
        box, el('label', { text: t.label })
      ]) };
  });

  const note = el('p', { className: 'form-status', role: 'status' });
  const save = el('button', { type: 'button', className: 'button',
    text: isNew ? 'Add the deck' : 'Save' });

  save.addEventListener('click', async () => {
    if (!name.value.trim()) { status(note, 'A deck needs a name.', 'error'); return; }
    save.disabled = true;
    status(note, 'Saving.');

    const row = {
      name: name.value.trim(),
      format: format.value,
      status: statusSel.value,
      deck_list_url: url.value.trim() || null,
      notes: notes.value.trim() || null
    };

    try {
      let id = deck.id;
      if (isNew) {
        const { data, error } = await supabase.from('rental_decks')
          .insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await supabase.from('rental_decks')
          .update(row).eq('id', id);
        if (error) throw error;
      }

      // Tags are replaced rather than diffed. The set is a handful of rows and
      // working out which two changed costs more than rewriting all of them.
      const { error: delErr } = await supabase.from('rental_deck_tag_links')
        .delete().eq('deck_id', id);
      if (delErr) throw delErr;

      const wanted = boxes.filter((b) => b.box.checked)
        .map((b) => ({ deck_id: id, tag_id: b.id }));
      if (wanted.length) {
        const { error: insErr } = await supabase.from('rental_deck_tag_links')
          .insert(wanted);
        if (insErr) throw insErr;
      }

      await reload();
    } catch (err) {
      console.error(err);
      save.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  // Retired, not deleted: a deck that comes off the shelf may come back, and
  // nothing here is worth losing.
  const retire = !isNew && el('button', { type: 'button', className: 'link-button',
    text: 'Take it off the shelf' });
  if (retire) {
    retire.addEventListener('click', async () => {
      retire.disabled = true;
      const { error } = await supabase.from('rental_decks')
        .update({ is_active: false }).eq('id', deck.id);
      if (error) {
        retire.disabled = false;
        status(note, `That did not go through: ${error.message}.`, 'error');
        return;
      }
      await reload();
    });
  }

  return el('li', {}, [
    el('div', { className: 'card rental-edit' }, [
      field('Name', name),
      field('Format', format),
      field('Status', statusSel),
      field('Deck list link', url),
      el('p', { className: 'field-help',
        text: 'Shown as “See the deck list”. Leave it blank and no link appears.' }),
      field('Note, optional', notes),
      el('p', { className: 'field' }, [el('span', { className: 'field-label-ish',
        text: 'Tags' })]),
      el('p', { className: 'tag-choices' }, boxes.map((b) => b.node)),
      el('p', { className: 'button-row' }, [save, retire || null]),
      note
    ])
  ]);
}

// --- Bounties -----------------------------------------------------------------

function bountyRow(bounty, reload) {
  const isNew = !bounty.id;
  const name = el('input', { value: bounty.name || '' });
  const format = pick(FORMATS, bounty.format || 'standard');
  const note = el('input', { value: bounty.note || '' });
  const claimed = el('input', { value: bounty.claimed_note || '',
    placeholder: 'e.g. Maya said she is building this' });

  const msg = el('p', { className: 'form-status', role: 'status' });
  const save = el('button', { type: 'button', className: 'button',
    text: isNew ? 'Add the bounty' : 'Save' });

  save.addEventListener('click', async () => {
    if (!name.value.trim()) { status(msg, 'A bounty needs a name.', 'error'); return; }
    save.disabled = true;
    status(msg, 'Saving.');

    const row = {
      name: name.value.trim(),
      format: format.value,
      note: note.value.trim() || null,
      claimed_note: claimed.value.trim() || null
    };

    const { error } = isNew
      ? await supabase.from('rental_deck_bounties').insert(row)
      : await supabase.from('rental_deck_bounties').update(row).eq('id', bounty.id);

    if (error) {
      save.disabled = false;
      status(msg, `That did not save: ${error.message}.`, 'error');
      return;
    }
    await reload();
  });

  const done = !isNew && el('button', { type: 'button', className: 'link-button',
    text: 'Take it off the list' });
  if (done) {
    done.addEventListener('click', async () => {
      done.disabled = true;
      const { error } = await supabase.from('rental_deck_bounties')
        .update({ is_active: false }).eq('id', bounty.id);
      if (error) {
        done.disabled = false;
        status(msg, `That did not go through: ${error.message}.`, 'error');
        return;
      }
      await reload();
    });
  }

  return el('li', {}, [
    el('div', { className: 'card rental-edit' }, [
      field('Deck we would like', name),
      field('Format', format),
      field('Note, optional', note),
      field('Somebody is building it', claimed),
      el('p', { className: 'field-help',
        text: 'Fill this in the moment somebody says they are on it. It shows '
            + 'on the public list so nobody builds the same deck twice.' }),
      el('p', { className: 'button-row' }, [save, done || null]),
      msg
    ])
  ]);
}

// --- Tags ---------------------------------------------------------------------

function tagPanel(reload) {
  const label = el('input', { placeholder: 'e.g. Good for beginners' });
  const msg = el('p', { className: 'form-status', role: 'status' });
  const add = el('button', { type: 'button', className: 'button', text: 'Add the tag' });

  add.addEventListener('click', async () => {
    const value = label.value.trim();
    if (!value) { status(msg, 'A tag needs a name.', 'error'); return; }
    add.disabled = true;

    const { error } = await supabase.from('rental_deck_tags')
      .insert({ label: value, sort_order: (tags.length + 1) * 10 });
    add.disabled = false;

    if (error) {
      status(msg, error.code === '23505'
        ? 'There is already a tag with that name.'
        : `That did not save: ${error.message}.`, 'error');
      return;
    }
    label.value = '';
    await reload();
  });

  async function retire(tag) {
    const { error } = await supabase.from('rental_deck_tags')
      .update({ is_active: false }).eq('id', tag.id);
    if (error) { status(msg, `That did not go through: ${error.message}.`, 'error'); return; }
    await reload();
  }

  return el('section', { className: 'panel' }, [
    el('h2', { text: 'Tags' }),
    el('p', { className: 'field-help',
      text: 'Anything a deck can be, other than whether it is up to date — that '
          + 'one is the status on the deck itself. Retiring a tag takes it off '
          + 'the list without disturbing the decks that wore it.' }),
    tags.length
      ? el('ul', { className: 'tag-admin-list' }, tags.map((t) => el('li', {}, [
          el('span', { className: 'tag tag-soft', text: t.label }),
          (() => {
            const b = el('button', { type: 'button', className: 'link-button',
              text: 'Retire' });
            b.addEventListener('click', () => retire(t));
            return b;
          })()
        ])))
      : el('p', { className: 'muted-note', text: 'No tags yet.' }),
    el('p', { className: 'field' }, [el('label', { text: 'New tag' }, [label])]),
    el('p', {}, [add]),
    msg
  ]);
}

// --- Load and draw ------------------------------------------------------------

async function load() {
  const [t, d, l, b] = await Promise.all([
    supabase.from('rental_deck_tags').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('rental_decks').select('*').eq('is_active', true)
      .order('format').order('sort_order'),
    supabase.from('rental_deck_tag_links').select('*'),
    supabase.from('rental_deck_bounties').select('*').eq('is_active', true)
      .order('sort_order')
  ]);
  const err = t.error || d.error || l.error || b.error;
  if (err) throw err;

  tags = t.data || [];
  const byDeck = new Map();
  for (const link of (l.data || [])) {
    if (!byDeck.has(link.deck_id)) byDeck.set(link.deck_id, []);
    byDeck.get(link.deck_id).push(link.tag_id);
  }
  decks = (d.data || []).map((row) => ({ ...row, tag_ids: byDeck.get(row.id) || [] }));
  bounties = b.data || [];
}

async function draw() {
  const reload = async () => { await load(); await draw(); };

  app.replaceChildren(
    el('p', { className: 'section-note',
      text: 'Everything on this screen is public. It fills the Rentable '
          + 'resources section of the league programs page the moment you save.' }),

    el('section', { className: 'panel' }, [
      el('h2', { text: `On the shelf (${decks.length})` }),
      decks.length
        ? el('ul', { className: 'card-list' }, decks.map((x) => deckRow(x, reload)))
        : el('p', { className: 'muted-note', text: 'No decks on the shelf yet.' }),
      el('h3', { text: 'Add a deck' }),
      el('ul', { className: 'card-list' }, [deckRow({}, reload)])
    ]),

    el('section', { className: 'panel' }, [
      el('h2', { text: `Rental Deck Bounties (${bounties.length})` }),
      el('p', { className: 'field-help',
        text: 'Donating one of these is worth 20 prize points rather than 10, '
            + 'so take a name off the list once it has been built.' }),
      bounties.length
        ? el('ul', { className: 'card-list' }, bounties.map((x) => bountyRow(x, reload)))
        : el('p', { className: 'muted-note', text: 'Nothing on the bounty list.' }),
      el('h3', { text: 'Add a bounty' }),
      el('ul', { className: 'card-list' }, [bountyRow({}, reload)])
    ]),

    tagPanel(reload)
  );
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
    app.replaceChildren(problem('The rental decks'));
  }
})();
