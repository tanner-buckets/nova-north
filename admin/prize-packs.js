// Prize packs: what is on the shelf, what went out, and when to order more.
//
// This replaces a spreadsheet with a block of columns per series -- how many
// went out each week, how many were left, and a figure typed in beside the week
// a box arrived. It stopped being kept, which is what happens to a second place
// to write something down: the packs go out at the desk and the sheet is
// somewhere else. The counting now happens where the day is already being
// recorded, and this page is where it is read back.
//
// Nothing here is public. How much stock is in the cupboard is a question about
// ordering, and a public figure would read as a promise about what is still
// available.
//
// Remaining is never stored. Every figure on this page is received minus handed
// out, worked out by the database when it is asked for.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let stock = [];       // one row per series, newest first
let history = [];     // one row per series per day that something moved
let receipts = [];    // the deliveries themselves, for the list and the void

// One line confirming the change that has just happened.
//
// Every write on this page is followed by a reload and a redraw, because a
// pack going out moves the figure on the card, every remaining count after it
// in the table, and the end of a line on the chart. That redraw also replaces
// whatever the form was saying, so the confirmation has to survive it -- and
// it says which card it belongs under, or the answer to "did that save" would
// appear next to a form somebody is not looking at.
let flash = null;     // { where, message }

const flashFor = (where) => (flash && flash.where === where
  ? el('p', { className: 'form-status is-good', role: 'status', text: flash.message })
  : null);

const DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  timeZone: 'America/New_York'
});
const SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'America/New_York'
});

// Midday UTC, not midnight: these are plain calendar days, and midnight in New
// York is the previous day in UTC -- the whole table would slide back by one.
const at = (value) => new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
const day = (value) => (value ? DAY.format(at(value)) : '');
const shortDay = (value) => (value ? SHORT.format(at(value)) : '');

const LEAGUE_DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York'
});
const today = () => LEAGUE_DAY.format(new Date());

const seriesName = (n) => `Series ${n}`;

// --- Colour -------------------------------------------------------------------
//
// One line per series. Series numbers run in order, but the lines cross and
// overlap, so what matters here is telling them apart rather than putting their
// order in the colour -- the newest series takes the site's gold, the one
// before it the slate the imported attendance weeks wear, and older ones step
// down the gold ramp. All five were already validated against the card.
const SERIES_INK = ['#8a6410', '#5b7a8c', '#5c430b', '#b08420', '#d9a32c'];
const inkFor = (i) => SERIES_INK[i % SERIES_INK.length];

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

// --- The shape the chart and the table both want ------------------------------
//
// The history arrives as one row per series per day something moved. Both the
// chart and the table want the opposite: a day, and where every series stood at
// the end of it. A series with no movement on a day has not changed, so its
// count is carried forward -- a blank there would read as nothing left rather
// than as nothing happening.
function timeline() {
  const dates = [...new Set(history.map((r) => r.moved_on))].sort();

  const byDate = new Map(dates.map((d) => [d, new Map()]));
  for (const row of history) byDate.get(row.moved_on).set(row.series_id, row);

  const standing = new Map();
  return dates.map((d) => {
    const moves = byDate.get(d);
    const cells = new Map();

    for (const s of stock) {
      const move = moves.get(s.series_id);
      if (move) standing.set(s.series_id, move.remaining_after);
      const left = standing.has(s.series_id) ? standing.get(s.series_id) : null;
      cells.set(s.series_id, {
        received: move ? move.received : 0,
        handedOut: move ? move.handed_out : 0,
        moved: !!move,
        // Null until a series has had its first delivery: before that it does
        // not exist on the shelf, and a zero would say it ran out.
        left
      });
    }
    return { date: d, cells };
  });
}

// --- Where each series stands -------------------------------------------------

