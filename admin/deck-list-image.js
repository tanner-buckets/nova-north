// A picture of a rental deck's list: picking one, seeing it, and putting it away.
//
// This is deliberately NOT prize-art.js, and the difference is not the bucket.
// A prize picture is recognised -- is that the right box -- so an 800px tile
// and a small preview answer the only question anybody has about it. A deck
// list is READ, so it is stored at 2000px and previewed large enough to check
// that the writing survived the resize, which is the failure this field exists
// to catch before a player meets it on the shelf.
//
// The resizing, the re-encoding and the guard on the decoded size all live in
// image-file.js, shared with the gallery and the prize wall. That one is the
// copy that matters: it is the difference between a 200KB file and half a
// gigabyte of canvas, and it is also what strips the camera and GPS details a
// phone attaches -- a list photographed at a kitchen table carries the
// coordinates of the kitchen.
import { supabase, el } from '../supabase-client.js';
import { prepareOne, DOCUMENT, ACCEPT } from '../image-file.js';
import { status } from './attendance-core.js';

const BUCKET = 'deck-lists';

// Named after a uuid rather than the deck, because a deck is renamed and its
// id is not written anywhere a person reads. The row points at the object; the
// bucket does not need to be browsable by eye.
export async function uploadDeckListImage(blob) {
  const path = `decks/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

// Replacing a picture, or moving a deck to a link or to pasted text, leaves the
// old object behind otherwise. Nothing else in this project deletes, but an
// orphaned image is not history worth keeping, and a failure here is not worth
// failing the save over.
export async function removeDeckListImage(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('Old deck list picture could not be removed:', error.message);
}

// The field. `deck` is the row being edited, or null on the add form.
//
// Three states a professor can leave it in, and the caller reads them back
// rather than being told: nothing touched, a new picture chosen, or the
// existing one cleared.
export function deckListImageField(deck = null, { currentUrl = null } = {}) {
  const input = el('input', { type: 'file', accept: ACCEPT });
  const note = el('p', { className: 'form-status', role: 'status' });
  const preview = el('div', { className: 'deck-list-preview' });

  const clear = el('button', {
    type: 'button', className: 'link-button', text: 'Remove the picture'
  });

  let chosen = null;      // a new picture, ready to upload
  let cleared = false;    // the existing one is to go

  function paint(src) {
    preview.replaceChildren(src
      ? el('img', { className: 'deck-list-preview-img', src, alt: '' })
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
      chosen = await prepareOne(file, DOCUMENT);
      cleared = false;
      paint(chosen.previewUrl);
      status(note, `Ready, at ${chosen.width} by ${chosen.height}. `
        + 'Read it above before you save: if you cannot, nor can a player.', 'good');
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
    cleared = !!(deck && deck.deck_list_image_path);
    paint(null);
    status(note, cleared
      ? 'It will come off the shelf when you save.'
      : 'Nothing chosen.');
  });

  return {
    nodes: [
      el('p', { className: 'field' }, [
        el('label', { text: 'Picture of the list' }, [input])
      ]),
      el('p', { className: 'field-help',
        text: 'A JPEG, PNG or WebP of the list itself — a photo of the sheet in '
            + 'the deck box is fine. It is resized in your browser before it is '
            + 'sent, and the camera and location details a phone attaches are '
            + 'removed with it. Pasting the list in is better where you have the '
            + 'choice: text can be read aloud, searched and copied into the '
            + 'game, and a picture can do none of those.' }),
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
