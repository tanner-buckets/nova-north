// The two sides of the prize point ledger: what earns points, and what spends
// them.
//
// prize_items and earning_actions are the same shape -- a label, a number, a
// note, a sort order and an is_active flag -- so they are driven by one
// component here rather than two that would drift.
//
// Nothing is ever deleted. A row is retired, which takes it out of every
// dropdown and off the public pages while leaving it intact, because ledger
// entries hold foreign keys to both tables and history has to keep naming what
// somebody earned or took. Deleting would either orphan those rows or be refused
// outright. Retiring is reversible; deleting would not be.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;

const PRIZES = {
  key: 'prizes',
  table: 'prize_items',
  amount: 'default_cost',
  amountLabel: 'Cost in points',
  one: 'item',
  liveHeading: 'On the prize wall',
  retiredHeading: 'Off the wall',
  addHeading: 'Add an item',
  addButton: 'Add to the prize wall',
  retireButton: 'Take off the wall',
  restoreButton: 'Put back on the wall',
  retiredTag: 'off the wall',
  amountSuffix: 'points',
  emptyLive: 'Nothing is on the prize wall. Add an item below.',
  addHelp: 'The standard price. A professor can charge something else at the '
         + 'desk without changing it here.',
  retireHelp: 'This takes it off the prize wall for everybody. Past redemptions '
            + 'keep it, and you can put it back whenever you like.',
  retiredHelp: 'Kept, not deleted. Every past redemption still points at these, '
             + 'and any of them can go back on the wall.',
  extra: null
};

const EARNING = {
  key: 'earning',
  table: 'earning_actions',
  amount: 'default_points',
  amountLabel: 'Points awarded',
  one: 'way to earn',
  liveHeading: 'Ways to earn points',
  retiredHeading: 'No longer earning',
  addHeading: 'Add a way to earn',
  addButton: 'Add it',
  retireButton: 'Stop offering it',
  restoreButton: 'Offer it again',
  retiredTag: 'not offered',
  amountSuffix: 'points',
  emptyLive: 'There are no ways to earn points yet. Add one below.',
  addHelp: 'The usual award, and a professor can give something else at the time. '
         + 'Zero is legitimate: an action worth zero plus a note is how a one-off '
         + 'award gets recorded.',
  retireHelp: 'This stops it being offered on the points screen. Every award '
            + 'already given keeps it, and you can offer it again whenever you '
            + 'like.',
  retiredHelp: 'Kept, not deleted. Points already awarded still point at these, '
             + 'and any of them can be offered again.',
  extra: { field: 'eligibility_note', label: 'Who can earn it, optional' }
};

const SECTIONS = [PRIZES, EARNING];
const rows = new Map();   // config key -> loaded rows

async function loadAll() {
  for (const config of SECTIONS) {
    const { data, error } = await supabase
      .from(config.table).select('*').order('sort_order').order('label');
    if (error) throw error;
    rows.set(config.key, data || []);
  }
}

// --- One row -----------------------------------------------------------------

