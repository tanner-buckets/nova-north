// The Chaos Cup rules sheet.
//
// Follows the shape of the sheets the organiser has been writing by hand: a
// title, a paragraph of conditions for the day, then a numbered rule per round
// with lettered additional rules under it. What changes is where the rules come
// from -- a catalogue rather than two documents somebody copies out of, which
// is how the same rule ended up in one event twice.
//
// NOTHING HERE IS SAVED EXCEPT THE CATALOGUE. A composed sheet lives on screen
// until it is printed. That is deliberate for now: a Chaos Cup sheet is written
// on the day and handed out, and the thing worth keeping between events is the
// pool of rules, not last week's running order. Keeping the composition would
// mean deciding what a half-built sheet is, who owns it, and when it expires,
// which is a bigger question than this screen needed answering first.
import { supabase, el, problem } from '../supabase-client.js';
import { status } from './attendance-core.js';

export const NAME = 'Chaos Cup rules sheet';

// The organiser's own wording from the sheets that have been run, offered as
// the starting point because it is right most weeks. Every word is editable:
// the whole reason this field exists is that the conditions change.
const DEFAULT_CONDITIONS =
  'For each round the corresponding numbered rule will be in play. Before each '
  + 'round, a random selection will be made to determine which of the additional '
  + 'rules a through d will also be applied. Rules do not carry over to the next '
  + 'round.';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

let catalogue = [];
let title = 'Chaos Cup rules';
let conditions = DEFAULT_CONDITIONS;
// One entry per round: { main: ruleId|null, extras: [ruleId] }
let rounds = [{ main: null, extras: [] }, { main: null, extras: [] },
              { main: null, extras: [] }];

const byId = (id) => catalogue.find((r) => r.id === id) || null;

async function load() {
  const { data, error } = await supabase
    .from('chaos_cup_rules').select('*').eq('is_active', true)
    .order('chain', { nullsFirst: false }).order('sort_order');
  if (error) throw error;
  catalogue = data || [];
}

// --- Picking a rule -------------------------------------------------------------

// A select rather than a search box. Ninety-odd rules sounds like a lot to put
// in a dropdown, but they arrive already grouped into the chains the organiser
// wrote them in, and an optgroup per chain is a shorter list to read than a
// search field is to type into when you do not yet know what you are looking
// for. The standalone rules lead, because those are the ones that have been
// played.
function rulePicker(label, onPick, { exclude = [] } = {}) {
  const used = new Set(exclude.filter(Boolean));
  const loose = catalogue.filter((r) => !r.chain && !used.has(r.id));
  const chains = [...new Set(catalogue.filter((r) => r.chain).map((r) => r.chain))];

  const option = (r) => el('option', {
    value: r.id,
    // The code is the organiser's own and says where a rule sits in its chain,
    // which is the thing you need when picking the next round's rule.
    text: (r.code ? `${r.code}  ` : '') + oneLine(r.body)
  });

  const groups = [el('option', { value: '', text: label })];
  if (loose.length) {
    groups.push(el('optgroup', { label: 'Played before' }, loose.map(option)));
  }
  for (const chain of chains) {
    const inChain = catalogue.filter((r) => r.chain === chain && !used.has(r.id));
    if (inChain.length) groups.push(el('optgroup', { label: chain }, inChain.map(option)));
  }

  const sel = el('select', { className: 'chaos-pick' }, groups);
  sel.setAttribute('aria-label', label);
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const id = sel.value;
    sel.value = '';
    onPick(id);
  });
  return sel;
}

// A rule can be six lines long -- one of them is a die roll with an outcome per
// face -- and a dropdown is one line. The full text is on the sheet below.
function oneLine(body) {
  const flat = (body || '').replace(/\s*\n\s*/g, ' ').trim();
  return flat.length > 96 ? flat.slice(0, 95) + '…' : flat;
}

// --- The composer ---------------------------------------------------------------

