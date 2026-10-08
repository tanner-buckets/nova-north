// A picture for a prize wall item: picking one, seeing it, and putting it away.
//
// Simpler than badge art, because nothing is read out of the picture. A badge
// tile takes its colours from the artwork; a prize is a photograph of a box on
// a shelf and the only question is whether it is the right box.
//
// The resizing, the re-encoding and the guard on the decoded size all live in
// image-file.js, shared with the gallery. One copy of that guard is the point:
// it is the difference between a 200KB file and half a gigabyte of canvas.
import { supabase, el } from '../supabase-client.js';
import { prepareOne, TILE, ACCEPT } from '../image-file.js';
import { status } from './attendance-core.js';

const BUCKET = 'prize-art';

// Named after a uuid rather than the item, because an item is renamed and its
// id is not written anywhere a person reads. The row points at the object; the
// bucket does not need to be browsable by eye.
export async function uploadPrizeArt(blob) {
  const path = `items/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

// Replacing or clearing a picture leaves the old object behind otherwise.
// Nothing else in this project deletes, but an orphaned image is not history
// worth keeping, and a failure here is not worth failing the save over.
export async function removePrizeArt(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('Old prize art could not be removed:', error.message);
}

// The field. `item` is the row being edited, or null on the add form.
//
// Three states a professor can leave it in, and the caller reads them back
// rather than being told: nothing touched, a new picture chosen, or the
// existing one cleared.
export function prizeArtField(item = null, { currentUrl = null } = {}) {
  const input = el('input', { type: 'file', accept: ACCEPT });
  const note = el('p', { className: 'form-status', role: 'status' });
  const preview = el('div', { className: 'prize-art-preview' });

  const clear = el('button', {
    type: 'button', className: 'link-button', text: 'Remove the picture'
  });

  let chosen = null;      // a new picture, ready to upload
  let cleared = false;    // the existing one is to go

  function paint(src) {
    preview.replaceChildren(src
      ? el('img', { className: 'prize-art-preview-img', src, alt: '' })
      : el('p', { className: 'muted-note', text: 'No picture.' }));
    clear.hidden = !src;
  }

  paint(currentUrl);

  input.addEventListener('change', async () => {
    if (chosen) { chosen.release(); chosen = null; }
    const file = input.files?.[0];
    if (!file) { paint(cleared ? null : currentUrl); return; }

    try {
      status(note, 'Getting the picture ready.');
      chosen = await prepareOne(file, TILE);
      cleared = false;
      paint(chosen.previewUrl);
      status(note, `Ready, at ${chosen.width} by ${chosen.height}. `
        + 'It is resized here, so a photo straight off a phone is fine.', 'good');
    } catch (err) {
      input.value = '';
      paint(cleared ? null : currentUrl);
      status(note, err.message, 'error');
    }
  });

  clear.addEventListener('click', () => {
    if (chosen) { chosen.release(); chosen = null; }
    input.value = '';
    // Only an existing picture needs clearing on save. Backing out of a picture
    // that was never saved is just not choosing one.
    cleared = !!(item && item.image_path);
    paint(null);
    status(note, cleared
      ? 'It will come off the wall when you save.'
      : 'Nothing chosen.');
  });

  return {
    nodes: [
      el('p', { className: 'field' }, [
        el('label', { text: item ? 'Picture' : 'Picture, optional' }, [input])
      ]),
      el('p', { className: 'field-help',
        text: 'A JPEG, PNG or WebP of the item itself. It is resized in your '
            + 'browser before it is sent, and the camera and location details '
            + 'a phone attaches are removed with it.' }),
      preview,
      el('p', {}, [clear]),
      note
    ],
    chosen: () => chosen,
    cleared: () => cleared,
    // After a save, so a second edit in the same sitting does not re-upload the
    // picture that is already on the row.
    release() { if (chosen) { chosen.release(); chosen = null; } }
  };
}
