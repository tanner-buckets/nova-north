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
  const [{ data, error }, { data: ranks, error: rankError },
         { data: seasons, error: seasonError }] = await Promise.all([
    // Secret badges are absent entirely: not listed, and not counted. A player
    // finds one rather than working towards it, which only holds if nothing on
    // this page hints that it is there.
    supabase.from('badges').select('*')
      .eq('is_active', true).eq('is_secret', false)
      .order('season_year', { ascending: false }).order('sort_order'),
    supabase.from('trainer_card_ranks').select('badges_required'),
    supabase.rpc('active_badge_seasons')
  ]);
  if (error || rankError || seasonError) throw error || rankError || seasonError;

  // Read the threshold rather than repeating it. The highest badge-earned rank
  // is the one that unlocks an Elite 4 challenge, so if that number is ever
  // changed in the table, this sentence follows it instead of contradicting it.
  const needed = Math.max(0, ...ranks.map((r) => r.badges_required || 0));

  // A season being retired is what takes its badges off this page, so more than
  // one list can be live during a changeover.
  const active = new Set((seasons || []).map(Number));
  const live = data.filter((b) => active.has(b.season_year));
  const years = [...new Set(live.map((b) => b.season_year))].sort((a, b) => b - a);

  if (!years.length) {
    return [el('p', { text: 'No badge list is running at the moment.' })];
  }

  const rows = (year) => table(['Badge', 'How to earn it'],
    live.filter((b) => b.season_year === year).map((b) => el('tr', {}, [
      el('th', { scope: 'row', className: 'badge-name', text: b.name }),
      el('td', { text: b.task })
    ])));

  // One season is the ordinary case and gets no heading, because a heading
  // saying "2026" above the only list tells a player nothing.
  if (years.length === 1) {
    const count = live.length;
    return [
      el('p', { text: needed
        ? `There are ${count} badges. You need ${needed} to be eligible to `
          + 'challenge the Elite 4 and go for League Champion.'
        : `There are ${count} badges to earn.` }),
      rows(years[0])
    ];
  }

  // Nothing here says which list is ending. A season runs until a professor
  // retires it, and there is no date to promise.
  return [
    el('p', { text: `${years.length} badge sets are running while the season `
      + 'changes over, and you can earn badges from any of them. '
      + (needed ? `You need ${needed} from one set to be eligible to challenge `
                + 'the Elite 4 and go for League Champion.' : '') }),
    ...years.flatMap((year) => [
      el('h3', { text: `Season ${year}` }),
      rows(year)
    ])
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
