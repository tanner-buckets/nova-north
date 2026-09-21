// Badge artwork: picking a picture, taking its colours, and putting it away.
//
// The colours used to be extracted offline and pasted into styles.css by hand,
// which is why a badge a professor created had none. The same canvas read works
// on the file they just chose, so the tile is coloured by whoever supplies the
// art, at the moment they supply it.
import { supabase, el, badgeArtUrl } from '../supabase-client.js';
import { status } from './attendance-core.js';

const BUCKET = 'badge-art';
const MAX_BYTES = 512 * 1024;        // matches the bucket's own limit
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// --- Colour ------------------------------------------------------------------

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrastWithWhite = (rgb) => 1.05 / (luminance(rgb) + 0.05);
const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

// The dominant colour of the subject, not the average of the picture.
//
// Transparent pixels are skipped because these images are cut out; near white
// and near black are skipped because they are outline and highlight rather than
// identity; and greys are skipped because they carry none. What is left is
// bucketed and weighted by saturation, so the colour somebody would name when
// they looked at it wins over the colour that merely covers the most pixels.
export function dominantColour(imageData) {
  const { data } = imageData;
  const bins = new Map();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const light = (max + min) / 2 / 255;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    if (light > 0.94 || light < 0.06 || sat < 0.15) continue;

    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bin = bins.get(key) || { r: 0, g: 0, b: 0, w: 0 };
    bin.r += r * sat; bin.g += g * sat; bin.b += b * sat; bin.w += sat;
    bins.set(key, bin);
  }

  let best = null;
  for (const bin of bins.values()) if (!best || bin.w > best.w) best = bin;
  if (!best) return null;

  return [best.r / best.w, best.g / best.w, best.b / best.w];
}

// The ring: the fill darkened until white on it clears 4.5:1, so a pale badge
// still has an outline against a white card.
//
// Rounded to whole channels at every step, not only at the end. That is what
// the offline script did when it produced the thirteen values now stored on the
// original badges, and matching it exactly means one rule rather than two that
// almost agree. Keeping floats would be a shade more accurate and would put a
// new badge on a slightly different footing from an old one.
export function edgeFor(rgb) {
  let out = rgb.map((c) => Math.round(c));
  for (let i = 0; i < 24 && contrastWithWhite(out) < 4.5; i++) {
    out = out.map((c) => Math.round(c * 0.92));
  }
  return toHex(out);
}

// --- Reading the file --------------------------------------------------------

export async function readArt(file) {
  if (!TYPES.includes(file.type)) {
    throw new Error('That needs to be a PNG, a JPEG or a WebP.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`That file is ${Math.round(file.size / 1024)}KB. `
      + `The limit is ${MAX_BYTES / 1024}KB, which is generous for a tile shown `
      + 'at about 110 pixels.');
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const rgb = dominantColour(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (!rgb) {
      throw new Error('No colour could be read from that image. It may be all '
        + 'greys, or all transparent.');
    }

    return {
      file,
      width: img.naturalWidth,
      height: img.naturalHeight,
      tile_color: toHex(rgb),
      tile_edge: edgeFor(rgb),
      previewUrl: URL.createObjectURL(file)
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- Storing it --------------------------------------------------------------

// Named by code and season, so the bucket is readable by a person and a badge
// cannot collide with the same code in a different year. The timestamp busts
// the CDN cache: replacing art under a path somebody has already loaded would
// otherwise keep showing the old picture.
export async function uploadArt(badge, art) {
  const ext = art.file.type === 'image/png' ? 'png'
    : art.file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${badge.season_year}/${badge.code}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, art.file, { contentType: art.file.type, upsert: false });
  if (error) throw error;

  return path;
}

// Replacing art leaves the old object behind otherwise. Nothing else in this
// project deletes, but an orphaned image is not history worth keeping, and a
// failure here is not worth failing the save over.
export async function removeArt(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('Old badge art could not be removed:', error.message);
}

// --- The field ---------------------------------------------------------------

// A file input, a live preview of the tile it will produce, and the two colours
// it worked out. The preview is the point: the colour comes from the picture,
// so the only way to know whether it looks right is to see it.
export function artField(badge, { label = 'Badge picture' } = {}) {
  const uid = Math.random().toString(36).slice(2, 8);
  const input = el('input', {
    id: `art-${uid}`, type: 'file',
    accept: 'image/png,image/jpeg,image/webp'
  });
  const note = el('p', { className: 'form-status', role: 'status' });

  const tile = el('span', { className: 'badge-tile has-backdrop' });
  const preview = el('span', { className: 'badge-slot is-earned art-preview' }, [
    tile,
    el('span', { className: 'badge-name', text: badge?.name || 'Preview' })
  ]);

  let chosen = null;

  function paint(src, fill, edge) {
    tile.replaceChildren(src
      ? el('img', { className: 'badge-art', src, alt: '' })
      : null);
    preview.style.setProperty('--tile', fill || 'var(--gold-line)');
    preview.style.setProperty('--tile-edge', edge || 'var(--gold)');
  }

  // An existing badge shows what it has now, so a professor can see what they
  // are about to replace.
  if (badge && (badge.image_path || badge.code)) {
    paint(badgeArtUrl(badge, '../'), badge.tile_color, badge.tile_edge);
  } else {
    paint(null, null, null);
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) { chosen = null; return; }
    try {
      status(note, 'Reading the colours.');
      chosen = await readArt(file);
      paint(chosen.previewUrl, chosen.tile_color, chosen.tile_edge);
      status(note, `${chosen.width} by ${chosen.height}. Tile ${chosen.tile_color}, `
        + `ring ${chosen.tile_edge}. Both taken from the picture.`, 'good');
    } catch (err) {
      chosen = null;
      input.value = '';
      status(note, err.message, 'error');
    }
  });

  return {
    nodes: [
      el('p', { className: 'field' }, [
        el('label', { for: input.id, text: label }), input
      ]),
      el('p', { className: 'field-help',
        text: 'PNG, JPEG or WebP, up to 512KB. A cut-out on a transparent '
            + 'background works best: the tile colour is read from the picture, '
            + 'and a white rectangle would make every badge white.' }),
      el('div', { className: 'art-preview-wrap' }, [
        el('span', { className: 'eyebrow', text: 'How the tile will look' }),
        preview
      ]),
      note
    ],
    // Null when nothing new was picked, which means leave the badge as it is.
    chosen: () => chosen
  };
}
