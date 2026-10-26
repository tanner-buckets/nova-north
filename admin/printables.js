// Printable resources: handouts for players, built from what is in the database.
//
// A shell and one module per handout. Each exports NAME and mount(app, sheet):
// the module owns its own loading, its own controls and its own paper, and this
// file only decides which one is on screen. Two sheets in one file was already
// the wrong shape at two, because only one of them can print at a time and the
// other has to be out of the way rather than merely further down.
//
// Print stylesheets, like every other printable here. No PDF library -- the
// browser's own Save as PDF is what makes the file.
import { el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { printGuidelines } from './print-guidelines.js';
import * as trainerCard from './sheet-trainer-card.js';
import * as chaosCup from './sheet-chaos-cup.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');
const chooser = document.querySelector('#chooser');
const guide = document.querySelector('#guide');

const SHEETS = [trainerCard, chaosCup];

let current = null;

async function show(index) {
  current = index;
  sheet.classList.remove('is-ready');
  sheet.replaceChildren();
  app.replaceChildren(el('p', { className: 'muted-note', text: 'Loading.' }));

  try {
    const ok = await SHEETS[index].mount(app, sheet);
    if (ok) sheet.classList.add('is-ready');
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem(SHEETS[index].NAME));
  }
}

function tabs() {
  // Buttons rather than a dropdown: there are two, and a dropdown to choose
  // between two things is a click to reveal a click.
  return el('div', { className: 'view-toggle', role: 'group',
    'aria-label': 'Which handout' },
    SHEETS.map((s, i) => {
      const b = el('button', {
        type: 'button',
        className: current === i ? 'button' : 'button button-quiet',
        'aria-pressed': String(current === i),
        text: s.NAME
      });
      b.addEventListener('click', async () => {
        if (current === i) return;
        await show(i);
        chooser.replaceChildren(tabs());
      });
      return b;
    }));
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

  await show(0);
  chooser.replaceChildren(tabs());
  // Under the tabs rather than inside a sheet: the advice is the same whichever
  // handout is showing, and it should not vanish when the tab changes.
  guide.replaceChildren(printGuidelines());
})();
