// Attendance read back: how many came each week, and who.
//
// Everything on this page is a read. Nothing here records, corrects or deletes,
// which is why it carries no confirmations and no buttons that change anything.
//
// Both figures come from RPCs rather than from queries here, because the
// division split needs birth years and a birth year is a protected field. A
// professor may read one, but shipping several hundred of them to a browser to
// bucket them into three groups is handing out protected data to do arithmetic
// the database can do itself.
//
// "Played" is only known for days recorded after the column existed. Nothing
// here fills that in: a day with no split says so, because a zero would look
// exactly like a day where nobody played.
import { supabase, el, problem, DIVISION_LABEL } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let days = [];

const DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  timeZone: 'America/New_York'
});

// The date is a plain calendar day, so it is formatted at midday UTC rather than
// midnight: midnight in New York is the previous day in UTC and the whole table
// would slide back by one.
function day(value) {
  return value ? DAY.format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '';
}

const num = (n) => el('td', { className: 'count', text: n });

// --- Week by week -------------------------------------------------------------

// Everybody who was in the room, which is the number a professor means by
// "how many came". Null others is not zero others: it means nobody counted, so
// the room was at least this full and the exact figure is not knowable.
const room = (d) => d.total + (d.other_attendees ?? 0);
const roomKnown = (d) => d.other_attendees !== null && d.other_attendees !== undefined;

function totals() {
  return days.reduce((acc, d) => ({
    days: acc.days + 1,
    players: acc.players + d.total,
    others: acc.others + (d.other_attendees ?? 0),
    uncounted: acc.uncounted + (roomKnown(d) ? 0 : 1)
  }), { days: 0, players: 0, others: 0, uncounted: 0 });
}

function weekRow(d, onPick) {
  // A day recorded before the split was tracked has nothing to show, and a zero
  // there would read as "nobody played" rather than "nobody wrote it down".
  const noSplit = d.split_unknown === d.total;
  const partial = d.split_unknown > 0 && !noSplit;

  const link = el('button', {
    type: 'button', className: 'link-button', text: day(d.attended_on)
  });
  link.addEventListener('click', () => onPick(d.attended_on));

  // A partly recorded day says so in the Played cell rather than in a column of
  // its own: a trailing note column is the first thing off the side of a narrow
  // screen, which is where it would never be read.
  const played = el('td', { className: 'count' }, [
    el('span', { text: d.played }),
    partial ? el('span', { className: 'muted-note',
      text: ` +${d.split_unknown} unknown` }) : null
  ]);

  // Players and Others are separate counts of separate people, so the room is
  // the sum and gets a column of its own. Reading Players as the total was the
  // obvious mistake to make when it was the leftmost number and Others sat at
  // the far end looking like a footnote.
  // The total leads. At the far right it was both the easiest to miss and the
  // first to scroll off a narrow screen, which is how Players got read as the
  // total in the first place. Everything after it breaks it down.
  return el('tr', {}, [
    el('th', { scope: 'row' }, [link]),
    el('td', { className: 'count room-count' }, [
      el('span', { text: room(d) }),
      // At least this many. A day nobody counted has an unknown room, and a
      // bare number there would be a total that quietly leaves people out.
      roomKnown(d) ? null : el('span', { className: 'muted-note', text: '+' })
    ]),
    num(d.total),
    roomKnown(d) ? num(d.other_attendees) : el('td', { className: 'muted-note', text: '—' }),
    noSplit
      ? el('td', { className: 'muted-note', colspan: '2', text: 'not recorded' })
      : played,
    noSplit ? null : num(d.attended_only),
    num(d.junior),
    num(d.senior),
    num(d.master)
  ]);
}