function roundCard(round, index, redraw, note) {
  const main = byId(round.main);
  const taken = [round.main, ...round.extras];

  const mainRow = main
    ? el('div', { className: 'chaos-chosen' }, [
        el('p', { className: 'chaos-chosen-body', text: main.body }),
        (() => {
          const x = el('button', { type: 'button', className: 'link-button',
            text: 'Change', 'aria-label': `Change the rule for round ${index + 1}` });
          x.addEventListener('click', () => { round.main = null; redraw(); });
          return x;
        })()
      ])
    : rulePicker('Choose this round’s rule…', (id) => { round.main = id; redraw(); },
        { exclude: taken });

  const extras = round.extras.map((id, i) => {
    const rule = byId(id);
    if (!rule) return null;
    const x = el('button', { type: 'button', className: 'chip-remove', text: '×',
      'aria-label': `Remove additional rule ${LETTERS[i]}` });
    x.addEventListener('click', () => {
      round.extras.splice(i, 1);
      redraw();
    });
    return el('li', { className: 'chaos-extra' }, [
      el('span', { className: 'chaos-letter', text: LETTERS[i] + '.' }),
      el('span', { className: 'chaos-extra-body', text: rule.body }),
      x
    ]);
  });

  const drop = rulePicker('Add an additional rule…',
    (id) => { round.extras.push(id); redraw(); }, { exclude: taken });

  const remove = el('button', { type: 'button', className: 'link-button',
    text: 'Remove this round' });
  remove.addEventListener('click', () => {
    rounds.splice(index, 1);
    redraw();
  });

  return el('article', { className: 'card chaos-round' }, [
    el('div', { className: 'chaos-round-head' }, [
      el('h3', { text: `Round ${index + 1}` }),
      rounds.length > 1 ? remove : null
    ]),
    mainRow,
    extras.length ? el('ol', { className: 'chaos-extras' }, extras) : null,
    drop
  ]);
}

function composer(redraw, note) {
  const titleInput = el('input', { id: 'chaos-title', value: title });
  titleInput.addEventListener('input', () => {
    title = titleInput.value;
    const h = document.querySelector('.chaos-title');
    if (h) h.textContent = title || 'Chaos Cup rules';
  });

  const conditionsInput = el('textarea', { id: 'chaos-conditions', rows: '3' });
  conditionsInput.value = conditions;
  conditionsInput.addEventListener('input', () => {
    conditions = conditionsInput.value;
    const p = document.querySelector('.chaos-conditions');
    if (p) {
      p.textContent = conditions;
      p.hidden = !conditions.trim();
    }
  });

  const addRound = el('button', { type: 'button', className: 'button button-quiet',
    text: 'Add a round' });
  addRound.addEventListener('click', () => {
    rounds.push({ main: null, extras: [] });
    redraw();
  });

  const go = el('button', { type: 'button', className: 'button', text: 'Print this sheet' });
  go.addEventListener('click', () => window.print());

  return el('div', {}, [
    el('section', { className: 'card' }, [
      el('h2', { text: NAME }),
      el('p', { className: 'field-help',
        text: 'A numbered rule for each round, with the additional rules under it. '
            + 'Nothing is saved: compose it, print it, hand it out.' }),
      el('p', { className: 'field' }, [
        el('label', { for: titleInput.id, text: 'Sheet title' }), titleInput,
        el('span', { className: 'field-help',
          text: 'What it says at the top. "Chaos Cup rules for June 7".' })
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: conditionsInput.id, text: 'Tournament conditions' }),
        conditionsInput,
        el('span', { className: 'field-help',
          text: 'The paragraph above the rules: how the day runs, how the extra '
              + 'rules are chosen, whether anything carries between rounds. '
              + 'Cleared, it does not print at all.' })
      ]),
      el('p', {}, [go])
    ]),
    ...rounds.map((r, i) => roundCard(r, i, redraw, note)),
    el('p', {}, [addRound])
  ]);
}

// --- Adding to the catalogue ----------------------------------------------------

