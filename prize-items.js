import { supabase, el, problem } from './supabase-client.js';

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
    host.replaceChildren(el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Item' }),
          el('th', { scope: 'col', className: 'points-cell', text: 'Points' })
        ])]),
        el('tbody', {}, data.map((item) => el('tr', {}, [
          el('th', { scope: 'row' }, [
            el('span', { text: item.label }),
            item.notes ? el('span', { className: 'row-note', text: item.notes }) : null
          ]),
          el('td', { className: 'points-cell count', text: item.default_cost })
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
