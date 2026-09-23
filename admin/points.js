// Prize points: everything a player earns that is not simply turning up, and
// everything they spend at the prize wall.
//
// The ledger is append only, and not by convention: professors hold INSERT on
// point_ledger and no UPDATE or DELETE at all, and there is no policy for either,
// so a row cannot be altered or removed through the API. A mistake is corrected
// by writing a reversing entry that points at the original. Both stay visible,
// which is the point -- a balance nobody can quietly rewrite is worth more than a
// tidy one.
//
// Balance is the sum of the deltas. There is no total column and there must
// never be one.
import { supabase, el, problem, playerLinks } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status, playerPicker } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;

// Every action and item, active or retired. History has to keep naming what a
// past entry was for, and an action retired last season still has entries
// pointing at it. The dropdowns offer the active subset instead.
let actions = [];
let items = [];
let player = null;

const activeActions = () => actions.filter((a) => a.is_active !== false);
const activeItems = () => items.filter((i) => i.is_active !== false);

// --- The rank discount -------------------------------------------------------

// A League Ace Trainer or a League Champion takes ten percent off anything on
// the prize wall.
//
// The badge threshold is read from trainer_card_ranks rather than written here,
// the same way the Trainer Card screen reads it, so moving the ladder moves the
// discount with it. Champions qualify for ever: the rank resets each season but
// having been Champion does not.
let ranks = [];
let discount = null;   // { reason } when this player qualifies

export const DISCOUNT_RATE = 0.1;

// Rounded UP, in the player's favour. A 25 point pack is 3 off, not 2.
export function discountFor(cost) {
  return Math.ceil(cost * DISCOUNT_RATE);
}

export function discountedCost(cost) {
  return Math.max(0, cost - discountFor(cost));
}

function badgeThreshold() {
  return ranks
    .filter((r) => r.badges_required != null)
    .reduce((max, r) => Math.max(max, r.badges_required), 0);
}

// Qualification, in one place so the banner and the price cannot disagree.
//
// Counted per season and the best one wins, which is how rank is worked out
// while more than one season is being awarded. Counting across seasons instead
// would let four badges in each of two years buy a discount that neither year
// earns.
async function loadDiscount(playerId) {
  const threshold = badgeThreshold();

  const [seasons, champs] = await Promise.all([
    supabase.rpc('active_badge_seasons'),
    supabase.from('champion_awards').select('season_year').eq('player_id', playerId)
  ]);

  const championSeasons = (champs.data || []).map((c) => c.season_year);
  const active = (seasons.data || []).map(Number);

  let badgeCount = 0;
  let badgeSeason = null;
  if (active.length) {
    const { data } = await supabase
      .from('player_badges')
      .select('badge_id, badges!inner(season_year)')
      .eq('player_id', playerId)
      .in('badges.season_year', active);

    const perSeason = new Map();
    for (const row of data || []) {
      const year = row.badges.season_year;
      perSeason.set(year, (perSeason.get(year) || 0) + 1);
    }
    for (const [year, count] of perSeason) {
      if (count > badgeCount) { badgeCount = count; badgeSeason = year; }
    }
  }

  if (championSeasons.length) {
    return {
      reason: `League Champion in ${championSeasons.sort((a, b) => b - a).join(', ')}`
    };
  }
  if (threshold && badgeCount >= threshold) {
    return {
      reason: `${badgeCount} badges in season ${badgeSeason}, at or above the `
            + `${threshold} needed`
    };
  }
  return null;
}

// Set by the local demo so the panels can render without a session.
export function _setReference(a, i, p, d = null, r = []) {
  actions = a; items = i; player = p; discount = d; ranks = r;
}

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});

