import { currentProfessor, signIn, signOut } from '../auth.js';
import { el } from '../supabase-client.js';

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
    status
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

const TOOLS = [
  { href: 'upload.html', name: 'Upload a TDF',
    note: 'Records attendance and awards points for an event. The file is read in your browser and never uploaded anywhere.' },
  { href: 'attendance.html', name: 'Record attendance by hand',
    note: 'For a day with no tournament file. Grants the same loyalty week and points an upload does.' },
  { href: 'consent.html', name: 'Visibility and consent',
    note: 'Turn a player\u2019s listing on or off. Every change is logged.' },
  { href: 'drops.html', name: 'Drop requests',
    note: 'Confirm a cancellation and promote the next person off the waiting list.' },
  { href: 'points.html', name: 'Manual points',
    note: 'Award or correct prize points. Corrections are reversing entries, never edits.' },
  { href: 'trainer-card.html', name: 'Trainer Card',
    note: 'Record badges, Elite 4 wins and Champion status.' },
  { href: 'players.html', name: 'Players',
    note: 'Add a player, or correct a name or Player ID.' },
  { href: 'events.html', name: 'Events',
    note: 'Create and edit events, capacities and registration.' },
  { href: 'reference.html', name: 'Reference data',
    note: 'Earning actions, prize wall items, badges, ranks and releases.' },
  { href: 'print.html', name: 'Printable lists',
    note: 'Loyalty tiers for the store, and pre-registration lists for the desk.' }
];

async function render() {
  const professor = await currentProfessor();
  if (!professor) {
    showSignIn();
    return;
  }

  whoami.replaceChildren(
    el('p', { className: 'muted-note' }, [
      el('span', { text: `Signed in as ${professor.email}. ` }),
      el('button', { type: 'button', className: 'link-button', id: 'signout', text: 'Sign out' })
    ])
  );
  whoami.querySelector('#signout').addEventListener('click', async () => {
    await signOut();
    render();
  });

  gate.replaceChildren();
  tools.replaceChildren(
    el('h2', { text: 'Professor tools' }),
    el('ul', { className: 'tool-list' }, TOOLS.map((t) =>
      el('li', {}, [
        el('a', { className: 'tool-card', href: t.href }, [
          el('span', { className: 'tool-name', text: t.name }),
          el('span', { className: 'tool-note', text: t.note })
        ])
      ])))
  );
}

render();
