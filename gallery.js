// The public gallery: approved photographs, newest first, and the form that
// sends one in.
//
// Nothing here decides what is visible. approved_gallery() returns approved
// rows and only approved rows, and the storage policy refuses to sign a
// picture no approved row points at, so a page bug cannot publish anything
// early.
import { supabase, el, problem } from './supabase-client.js';
import { signedUrls, signedUrl, newSubmissionPaths, GALLERY_BUCKET } from './gallery-store.js';
import { prepare, ACCEPT } from './gallery-image.js';

const PAGE = 24;

const host = document.querySelector('#gallery');
const formHost = document.querySelector('#submit-form');

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});

// --- The grid ----------------------------------------------------------------

const grid = el('ul', { className: 'photo-grid' });
const more = el('button', { type: 'button', className: 'button button-quiet', text: 'Show more' });
const moreWrap = el('p', { className: 'photo-more' }, [more]);

// Everything on screen, in order, so the viewer can step through it.
let shown = [];
let cursor = null;
let loading = false;

function status(node, message, kind) {
  node.className = 'form-status' + (kind ? ` is-${kind}` : '');
  node.textContent = message;
}

function figure(photo, index) {
  const img = el('img', {
    className: 'photo-thumb',
    src: photo.thumbUrl,
    // The caption is the only description anybody has written. Without one
    // there is nothing honest to say beyond what the picture is, and inventing
    // a description would be worse than a plain one.
    alt: photo.caption || 'A photograph from a league day',
    loading: 'lazy',
    decoding: 'async'
  });

  const button = el('button', {
    type: 'button', className: 'photo-open',
    'aria-label': photo.caption
      ? `Open: ${photo.caption}`
      : `Open the photograph from ${DAY.format(new Date(photo.submitted_at))}`
  }, [img]);
  button.addEventListener('click', () => openViewer(index));

  return el('li', { className: 'photo-cell' }, [
    el('figure', { className: 'photo-figure' }, [
      button,
      photo.caption
        ? el('figcaption', { className: 'photo-caption', text: photo.caption })
        : null
    ])
  ]);
}

// Appends rather than redrawing. Replacing the grid on every "Show more" would
// swap the src of every picture already on screen for the same value, and some
// browsers flash the alt text while they work out that nothing changed.
function append(from) {
  grid.append(...shown.slice(from).map((photo, i) => figure(photo, from + i)));
  moreWrap.hidden = cursor === null;
}

async function loadMore() {
  if (loading) return;
  loading = true;
  more.disabled = true;

  const { data, error } = await supabase.rpc('approved_gallery', {
    p_limit: PAGE,
    p_before: cursor ? cursor.at : null,
    p_before_id: cursor ? cursor.id : null
  });

  loading = false;
  more.disabled = false;

  if (error) {
    host.replaceChildren(problem('The gallery'));
    host.removeAttribute('aria-busy');
    return;
  }

  const rows = data || [];
  const urls = await signedUrls(rows.map((r) => r.thumb_path));
  const before = shown.length;

  for (const row of rows) {
    const thumbUrl = urls.get(row.thumb_path);
    if (!thumbUrl) continue;    // nothing to show; skip rather than break the row
    shown.push({ ...row, thumbUrl });
  }

  // A short page is the last page. Asking again would be one request to learn
  // there is nothing left.
  cursor = rows.length === PAGE
    ? { at: rows[rows.length - 1].submitted_at, id: rows[rows.length - 1].id }
    : null;

  host.removeAttribute('aria-busy');

  if (!shown.length) {
    host.replaceChildren(el('p', { className: 'notice',
      text: 'No photos yet. Send us the first one.' }));
    return;
  }

  if (!host.contains(grid)) host.replaceChildren(grid, moreWrap);
  append(before);
}

more.addEventListener('click', loadMore);

// --- The viewer --------------------------------------------------------------

// One dialog, reused. The full rendition is signed when it is opened rather
// than with the page: a visitor who looks at two pictures should not have paid
// for a URL to all twenty-four.
const viewerImg = el('img', { className: 'viewer-img', alt: '' });
const viewerCaption = el('p', { className: 'viewer-caption' });
const viewerCount = el('p', { className: 'viewer-count' });
const prev = el('button', { type: 'button', className: 'viewer-step', text: 'Previous' });
const next = el('button', { type: 'button', className: 'viewer-step', text: 'Next' });
const close = el('button', { type: 'button', className: 'viewer-close', 'aria-label': 'Close', text: 'Close' });

const viewer = el('dialog', { className: 'viewer', 'aria-label': 'Photograph' }, [
  el('div', { className: 'viewer-frame' }, [viewerImg]),
  el('div', { className: 'viewer-bar' }, [
    prev, el('div', { className: 'viewer-text' }, [viewerCaption, viewerCount]), next
  ]),
  close
]);
document.body.append(viewer);

let at = 0;

async function show(index) {
  at = (index + shown.length) % shown.length;
  const photo = shown[at];

  viewerImg.removeAttribute('src');
  viewerImg.alt = photo.caption || 'A photograph from a league day';
  viewerCaption.textContent = photo.caption || '';
  viewerCaption.hidden = !photo.caption;
  viewerCount.textContent = `${at + 1} of ${shown.length} · `
    + DAY.format(new Date(photo.submitted_at));
  prev.disabled = next.disabled = shown.length < 2;

  // The thumbnail first, so there is something on screen while the larger one
  // is signed and fetched.
  viewerImg.src = photo.thumbUrl;
  const url = photo.fullUrl || await signedUrl(photo.storage_path);
  if (url) {
    photo.fullUrl = url;
    if (shown[at] === photo) viewerImg.src = url;
  }
}

