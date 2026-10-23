import { currentProfessor, signIn, signOut } from '../auth.js';
import { supabase, el } from '../supabase-client.js';

const gate = document.querySelector('#gate');
const tools = document.querySelector('#tools');
const whoami = document.querySelector('#whoami');

function showSignIn(message) {
  const status = el('p', { className: 'form-status', role: 'status', text: message || '' });
  if (message) status.classList.add('is-error');

  const form = el('form', { className: 'lookup-form' }, [
    el('p', { className: 'field' }, [
      el('label', { for: 'email', text: 'Email' }),
      el('input', { id: 'email', name: 'email', type: 'email', required: 'required', autocomplete: 'username' })
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: 'password', text: 'Password' }),
      el('input', { id: 'password', name: 'password', type: 'password', required: 'required', autocomplete: 'current-password' })
    ]),
    el('p', {}, [el('button', { type: 'submit', className: 'button', text: 'Sign in' })]),
    status,
    el('p', { className: 'muted-note' }, [
      el('a', { href: 'password.html', text: 'Forgotten your password?' })
    ])
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Signing in.';

    const data = Object.fromEntries(new FormData(form).entries());
    const result = await signIn(data.email, data.password);
    button.disabled = false;

    if (!result.ok) {
      status.className = 'form-status is-error';
      status.textContent = result.message;
      return;
    }
    render();
  });

  gate.replaceChildren(
    el('h2', { text: 'Sign in' }),
    el('p', { text: 'Professor accounts only. Everything below stays empty without one — '
      + 'not because the page hides it, but because the database refuses it.' }),
    form
  );
  tools.replaceChildren();
  whoami.replaceChildren();
}

// Sixteen tools in one list had stopped being a menu and become something to
// read. Grouped by what a professor came here to do, and collapsed, so the
// page is four choices rather than sixteen.
//
// `queue` names a count fetched below. A tool with one carries a badge, and so
// does the section holding it -- the point of collapsing is that you stop
// seeing what is inside, and something waiting for a person has to survive
// that.
const SECTIONS = [
  {
    name: 'Event management',
    note: 'Running a league day, and recording what happened.',
    tools: [
      { href: 'events.html', name: 'Events',
        note: 'Create and edit events, set what they cost, and decide which take pre-registration.' },
      { href: 'staff.html', name: 'Staff schedule',
        note: 'Who can make each event, and who is organiser, head judge and floor judge on the day. Past events are kept.' },
      { href: 'upload.html', name: 'Upload a TDF',
        note: 'Records attendance and awards points for an event. The file is read in your browser and never uploaded anywhere.' },
      { href: 'attendance.html', name: 'Record attendance by hand',
        note: 'For a day with no tournament file. One point and one loyalty week for turning up. Adds new players too.' },
      { href: 'attendance-history.html', name: 'Attendance history',
        note: 'How many came each week, split by played, attended and age division, and who was here on any given day. Read only.' },
      { href: 'drops.html', name: 'Drop requests', queue: 'drops',
        note: 'Confirm a cancellation and promote the next person off the waiting list.' }
    ]
  },
  {
    name: 'Player management',
    note: 'One player at a time: who they are, what they have earned, and what the site may show.',
    tools: [
      { href: 'players.html', name: 'Player records',
        note: 'Add a player, or correct a name or Player ID.' },
      { href: 'consent.html', name: 'Visibility and consent', queue: 'visibility',
        note: 'Turn a player’s listing on or off, and answer the requests players have sent. Every change is logged.' },
      { href: 'trainer-card.html', name: 'Trainer Card',
        note: 'Record badges, Elite 4 wins and Champion. Rank follows from what is recorded; it is not set by hand.' },
      { href: 'points.html', name: 'Points',
        note: 'Award points for anything else earned, and record what is spent at the prize wall. Corrections are reversing entries, never edits.' }
    ]
  },
  {
    name: 'Update program details',
    note: 'The lists players read: what points buy, what can be borrowed, what is on the gallery.',
    tools: [
      { href: 'prizes.html', name: 'Prize wall and earning',
        note: 'What points buy and what earns them. Rows are retired, never deleted.' },
      { href: 'rentals.html', name: 'Rental decks',
        note: 'Decks players can borrow, the bounty list of ones we want built, and the tags a deck can wear. All public.' },
      { href: 'gallery-review.html', name: 'Gallery review', queue: 'gallery',
        note: 'Photos people have sent in. Nothing reaches the gallery page until it is approved here, and a published photo can be taken down from the same screen.' },
      { href: 'reference.html', name: 'Reference data',
        note: 'Badges, Trainer Card ranks, and releases with their loyalty tiers.' }
    ]
  },
  {
    name: 'Staff tools',
    note: 'Things to print, and places to look something up.',
    tools: [
      { href: 'trainer-cards.html', name: 'Trainer Card Creator',
        note: 'Print membership cards, eight to a page. Everyone active, everyone without one yet, or a list you build by hand.' },
      { href: 'print.html', name: 'Printable lists',
        note: 'Loyalty tiers for the store and pre-registration for the desk. Print stylesheets, never public.' },
      { href: 'resources.html', name: 'Resources',
        note: 'The outside links we reach for most: the rules, the penalty sheet, Play! Tools, a round timer and a raffle wheel.' }
    ]
  }
];

