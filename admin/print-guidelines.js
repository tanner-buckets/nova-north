// How to print, for the two screens that put something on paper.
//
// One copy, shared, for the same reason image-file.js and trainer-card-art.js
// are: this is a list of settings that will change as browsers change, and two
// copies would mean one of them quietly becoming wrong.
//
// Everything here is downstream of the page. The sheets are laid out at real
// measurements on a Letter page with no margin, and nothing in a browser
// reports back what the printer actually did -- so when a print comes out
// wrong, the thing to change is almost never the site.
import { el } from '../supabase-client.js';

// The dialog settings, in the order they appear in Chrome's print panel, which
// is the order somebody will find them in.
const SETTINGS = [
  ['Destination', 'The printer, or Save as PDF.'],
  ['Pages', 'All.'],
  ['Layout', 'Portrait.'],
  ['Paper size', 'Letter. A4 is 17pt narrower, so a Letter sheet has to shrink '
    + 'to about 97% to fit on it.'],
  ['Scale', '100%, or Default. Not "Fit to printable area" — that shrinks the '
    + 'page to clear the margin the printer physically cannot print into, '
    + 'usually to somewhere between 94% and 97%.'],
  ['Margins', 'None. The sheets carry their own margins at the right size, and '
    + 'a margin set here is added on top of them.'],
  ['Headers and footers', 'Off. They reserve space, which forces a shrink.'],
  ['Background graphics', 'On. Without it the card artwork and the badge '
    + 'colours do not print and the boxes come out empty.']
];

// The ones that are not in the browser at all, which is why they are the hard
// ones to find.
const ELSEWHERE = [
  ['The printer driver', 'Printers have their own "Fit to page" or "Shrink '
    + 'oversized pages" setting in the system print queue, and it overrides '
    + 'everything the browser asked for. Worth checking if the dialog is right '
    + 'and the paper is still wrong.'],
  ['Printing a saved PDF', 'Acrobat and Preview both default to "Fit" or '
    + '"Shrink to fit". The PDF can measure perfectly and the paper still come '
    + 'out small. Set the PDF reader to Actual size.'],
  ['A different browser', 'Chrome follows these sheets most closely. Safari '
    + 'and Firefox honour the page size and the zero margin less completely, '
    + 'so the same sheet can print differently from each.'],
  ['Browser zoom', 'Back to 100% before printing. A zoomed page can carry that '
    + 'zoom into the print.']
];


function list(pairs) {
  return el('dl', { className: 'print-guide' },
    pairs.flatMap(([term, detail]) => [
      el('dt', { text: term }),
      el('dd', { text: detail })
    ]));
}

// `exact` is for the Trainer Card Creator, where the measurements are the whole
// point -- a card at 94% is a card that does not fit the sleeve it was cut for.
// On a handout a slight shrink costs nothing, so that page is not told to go
// and measure anything.
export function printGuidelines({ exact = false } = {}) {
  return el('details', { className: 'disclosure print-guide-block' }, [
    el('summary', { text: 'How to print this' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: exact
          ? 'A card is a real measurement on paper, so anything that scales the '
            + 'page makes every card the wrong size. These are the settings '
            + 'that stop that happening.'
          : 'This sheet is laid out to fill one Letter page. These settings keep '
            + 'it on one.' }),

      el('h4', { text: 'In the print dialog' }),
      list(SETTINGS),

      el('h4', { text: 'If it is still wrong' }),
      el('p', { className: 'field-help',
        text: 'These are outside the browser, which is what makes them hard to '
            + 'find.' }),
      list(ELSEWHERE),

      exact
        ? el('p', { className: 'field-help',
            text: 'Print a test sheet above and hold a bank card against the '
                + 'rectangle. If it matches, the settings are right and the '
                + 'cards will be too. If it does not, change one thing at a '
                + 'time — and if every setting is right and it is still small, '
                + 'the printer is shrinking the page on its own, which the '
                + 'correction above makes up for.' })
        : null
    ])
  ]);
}