// How many more Sundays a series lasts at the rate it has lately been going
// out. The rate ignores days none of it went out: a series that has been
// superseded hands out nothing for weeks, and counting those would say it lasts
// forever on the day it is about to run out.
function sundaysLeft(s) {
  if (!s.recent_days || !s.recent_out) return null;
  const perDay = s.recent_out / s.recent_days;
  return perDay > 0 ? Math.floor(s.remaining / perDay) : null;
}

function stockCards() {
  const live = stock.filter((s) => s.is_active);
  if (!live.length) {
    return el('section', { className: 'card' }, [
      el('h2', { text: 'On the shelf' }),
      el('p', { className: 'muted-note',
        text: 'No series is in play. Add one below and it will appear here and on '
            + 'both of the attendance screens.' })
    ]);
  }

  const anyRate = live.some((s) => sundaysLeft(s) !== null);

  return el('section', { className: 'card' }, [
    el('h2', { text: 'On the shelf' }),
    el('div', { className: 'keystat-row' }, live.map((s) => {
      const weeks = sundaysLeft(s);
      const sub = weeks === null
        ? (s.received ? 'nothing out yet to judge by' : 'none recorded yet')
        : weeks === 0 ? 'not enough for another Sunday'
        : `about ${weeks} more Sunday${weeks === 1 ? '' : 's'}`;

      return el('div', { className: 'keystat' }, [
        el('span', { className: 'keystat-label', text: seriesName(s.series_number) }),
        el('span', { className: 'keystat-value', text: s.remaining }),
        el('span', { className: 'keystat-sub', text: sub })
      ]);
    })),
    el('p', { className: 'field-help',
      text: 'What is left of each series in play, and how long that lasts at the '
          + 'rate it has lately been going out.'
          + (anyRate
              ? ' The rate is the last four days each series actually went out '
                + 'on, so a series nobody is handing out any more is not counted '
                + 'as lasting forever.'
              : '') })
  ]);
}

