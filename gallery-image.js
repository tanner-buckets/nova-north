// Turning whatever came out of somebody's phone into two JPEGs we can store.
//
// Three things happen here, and only one of them is about file size.
//
//  1. **The data is stripped.** A photograph straight off a phone carries EXIF:
//     the time it was taken, the camera, and very often the GPS coordinates of
//     the room. Publishing that alongside a picture of a child is worse than
//     publishing the picture. Drawing to a canvas and re-encoding keeps the
//     pixels and nothing else, so the stripping is not a step that can be
//     forgotten -- it is a consequence of resizing at all.
//  2. **Two renditions.** A grid of thumbnails on store wifi should not be
//     twenty full-size pictures. 480px for the grid, 1600px for the one
//     somebody opened.
//  3. **A guard on the decoded size, not the file size.** A JPEG is compressed,
//     so bytes say almost nothing about what it costs to open: a 200KB file can
//     decode to 8000 by 8000 and ask for half a gigabyte before a single pixel
//     is drawn. The check that matters is on naturalWidth times naturalHeight,
//     after decode() and before any canvas is made.

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAX_BYTES = 20 * 1024 * 1024;   // a phone photograph, generously
const MAX_PIXELS = 24e6;              // about twice a current phone camera
const MAX_SIDE = 10000;

const FULL_EDGE = 1600;
const THUMB_EDGE = 480;
const FULL_QUALITY = 0.82;
const THUMB_QUALITY = 0.72;

// The longest edge goes to `edge`, and nothing is ever enlarged: a small
// picture stays small rather than being blown up into a soft one.
function fit(width, height, edge) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(
        'That picture could not be converted. Try saving it as a JPEG first.'))),
      'image/jpeg',
      quality
    );
  });
}

function render(img, edge, quality) {
  const size = fit(img.naturalWidth, img.naturalHeight, edge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  // A photograph has no transparency, and a JPEG cannot hold any. Without this
  // a PNG with transparent corners turns them black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size.width, size.height);

  return toJpeg(canvas, quality).then((blob) => ({ blob, ...size }));
}

// Everything the submission form needs from a chosen file: the two blobs to
// upload, the size to record, and a preview URL to show. The caller must call
// release() when it is finished with the preview, or the decoded picture stays
// in memory for the life of the page.
export async function prepare(file) {
  if (!TYPES.includes(file.type)) {
    throw new Error('That needs to be a JPEG, a PNG or a WebP. '
      + 'A photo straight from a phone is usually a JPEG, and sharing it to '
      + 'yourself first will convert one that is not.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`That file is ${Math.round(file.size / 1024 / 1024)}MB, and `
      + `the limit is ${MAX_BYTES / 1024 / 1024}MB.`);
  }

  const url = URL.createObjectURL(file);
  let img;
  try {
    img = new Image();
    img.src = url;
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('That picture could not be opened. It may be damaged, or '
      + 'in a format this browser cannot read.');
  }

  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // Before any canvas exists. Past this point the picture is drawn, and a
    // picture this large would be drawn into however much memory it takes.
    if (!w || !h || w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) {
      throw new Error(`That picture is ${w} by ${h}, which is larger than this `
        + 'page can open. Scale it down and try again.');
    }

    const full = await render(img, FULL_EDGE, FULL_QUALITY);
    const thumb = await render(img, THUMB_EDGE, THUMB_QUALITY);

    return {
      full: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      previewUrl: URL.createObjectURL(thumb.blob),
      release() { URL.revokeObjectURL(this.previewUrl); }
    };
  } finally {
    // The decoded picture is the expensive thing here, and it is held by this
    // URL. Letting it go as soon as both renditions exist is the difference
    // between one photograph in memory and every photograph somebody tried.
    URL.revokeObjectURL(url);
    img.src = '';
  }
}

export const ACCEPT = TYPES.join(',');
