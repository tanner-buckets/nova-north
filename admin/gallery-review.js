// Approving photographs for the gallery.
//
// This screen is the whole of the privacy control on the gallery. A submitted
// picture is unreadable to anybody without a professor session -- the bucket is
// private and the storage policy will only sign an object an approved row
// points at -- so until somebody here says yes, there is nothing to see.
//
// Turning one down deletes the files. The row stays, because "somebody sent
// this and it was turned down" is worth keeping; the picture is not. That also
// means taking a published photograph down is the same action as rejecting one,
// which is deliberate: a parent asking for a picture of their child to come off
// the page is the likeliest thing this screen will ever be asked to do, and it
// should not be a different button in a different place.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';
import { signedUrls, signedUrl, GALLERY_BUCKET } from '../gallery-store.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

const WHEN = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
});

const QUEUES = [
  { key: 'pending', heading: 'Waiting for review',
    empty: 'Nothing is waiting. Everything sent in has been looked at.' },
  { key: 'approved', heading: 'On the gallery page',
    empty: 'Nothing has been approved yet.' },
  { key: 'rejected', heading: 'Turned down and taken down',
    empty: 'Nothing has been turned down.' }
];

let professor = null;
let open = 'pending';

const when = (value) => (value ? WHEN.format(new Date(value)) : '');

async function load(statusKey) {
  const { data, error } = await supabase.rpc('gallery_review_list', {
    p_status: statusKey, p_limit: 100
  });
  if (error) throw error;

  const rows = data || [];
  // A rejected photograph has no files left, so there is nothing to sign.
  const urls = await signedUrls(
    rows.filter((r) => !r.files_removed_at).map((r) => r.thumb_path)
  );
  return rows.map((r) => ({ ...r, thumbUrl: urls.get(r.thumb_path) || null }));
}

// --- One photograph ----------------------------------------------------------

function thumb(photo) {
  if (!photo.thumbUrl) {
    return el('p', { className: 'review-missing',
      text: photo.files_removed_at
        ? `Picture deleted ${when(photo.files_removed_at)}.`
        : 'The picture could not be loaded. It may not have finished uploading.' });
  }

  const img = el('img', { className: 'review-thumb', src: photo.thumbUrl,
    alt: photo.caption || 'The submitted photograph', loading: 'lazy' });

  // The full rendition is what somebody will actually see on the page, and a
  // 480px thumbnail is not enough to tell who is in a picture.
  const link = el('button', { type: 'button', className: 'link-button',
    text: 'Open the full picture' });
  link.addEventListener('click', async () => {
    link.disabled = true;
    const url = await signedUrl(photo.storage_path);
    link.disabled = false;
    if (url) window.open(url, '_blank', 'noopener');
  });

  return el('div', { className: 'review-art' }, [img, el('p', {}, [link])]);
}