// --- The chart ----------------------------------------------------------------
//
// A line per series of what was left after each day, which is the view the
// spreadsheet kept: the slope is how fast a series goes out and the steps up
// are the deliveries. Columns would be wrong here -- this is a level over time
// rather than an amount per week.
function chart() {
  const rows = timeline();
  if (rows.length < 2) return null;

  // A series with no movement anywhere has no line and no legend entry: a
  // colour to learn for nothing.
  const drawn = stock
    .map((s, i) => ({ series: s, ink: inkFor(i) }))
    .filter((d) => rows.some((r) => r.cells.get(d.series.series_id).left !== null));
  if (!drawn.length) return null;

  const PAD = { top: 20, right: 44, bottom: 44, left: 44 };
  const W = PAD.left + PAD.right + Math.max(rows.length - 1, 1) * 44;
  const H = 280;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const highest = Math.max(1, ...rows.flatMap((r) =>
    [...r.cells.values()].map((c) => c.left || 0)));
  const step = highest <= 50 ? 10 : highest <= 150 ? 25 : highest <= 400 ? 100 : 200;
  const top = Math.ceil(highest / step) * step || step;

  const x = (i) => PAD.left + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / top) * plotH;

  const root = svg('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': 'Prize packs left after each day, one line per series. '
      + drawn.map((d) => {
          const last = [...rows].reverse()
            .find((r) => r.cells.get(d.series.series_id).left !== null);
          return `${seriesName(d.series.series_number)} ends at `
               + `${last ? last.cells.get(d.series.series_id).left : 0}`;
        }).join('. ') + '. Every figure is in the table below.'
  });

  for (let t = 0; t <= top; t += step) {
    root.append(svg('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t),
      class: t === 0 ? 'chart-axis' : 'chart-grid'
    }));
    const label = svg('text', { x: PAD.left - 8, y: y(t) + 4, class: 'chart-tick',
      'text-anchor': 'end' });
    label.textContent = t;
    root.append(label);
  }

  rows.forEach((r, i) => {
    const label = svg('text', {
      x: x(i), y: H - 24, class: 'chart-x', 'text-anchor': 'middle'
    });
    // Every other one once the axis is crowded, so labels do not collide.
    const every = Math.ceil(rows.length / 10);
    label.textContent = i % every === 0 ? shortDay(r.date) : '';
    root.append(label);
  });

  // The lines. Each starts at the series' first delivery, because before that
  // it was not on the shelf at all.
  const ends = [];
  for (const d of drawn) {
    const pts = rows
      .map((r, i) => ({ i, left: r.cells.get(d.series.series_id).left }))
      .filter((p) => p.left !== null);
    if (pts.length < 2) continue;

    root.append(svg('polyline', {
      class: 'pack-line', stroke: d.ink,
      points: pts.map((p) => `${x(p.i)},${y(p.left)}`).join(' ')
    }));

    const last = pts[pts.length - 1];
    ends.push({ d, x: x(last.i), y: y(last.left) });
  }

  // One direct label per line, riding its endpoint, which is the figure a
  // reader looks for first -- a number on every point would go unread.
  //
  // Two series that are nearly level end at nearly the same height, which is
  // exactly when the labels matter and exactly when they land on top of each
  // other. They are pushed apart just enough to be read, which is a small lie
  // about position in exchange for being legible at all; the line itself is
  // untouched.
  ends.sort((a, b) => a.y - b.y);
  let floor = -Infinity;
  for (const end of ends) {
    const at = Math.max(end.y, floor + 13);
    floor = at;
    const cap = svg('text', {
      x: Math.min(end.x + 6, W - 4), y: at + 4,
      class: 'chart-cap', 'text-anchor': 'start', fill: end.d.ink
    });
    cap.textContent = `S${end.d.series.series_number}`;
    root.append(cap);
  }

  // --- Reading a day off the chart
  const tip = el('div', { className: 'chart-tip', role: 'status', hidden: 'hidden' });

  function show(r, cx) {
    tip.replaceChildren(
      el('p', { className: 'chart-tip-day', text: day(r.date) }),
      ...drawn.map((d) => {
        const c = r.cells.get(d.series.series_id);
        if (c.left === null) return null;
        const moved = c.received
          ? `, ${c.received} arrived`
          : c.handedOut ? `, ${c.handedOut} out` : '';
        return el('p', {}, [
          el('span', { className: 'chart-key', style: `background:${d.ink}` }),
          el('span', { className: 'chart-tip-value', text: c.left }),
          el('span', { text: ` left of ${seriesName(d.series.series_number)}${moved}` })
        ]);
      }).filter(Boolean)
    );
    tip.hidden = false;

    const wrap = tip.parentElement;
    const scale = wrap.clientWidth / W || 1;
    const half = tip.offsetWidth / 2;
    const want = cx * scale;
    tip.style.left = Math.min(Math.max(want, half + 4), wrap.clientWidth - half - 4) + 'px';
  }

  rows.forEach((r, i) => {
    const bandW = plotW / Math.max(rows.length - 1, 1);
    const group = svg('g', {
      class: 'chart-col', tabindex: '0', role: 'img',
      'aria-label': day(r.date) + ': ' + drawn
        .filter((d) => r.cells.get(d.series.series_id).left !== null)
        .map((d) => `${r.cells.get(d.series.series_id).left} left of `
          + seriesName(d.series.series_number)).join(', ')
    });
    group.append(svg('rect', {
      x: x(i) - bandW / 2, y: PAD.top, width: bandW, height: plotH,
      fill: 'transparent', class: 'chart-hit'
    }));

    const open = () => show(r, x(i));
    group.addEventListener('pointerenter', open);
    group.addEventListener('focus', open);
    group.addEventListener('pointerleave', () => { tip.hidden = true; });
    group.addEventListener('blur', () => { tip.hidden = true; });
    root.append(group);
  });

  // Landed at the newest end: time runs left to right because that is how a
  // reader expects it, but the week somebody opened this page for is the last.
  const wrap = el('div', { className: 'chart-wrap' }, [root, tip]);
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'What is left, week by week' }),
    el('p', { className: 'field-help',
      text: 'One line per series, oldest day on the left. The slope is how fast '
          + 'a series goes out; a step up is a delivery arriving.' }),
    el('ul', { className: 'chart-legend' }, drawn.map((d) => el('li', {}, [
      el('span', { className: 'chart-key chart-key-series', style: `color:${d.ink}` }),
      el('span', { text: seriesName(d.series.series_number) })
    ]))),
    wrap
  ]);
}

