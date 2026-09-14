// Shared professor session handling.
//
// Used by the admin pages and by the professor bar that appears on public pages.
// Nothing here is a security boundary: the admin HTML is a static file anyone can
// fetch, and hiding a button protects nothing. What protects the data is row
// level security, which refuses every professor query without a real session.
// This module decides what to *show*, not what is *allowed*.
import { supabase, el } from './supabase-client.js';

export async function currentProfessor() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  // is_professor() is security definer, so it answers truthfully even though the
  // professors table itself is unreadable to a signed-in non-professor.
  const { data, error } = await supabase.rpc('is_professor');
  if (error || !data) return null;

  return { userId: session.user.id, email: session.user.email };
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // The old wording sent people to another professor, who had no way to help.
  // The reset link is the actual route back in.
  if (error) return { ok: false, message: 'That email and password did not match. Try again, or use the reset link below.' };

  const professor = await currentProfessor();
  if (!professor) {
    await supabase.auth.signOut();
    return { ok: false, message: 'That account signed in, but it is not registered as a professor. Ask an existing professor to add you.' };
  }
  return { ok: true, professor };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// The bar that appears at the foot of every public page once a professor is
// signed in. Invisible to everyone else, and absent entirely when signed out.
//
// The links are contextual: every page offers the way back to the tools, but a
// shortcut only appears where it belongs. Upload is on the home page, because
// that is where a professor lands after an event, and inside the tools. Putting
// it on the prize wall would be a button nobody is looking for there.
export async function mountProfessorBar({ prefix = '', tdf = false } = {}) {
  const professor = await currentProfessor();
  if (!professor) return;

  const bar = el('div', { className: 'prof-bar', role: 'region', 'aria-label': 'Professor tools' }, [
    el('div', { className: 'prof-bar-inner' }, [
      el('span', { className: 'prof-who', text: professor.email }),
      el('nav', { className: 'prof-links', 'aria-label': 'Professor tools' }, [
        el('a', { href: `${prefix}admin/index.html`, text: 'Professor tools' }),
        tdf
          ? el('a', { href: `${prefix}admin/upload.html`, className: 'prof-primary', text: 'Upload TDF' })
          : null
      ]),
      el('button', { type: 'button', className: 'prof-signout', text: 'Sign out' })
    ])
  ]);

  bar.querySelector('.prof-signout').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  document.body.append(bar);
  document.body.classList.add('has-prof-bar');
}
