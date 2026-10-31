// Drawing one Trainer Card.
//
// Pulled out of trainer-cards.js so the printable information sheet can show a
// specimen card without importing that whole screen -- it runs start() on load,
// so importing it would mount the Creator. One copy for the same reason
// image-file.js is shared with the prize wall rather than copied for it: a
// specimen that drifts from the real card is worse than no specimen, because it
// teaches somebody what the card does not look like.
//
// The measurements come from the supplied template, not from taste. Changing
// the artwork means re-measuring it, not nudging these until it looks right.
import { el, badgeArtUrl } from '../supabase-client.js';

// The circle the badges ride, measured off the artwork rather than guessed:
// fitting its left edge gives centre (815.8, 225.6) and radius 350.5 on the
// 1013 by 638 template, to within half a pixel. Converted to the printed card
// at 251.97 by 158.70pt, that is:
export const CARD_W = 251.97;
export const CARD_H = 158.7;
const RING = { cx: 202.92, cy: 56.12, r: 87.19 };   // points

const BADGE_MAX = 8;        // the size they were approved at
const PITCH_MAX = 10;       // the gap between two when there is room to spare

// A quiet edge all the way round. Nothing is printed inside it. Cards are cut
// by hand from a sheet of eight, so the last millimetre of any one of them is
// the least reliable part of the card -- the first badge used to sit 6pt from
// the top, inside the margin of error of a guillotine.
//
// 6% of the card height, which is the same inset the heading block already uses
// at the top left. Matching it rather than picking a second number means the
// badge run and the two text lines start level with each other.
const EDGE = CARD_H * 0.06;        // 9.52pt

// The run is bounded at both ends by something a badge must not touch: the top
// edge of the card, and the top of the name box at 58.78%. Everything inside
// the circle below that line is also inside the name box, so the arc stops
// there rather than carrying on round.
const NAME_TOP = CARD_H * 0.5878;

// The URL is made absolute first, and that is not fussiness. A url() inside a
// CSS custom property is resolved against the STYLESHEET that uses it, not the
// page -- styles.css lives at the root, so a path written "../images/..." for
// an admin page resolved one level above the site and quietly 404ed, leaving
// every silhouette blank with nothing in the console to say why.
export function badgeArtHref(badge) {
  return new URL(badgeArtUrl(badge, '../'), document.baseURI).href;
}

export function arcPlacement(count) {
  const inset = BADGE_MAX / 2 + 2;         // keep the shape off the outline
  const radius = RING.r - inset;

  const topY = EDGE + BADGE_MAX / 2;
  const bottomY = NAME_TOP - BADGE_MAX / 2 - 2;

  // Angles on the left half of the circle. 180 degrees is level with the
  // centre, and the angle falls as y grows, so stepping down the card is
  // stepping the angle down too.
  const at = (y) => Math.PI - Math.asin(
    Math.max(-1, Math.min(1, (y - RING.cy) / radius)));

  const start = at(topY);
  const span = start - at(bottomY);

  if (count <= 1) return { radius, start, step: 0, size: BADGE_MAX };

  // Spread at the comfortable pitch until they would run past the name box,
  // then compress to fit and shrink just enough that they still do not touch.
  // Thirteen is the case that forces this: the usable arc is about 86pt long
  // and thirteen at full size want 104.
  const step = Math.min(PITCH_MAX / radius, span / (count - 1));
  const size = Math.min(BADGE_MAX, step * radius * 0.85);

  return { radius, start, step, size };
}

function badgeDot(badge, index, place) {
  const angle = place.start - place.step * index;
  const x = RING.cx + place.radius * Math.cos(angle);
  const y = RING.cy + place.radius * Math.sin(angle);

  return el('li', {
    className: 'tcard-badge',
    title: badge.name || '',
    style: `--art: url("${badgeArtHref(badge)}"); `
         + `--fill: ${badge.tile_color || '#c9a227'}; `
         + `--x: ${(x / CARD_W * 100).toFixed(3)}%; `
         + `--y: ${(y / CARD_H * 100).toFixed(3)}%; `
         + `--size: ${place.size.toFixed(2)}pt`
  });
}

// A Champion's star, on the white directly below the gold band and in from the
// right edge. Drawn rather than typed: a star glyph is whatever shape the
// reading font happens to have, and there are no web fonts here. The gold is
// #d1a213, sampled from the band itself, so it is the card's own gold and not
// an approximation of it -- and it moves when the artwork does, as it did when
// the band went from #b99d2c to this.
const STAR_POINTS = '50.00,0.00 61.23,34.55 97.55,34.55 68.17,55.90 79.39,90.45 '
  + '50.00,69.10 20.61,90.45 31.83,55.90 2.45,34.55 38.77,34.55';

export function championStar() {
  return el('div', {
    className: 'tcard-star',
    html: '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
        + `<polygon points="${STAR_POINTS}" fill="#d1a213"/></svg>`
  });
}

export function badgeRing(badges) {
  if (!badges.length) return null;
  const place = arcPlacement(badges.length);
  return el('ul', { className: 'tcard-badges' },
    badges.map((b, i) => badgeDot(b, i, place)));
}

// Ranks are stored as "League Ace Trainer", and the line above the rank says
// "League", so the two read down the card as the stored name split across two
// lines. Printing the stored name whole would repeat the word.
export function shortRank(name) {
  return (name || '').replace(/^League\s+/, '');
}

// The name box holds about 24 characters at the ordinary size. Rather than
// clip a surname, step the type down -- twice, then let it clip, because by
// then the name is longer than anything a person is actually called.
function nameClass(name) {
  if (name.length > 30) return 'tcard-field tcard-name is-very-long';
  if (name.length > 24) return 'tcard-field tcard-name is-long';
  return 'tcard-field tcard-name';
}

// One card. `row` carries first_name, last_name, player_id, birth_year,
// rank_name and badges; `isChampion` decides the star, and is passed in rather
// than worked out here because which rank names earn one is a column on
// trainer_card_ranks and belongs to whoever loaded them.
export function card(row, { isChampion = false } = {}) {
  const badges = Array.isArray(row.badges) ? row.badges : [];
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();

  return el('div', { className: 'tcard' }, [
    el('div', { className: 'tcard-head' }, [
      el('p', { className: 'tcard-league', text: 'League' }),
      el('p', { className: 'tcard-rank', text: shortRank(row.rank_name) })
    ]),
    badgeRing(badges),
    isChampion ? championStar() : null,
    // The three values sit in the boxes already drawn on the artwork, so these
    // are placed against the template rather than laid out in a flow.
    el('span', { className: nameClass(name), text: name }),
    el('span', { className: 'tcard-field tcard-pid', text: row.player_id }),
    el('span', { className: 'tcard-field tcard-birth',
                 text: row.birth_year == null ? '' : String(row.birth_year) })
  ]);
}
