// The rental shelf and the bounty list, on the league programs page.
//
// Reads only. A professor fills both from admin/rentals.html; this draws what
// is there.
//
// Two formats, always both shown, because an empty Standard list and a missing
// Standard list look identical on a page and mean different things: one says we
// have no Standard decks yet, the other leaves a reader wondering whether they
// scrolled past it.
import { supabase, el, problem } from './supabase-client.js';

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
  current: { word: 'Current', className: 'tag tag-good' },
  needs_updating: { word: 'Needs updating', className: 'tag tag-hidden' }
};

function deckRow(deck) {
  const status = STATUS[deck.status] || STATUS.current;
  const tags = Array.isArray(deck.tags) ? deck.tags : [];

  return el('li', { className: 'rental-deck' }, [
    el('p', { className: 'rental-deck-head' }, [
      el('span', { className: 'rental-deck-name', text: deck.name }),
      el('span', { className: status.className, text: status.word }),
      ...tags.map((t) => el('span', { className: 'tag tag-soft', text: t }))
    ]),
    deck.notes ? el('p', { className: 'rental-deck-note', text: deck.notes }) : null,
    // A deck with no list recorded simply has no link. Printing a dead one
    // would be worse than printing none.
    deck.deck_list_url
      ? el('p', {}, [
          el('a', { href: deck.deck_list_url, target: '_blank', rel: 'noopener',
                    text: 'See the deck list' })
        ])
      : null
  ]);
}

function formatBlock(label, decks) {
  return el('section', { className: 'rental-format' }, [
    el('h4', { text: label }),
    decks.length
      ? el('ul', { className: 'rental-list' }, decks.map(deckRow))
      : el('p', { className: 'muted-note',
          text: 'None on the shelf yet. If you have one to donate, see the '
              + 'bounty list below.' })
  ]);
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

    bounties.replaceChildren(
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
    );
  } catch (err) {
    console.error(err);
    bounties.replaceChildren(problem('The bounty list'));
  } finally {
    bounties.removeAttribute('aria-busy');
  }
}

loadShelf();
loadBounties();
