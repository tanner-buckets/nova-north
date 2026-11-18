// The rental shelf and the bounty list, on the league programs page.
//
// Reads only. A professor fills both from admin/rentals.html; this draws what
// is there.
//
// Two formats, always both shown, because an empty Standard list and a missing
// Standard list look identical on a page and mean different things: one says we
// have no Standard decks yet, the other leaves a reader wondering whether they
// scrolled past it.
import { supabase, el, problem, readableOn, deckListImageUrl } from './supabase-client.js';

const shelf = document.querySelector('#rental-shelf');
const bounties = document.querySelector('#rental-bounties');

const FORMATS = [
  ['standard', 'Standard decks'],
  ['glc', 'GLC decks']
];

// Status is a column rather than a tag, so it gets its own chip and its own
// wording. A player deciding whether to borrow one needs this before anything
// else on the row.
const STATUS = {
  current: { word: 'Current', className: 'tag tag-silver' },
  needs_updating: { word: 'Needs updating', className: 'tag tag-hidden' }
};

// A tag's colour comes from its row, so a professor can set one on a tag they
// invented. Null is the quiet grey pill, which is what most tags should be: a
// shelf where everything is coloured is a shelf where no colour means anything.
//
// The text colour is worked out rather than stored. See readableOn().
function tagPill(tag) {
  const label = typeof tag === 'string' ? tag : tag.label;
  const colour = typeof tag === 'string' ? null : tag.color;
  const ink = readableOn(colour);

  return ink
    ? el('span', { className: 'tag tag-colour', text: label,
                   style: `background:${colour};color:${ink}` })
    : el('span', { className: 'tag tag-soft', text: label });
}

// A deck list arrives one of three ways and the row says the same thing about
// all three: "See the deck list". A link goes out to the site holding it; the
// other two open in place, because the list is already here and sending
// somebody to a second page to read what the page already has is a tap for
// nothing.
//
// The database allows only one of the three to be set, so the order below
// decides nothing in practice -- it is here so a row that somehow held two
// would still draw one list rather than both.
function listBlock(deck) {
  if (deck.deck_list_url) {
    // A deck with no list recorded simply has no link. Printing a dead one
    // would be worse than printing none.
    return el('p', {}, [
      el('a', { href: deck.deck_list_url, target: '_blank', rel: 'noopener',
                text: 'See the deck list' })
    ]);
  }
  if (deck.deck_list_text) return pastedList(deck);

  const src = deckListImageUrl(deck);
  return src ? picturedList(deck, src) : null;
}

// Folded away, because a sixty-card list is forty lines and a shelf of six
// decks would be a page of them with the decks lost in between.
function disclosure(body) {
  return el('details', { className: 'deck-list' }, [
    el('summary', { text: 'See the deck list' }),
    el('div', { className: 'deck-list-body' }, body)
  ]);
}

// The copy button is the point of holding the list as text rather than as a
// picture: this is the format the game imports, and selecting forty lines on a
// phone to get at it is the thing that would send somebody back to a photo.
//
// A browser can simply refuse to write to the clipboard, so the button says so
// and points at selecting it by hand rather than appearing to do nothing.
function copyButton(text) {
  const note = el('span', { className: 'deck-list-copied', role: 'status' });
  const button = el('button', { type: 'button', className: 'link-button',
                                text: 'Copy the list' });

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = 'Copied.';
    } catch {
      note.textContent = 'This browser would not let the page copy it — '
        + 'select the list above and copy it yourself.';
    }
  });

  return el('p', { className: 'deck-list-actions' }, [button, note]);
}

function pastedList(deck) {
  return disclosure([
    el('pre', { className: 'deck-list-text', text: deck.deck_list_text }),
    copyButton(deck.deck_list_text)
  ]);
}

// The picture links to itself so a phone can open it full size and pinch it.
// A list photographed at arm's length is readable on paper and not in a column
// 320 pixels wide, which is the whole reason the screen keeps it at 2000px.
//
// The alt text names the deck and says what the picture is. It cannot carry
// the list, which is exactly why the professor screen asks for the text where
// there is a choice.
function picturedList(deck, src) {
  return disclosure([
    el('a', { href: src, target: '_blank', rel: 'noopener' }, [
      el('img', { className: 'deck-list-image', src,
                  alt: `A photograph of the deck list for ${deck.name}`,
                  loading: 'lazy', decoding: 'async' })
    ]),
    el('p', { className: 'rental-deck-note',
              text: 'Open the picture to read it full size.' })
  ]);
}