function openViewer(index) {
  show(index);
  if (!viewer.open) viewer.showModal();
}

prev.addEventListener('click', () => show(at - 1));
next.addEventListener('click', () => show(at + 1));
close.addEventListener('click', () => viewer.close());

// Escape already closes a modal dialog. These two are the keys somebody
// actually reaches for in a gallery.
viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
});

// Clicking the backdrop. The dialog fills the screen, so the backdrop is the
// dialog itself anywhere outside the frame.
viewer.addEventListener('click', (e) => {
  if (e.target === viewer) viewer.close();
});

// --- Sending one in ----------------------------------------------------------

const REFUSALS = {
  not_matched: 'We could not match that Player ID and first name. Both have to '
    + 'be the ones on the player’s own account — check them with a professor if '
    + 'you are not sure.',
  too_many: 'That is a lot of photos from one person today. Try again tomorrow, '
    + 'or hand the rest to a professor at league.',
  already_submitted: 'That photo looks like it has already been sent. '
    + 'Reload the page and try again if you meant to send a different one.',
  bad_path: 'Something went wrong preparing that photo. Reload the page and '
    + 'try again.'
};

function submissionForm() {
  const photo = el('input', { id: 'photo', type: 'file', accept: ACCEPT, required: 'required' });
  const caption = el('input', { id: 'caption', type: 'text', maxlength: '300',
    autocomplete: 'off', placeholder: 'Optional. A few words about the day.' });
  const playerId = el('input', { id: 'submit-player-id', inputmode: 'numeric',
    autocomplete: 'off', required: 'required', placeholder: 'e.g. 1234567' });
  const firstName = el('input', { id: 'submit-first-name', type: 'text',
    autocomplete: 'given-name', required: 'required' });

  const note = el('p', { className: 'form-status', role: 'status' });
  const preview = el('div', { className: 'submit-preview' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Send the photo' });

  let ready = null;

  photo.addEventListener('change', async () => {
    if (ready) { ready.release(); ready = null; }
    preview.replaceChildren();

    const file = photo.files?.[0];
    if (!file) return;

    try {
      status(note, 'Getting the photo ready.');
      ready = await prepare(file);
      preview.replaceChildren(el('img', {
        className: 'submit-preview-img', src: ready.previewUrl, alt: ''
      }));
      status(note, `Ready to send, at ${ready.width} by ${ready.height}. `
        + 'The camera and location details are removed.', 'good');
    } catch (err) {
      photo.value = '';
      status(note, err.message, 'error');
    }
  });

  const form = el('form', {}, [
    el('p', { className: 'field' }, [
      el('label', { for: photo.id, text: 'Photo' }), photo
    ]),
    el('p', { className: 'field-help',
      text: 'A JPEG, PNG or WebP. It is resized in your browser before it is '
          + 'sent, and the camera and location details that phones attach are '
          + 'removed with it.' }),
    preview,
    el('p', { className: 'field' }, [
      el('label', { for: caption.id, text: 'Caption' }), caption
    ]),
    el('p', { className: 'field-help',
      text: 'Please do not put anybody’s name in the caption. A professor may '
          + 'shorten or clear it before the photo goes up.' }),
    el('p', { className: 'field' }, [
      el('label', { for: playerId.id, text: 'Your Player ID' }), playerId
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: firstName.id, text: 'Your first name' }), firstName
    ]),
    el('p', { className: 'field-help',
      text: 'So a professor knows who sent it, and who to ask about it. Neither '
          + 'is ever shown on this page.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ready) {
      status(note, 'Choose a photo first.', 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Sending.');

    const paths = newSubmissionPaths();
    try {
      // The files go first and the row second. Either order leaves something
      // behind when the other half fails, and this is the half that fails
      // harmlessly: two objects nothing points at, in a bucket nothing lists.
      // The other way round would put a photograph with no picture in it into
      // a professor's queue, which is a person's time rather than a few
      // kilobytes.
      await upload(paths.full, ready.full);
      await upload(paths.thumb, ready.thumb);

      const { data, error } = await supabase.rpc('submit_gallery_photo', {
        p_player_id: playerId.value,
        p_first_name: firstName.value,
        p_storage_path: paths.full,
        p_thumb_path: paths.thumb,
        p_width: ready.width,
        p_height: ready.height,
        p_caption: caption.value
      });

      if (error) throw error;
      if (!data?.ok) {
        status(note, REFUSALS[data?.code] || 'That could not be sent. Try again.', 'error');
        go.disabled = false;
        return;
      }

      ready.release();
      ready = null;
      form.reset();
      preview.replaceChildren();
      status(note, 'Sent. A professor will look at it, and it will appear on '
        + 'this page once they have approved it.', 'good');
    } catch (err) {
      status(note, 'That could not be sent: ' + (err.message || 'the upload failed')
        + '. Check your connection and try again.', 'error');
    }
    go.disabled = false;
  });

  return form;
}

async function upload(path, blob) {
  const { error } = await supabase.storage.from(GALLERY_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
}

formHost.replaceChildren(submissionForm());
loadMore();