function when(value) {
  return value ? WHEN.format(new Date(value)) : '';
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

// --- Loading -----------------------------------------------------------------

async function loadLedger(playerId) {
  const { data, error } = await supabase
    .from('point_ledger')
    .select('id, delta, reason, earning_action_id, prize_item_id, voids_id, created_at')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

function describe(row) {
  if (row.reason) return row.reason;
  const action = actions.find((a) => a.id === row.earning_action_id);
  if (action) return action.label;
  const item = items.find((i) => i.id === row.prize_item_id);
  if (item) return item.label;
  return 'No description';
}

// --- Writing -----------------------------------------------------------------

async function write(entry, resultNode, button, retireItemId = null) {
  button.disabled = true;
  status(resultNode, 'Recording.');
  try {
    const { error } = await supabase.from('point_ledger')
      .insert({ ...entry, player_id: player.player_id, created_by: professor.userId });
    if (error) throw error;

    // After the ledger, deliberately. The points are the part that has to be
    // right; if retiring the item then fails, the redemption stands and the
    // message says exactly what is left to do rather than implying both failed.
    if (retireItemId) {
      const { error: retireErr } = await supabase.from('prize_items')
        .update({ is_active: false }).eq('id', retireItemId);
      if (retireErr) {
        status(resultNode, 'The prize was recorded, but taking it off the wall '
          + `failed: ${retireErr.message}. Retire it on the prize wall screen; do `
          + 'not record the prize again.', 'error');
        return;
      }
    }

    await show(player.player_id);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    status(resultNode, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
  }
}

// --- Earn --------------------------------------------------------------------

export function earnPanel(balance) {
  const available = activeActions();
  const select = el('select', { id: 'earn-action' },
    available.map((a) => el('option', { value: a.id, text: `${a.label} (${a.default_points})` })));
  const amount = el('input', { id: 'earn-points', type: 'number', step: '1' });
  const reason = el('input', { id: 'earn-reason' });
  const result = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Award points' });

  function syncAmount() {
    const a = available.find((x) => x.id === select.value);
    amount.value = a ? a.default_points : 0;
  }
  select.addEventListener('change', syncAmount);
  syncAmount();

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'earn-action', text: 'What they did' }), select
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: 'earn-points', text: 'Points' }), amount
    ]),
    el('p', { className: 'field-help',
      text: 'The action’s usual value, and you can change it. An action worth '
          + 'zero plus a note is how a one-off award gets recorded.' }),
    el('p', { className: 'field' }, [
      el('label', { for: 'earn-reason', text: 'Note, optional' }), reason
    ]),
    el('p', { className: 'field-help',
      text: 'Shown on the player’s own points history, which is public for '
          + 'anyone whose Player ID is visible. Nothing private belongs here.' }),
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const delta = Number(amount.value);
    if (!Number.isInteger(delta)) {
      status(result, 'Points must be a whole number.', 'error');
      return;
    }
    write({
      delta,
      earning_action_id: select.value,
      reason: reason.value.trim() || null
    }, result, go);
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: 'Award points' }),
    form
  ]);
}

// --- Spend -------------------------------------------------------------------