function deckRow(deck) {
  const status = STATUS[deck.status] || STATUS.current;
  const tags = Array.isArray(deck.tags) ? deck.tags : [];

  return el('li', { className: 'rental-deck' }, [
    el('p', { className: 'rental-deck-head' }, [
      el('span', { className: 'rental-deck-name', text: deck.name }),
      el('span', { className: status.className, text: status.word }),
      ...tags.map(tagPill)
    ]),
    deck.notes ? el('p', { className: 'rental-deck-note', text: deck.notes }) : null,
    listBlock(deck)
  ]);
}

// Each format folds away behind its own disclosure, and so does the bounty
// list. A shelf of six decks with their notes and their lists is most of a
// screen, and every bit of it sat between a reader and the rest of the programs
// page whether or not they had come to borrow a deck.
//
// THE COUNT IS PART OF THE SUMMARY, not decoration on it. Collapsing a section
// hides what is inside, so the line that stays visible has to answer the
// question somebody would have opened it to ask -- the same reason the tools
// menu puts a waiting count on the section and not only on the card within it.
//
// The native marker is kept rather than drawn, which is why the heading goes
// inline next to it instead of the summary becoming a flex row: a summary is a
// list-item by default, and laying it out any other way takes the triangle
// with it. A heading is allowed inside a summary, and keeps these two reachable
// by heading navigation now that they are no longer plain headings on the page.
function group(name, count, body) {
  return el('details', { className: 'rental-group' }, [
    el('summary', {}, [
      el('h4', { className: 'rental-group-name', text: name }),
      // A real space, not only the margin that draws the gap. These two are
      // adjacent inline boxes, so without it the summary's text -- which is
      // this control's accessible name -- runs together as "Standard decks3
      // decks" for anyone listening to the page rather than looking at it.
      ' ',
      el('span', { className: 'rental-group-count', text: count })
    ]),
    el('div', { className: 'rental-group-body' }, [body])
  ]);
}

function deckCount(n) {
  if (!n) return 'None yet';
  return n === 1 ? '1 deck' : `${n} decks`;
}

function formatBlock(label, decks) {
  return group(label, deckCount(decks.length),
    decks.length
      ? el('ul', { className: 'rental-list' }, decks.map(deckRow))
      : el('p', { className: 'muted-note',
          text: 'None on the shelf yet. If you have one to donate, see the '
              + 'bounty list below.' }));
}

async function loadShelf() {
  try {
    const { data, error } = await supabase.rpc('rental_deck_shelf');
    if (error) throw error;
    const decks = data || [];
    shelf.replaceChildren(...FORMATS.map(([key, label]) =>
      formatBlock(label, decks.filter((d) => d.format === key))));
  } catch (err) {
    console.error(err);
    shelf.replaceChildren(problem('The rental decks'));
  } finally {
    shelf.removeAttribute('aria-busy');
  }
}

async function loadBounties() {
  try {
    const { data, error } = await supabase
      .from('rental_deck_bounties')
      .select('name, format, note, claimed_note')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;

    const rows = data || [];
    if (!rows.length) {
      bounties.replaceChildren(el('p', { className: 'muted-note',
        text: 'Nothing on the bounty list right now. Ask a professor what would '
            + 'be useful — the answer is rarely nothing.' }));
      return;
    }

    // Folded like the two format lists above it. There is no disclosure on the
    // empty case: a fold exists to put length away, and one sentence has no
    // length to put anywhere. The shelf's two formats always draw a disclosure
    // each even when empty, because there the pair is the point -- a missing
    // Standard list and an empty one look identical and mean different things.
    bounties.replaceChildren(group(
      'The bounty list',
      rows.length === 1 ? '1 deck wanted' : `${rows.length} decks wanted`,
      el('ul', { className: 'rental-list' }, rows.map((b) => el('li', {
        className: 'rental-deck'
      }, [
        el('p', { className: 'rental-deck-head' }, [
          el('span', { className: 'rental-deck-name', text: b.name }),
          el('span', { className: 'tag tag-soft',
                       text: b.format === 'glc' ? 'GLC' : 'Standard' }),
          // The duplicate guard, and the reason it is on the public page
          // rather than in a professor's notes: somebody about to buy cards
          // needs to see it before they do.
          b.claimed_note
            ? el('span', { className: 'tag tag-hidden', text: 'Someone is on it' })
            : null
        ]),
        b.note ? el('p', { className: 'rental-deck-note', text: b.note }) : null,
        b.claimed_note
          ? el('p', { className: 'rental-deck-note', text: b.claimed_note })
          : null
      ])))
    ));
  } catch (err) {
    console.error(err);
    bounties.replaceChildren(problem('The bounty list'));
  } finally {
    bounties.removeAttribute('aria-busy');
  }
}

loadShelf();
loadBounties();