// --- Adding packs -------------------------------------------------------------

// Either a delivery, or a professor counting what is already on the shelf. They
// are the same movement -- packs that were not here and now are -- so they are
// one form with a note rather than two.
function addPacksCard() {
  const NEW = '__new';

  const pick = el('select', { id: 'pack-series' }, [
    ...stock.map((s) => el('option', {
      value: s.series_id,
      text: seriesName(s.series_number) + (s.is_active ? '' : ' (retired)')
    })),
    el('option', { value: NEW, text: 'A new series…' })
  ]);

  const number = el('input', {
    type: 'number', id: 'pack-new-number', min: '1', step: '1',
    inputmode: 'numeric', placeholder: '10'
  });
  const numberField = el('p', { className: 'field' }, [
    el('label', { for: number.id, text: 'Series number' }), number
  ]);
  numberField.hidden = stock.length > 0;
  if (!stock.length) pick.value = NEW;

  pick.addEventListener('change', () => { numberField.hidden = pick.value !== NEW; });

  const date = el('input', { type: 'date', id: 'pack-date', value: today() });
  const quantity = el('input', {
    type: 'number', id: 'pack-quantity', min: '1', step: '1',
    inputmode: 'numeric', placeholder: '600'
  });
  const note = el('input', { id: 'pack-note', placeholder: 'Opening count' });

  const result = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Add the packs' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: pick.id, text: 'Series' }), pick
    ]),
    numberField,
    el('p', { className: 'field' }, [
      el('label', { for: date.id, text: 'Date' }), date
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: quantity.id, text: 'How many packs' }), quantity
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: note.id, text: 'Note' }), note
    ]),
    el('p', { className: 'field-help',
      text: 'Optional, and only to tell one delivery from another later: '
          + '“Opening count”, “second shipment”.' }),
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = Math.trunc(Number(quantity.value));
    if (!Number.isFinite(qty) || qty < 1) {
      status(result, 'How many packs arrived? It has to be a whole number, at least one.', 'error');
      return;
    }
    if (!date.value) {
      status(result, 'Pick the date they arrived.', 'error');
      return;
    }

    let seriesId = pick.value;
    const wantsNew = seriesId === NEW;
    const n = Math.trunc(Number(number.value));

    if (wantsNew) {
      if (!Number.isFinite(n) || n < 1) {
        status(result, 'A new series needs its number — Series 10, say.', 'error');
        return;
      }
      if (stock.some((s) => s.series_number === n)) {
        status(result, `${seriesName(n)} already exists. Pick it from the list instead.`, 'error');
        return;
      }
    }

    go.disabled = true;
    status(result, 'Adding.');

    try {
      if (wantsNew) {
        // The series is written first: a delivery pointing at a series that
        // does not exist is refused by the foreign key, which is the right way
        // round for the half that can fail.
        const { data, error } = await supabase.from('prize_pack_series')
          .insert({ number: n }).select('id').single();
        if (error) throw error;
        seriesId = data.id;
      }

      const { error } = await supabase.from('prize_pack_receipts').insert({
        series_id: seriesId,
        received_on: date.value,
        quantity: qty,
        note: note.value.trim() || null
      });
      if (error) throw error;

      const named = wantsNew ? seriesName(n)
        : seriesName(stock.find((s) => s.series_id === seriesId).series_number);
      flash = { where: 'add',
        message: `${qty} pack${qty === 1 ? '' : 's'} added to ${named}.` };

      await refresh();
      draw();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(result, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Add packs' }),
    flashFor('add'),
    el('p', { text: 'A delivery from Pokémon, or a count of what is already on '
      + 'the shelf. Both are packs that were not recorded and now are, so both '
      + 'go in here.' }),
    form
  ]);
}

