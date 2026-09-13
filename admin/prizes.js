// The prize wall: what is on it and what it costs.
//
// Nothing is ever deleted. An item is retired, which takes it off the wall and
// out of every dropdown while leaving it intact, because every past redemption
// holds a foreign key to it and history has to keep naming what somebody took.
// Retiring is reversible; deleting would not be, and would either orphan those
// rows or refuse outright.
//
// This page is public reading and professor writing: prize_items is readable by
// anyone, which is how the prize wall page works, and writable only by a
// professor.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let items = [];

async function load() {
  const { data, error } = await supabase
    .from('prize_items').select('*').order('sort_order').order('label');
  if (error) throw error;
  items = data || [];
}

// --- One item ----------------------------------------------------------------

export function itemRow(item) {
  const label = el('input', { value: item.label });
  const cost = el('input', { type: 'number', step: '1', min: '0', value: item.default_cost });
  const notes = el('input', { value: item.notes ?? '' });
  const order = el('input', { type: 'number', step: '1', value: item.sort_order });
  const note = el('p', { className: 'form-status', role: 'status' });

  const save = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save' });

  const toggle = el('button', {
    type: 'button',
    className: item.is_active ? 'link-button' : 'button button-quiet',
    text: item.is_active ? 'Take off the wall' : 'Put back on the wall'
  });

  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: `Yes, take ${item.label} off` });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Leave it on' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    toggle.hidden = false;
    status(note, '');
  });

  toggle.addEventListener('click', () => {
    // Putting something back is harmless and immediate. Taking it off changes
    // what every professor and every player sees, so that direction asks first.
    if (!item.is_active) { setActive(true); return; }
    toggle.hidden = true;
    confirmRow.hidden = false;
    status(note, 'This takes it off the prize wall for everybody. Past '
      + 'redemptions keep it, and you can put it back whenever you like.');
  });

  yes.addEventListener('click', () => setActive(false));

  async function setActive(value) {
    toggle.disabled = true;
    yes.disabled = true;
    status(note, value ? 'Putting it back.' : 'Taking it off.');
    try {
      const { error } = await supabase.from('prize_items')
        .update({ is_active: value }).eq('id', item.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      toggle.disabled = false;
      yes.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  }

  // Each label wraps its own input rather than pointing at an id. A page of
  // these would otherwise need a unique id per field per item, and a wrapped
  // input is associated just as properly.
  const field = (text, input) =>
    el('p', { className: 'field' }, [el('label', { text }, [input])]);

  const form = el('form', { className: 'item-form' }, [
    field('Item', label),
    field('Cost in points', cost),
    field('Note, optional', notes),
    field('Sort order', order),
    el('p', { className: 'item-actions' }, [save, toggle, confirmRow]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!label.value.trim()) {
      status(note, 'An item needs a name.', 'error');
      return;
    }
    const costValue = Number(cost.value);
    if (!Number.isInteger(costValue) || costValue < 0) {
      status(note, 'The cost must be a whole number, zero or more.', 'error');
      return;
    }

    save.disabled = true;
    status(note, 'Saving.');
    try {
      const { error } = await supabase.from('prize_items').update({
        label: label.value.trim(),
        default_cost: costValue,
        notes: notes.value.trim() || null,
        sort_order: Number(order.value) || 0
      }).eq('id', item.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      save.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('li', { className: 'item-row' + (item.is_active ? '' : ' is-retired') }, [
    el('details', { className: 'disclosure' }, [
      el('summary', {}, [
        el('span', { className: 'player-label', text: item.label }),
        el('span', { className: 'count', text: `${item.default_cost} points` }),
        item.is_active ? null : el('span', { className: 'tag tag-voided', text: 'off the wall' })
      ]),
      el('div', { className: 'disclosure-body' }, [form])
    ])
  ]);
}

// --- Add ---------------------------------------------------------------------

export function addPanel() {
  const label = el('input', { id: 'add-label' });
  const cost = el('input', { id: 'add-cost', type: 'number', step: '1', min: '0', value: '0' });
  const notes = el('input', { id: 'add-notes' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Add to the prize wall' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [el('label', { for: 'add-label', text: 'Item' }), label]),
    el('p', { className: 'field' }, [el('label', { for: 'add-cost', text: 'Cost in points' }), cost]),
    el('p', { className: 'field-help',
      text: 'The standard price. A professor can charge something else at the '
          + 'desk without changing it here.' }),
    el('p', { className: 'field' }, [el('label', { for: 'add-notes', text: 'Note, optional' }), notes]),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!label.value.trim()) {
      status(note, 'An item needs a name.', 'error');
      return;
    }
    const costValue = Number(cost.value);
    if (!Number.isInteger(costValue) || costValue < 0) {
      status(note, 'The cost must be a whole number, zero or more.', 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Adding.');
    try {
      // Sorted to the end by default. Reordering the whole wall is a job for the
      // sort fields on each item, not something an add should do for you.
      const nextOrder = items.reduce((max, i) => Math.max(max, i.sort_order), 0) + 10;
      const { error } = await supabase.from('prize_items').insert({
        label: label.value.trim(),
        default_cost: costValue,
        notes: notes.value.trim() || null,
        sort_order: nextOrder
      });
      if (error) throw error;
      form.reset();
      go.disabled = false;
      await refresh();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Add an item' }),
    form
  ]);
}

// --- Render ------------------------------------------------------------------

function render() {
  const live = items.filter((i) => i.is_active);
  const retired = items.filter((i) => !i.is_active);

  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('h2', { text: `On the prize wall (${live.length})` }),
      live.length
        ? el('ul', { className: 'item-list' }, live.map(itemRow))
        : el('p', { className: 'muted-note',
            text: 'Nothing is on the prize wall. Add an item below.' })
    ]),

    addPanel(),

    retired.length
      ? el('section', { className: 'card' }, [
          el('h2', { text: `Off the wall (${retired.length})` }),
          el('p', { className: 'field-help',
            text: 'Kept, not deleted. Every past redemption still points at these, '
                + 'and any of them can go back on the wall.' }),
          el('ul', { className: 'item-list' }, retired.map(itemRow))
        ])
      : null
  );
}

async function refresh() {
  await load();
  render();
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
    await refresh();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The prize wall'));
  }
})();