export function spendPanel(balance) {
  const available = activeItems();
  if (!available.length) {
    return el('section', { className: 'card' }, [
      el('h3', { text: 'Spend at the prize wall' }),
      el('p', { className: 'muted-note' }, [
        el('span', { text: 'Nothing is on the prize wall. ' }),
        el('a', { href: 'prizes.html', text: 'Add some items' })
      ])
    ]);
  }

  // The list shows what this player pays, not the wall price. A professor
  // reading one number off the screen and another off the shelf is how the
  // discount gets forgotten.
  const select = el('select', { id: 'spend-item' },
    available.map((i) => el('option', {
      value: i.id,
      text: discount
        ? `${i.label} (${discountedCost(i.default_cost)}, was ${i.default_cost})`
        : `${i.label} (${i.default_cost})`
    })));
  const cost = el('input', { id: 'spend-cost', type: 'number', step: '1', min: '0' });
  const priced = el('p', { className: 'field-help' });
  const reason = el('input', { id: 'spend-reason' });
  const after = el('p', { className: 'field-help' });
  const result = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Record the prize' });

  // Handing something over does not usually mean the prize wall has run out of
  // it. Most items are restocked, so retiring one is a separate decision a
  // professor makes deliberately, not a side effect of a redemption.
  const retire = el('input', { type: 'checkbox', id: 'spend-retire' });
  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: 'Yes, record it and take it off' });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Go back' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  function chosen() {
    return available.find((x) => x.id === select.value);
  }

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    go.hidden = false;
    status(result, '');
  });

  function syncCost() {
    const i = available.find((x) => x.id === select.value);
    if (i && !cost.dataset.touched) {
      cost.value = discount ? discountedCost(i.default_cost) : i.default_cost;
    }
    syncAfter();
  }

  // Not a block. A professor may knowingly hand something over on credit, and
  // refusing would make this screen lie about who decides. It says what will
  // happen instead.
  function syncAfter() {
    const spend = Number(cost.value) || 0;
    const left = balance - spend;

    const item = available.find((x) => x.id === select.value);
    priced.textContent = (discount && item)
      ? `${item.label} is ${item.default_cost} on the wall, less `
        + `${discountFor(item.default_cost)} at 10% rounded up, so `
        + `${discountedCost(item.default_cost)}. Change the cost to charge `
        + 'something else.'
      : '';

    if (left < 0) {
      after.className = 'field-help is-warning';
      after.textContent = `That leaves ${left}, below zero. Their balance is `
        + `${balance}. Record it anyway only if you mean to.`;
    } else {
      after.className = 'field-help';
      after.textContent = `That leaves ${left}.`;
    }
  }

  select.addEventListener('change', () => { delete cost.dataset.touched; syncCost(); });
  cost.addEventListener('input', () => { cost.dataset.touched = '1'; syncAfter(); });
  syncCost();

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'spend-item', text: 'What they took' }), select
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: 'spend-cost', text: 'Cost in points' }), cost
    ]),
    priced,
    after,
    el('p', { className: 'field' }, [
      el('label', { for: 'spend-reason', text: 'Note, optional' }), reason
    ]),
    el('p', { className: 'field field-inline' }, [
      retire, el('label', { for: 'spend-retire', text: 'Take this off the prize wall' })
    ]),
    el('p', { className: 'field-help' }, [
      el('span', { text: 'Only if that was the last one. The item is retired, not '
        + 'deleted, so every past redemption still points at it and it can be put '
        + 'back on the ' }),
      el('a', { href: 'prizes.html', text: 'prize wall screen' }),
      el('span', { text: '.' })
    ]),
    el('p', {}, [go, confirmRow]),
    result
  ]);

  function valid() {
    const spend = Number(cost.value);
    if (!Number.isInteger(spend) || spend < 0) {
      status(result, 'The cost must be a whole number, zero or more.', 'error');
      return null;
    }
    return spend;
  }

  async function record(spend) {
    const typed = reason.value.trim();
    const item = chosen();

    // Recorded on the entry, so a smaller number in the history is explicable a
    // season later without anyone having to remember the rule. An item name is
    // already public on the prize wall and so is a rank, so this reveals
    // nothing new.
    const discounted = !!(discount && item && spend < item.default_cost);
    const note = discounted
      ? (typed ? `${typed} (10% rank discount)` : '10% rank discount')
      : (typed || null);

    await write({
      // Stored as a negative delta. Spending is a transaction like any other,
      // and the balance is still just a sum.
      delta: -spend,
      prize_item_id: select.value,
      reason: note
    }, result, go, retire.checked ? select.value : null);
  }

  yes.addEventListener('click', () => {
    const spend = valid();
    if (spend === null) return;
    yes.disabled = true;
    record(spend);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const spend = valid();
    if (spend === null) return;

    // Taking an item off the wall affects everyone who might have wanted it, not
    // just the player at the desk, so it is confirmed before it happens.
    if (retire.checked) {
      const item = chosen();
      go.hidden = true;
      confirmRow.hidden = false;
      status(result, `This records the prize and takes “${item ? item.label : 'it'}” `
        + 'off the prize wall for everybody. Put it back on the prize wall screen '
        + 'if that was wrong.');
      return;
    }

    record(spend);
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: 'Spend at the prize wall' }),
    form
  ]);
}

// --- History and corrections -------------------------------------------------