// --- Recording a day by hand --------------------------------------------------
//
// Packs are normally counted on the screen where the day is being recorded.
// This is for the day that was missed, or a Saturday prerelease nobody recorded
// attendance for -- the same replace-by-day rule, so running it twice is safe.
function handoutCard() {
  const live = stock.filter((s) => s.is_active);
  if (!live.length) return null;

  const pick = el('select', { id: 'out-series' }, live.map((s) => el('option', {
    value: s.series_id, text: seriesName(s.series_number)
  })));
  const date = el('input', { type: 'date', id: 'out-date', value: today() });
  const quantity = el('input', {
    type: 'number', id: 'out-quantity', min: '0', step: '1',
    inputmode: 'numeric', placeholder: '0'
  });

  const result = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button button-quiet',
    text: 'Record what went out' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: pick.id, text: 'Series' }), pick
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: date.id, text: 'Date' }), date
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: quantity.id, text: 'How many went out' }), quantity
    ]),
    el('p', { className: 'field-help',
      text: 'Replaces whatever is recorded for that series on that day rather '
          + 'than adding to it, so running this twice is safe. Zero is a real '
          + 'answer: none of that series went out.' }),
    el('p', {}, [go]),
    result
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = Math.trunc(Number(quantity.value));
    if (!Number.isFinite(qty) || qty < 0) {
      status(result, 'How many went out? Zero is fine; a negative number is not.', 'error');
      return;
    }
    if (!date.value) {
      status(result, 'Pick the day they went out.', 'error');
      return;
    }

    go.disabled = true;
    status(result, 'Recording.');

    try {
      const { error } = await supabase.from('prize_pack_handouts').upsert({
        series_id: pick.value, handed_out_on: date.value, quantity: qty
      }, { onConflict: 'series_id,handed_out_on' });
      if (error) throw error;

      const named = seriesName(
        stock.find((s) => s.series_id === pick.value).series_number);
      flash = { where: 'out',
        message: `${named} on ${day(date.value)}: ${qty} recorded.` };

      await refresh();
      draw();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(result, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Record a day that was missed' }),
    flashFor('out'),
    el('p', { text: 'Packs are counted on the attendance screens as the day is '
      + 'recorded. This is for a day that was not, or one with no attendance '
      + 'behind it at all.' }),
    form
  ]);
}

// --- The history --------------------------------------------------------------

