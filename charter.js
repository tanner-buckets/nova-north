// The league charter: what this league is for, and how we expect each other to
// behave while we are doing it.
//
// NOT PUBLISHED YET. The charter is a draft, so for now the page renders only
// for a signed-in professor and everybody else gets a short note. That is the
// same kind of gate as everything else `auth.js` governs: it decides what to
// SHOW. This file is a static asset anybody can fetch, so a determined reader
// can read the text in the source — which is fine, because none of it is
// secret. It is unfinished, not confidential. When it is ready, delete the gate
// and the `nav-prof` class on the nav item.
//
// The responsibilities section in the draft is still marked TODO, so it is not
// here. Neither are the one-line definitions beside each value: they are being
// worded, and half-written definitions on a page about how to treat each other
// would be worse than the words alone.
import { el } from './supabase-client.js';
import { currentProfessor, mountProfessorBar } from './auth.js';

const host = document.querySelector('#charter');

// Taken from the charter draft. The league is LoCo League here, as it is
// everywhere on this site -- the draft calls it by the venue's name, which is
// the room rather than the league.
const MISSION = 'The mission of LoCo League is to foster a community in which '
  + 'people can enjoy all aspects of Pokémon through a shared experience.';

// Words only, in the draft's own order. The definitions come later.
const VALUES = [
  'Kindness',
  'Honesty',
  'Hospitality',
  'Respectfulness',
  'Stewardship',
  'Playfulness',
  'Benevolence'
];

function charter() {
  return [
    el('section', { className: 'charter-mission', 'aria-labelledby': 'mission-heading' }, [
      el('h2', { id: 'mission-heading', className: 'charter-eyebrow', text: 'Our mission' }),
      el('p', { className: 'charter-statement', text: MISSION })
    ]),

    el('section', { 'aria-labelledby': 'values-heading' }, [
      el('h2', { id: 'values-heading', className: 'charter-eyebrow', text: 'Our values' }),
      el('ul', { className: 'value-grid' }, VALUES.map((word) =>
        el('li', { className: 'value-card' }, [
          el('span', { className: 'value-word', text: word })
        ])))
    ]),

    el('p', { className: 'section-note',
      text: 'This charter is a draft. What each value means in practice, and '
          + 'what we each take responsibility for, are still being written.' })
  ];
}

function notYet() {
  return [
    el('p', { className: 'notice notice-quiet',
      text: 'The league charter is still being written. It will be here once '
          + 'the professors have finished it.' }),
    el('p', {}, [
      el('a', { href: 'index.html', text: 'Back to the home page' })
    ])
  ];
}

async function load() {
  try {
    const professor = await currentProfessor();
    host.replaceChildren(...(professor ? charter() : notYet()));
  } finally {
    host.removeAttribute('aria-busy');
  }
}

load();
mountProfessorBar();
