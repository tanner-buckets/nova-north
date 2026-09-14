// Passwords: ask for a reset link, land on one, or change a password already
// known.
//
// Supabase Auth has always been able to do this; nothing on the site used it,
// so a professor who forgot a password had no route back in and the sign-in
// screen told them to ask somebody who had no way to help.
//
// One page for three states, because they are the same conversation from
// different starting points and a professor arriving from an email should not
// have to work out which page they wanted.
//
// A recovery link carries a real session to whoever opens it. That is how every
// password reset works, and it is why the link is short-lived and why the email
// goes only to the address already on the account.
import { supabase, el } from '../supabase-client.js';
import { status } from './attendance-core.js';

const app = document.querySelector('#app');

// Supabase's own minimum is lower. Eight is asked for here because these
// accounts can read every child's name in the league.
const MIN_LENGTH = 8;

function passwordFields(prefix) {
  const first = el('input', {
    id: `${prefix}-pw`, type: 'password', required: 'required',
    autocomplete: 'new-password', minlength: String(MIN_LENGTH)
  });
  const second = el('input', {
    id: `${prefix}-pw2`, type: 'password', required: 'required',
    autocomplete: 'new-password', minlength: String(MIN_LENGTH)
  });

  return {
    first,
    second,
    nodes: [
      el('p', { className: 'field' }, [
        el('label', { for: first.id, text: 'New password' }), first
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: second.id, text: 'Type it again' }), second
      ]),
      el('p', { className: 'field-help',
        text: `At least ${MIN_LENGTH} characters. These accounts can read every `
            + 'player’s full name and birth year, so pick something you do not '
            + 'use anywhere else.' })
    ],
    // Checked here so the two common mistakes are caught without a round trip,
    // and so "they did not match" is not reported as a server error.
    problem() {
      if (first.value.length < MIN_LENGTH) {
        return `A password needs at least ${MIN_LENGTH} characters.`;
      }
      if (first.value !== second.value) {
        return 'Those two do not match. Type the same password twice.';
      }
      return null;
    }
  };
}

async function setPassword(fields, note, button, successText) {
  const bad = fields.problem();
  if (bad) { status(note, bad, 'error'); return; }

  button.disabled = true;
  status(note, 'Saving.');

  const { error } = await supabase.auth.updateUser({ password: fields.first.value });
  if (error) {
    button.disabled = false;
    status(note, `That did not save: ${error.message}`, 'error');
    return;
  }

  note.className = 'form-status is-good';
  note.replaceChildren(
    el('span', { text: `${successText} ` }),
    el('a', { href: 'index.html', text: 'Professor tools' })
  );
  button.remove();
}

// --- Set a new password, arriving from a link --------------------------------

function recoveryForm() {
  const fields = passwordFields('new');
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Set the password' });

  const form = el('form', {}, [...fields.nodes, el('p', {}, [go]), note]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setPassword(fields, note, go, 'Password set, and you are signed in.');
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Choose a new password' }),
    el('p', { text: 'This link signed you in. Set a password and it is done.' }),
    form
  ]);
}

// --- Change a password already known -----------------------------------------

function changeForm(email) {
  const fields = passwordFields('change');
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Change the password' });

  const form = el('form', {}, [...fields.nodes, el('p', {}, [go]), note]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setPassword(fields, note, go, 'Password changed.');
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Change your password' }),
    el('p', { text: `Signed in as ${email}.` }),
    form
  ]);
}

// --- Ask for a link -----------------------------------------------------------

function requestForm() {
  const email = el('input', {
    id: 'email', type: 'email', required: 'required', autocomplete: 'username'
  });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Email me a link' });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: 'email', text: 'Your email' }), email
    ]),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status(note, 'Sending.');

    // Back to this page, resolved against wherever it is actually being served
    // from, so the same code works on a laptop and on the live site. The address
    // still has to be allow-listed in Supabase, or the link goes nowhere.
    const redirectTo = new URL('password.html', location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });

    go.disabled = false;

    // Deliberately the same answer whether or not that address has an account.
    // Otherwise this becomes a way to find out who the professors are.
    if (error && !/rate/i.test(error.message)) {
      console.error(error);
    }
    if (error && /rate/i.test(error.message)) {
      status(note, 'Too many requests just now. Wait a few minutes and try again.', 'error');
      return;
    }
    status(note, 'If that address has a professor account, a link is on its way. '
      + 'It expires, so use it soon, and check the spam folder.', 'good');
  });

  return el('section', { className: 'card' }, [
    el('h2', { text: 'Forgotten your password?' }),
    el('p', { text: 'A link goes to the address on the account. Opening it signs '
      + 'you in long enough to choose a new password.' }),
    form,
    el('p', { className: 'muted-note' }, [
      el('span', { text: 'Remembered it? ' }),
      el('a', { href: 'index.html', text: 'Sign in' })
    ])
  ]);
}

// --- Which of the three ------------------------------------------------------

(async () => {
  app.replaceChildren(el('p', { className: 'notice', text: 'One moment.' }));

  // A recovery link arrives one of two ways depending on how the project is
  // configured: a token in the query string that has to be exchanged, or a
  // fragment the client library consumes on its own. Both are handled, because
  // which one is in use is a dashboard setting rather than something this code
  // can see.
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  if (tokenHash && type === 'recovery') {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error) {
      app.replaceChildren(
        el('p', { className: 'notice notice-problem',
          text: `That link did not work: ${error.message}. Links expire and can `
              + 'only be used once, so ask for another.' }),
        requestForm()
      );
      return;
    }
    app.replaceChildren(recoveryForm());
    return;
  }

  // The error a used or expired fragment link leaves behind.
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hash.get('error_description') || hash.get('error')) {
    app.replaceChildren(
      el('p', { className: 'notice notice-problem',
        text: `That link did not work: ${hash.get('error_description') || hash.get('error')}. `
            + 'Links expire and can only be used once, so ask for another.' }),
      requestForm()
    );
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    // A recovery session and an ordinary one look the same here, which is fine:
    // either way the person is signed in and allowed to set their own password.
    app.replaceChildren(changeForm(session.user.email));
    return;
  }

  app.replaceChildren(requestForm());
})();
