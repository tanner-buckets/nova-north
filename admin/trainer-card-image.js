// One Trainer Card as a PNG, at the size it prints.
//
// THE CARD IS NOT REDRAWN HERE. It is the same DOM `card()` builds for the
// sheet, serialised into an SVG foreignObject and rasterised -- so a change to
// the artwork, a measurement or a field lands on the picture and the paper at
// once. A second renderer was the obvious way to do this and the wrong one:
// the measurements live in one place precisely because a card that drifts from
// the real card teaches somebody what the card does not look like, and an
// image is the copy that ends up in a Discord post and outlives the mistake.
//
// What that costs is a few rules about what a foreignObject can be handed:
//
//   * It fetches NOTHING. An SVG loaded through an <img> has no network of its
//     own, so the background artwork and every badge silhouette have to arrive
//     as data URIs or they are silently absent.
//   * Its content is XHTML, so anything in another namespace must say so. The
//     Champion star is an inline <svg> and went missing until it carried its
//     own xmlns -- see the note in trainer-card-art.js.
//   * The stylesheet has to travel with it, and a url() in a rule resolves
//     against the STYLESHEET rather than the page, which is why each rule is
//     inlined against its own sheet's href rather than against document.
//
// CSS masks do survive, which is the thing this turns on: the badges are
// artwork used as a mask and filled with the stored colour, and a rasteriser
// that dropped them would make a card with no badges on it.
import { card, badgeArtHref, CARD_W, CARD_H } from './trainer-card-art.js';
import { crc32 } from './crc32.js';

// 300 is what a card is worth: at 72pt to the inch a card is 1050 by 661
// pixels, which prints as a card rather than as a screenshot of one. The
// number is stamped into the file as well as used to size it -- see below.
export const CARD_DPI = 300;

const PT_PER_INCH = 72;
const CSS_PX_PER_INCH = 96;

// The SVG is laid out in CSS pixels, because that is the unit a foreignObject
// lays out in, and then drawn into a canvas of however many real pixels the
// chosen resolution asks for.
const BOX_W = CARD_W / PT_PER_INCH * CSS_PX_PER_INCH;
const BOX_H = CARD_H / PT_PER_INCH * CSS_PX_PER_INCH;

export function cardPixels(dpi = CARD_DPI) {
  return {
    width: Math.round(CARD_W / PT_PER_INCH * dpi),
    height: Math.round(CARD_H / PT_PER_INCH * dpi)
  };
}

// --- Getting the page's own styles and artwork into the picture --------------

const uriCache = new Map();

async function dataUri(url) {
  if (uriCache.has(url)) return uriCache.get(url);
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`${url} could not be read`));
      reader.readAsDataURL(blob);
    });
  })();
  uriCache.set(url, pending);
  return pending;
}

// Every rule that styles a card, read from the live stylesheet rather than
// copied into this file. A second copy of the card's CSS is the same mistake
// as a second copy of its measurements, and it would go stale the same way.
function cardRules() {
  const found = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet refuses to be read. Nothing styling a card comes
      // from one, so there is nothing to recover and nothing to warn about.
      continue;
    }
    for (const rule of rules) {
      const selector = rule.selectorText;
      if (!selector) continue;          // @media and friends: screen-only dress
      if (selector.includes('tcard') || selector === ':root') {
        found.push({ text: rule.cssText, base: sheet.href || document.baseURI });
      }
    }
  }
  return found;
}

const URL_PATTERN = /url\((["']?)([^"')]+)\1\)/g;

async function inlineUrls({ text, base }) {
  const wanted = new Set();
  for (const match of text.matchAll(URL_PATTERN)) {
    if (!match[2].startsWith('data:')) wanted.add(match[2]);
  }
  let out = text;
  for (const raw of wanted) {
    const uri = await dataUri(new URL(raw, base).href);
    out = out.split(raw).join(uri);
  }
  return out;
}

let cssPromise = null;

function cardCss() {
  if (!cssPromise) {
    cssPromise = Promise.all(cardRules().map(inlineUrls))
      .then((parts) => parts.join('\n'))
      .catch((err) => { cssPromise = null; throw err; });
  }
  return cssPromise;
}

// --- Stamping the physical size onto the file --------------------------------
//
// A PNG with no pHYs chunk has no size, only a pixel count, and a word
// processor dropping one in assumes 96dpi -- so a 1050 pixel card arrives
// eleven inches wide. The chunk is what makes "the same dimensions as the
// printed card" true when somebody puts the file in a document rather than
// a promise about how it was rendered.
const METRES_PER_INCH = 0.0254;

function pngChunk(type, data) {
  const name = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(name, 4);
  chunk.set(data, 8);
  const covered = new Uint8Array(4 + data.length);
  covered.set(name, 0);
  covered.set(data, 4);
  view.setUint32(8 + data.length, crc32(covered));
  return chunk;
}

function physChunk(dpi) {
  const perMetre = Math.round(dpi / METRES_PER_INCH);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, perMetre);
  view.setUint32(4, perMetre);
  data[8] = 1;                       // unit: the metre
  return pngChunk('pHYs', data);
}

// pHYs has to come before the first IDAT. IHDR is always the first chunk and
// always 13 bytes of data, so straight after it is both the simplest place and
// a legal one.
const SIGNATURE_AND_IHDR = 8 + 4 + 4 + 13 + 4;

function withPhysicalSize(buffer, dpi) {
  const png = new Uint8Array(buffer);
  const header = String.fromCharCode(...png.subarray(12, 16));
  if (header !== 'IHDR') return png;   // not a shape we know; leave it alone
  const chunk = physChunk(dpi);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, SIGNATURE_AND_IHDR), 0);
  out.set(chunk, SIGNATURE_AND_IHDR);
  out.set(png.subarray(SIGNATURE_AND_IHDR), SIGNATURE_AND_IHDR + chunk.length);
  return out;
}

// --- Drawing one ------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the card could not be rasterised'));
    img.src = src;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('the card could not be encoded'));
    }, 'image/png');
  });
}

export async function cardImage(row, { isChampion = false, dpi = CARD_DPI } = {}) {
  const css = await cardCss();
  const node = card(row, { isChampion });

  // The badge silhouettes are referenced from inline style properties rather
  // than from the stylesheet, so they are inlined on the serialised markup.
  let html = node.outerHTML;
  for (const badge of row.badges || []) {
    const href = badgeArtHref(badge);
    html = html.split(href).join(await dataUri(href));
  }

  // The CDATA wrapper is written as a CSS comment, so it is a comment to a CSS
  // parser and a text section to an XML one. Without it a stylesheet holding a
  // stray & or < would end the document early.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX_W}" `
    + `height="${BOX_H}" viewBox="0 0 ${BOX_W} ${BOX_H}">`
    + '<foreignObject x="0" y="0" width="100%" height="100%">'
    + '<div xmlns="http://www.w3.org/1999/xhtml">'
    + `<style>/*<![CDATA[*/${css}/*]]>*/</style>${html}`
    + '</div></foreignObject></svg>';

  const image = await loadImage(
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));

  const { width, height } = cardPixels(dpi);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  // A card is cut from a white sheet, so what is behind the artwork is white
  // rather than the transparency a canvas starts with.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasBlob(canvas);
  const stamped = withPhysicalSize(await blob.arrayBuffer(), dpi);
  return new Blob([stamped], { type: 'image/png' });
}

// Player ID first, because that is the thing that does not change spelling and
// the thing a professor sorts a folder by.
export function cardFileName(row, season) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return [row.player_id, name, season].filter(Boolean).join('-') + '.png';
}