function weekTable(onPick) {
  if (!days.length) {
    return el('p', { className: 'muted-note',
      text: 'No attendance has been recorded yet. Upload a tournament file, or '
          + 'record a day by hand, and it will show up here.' });
  }

  const sum = totals();

  return el('div', {}, [
    el('p', { className: 'section-note',
      text: `${sum.days} day${sum.days === 1 ? '' : 's'} recorded. `
          + `${sum.players} player visit${sum.players === 1 ? '' : 's'}`
          + (sum.others ? ` and ${sum.others} other attendee`
              + `${sum.others === 1 ? '' : 's'}: ${sum.players + sum.others} `
              + 'people through the door'
            : '')
          + (sum.uncounted
              ? `, with ${sum.uncounted} day${sum.uncounted === 1 ? '' : 's'} `
                + 'where nobody counted the others.'
              : '.') }),
    el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table attendance-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Day' }),
            el('th', { scope: 'col', text: 'Total' }),
            el('th', { scope: 'col', text: 'Players' }),
            el('th', { scope: 'col', text: 'Others' }),
            el('th', { scope: 'col', text: 'Played' }),
            el('th', { scope: 'col', text: 'Attended' }),
            // Abbreviated, because the full division names are the three widest
            // headings on a table that already has to scroll on a phone.
            el('th', { scope: 'col', title: 'Junior', text: 'JR' }),
            el('th', { scope: 'col', title: 'Senior', text: 'SR' }),
            el('th', { scope: 'col', title: 'Master', text: 'MA' })
          ])
        ]),
        el('tbody', {}, days.map((d) => weekRow(d, onPick)))
      ])
    ]),
    el('p', { className: 'field-help',
      text: 'Total is Players plus Others, which is how many people were '
          + 'actually there. Players are the people with a record; Others are '
          + 'the parents, siblings and anyone else without a Player ID, counted '
          + 'by a professor on the day. Played and Attended, and the three '
          + 'divisions, are two ways of splitting Players and do not include '
          + 'Others. A dash under Others means nobody counted, and the room '
          + 'figure carries a plus to say it is a floor rather than a total. '
          + 'Divisions are worked out as at the day itself, so somebody who has '
          + 'had a birthday since is still counted in the division they played '
          + 'in.' })
  ]);
}

// --- The chart ----------------------------------------------------------------

// A stacked column per league day, broken down by division with everybody
// without a Player ID on top, and a line across the totals.
//
// The divisions are age bands, so they take a one-hue ordinal ramp rather than
// four categorical hues: the order means something, and a ramp puts that order
// in the colour. Others sits outside the age scale and takes the lightest step
// of the same ramp, because it is still part of the same whole.
//
// The four steps were validated together: monotone lightness, a visible step
// between each pair, and the light end still readable against the card. Three
// of them are existing site tokens.
const SVG_NS = 'http://www.w3.org/2000/svg';

const BANDS = [
  { key: 'master', label: 'MA', long: 'Master', fill: '#5c430b' },
  { key: 'senior', label: 'SR', long: 'Senior', fill: '#8a6410' },   // --gold
  { key: 'junior', label: 'JR', long: 'Junior', fill: '#b08420' },   // --gold-lift
  { key: 'division_unknown', label: 'No birth year', long: 'No birth year',
    fill: '#b8b5ad', optional: true },
  { key: 'others', label: 'Others', long: 'Others, without a Player ID',
    fill: '#d9a32c' }                                                // --amber
];

// The line is not a series in the ramp. It is the sum of the stack, so it wears
// a text token rather than a colour that would read as a fifth category.
const TOTAL_STROKE = '#33363b';   // --ink-soft

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

const SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'America/New_York'
});
function shortDay(value) {
  return value ? SHORT.format(new Date(String(value).slice(0, 10) + 'T12:00:00Z')) : '';
}

const bandValue = (d, key) => (key === 'others' ? (d.other_attendees || 0) : (d[key] || 0));

// Clean axis steps. The axis carries the values no label is riding, so it has to
// land on numbers somebody would say out loud.
function ticksTo(max) {
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 20;
  const top = Math.ceil(max / step) * step || step;
  const out = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return { top, out };
}