// A cell that can be corrected in place. The number on screen is what the shelf
// is counted against, so a figure somebody typed wrong has to be reachable
// without going anywhere else.
function outCell(seriesId, date, cell) {
  const td = el('td', { className: 'count' });

  function show() {
    // A recorded zero and a day nobody wrote anything down for are different
    // facts, and the second must not print as the first. A day with only a
    // delivery on it has no handout row either, so it reads as nothing
    // recorded rather than as none going out.
    const recordedZero = cell.moved && !cell.handedOut && !cell.received;
    const out = cell.handedOut ? String(cell.handedOut) : recordedZero ? '0' : '—';

    const button = el('button', {
      type: 'button',
      className: out === '—' ? 'link-button pack-add' : 'link-button',
      'aria-label': (out === '—' ? 'Nothing recorded' : `${out} out`)
        + ` on ${day(date)}. Change it.`,
      text: out
    });
    button.addEventListener('click', edit);

    td.replaceChildren(...[
      cell.left === null ? el('span', { className: 'muted-note', text: '—' }) : button,
      cell.received
        ? el('span', { className: 'tag tag-added pack-in', text: `+${cell.received} in` })
        : null
    ].filter(Boolean));
  }

  function edit() {
    const input = el('input', {
      type: 'number', min: '0', step: '1', inputmode: 'numeric',
      value: cell.handedOut || 0, 'aria-label': `Packs out on ${day(date)}`
    });
    const save = el('button', { type: 'button', className: 'link-button', text: 'Save' });
    const cancel = el('button', { type: 'button', className: 'link-button', text: 'Cancel' });

    async function commit() {
      const n = Math.trunc(Number(input.value));
      if (!Number.isFinite(n) || n < 0) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      save.disabled = true;
      cancel.disabled = true;

      const { error } = await supabase.from('prize_pack_handouts').upsert({
        series_id: seriesId, handed_out_on: date, quantity: n
      }, { onConflict: 'series_id,handed_out_on' });

      if (error) {
        console.error(error);
        save.disabled = false;
        cancel.disabled = false;
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      // Everything downstream of this cell moves -- the remaining count on its
      // own row, every row after it, the figures on the cards and the chart --
      // so the page is reloaded rather than the one cell patched.
      flash = { where: 'table', message: `${day(date)} corrected to ${n}.` };
      await refresh();
      draw();
    }

    save.addEventListener('click', commit);
    cancel.addEventListener('click', show);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); show(); }
    });

    td.replaceChildren(el('span', { className: 'note-edit' }, [input, save, cancel]));
    input.focus();
    input.select();
  }

  show();
  return td;
}

function historyCard() {
  const rows = timeline();
  if (!rows.length) {
    return el('section', { className: 'card' }, [
      el('h2', { text: 'Week by week' }),
      el('p', { className: 'muted-note',
        text: 'Nothing recorded yet. Add what is on the shelf above, and the '
            + 'weeks will fill in as attendance is recorded.' })
    ]);
  }

  // Only the series that have ever moved get columns. A retired series stays,
  // because the weeks it was going out are part of the history.
  const columns = stock.filter((s) =>
    rows.some((r) => r.cells.get(s.series_id).left !== null));

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Week by week' }),
    flashFor('table'),
    el('p', { className: 'field-help',
      text: 'Newest first. “Out” is what was handed out that day and “Left” is '
          + 'what remained afterwards, carried forward through the weeks '
          + 'nothing moved. A delivery is marked in the Out column. Click a '
          + 'number to correct it.' }),
    el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Day' }),
            ...columns.flatMap((s) => [
              el('th', { scope: 'col', text: `S${s.series_number} out`,
                title: `${seriesName(s.series_number)}: packs handed out that day.` }),
              el('th', { scope: 'col', text: `S${s.series_number} left`,
                title: `${seriesName(s.series_number)}: on the shelf afterwards.` })
            ])
          ])
        ]),
        el('tbody', {}, [...rows].reverse().map((r) => el('tr', {}, [
          el('th', { scope: 'row', text: day(r.date) }),
          ...columns.flatMap((s) => {
            const cell = r.cells.get(s.series_id);
            return [
              outCell(s.series_id, r.date, cell),
              cell.left === null
                ? el('td', { className: 'muted-note', text: '' })
                : el('td', { className: 'count room-count', text: cell.left })
            ];
          })
        ])))
      ])
    ])
  ]);
}

// --- Deliveries, and retiring a series ----------------------------------------

