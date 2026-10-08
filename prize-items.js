import { supabase, el, problem, prizeArtUrl } from './supabase-client.js';

const host = document.querySelector('#item-list');

try {
  const { data, error } = await supabase
    .from('prize_items').select('*').eq('is_active', true).order('sort_order');
  if (error) throw error;

  if (!data.length) {
    host.replaceChildren(el('p', {
      className: 'notice notice-quiet',
      text: 'The prize wall has no items listed yet. Ask a professor what is available.'
    }));
  } else {
    // A long list of label-and-number rows reads as a price table, not as
    // dozens of cards.
    // The picture goes at the end of the row, after the name and the cost,
    // because those are what somebody reads down the list for. It is the same
    // placement the programs page gives a badge, and for the same reason.
    //
    // The column only exists once something has a picture. A column of empty
    // cells on a wall nobody has photographed yet is a column of nothing.
    const anyArt = data.some((item) => item.image_path);

    host.replaceChildren(el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Item' }),
          el('th', { scope: 'col', className: 'points-cell', text: 'Points' }),
          anyArt ? el('th', { scope: 'col', className: 'prize-cell' }, [
            // The pictures are beside their own names, so a heading over them
            // would be read out before every one of them to no purpose.
            el('span', { className: 'hidden-label', text: 'Picture' })
          ]) : null
        ])]),
        el('tbody', {}, data.map((item) => el('tr', {}, [
          el('th', { scope: 'row' }, [
            el('span', { text: item.label }),
            item.notes ? el('span', { className: 'row-note', text: item.notes }) : null
          ]),
          el('td', { className: 'points-cell count', text: item.default_cost }),
          anyArt ? el('td', { className: 'prize-cell' }, [
            item.image_path
              ? el('img', {
                  className: 'prize-art',
                  src: prizeArtUrl(item),
                  // The name is the first cell of the same row, so a screen
                  // reader has already read it. Repeating it here reads twice.
                  alt: '',
                  loading: 'lazy', decoding: 'async'
                })
              : null
          ]) : null
        ])))
      ])
    ]));
  }
} catch (err) {
  console.error(err);
  host.replaceChildren(problem('The prize wall items'));
} finally {
  host.removeAttribute('aria-busy');
}