function chart(onPick) {
  if (!days.length) return null;

  // Oldest on the left: time runs left to right whatever order the table is in.
  const rows = [...days].reverse();

  // A band with nothing in it anywhere is not drawn and not in the legend. A
  // legend entry for a segment that never appears is a colour to learn for
  // nothing.
  const bands = BANDS.filter((b) =>
    !b.optional || rows.some((d) => bandValue(d, b.key) > 0));

  const PAD = { top: 20, right: 14, bottom: 44, left: 40 };
  const W = PAD.left + PAD.right + rows.length * 46;
  const H = 260;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const tickInfo = ticksTo(Math.max(...rows.map(room), 1));
  const y = (v) => PAD.top + plotH - (v / tickInfo.top) * plotH;

  const band = plotW / rows.length;
  const barW = Math.min(24, band - 12);   // capped, so the leftover band is air

  const root = svg('svg', {
    class: 'chart',
    viewBox: '0 0 ' + W + ' ' + H,
    width: W, height: H, role: 'img',
    'aria-label': 'Attendance across the last ' + rows.length
      + ' league days, broken down by division, with a line across the totals. '
      + 'Every figure is in the table below.'
  });

  for (const t of tickInfo.out) {
    root.append(svg('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t),
      class: t === 0 ? 'chart-axis' : 'chart-grid'
    }));
    const label = svg('text', { x: PAD.left - 8, y: y(t) + 4, class: 'chart-tick' });
    label.textContent = t;
    root.append(label);
  }

  const tip = el('div', { className: 'chart-tip', role: 'status', hidden: 'hidden' });

  // Values lead, labels follow: the reader has the day and wants the numbers.
  function show(d, cx) {
    const lines = bands
      .filter((b) => bandValue(d, b.key) > 0 || b.key === 'others')
      .map((b) => el('p', {}, [
        el('span', { className: 'chart-key', style: 'background:' + b.fill }),
        el('span', { className: 'chart-tip-value',
          text: b.key === 'others' && !roomKnown(d) ? '—' : bandValue(d, b.key) }),
        el('span', { text: ' ' + (b.key === 'others' && !roomKnown(d)
          ? 'others, nobody counted' : b.long) })
      ]));

    tip.replaceChildren(
      el('p', { className: 'chart-tip-day', text: day(d.attended_on) }),
      ...lines,
      el('p', { className: 'chart-tip-room' }, [
        el('span', { className: 'chart-tip-value',
          text: room(d) + (roomKnown(d) ? '' : '+') }),
        el('span', { text: ' in total' })
      ])
    );
    tip.hidden = false;

    // Clamped to the plot, or the last few columns push it off the edge and the
    // reader loses the numbers they went there for. Measured after it is
    // visible, because its width depends on the text just put in it.
    const wrap = tip.parentElement;
    const scale = wrap.clientWidth / W || 1;
    const half = tip.offsetWidth / 2;
    const want = cx * scale;
    tip.style.left = Math.min(Math.max(want, half + 4), wrap.clientWidth - half - 4) + 'px';
  }

  const hide = () => { tip.hidden = true; };

  rows.forEach((d, i) => {
    const cx = PAD.left + band * i + band / 2;
    const x = cx - barW / 2;

    const group = svg('g', {
      class: 'chart-col', tabindex: '0', role: 'button',
      'aria-label': day(d.attended_on) + ': '
        + bands.map((b) => bandValue(d, b.key) + ' ' + b.long).join(', ')
        + (roomKnown(d) ? ', ' + room(d) + ' in total'
                        : ', others not counted, at least ' + room(d) + ' in total')
    });

    // Bottom up, darkest first, so the column settles rather than floats. The
    // 2px gap is the surface doing the separating; never a stroke around a mark.
    let base = 0;
    for (const b of bands) {
      const v = bandValue(d, b.key);
      if (v <= 0) continue;

      const topY = y(base + v);
      const bottomY = y(base);
      const isTop = base + v >= room(d) - 0.001;
      const height = Math.max(1, bottomY - topY - (base > 0 ? 2 : 0));

      group.append(svg('rect', {
        x: x, y: topY, width: barW, height: height,
        // Rounded at the data end, square at the baseline. Only the topmost
        // segment has a data end.
        rx: isTop ? 4 : 0,
        fill: b.fill
      }));
      base += v;
    }

    // A hit target the width of the band, so nobody has to aim at a 24px column.
    group.append(svg('rect', {
      x: PAD.left + band * i, y: PAD.top, width: band, height: plotH,
      fill: 'transparent', class: 'chart-hit'
    }));

    const label = svg('text', {
      x: cx, y: H - 24, class: 'chart-x', 'text-anchor': 'middle'
    });
    // Every other one once the axis is crowded, so labels do not collide.
    label.textContent = (rows.length > 7 && i % 2 === 1) ? '' : shortDay(d.attended_on);
    root.append(label);

    const open = () => show(d, cx);
    group.addEventListener('pointerenter', open);
    group.addEventListener('focus', open);
    group.addEventListener('pointerleave', hide);
    group.addEventListener('blur', hide);
    group.addEventListener('click', () => onPick(d.attended_on));
    group.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick(d.attended_on);
      }
    });

    root.append(group);
  });

  // The total line, over the columns.
  //
  // It breaks wherever nobody counted the others, because on those days the
  // total is not known -- it is a floor. Drawing straight through would put a
  // dip in the line that is an artefact of nobody counting rather than of
  // anybody staying home, which is the kind of thing a line chart is believed
  // about.
  const pts = rows.map((d, i) => ({
    x: PAD.left + band * i + band / 2,
    y: y(room(d)),
    known: roomKnown(d)
  }));

  let run = [];
  const flush = () => {
    if (run.length > 1) {
      root.append(svg('polyline', {
        class: 'chart-total-line',
        points: run.map((p) => p.x + ',' + p.y).join(' ')
      }));
    }
    run = [];
  };
  for (const p of pts) {
    if (p.known) run.push(p); else flush();
  }
  flush();

  for (const p of pts) {
    root.append(svg('circle', {
      cx: p.x, cy: p.y, r: 4,
      class: p.known ? 'chart-total-dot' : 'chart-total-dot is-floor'
    }));
  }

  // One direct label, on the endpoint, which is the figure a reader looks for
  // first. A number on all eleven would be chaos and would go unread.
  const last = rows[rows.length - 1];
  const cap = svg('text', {
    x: PAD.left + band * (rows.length - 1) + band / 2,
    y: y(room(last)) - 12, class: 'chart-cap', 'text-anchor': 'middle'
  });
  cap.textContent = room(last) + (roomKnown(last) ? '' : '+');
  root.append(cap);

  const anyFloor = pts.some((p) => !p.known);

  return el('section', { className: 'card' }, [
    el('h2', { text: 'How many came' }),
    el('p', { className: 'field-help',
      text: 'One column per league day, oldest first, broken down by division '
          + 'with everybody who has no Player ID on top. The line is the total. '
          + 'Click a column for who was there.' }),
    // A legend is always present once there are two series: identity never rests
    // on colour alone.
    el('ul', { className: 'chart-legend' },
      [el('li', {}, [
        el('span', { className: 'chart-key chart-key-line' }),
        el('span', { text: 'Total' })
      ])].concat(bands.slice().reverse().map((b) => el('li', {}, [
        el('span', { className: 'chart-key', style: 'background:' + b.fill }),
        el('span', { text: b.long })
      ])))),
    el('div', { className: 'chart-wrap' }, [root, tip]),
    anyFloor
      ? el('p', { className: 'field-help',
          text: 'The line breaks where nobody counted the others: on those days '
              + 'the total is a floor rather than a figure, and a hollow dot '
              + 'marks it. Joining across would show a dip that came from '
              + 'nobody counting rather than from anybody staying home.' })
      : null
  ]);
}