export function referenceRow(config, row) {
  const label = el('input', { value: row.label });
  const amount = el('input', { type: 'number', step: '1', min: '0', value: row[config.amount] });
  const extra = config.extra ? el('input', { value: row[config.extra.field] ?? '' }) : null;
  const notes = el('input', { value: row.notes ?? '' });
  const order = el('input', { type: 'number', step: '1', value: row.sort_order });
  const note = el('p', { className: 'form-status', role: 'status' });

  const save = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save' });

  const toggle = el('button', {
    type: 'button',
    className: row.is_active ? 'link-button' : 'button button-quiet',
    text: row.is_active ? config.retireButton : config.restoreButton
  });

  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: `Yes, ${config.retireButton.toLowerCase()}` });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Leave it' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    toggle.hidden = false;
    status(note, '');
  });

  toggle.addEventListener('click', () => {
    // Putting something back is harmless and immediate. Taking it away changes
    // what every professor and every player sees, so that direction asks first.
    if (!row.is_active) { setActive(true); return; }
    toggle.hidden = true;
    confirmRow.hidden = false;
    status(note, config.retireHelp);
  });

  yes.addEventListener('click', () => setActive(false));

  async function setActive(value) {
    toggle.disabled = true;
    yes.disabled = true;
    status(note, value ? 'Putting it back.' : 'Taking it off.');
    try {
      const { error } = await supabase.from(config.table)
        .update({ is_active: value }).eq('id', row.id);
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
  // these would otherwise need a unique id per field per row, and a wrapped
  // input is associated just as properly.
  const field = (text, input) =>
    el('p', { className: 'field' }, [el('label', { text }, [input])]);

  const form = el('form', { className: 'item-form' }, [
    field('Name', label),
    field(config.amountLabel, amount),
    extra ? field(config.extra.label, extra) : null,
    field('Note, optional', notes),
    field('Sort order', order),
    el('p', { className: 'item-actions' }, [save, toggle, confirmRow]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!label.value.trim()) {
      status(note, `A ${config.one} needs a name.`, 'error');
      return;
    }
    const n = Number(amount.value);
    if (!Number.isInteger(n) || n < 0) {
      status(note, `${config.amountLabel} must be a whole number, zero or more.`, 'error');
      return;
    }

    save.disabled = true;
    status(note, 'Saving.');
    try {
      const patch = {
        label: label.value.trim(),
        [config.amount]: n,
        notes: notes.value.trim() || null,
        sort_order: Number(order.value) || 0
      };
      if (config.extra) patch[config.extra.field] = extra.value.trim() || null;

      const { error } = await supabase.from(config.table).update(patch).eq('id', row.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      save.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('li', { className: 'item-row' + (row.is_active ? '' : ' is-retired') }, [
    el('details', { className: 'disclosure' }, [
      el('summary', {}, [
        el('span', { className: 'player-label', text: row.label }),
        el('span', { className: 'count',
          text: `${row[config.amount]} ${config.amountSuffix}` }),
        row.is_active ? null : el('span', { className: 'tag tag-voided', text: config.retiredTag })
      ]),
      el('div', { className: 'disclosure-body' }, [form])
    ])
  ]);
}

// --- Add ---------------------------------------------------------------------

export function addPanel(config, existing = []) {
  const label = el('input', {});
  const amount = el('input', { type: 'number', step: '1', min: '0', value: '0' });
  const extra = config.extra ? el('input', {}) : null;
  const notes = el('input', {});
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: config.addButton });

  const field = (text, input) =>
    el('p', { className: 'field' }, [el('label', { text }, [input])]);

  const form = el('form', {}, [
    field('Name', label),
    field(config.amountLabel, amount),
    el('p', { className: 'field-help', text: config.addHelp }),
    extra ? field(config.extra.label, extra) : null,
    field('Note, optional', notes),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!label.value.trim()) {
      status(note, `A ${config.one} needs a name.`, 'error');
      return;
    }
    const n = Number(amount.value);
    if (!Number.isInteger(n) || n < 0) {
      status(note, `${config.amountLabel} must be a whole number, zero or more.`, 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Adding.');
    try {
      // Sorted to the end. Reordering the whole list is a job for the sort field
      // on each row, not something an add should do for you.
      const nextOrder = existing.reduce((max, r) => Math.max(max, r.sort_order), 0) + 10;
      const record = {
        label: label.value.trim(),
        [config.amount]: n,
        notes: notes.value.trim() || null,
        sort_order: nextOrder
      };
      if (config.extra) record[config.extra.field] = extra.value.trim() || null;

      const { error } = await supabase.from(config.table).insert(record);
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
    el('h2', { text: config.addHeading }),
    form
  ]);
}

// --- Render ------------------------------------------------------------------

export function section(config, all) {
  const live = all.filter((r) => r.is_active);
  const retired = all.filter((r) => !r.is_active);

  return el('div', { className: 'reference-section' }, [
    el('section', { className: 'card' }, [
      el('h2', { text: `${config.liveHeading} (${live.length})` }),
      live.length
        ? el('ul', { className: 'item-list' }, live.map((r) => referenceRow(config, r)))
        : el('p', { className: 'muted-note', text: config.emptyLive })
    ]),

    addPanel(config, all),

    retired.length
      ? el('section', { className: 'card' }, [
          el('h2', { text: `${config.retiredHeading} (${retired.length})` }),
          el('p', { className: 'field-help', text: config.retiredHelp }),
          el('ul', { className: 'item-list' }, retired.map((r) => referenceRow(config, r)))
        ])
      : null
  ]);
}

function render() {
  app.replaceChildren(
    el('nav', { className: 'jump-links', 'aria-label': 'On this page' }, [
      el('a', { href: '#prize-wall', text: 'Prize wall' }),
      el('a', { href: '#earning', text: 'Ways to earn' })
    ]),

    el('div', { id: 'prize-wall' }, [
      el('h2', { className: 'section-heading', text: 'Spending' }),
      section(PRIZES, rows.get(PRIZES.key) || [])
    ]),

    el('div', { id: 'earning' }, [
      el('h2', { className: 'section-heading', text: 'Earning' }),
      el('p', { className: 'section-note',
        text: 'What the points screen offers when a professor awards points. '
            + 'Attendance uses these too: the upload and the manual screen both '
            + 'look for the attendance award by name.' }),
      section(EARNING, rows.get(EARNING.key) || [])
    ])
  );
}

async function refresh() {
  await loadAll();
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
    app.replaceChildren(problem('The prize wall and earning actions'));
  }
})();

export { PRIZES, EARNING };