export function historyPanel(ledger) {
  if (!ledger.length) {
    return el('section', { className: 'card' }, [
      el('h3', { text: 'History' }),
      el('p', { className: 'muted-note', text: 'No points recorded for this player yet.' })
    ]);
  }

  // An entry that has already been reversed must not be reversible again, or the
  // correction would cancel the correction and the balance would drift back.
  const voided = new Set(ledger.filter((r) => r.voids_id).map((r) => r.voids_id));

  return el('section', { className: 'card' }, [
    el('h3', { text: 'History' }),
    el('p', { className: 'field-help',
      text: 'Nothing here can be edited or deleted. A mistake is corrected by '
          + 'reversing it, and both entries stay on the record.' }),
    el('ul', { className: 'ledger-list' }, ledger.map((row) => {
      const isCorrection = !!row.voids_id;
      const alreadyVoided = voided.has(row.id);

      const note = el('p', { className: 'form-status', role: 'status' });
      const undo = el('button', { type: 'button', className: 'link-button', text: 'Reverse this' });

      undo.addEventListener('click', () => {
        write({
          delta: -row.delta,
          voids_id: row.id,
          reason: `Correction: ${describe(row)}`
        }, note, undo);
      });

      return el('li', { className: 'ledger-row' + (alreadyVoided ? ' is-voided' : '') }, [
        el('span', { className: `ledger-delta ${row.delta < 0 ? 'is-down' : 'is-up'}`,
          text: signed(row.delta) }),
        el('span', { className: 'ledger-what' }, [
          el('span', { text: describe(row) }),
          el('span', { className: 'log-when count', text: when(row.created_at) })
        ]),
        alreadyVoided
          ? el('span', { className: 'tag tag-voided', text: 'reversed' })
          : (isCorrection
              ? el('span', { className: 'tag tag-division', text: 'correction' })
              : undo),
        note
      ]);
    }))
  ]);
}

// --- Render ------------------------------------------------------------------

const detail = el('div', { id: 'detail' });

async function show(playerId) {
  detail.replaceChildren(el('p', { className: 'notice', text: 'Loading.' }));
  try {
    // Re-read, because a redemption may have just retired an item and the
    // dropdown must not keep offering something that is off the wall.
    const fresh = await supabase.from('prize_items').select('*').order('sort_order');
    if (fresh.data) items = fresh.data;

    const { data, error } = await supabase.from('players')
      .select('player_id, first_name, last_name').eq('player_id', playerId).maybeSingle();
    if (error) throw error;
    if (!data) {
      detail.replaceChildren(el('p', { className: 'notice notice-problem',
        text: 'No player has that ID.' }));
      return;
    }
    player = data;

    const ledger = await loadLedger(playerId);
    const balance = ledger.reduce((sum, r) => sum + r.delta, 0);
    discount = await loadDiscount(playerId);

    detail.replaceChildren(
      el('section', { className: 'card' }, [
        el('h2', { text: `${data.first_name} ${data.last_name}`.trim() }),
        el('p', { className: 'player-id count', text: data.player_id }),
        playerLinks(data.player_id, { current: 'points' }),
        el('p', { className: 'balance' }, [
          // A balance below zero should not look like a healthy one. It is a
          // real state -- a professor may hand something over on credit -- but
          // it is one somebody has to notice.
          el('span', {
            className: 'balance-number' + (balance < 0 ? ' is-negative' : ''),
            text: balance
          }),
          el('span', { text: ' prize points' })
        ]),
        el('p', { className: 'muted-note', text: 'Prize points never reset.' }),
        discount ? el('p', { className: 'discount-note' }, [
          el('strong', { text: '10% off the prize wall. ' }),
          el('span', { text: discount.reason + '. Already taken off the price below.' })
        ]) : null
      ]),
      earnPanel(balance),
      spendPanel(balance),
      historyPanel(ledger)
    );
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

  try {
    const [a, i, r] = await Promise.all([
      supabase.from('earning_actions').select('*').order('sort_order'),
      supabase.from('prize_items').select('*').order('sort_order'),
      supabase.from('trainer_card_ranks').select('*').order('sort_order')
    ]);
    if (a.error || i.error || r.error) throw a.error || i.error || r.error;
    actions = a.data || [];
    items = i.data || [];
    ranks = r.data || [];
  } catch (err) {
    console.error(err);
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'The earning actions and prize items could not be loaded, so nothing '
          + 'can be recorded safely. Reload the page and try again.' }));
    return;
  }

  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('h2', { text: 'Find a player' }),
      playerPicker({ onPick: (p) => show(p.player_id) })
    ]),
    detail
  );

  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) show(fromUrl);
})();