// --- One day ------------------------------------------------------------------

function dayPanel() {
  const input = el('input', { type: 'date', id: 'pick-day' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const list = el('div', {});

  async function load(value) {
    if (!value) { list.replaceChildren(); status(note, ''); return; }
    input.value = value;
    status(note, 'Looking.');
    list.replaceChildren();

    try {
      const { data, error } = await supabase.rpc('attendance_on', { p_day: value });
      if (error) throw error;

      if (!data.length) {
        status(note, `Nobody is recorded as attending on ${day(value)}.`);
        return;
      }

      status(note, '');
      list.replaceChildren(
        el('h3', { text: `${data.length} on ${day(value)}` }),
        el('ul', { className: 'player-list' }, data.map((r) => el('li', { className: 'attendee' }, [
          el('span', { className: 'player-label',
            text: `${r.first_name} ${r.last_name}`.trim() }),
          el('span', { className: 'player-id count', text: r.player_id }),
          r.division
            ? el('span', { className: 'tag tag-division',
                text: DIVISION_LABEL[r.division] || r.division })
            : el('span', { className: 'tag tag-voided', text: 'no birth year' }),
          r.played === true ? el('span', { className: 'tag tag-added', text: 'played' })
            : r.played === false ? el('span', { className: 'tag tag-flight', text: 'attended' })
            : null
        ])))
      );
    } catch (err) {
      console.error(err);
      status(note, `That did not load: ${err.message || 'unknown error'}.`, 'error');
    }
  }

  input.addEventListener('change', () => load(input.value));

  return {
    node: el('section', { className: 'card' }, [
      el('h2', { text: 'Who was here on a day' }),
      el('p', { className: 'field' }, [
        el('label', { for: input.id, text: 'Date' }), input
      ]),
      el('p', { className: 'field-help',
        text: 'Pick any day, or click one in the table above. Players only: '
            + 'somebody without a Player ID is a number in the Others column and '
            + 'is not recorded by name anywhere.' }),
      note,
      list
    ]),
    load
  };
}

// --- Render -------------------------------------------------------------------

async function refresh() {
  const { data, error } = await supabase.rpc('attendance_by_day', {
    p_from: null, p_to: null
  });
  if (error) throw error;
  days = data || [];
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
    app.replaceChildren(problem('The attendance history'));
    return;
  }

  const picker = dayPanel();

  const pick = (d) => {
    picker.load(d);
    picker.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  app.replaceChildren(
    chart(pick),
    el('section', { className: 'card' }, [
      el('h2', { text: 'Week by week' }),
      weekTable(pick)
    ]),
    picker.node
  );
})();