function deliveriesList() {
  if (!receipts.length) {
    return el('p', { className: 'muted-note', text: 'No deliveries recorded yet.' });
  }

  return el('ul', { className: 'player-list' }, receipts.map((r) => {
    const series = stock.find((s) => s.series_id === r.series_id);
    const voided = !!r.voided_at;

    const drop = el('button', {
      type: 'button', className: 'link-button', text: 'This was wrong'
    });
    drop.addEventListener('click', async () => {
      drop.disabled = true;
      const { error } = await supabase.rpc('void_prize_pack_receipt', { p_receipt: r.id });
      if (error) {
        console.error(error);
        drop.disabled = false;
        drop.textContent = 'That did not void — try again';
        return;
      }
      await refresh();
      draw();
    });

    return el('li', { className: 'attendee' }, [
      el('span', { className: 'player-label',
        text: series ? seriesName(series.series_number) : 'A retired series' }),
      el('span', { className: 'count', text: `+${r.quantity}` }),
      el('span', { className: 'player-id', text: day(r.received_on) }),
      r.note ? el('span', { className: 'muted-note', text: r.note }) : null,
      voided ? el('span', { className: 'tag tag-voided', text: 'voided' }) : drop
    ]);
  }));
}

function seriesList() {
  if (!stock.length) return null;

  return el('ul', { className: 'player-list' }, stock.map((s) => {
    const toggle = el('button', {
      type: 'button', className: 'link-button',
      text: s.is_active ? 'Retire it' : 'Bring it back'
    });
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const { error } = await supabase.from('prize_pack_series')
        .update({ is_active: !s.is_active }).eq('id', s.series_id);
      if (error) {
        console.error(error);
        toggle.disabled = false;
        return;
      }
      await refresh();
      draw();
    });

    return el('li', { className: 'attendee' }, [
      el('span', { className: 'player-label', text: seriesName(s.series_number) }),
      el('span', { className: 'count', text: `${s.remaining} left` }),
      s.is_active ? null : el('span', { className: 'tag tag-voided', text: 'retired' }),
      s.is_active && s.remaining === 0 && s.received
        ? el('span', { className: 'tag tag-hidden', text: 'all gone' }) : null,
      toggle
    ]);
  }));
}

function bookkeepingCard() {
  return el('section', { className: 'card' }, [
    el('h2', { text: 'Deliveries and series' }),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Every delivery recorded' }),
      el('div', { className: 'disclosure-body' }, [
        el('p', { className: 'field-help',
          text: 'A delivery typed in wrongly is voided rather than deleted: it '
              + 'happened, and the void is what says the number was not right. '
              + 'Add the correct one afterwards.' }),
        deliveriesList()
      ])
    ]),
    el('details', { className: 'disclosure' }, [
      el('summary', { text: 'Which series are in play' }),
      el('div', { className: 'disclosure-body' }, [
        el('p', { className: 'field-help',
          text: 'A series in play gets a box on both attendance screens. Retire '
              + 'one when the last pack has gone out, and it stops being asked '
              + 'about every week while keeping every week it was. Retiring is '
              + 'reversible and deletes nothing.' }),
        seriesList()
      ])
    ])
  ]);
}

// --- Render -------------------------------------------------------------------

async function refresh() {
  const [stockRes, historyRes, receiptRes] = await Promise.all([
    supabase.rpc('prize_pack_stock'),
    supabase.rpc('prize_pack_history'),
    supabase.from('prize_pack_receipts')
      .select('id, series_id, received_on, quantity, note, voided_at')
      .order('received_on', { ascending: false })
  ]);

  if (stockRes.error) throw stockRes.error;
  if (historyRes.error) throw historyRes.error;
  if (receiptRes.error) throw receiptRes.error;

  stock = stockRes.data || [];
  history = historyRes.data || [];
  receipts = receiptRes.data || [];
}

function draw() {
  // Filtered, because replaceChildren stringifies a null into the literal word
  // "null" on the page, and both the chart and the handout card withhold
  // themselves when there is nothing to draw.
  app.replaceChildren(...[
    stockCards(),
    chart(),
    addPacksCard(),
    handoutCard(),
    historyCard(),
    bookkeepingCard()
  ].filter(Boolean));

  // Read once. It describes the change that has just happened, and leaving it
  // up through the next redraw would have it confirming something else.
  flash = null;
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
    app.replaceChildren(problem('The prize pack history'));
    return;
  }
  draw();
})();