function card(photo, reload) {
  const note = el('p', { className: 'form-status', role: 'status' });

  const caption = el('textarea', {
    id: `caption-${photo.id}`, rows: '2', maxlength: '300',
    placeholder: 'No caption. One is optional.'
  });
  caption.value = photo.caption || '';

  const reason = el('input', {
    id: `reason-${photo.id}`, type: 'text', maxlength: '300',
    placeholder: 'Optional. Only a professor ever reads this.'
  });
  reason.value = photo.decided_note || '';

  async function decide(approve) {
    const buttons = [...actions.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    status(note, approve ? 'Approving.' : 'Taking it down.');

    const { data, error } = await supabase.rpc('decide_gallery_photo', {
      p_id: photo.id,
      p_approve: approve,
      p_caption: caption.value,
      p_note: reason.value
    });

    if (error || !data?.ok) {
      buttons.forEach((b) => { b.disabled = false; });
      status(note, data?.code === 'files_gone'
        ? 'The picture for this one has already been deleted, so there is '
          + 'nothing left to put on the page. Reload to see where it stands.'
        : `That did not save: ${error?.message || data?.code || 'unknown reason'}.`,
        'error');
      return;
    }

    // Not an approval means the picture itself goes. A failure here is worth
    // saying out loud rather than swallowing: the row says the photograph is
    // off the page, and it is -- the storage policy stops signing it the moment
    // the status changes -- but a file nobody meant to keep is still sitting
    // there, and somebody should know.
    if (!approve) {
      const { error: gone } = await supabase.storage.from(GALLERY_BUCKET)
        .remove([data.storage_path, data.thumb_path]);
      if (gone) {
        status(note, 'It is off the page, but the file could not be deleted: '
          + `${gone.message}. Tell whoever looks after the database.`, 'error');
        return;
      }
      await supabase.rpc('mark_gallery_files_removed', { p_id: photo.id });
    }

    reload();
  }

  const actions = el('p', { className: 'review-actions' });

  if (photo.status === 'pending') {
    const yes = el('button', { type: 'button', className: 'button', text: 'Approve' });
    const no = el('button', { type: 'button', className: 'button button-danger', text: 'Turn it down' });
    yes.addEventListener('click', () => decide(true));
    no.addEventListener('click', () => {
      if (confirm('Turn this photo down? The picture is deleted and cannot be put back.')) decide(false);
    });
    actions.append(yes, no);
  } else if (photo.status === 'approved') {
    const save = el('button', { type: 'button', className: 'button button-quiet', text: 'Save the caption' });
    const down = el('button', { type: 'button', className: 'button button-danger', text: 'Take it down' });
    save.addEventListener('click', () => decide(true));
    down.addEventListener('click', () => {
      if (confirm('Take this photo off the gallery page? The picture is deleted and cannot be put back.')) decide(false);
    });
    actions.append(save, down);
  }

  const editable = photo.status !== 'rejected';

  return el('article', { className: 'card review-card' }, [
    thumb(photo),
    el('div', { className: 'review-body' }, [
      el('p', { className: 'review-who' }, [
        el('span', { text: photo.submitter_name || 'Unknown submitter' }),
        el('span', { className: 'count', text: photo.submitted_by })
      ]),
      el('p', { className: 'muted-note', text: `Sent ${when(photo.submitted_at)}`
        + (photo.width && photo.height ? ` · ${photo.width} by ${photo.height}` : '')
        + (photo.decided_at ? ` · decided ${when(photo.decided_at)}` : '') }),

      editable
        ? el('p', { className: 'field' }, [
            el('label', { for: caption.id, text: 'Caption' }), caption
          ])
        : el('p', { className: 'muted-note',
            text: photo.caption ? `Caption: ${photo.caption}` : 'No caption.' }),

      editable
        ? el('p', { className: 'field' }, [
            el('label', { for: reason.id, text: 'Note' }), reason
          ])
        : el('p', { className: 'muted-note',
            text: photo.decided_note ? `Note: ${photo.decided_note}` : 'No note.' }),

      actions,
      note
    ])
  ]);
}

// --- The page ----------------------------------------------------------------

function tabs(reload) {
  return el('nav', { className: 'review-tabs', 'aria-label': 'Which photographs' },
    QUEUES.map((q) => {
      const button = el('button', {
        type: 'button',
        className: 'review-tab' + (q.key === open ? ' is-open' : ''),
        'aria-current': q.key === open ? 'true' : null,
        text: q.heading
      });
      button.addEventListener('click', () => {
        if (q.key === open) return;
        open = q.key;
        reload();
      });
      return button;
    }));
}

async function render() {
  const queue = QUEUES.find((q) => q.key === open);
  let photos;
  try {
    photos = await load(open);
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The gallery queue'));
    return;
  }

  app.replaceChildren(
    tabs(render),
    el('h2', { text: `${queue.heading} (${photos.length})` }),
    photos.length
      ? el('div', { className: 'review-list' }, photos.map((p) => card(p, render)))
      : el('p', { className: 'notice', text: queue.empty })
  );
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
  render();
})();