function addRulePanel(redraw, note) {
  const body = el('textarea', { id: 'new-rule', rows: '3' });
  const chain = el('input', { id: 'new-chain', placeholder: 'Draw Crazy' });
  const code = el('input', { id: 'new-code', placeholder: '1.a.i' });
  const stage = el('select', { id: 'new-stage' }, [
    el('option', { value: '', text: 'Any round' }),
    el('option', { value: '1', text: 'Round 1' }),
    el('option', { value: '2', text: 'Round 2' }),
    el('option', { value: '3', text: 'Round 3' })
  ]);

  const go = el('button', { type: 'button', className: 'button', text: 'Add to the catalogue' });
  go.addEventListener('click', async () => {
    if (!body.value.trim()) {
      status(note, 'A rule needs some text.', 'error');
      return;
    }
    go.disabled = true;
    const { error } = await supabase.from('chaos_cup_rules').insert({
      body: body.value.trim(),
      chain: chain.value.trim() || null,
      code: code.value.trim() || null,
      stage: stage.value ? Number(stage.value) : null,
      sort_order: catalogue.length + 1
    });
    go.disabled = false;
    if (error) {
      status(note, /duplicate|unique/i.test(error.message)
        ? `${code.value.trim()} is already a code in the catalogue.`
        : `That did not save: ${error.message}`, 'error');
      return;
    }
    body.value = '';
    code.value = '';
    status(note, 'Added.', 'good');
    await load();
    redraw();
  });

  return el('details', { className: 'disclosure' }, [
    el('summary', { text: `Add a rule to the catalogue (${catalogue.length} in it)` }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: 'Rules stay in the catalogue once added, so a rule written for one '
            + 'event can be picked again. Retired, never deleted — a rule that '
            + 'was played is part of what happened.' }),
      el('p', { className: 'field' }, [
        el('label', { for: body.id, text: 'The rule' }), body,
        el('span', { className: 'field-help',
          text: 'As it will be read out. Line breaks are kept, which is what '
              + 'makes a die-roll rule readable.' })
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: chain.id, text: 'Chain' }), chain,
        el('span', { className: 'field-help',
          text: 'Optional. Rules that build on each other across rounds share a '
              + 'chain name, and the picker groups them by it.' })
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: code.id, text: 'Code' }), code,
        el('span', { className: 'field-help',
          text: 'Optional, and must be unique. 1.a.i is the first round-3 option '
              + 'under option a of chain 1.' })
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: stage.id, text: 'Written for' }), stage
      ]),
      el('p', {}, [go]),
      note
    ])
  ]);
}

// --- The sheet -------------------------------------------------------------------

function drawSheet(sheet) {
  const used = rounds.filter((r) => r.main || r.extras.length);

  sheet.replaceChildren(
    el('div', { className: 'info-page chaos-page' }, [
      // No corner mark on this one. The Trainer Card sheet earns its specimen
      // because the card is the thing being explained; here the rules are, and
      // a logo in the corner would be decoration taking room from them.
      el('header', { className: 'chaos-head' }, [
        el('h2', { className: 'info-title chaos-title', text: title || 'Chaos Cup rules' })
      ]),

      el('p', { className: 'chaos-conditions', text: conditions, hidden: conditions.trim() ? null : 'hidden' }),

      used.length
        ? el('ol', { className: 'chaos-rounds' }, used.map((round) => {
            const main = byId(round.main);
            return el('li', { className: 'chaos-round-item' }, [
              main
                ? el('p', { className: 'chaos-main', text: main.body })
                : el('p', { className: 'chaos-main is-empty', text: '(no rule chosen)' }),
              round.extras.length
                ? el('ol', { className: 'chaos-sub' }, round.extras.map((id) => {
                    const rule = byId(id);
                    return rule ? el('li', { text: rule.body }) : null;
                  }))
                : null
            ]);
          }))
        : el('p', { className: 'chaos-empty',
            text: 'Choose a rule for each round and it appears here.' })
    ])
  );
}

// --- What the shell asks for -------------------------------------------------------

export async function mount(app, sheet) {
  await load();

  const note = el('p', { className: 'form-status', role: 'status' });

  const redraw = () => {
    app.replaceChildren(composer(redraw, note), addRulePanel(redraw, note));
    drawSheet(sheet);
  };

  redraw();
  return true;
}
