import { supabase, el, problem } from './supabase-client.js';

function fill(selector, build) {
  const host = document.querySelector(selector);
  if (!host) return Promise.resolve();
  return Promise.resolve()
    .then(build)
    .then((nodes) => { host.replaceChildren(...[].concat(nodes).filter(Boolean)); })
    .catch((err) => {
      console.error(err);
      host.replaceChildren(problem(host.dataset.contentName || 'This section'));
    })
    .finally(() => host.removeAttribute('aria-busy'));
}

function table(headings, rows) {
  return el('div', { className: 'table-wrap' }, [
    el('table', { className: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, headings.map((h) => el('th', { scope: 'col', text: h })))
      ]),
      el('tbody', {}, rows)
    ])
  ]);
}

// --- Trainer Card Program ----------------------------------------------------

fill('#ranks', async () => {
  const { data, error } = await supabase
    .from('trainer_card_ranks').select('*').order('sort_order');
  if (error) throw error;

  return table(['Rank', 'How to reach it', 'Reward', 'What it unlocks'],
    data.map((r) => el('tr', {}, [
      el('th', { scope: 'row', className: 'rank-name', text: r.name }),
      el('td', { text: r.qualification }),
      el('td', { text: r.reward || '—' }),
      el('td', { text: r.benefit || '—' })
    ])));
});

fill('#badges', async () => {
  const { data, error } = await supabase
    .from('badges').select('*').eq('is_active', true).order('sort_order');
  if (error) throw error;

  return [
    el('p', { text: `There are ${data.length} badges. You need 8 to be eligible to `
      + 'challenge the Elite 4 and go for League Champion.' }),
    table(['Badge', 'How to earn it'],
      data.map((b) => el('tr', {}, [
        el('th', { scope: 'row', className: 'badge-name', text: b.name }),
        el('td', { text: b.task })
      ])))
  ];
});

// --- Prize wall --------------------------------------------------------------

fill('#earning-actions', async () => {
  const { data, error } = await supabase
    .from('earning_actions').select('*').eq('is_active', true).order('sort_order');
  if (error) throw error;

  return table(['How to earn', 'Points'],
    data.map((a) => {
      // Zero is how the data marks professor discretion, so the page shows a
      // question mark rather than a number someone might read as an award.
      const discretionary = a.default_points === 0;
      return el('tr', {}, [
        el('th', { scope: 'row' }, [
          el('span', { text: a.label }),
          a.eligibility_note ? el('span', { className: 'eligibility', text: a.eligibility_note }) : null,
          a.notes ? el('span', { className: 'row-note', text: a.notes }) : null
        ]),
        el('td', { className: 'points-cell count', text: discretionary ? '?' : a.default_points })
      ]);
    }));
});

// --- Loyalty -----------------------------------------------------------------

fill('#loyalty-tiers', async () => {
  const today = new Date().toISOString().slice(0, 10);

  const { data: releases, error: releaseError } = await supabase
    .from('releases').select('*')
    .lte('starts_on', today).gte('ends_on', today)
    .order('starts_on', { ascending: false }).limit(1);
  if (releaseError) throw releaseError;

  if (!releases.length) {
    return el('p', {
      className: 'notice notice-quiet',
      text: 'No attendance window is open right now. Ask a professor which release is being counted next.'
    });
  }

  const release = releases[0];
  const { data: tiers, error: tierError } = await supabase
    .from('loyalty_tiers').select('*').eq('release_id', release.id).order('weeks_required');
  if (tierError) throw tierError;

  const window = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC'
  });
  const asUtc = (d) => window.format(new Date(d + 'T12:00:00Z'));

  return [
    el('p', { className: 'release-window' }, [
      el('strong', { text: release.name }),
      el('span', { text: ` — counting Sundays from ${asUtc(release.starts_on)} `
        + `to ${asUtc(release.ends_on)}.` })
    ]),
    tiers.length
      ? table(['Sundays attended', 'You may buy, at MSRP'],
          tiers.slice().reverse().map((t) => el('tr', {}, [
            el('th', { scope: 'row', className: 'count', text: t.weeks_required }),
            el('td', {}, [
              el('span', { className: 'tier-name', text: t.tier_name }),
              el('span', { text: ' — ' + t.product })
            ])
          ])))
      : el('p', { className: 'notice notice-quiet',
                  text: 'Thresholds for this release have not been set yet.' })
  ];
});