// How many things are waiting for a person, per queue.
//
// Head counts rather than rows: the number is the whole of what this page wants
// and the rows can be hundreds. A queue that fails to load is left without a
// badge rather than showing a zero -- "nothing waiting" and "could not tell"
// are different, and the second one should not look like the first.
async function queueCounts() {
  const count = async (table, column, value) => {
    const { count: n, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value);
    return error ? null : n;
  };

  const [drops, visibility, gallery] = await Promise.all([
    count('registrations', 'status', 'drop_requested'),
    count('visibility_requests', 'status', 'pending'),
    count('gallery_photos', 'status', 'pending')
  ]);

  return { drops, visibility, gallery };
}

function badge(n) {
  return el('span', {
    className: 'queue-badge',
    title: `${n} waiting for a professor`
  }, [
    el('span', { 'aria-hidden': 'true', text: String(n) }),
    el('span', { className: 'hidden-label', text: ` ${n} waiting` })
  ]);
}

function toolCard(tool, counts) {
  const n = tool.queue ? counts[tool.queue] : null;
  return el('li', {}, [
    el('a', { className: 'tool-card', href: tool.href }, [
      el('span', { className: 'tool-name-row' }, [
        el('span', { className: 'tool-name', text: tool.name }),
        n ? badge(n) : null
      ]),
      el('span', { className: 'tool-note', text: tool.note })
    ])
  ]);
}

function sectionBlock(section, counts) {
  // The section total, so a collapsed group still says it wants attention.
  const waiting = section.tools
    .reduce((sum, t) => sum + (t.queue ? (counts[t.queue] || 0) : 0), 0);

  return el('details', { className: 'tool-section' }, [
    el('summary', {}, [
      el('span', { className: 'tool-section-name', text: section.name }),
      waiting ? badge(waiting) : null,
      el('span', { className: 'tool-section-note', text: section.note })
    ]),
    el('ul', { className: 'tool-list' },
      section.tools.map((t) => toolCard(t, counts)))
  ]);
}

function draw(counts) {
  const total = Object.values(counts).reduce((s, n) => s + (n || 0), 0);

  // Filtered, because replaceChildren stringifies a null into the literal word
  // "null" on the page -- which is what a quiet week looked like, since the
  // waiting line withholds itself when nothing is waiting. el() drops a falsy
  // child for this reason; replaceChildren is not el().
  //
  // No heading here either: the page's own h1 already says Professor tools, and
  // a second one underneath read as a stray repeat of the title.
  tools.replaceChildren(...[
    total
      ? el('p', { className: 'tool-waiting',
          text: `${total} thing${total === 1 ? '' : 's'} waiting for a professor.` })
      : null,
    ...SECTIONS.map((s) => sectionBlock(s, counts))
  ].filter(Boolean));
}

async function render() {
  const professor = await currentProfessor();
  if (!professor) {
    showSignIn();
    return;
  }

  whoami.replaceChildren(
    el('p', { className: 'muted-note' }, [
      el('span', { text: `Signed in as ${professor.email}. ` }),
      el('a', { href: 'password.html', text: 'Change password' }),
      el('span', { text: ' · ' }),
      el('button', { type: 'button', className: 'link-button', id: 'signout', text: 'Sign out' })
    ])
  );
  whoami.querySelector('#signout').addEventListener('click', async () => {
    await signOut();
    render();
  });

  gate.replaceChildren();

  // Drawn once with no badges so the menu is usable immediately, then again
  // once the counts land. The menu is the point; the badges are a bonus on top
  // of it and should not hold it up.
  draw({});
  try {
    draw(await queueCounts());
  } catch (err) {
    console.error(err);
  }
}

render();
