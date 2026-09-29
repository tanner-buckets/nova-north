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

function totals() {
  return days.reduce((acc, d) => ({
    days: acc.days + 1,
    present: acc.present + d.total,
    others: acc.others + d.other_attendees
  }), { days: 0, present: 0, others: 0 });
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

  return el('tr', {}, [
    el('th', { scope: 'row' }, [link]),
    num(d.total),
    noSplit
      ? el('td', { className: 'muted-note', colspan: '2', text: 'not recorded' })
      : played,
    noSplit ? null : num(d.attended_only),
    num(d.junior),
    num(d.senior),
    num(d.master),
    num(d.other_attendees || '—')
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
      text: `${sum.days} day${sum.days === 1 ? '' : 's'} recorded, `
          + `${sum.present} player visit${sum.present === 1 ? '' : 's'} in total`
          + (sum.others ? `, plus ${sum.others} other attendee`
            + `${sum.others === 1 ? '' : 's'}.` : '.') }),
    el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table attendance-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Day' }),
            el('th', { scope: 'col', text: 'Present' }),
            el('th', { scope: 'col', text: 'Played' }),
            el('th', { scope: 'col', text: 'Attended' }),
            el('th', { scope: 'col', text: DIVISION_LABEL.junior || 'Junior' }),
            el('th', { scope: 'col', text: DIVISION_LABEL.senior || 'Senior' }),
            el('th', { scope: 'col', text: DIVISION_LABEL.master || 'Master' }),
            el('th', { scope: 'col', text: 'Others' })
          ])
        ]),
        el('tbody', {}, days.map((d) => weekRow(d, onPick)))
      ])
    ]),
    el('p', { className: 'field-help',
      text: 'Present counts players with a record. Others are the parents, '
          + 'siblings and anyone else who was in the room without a Player ID, '
          + 'as counted by a professor on the day; a dash means nobody counted. '
          + 'Divisions are worked out as at the day itself, so somebody who had '
          + 'a birthday since is still counted in the division they played in.' })
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

  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('h2', { text: 'Week by week' }),
      weekTable((d) => {
        picker.load(d);
        picker.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
    ]),
    picker.node
  );
})();
