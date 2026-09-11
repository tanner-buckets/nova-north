// Northern Virginia North Pokemon League — shared logic for every page.
//
// Phase 1 content is static JSON in data/. Each file holds arrays named after the
// tables in docs/SCHEMA.md, and each row uses the same column names as that table.
// At phase 2, read() is the only function that changes: it starts asking Supabase
// for rows instead of reading a file. The render functions below keep working
// because the row shape does not change.

const SOURCES = {
  events: 'data/events.json',
  event_capacities: 'data/events.json',
  prize_items: 'data/prizes.json',
  earning_actions: 'data/earning-actions.json',
  league: 'data/league.json',
  releases: 'data/league.json',
  loyalty_tiers: 'data/league.json',
  labels: 'data/league.json',
  pages: 'data/league.json'
};

const files = new Map();

function loadFile(path) {
  if (!files.has(path)) {
    files.set(
      path,
      // no-cache still uses the browser cache, but always asks the server whether
      // the file changed. Without it a professor edits the JSON and players keep
      // seeing the old content until their cache expires.
      fetch(path, { cache: 'no-cache' }).then((response) => {
        if (!response.ok) {
          throw new Error(`${path} returned status ${response.status}`);
        }
        return response.json();
      })
    );
  }
  return files.get(path);
}

async function read(key) {
  const path = SOURCES[key];
  if (!path) {
    throw new Error(`No data source is registered for "${key}"`);
  }
  const file = await loadFile(path);
  if (!(key in file)) {
    throw new Error(`${path} does not contain "${key}"`);
  }
  return file[key];
}

async function getRows(table) {
  const rows = await read(table);
  if (!Array.isArray(rows)) {
    throw new Error(`"${table}" must be a list of rows`);
  }
  return rows;
}

// Retired rows stay in the data so that history keeps pointing at them. They are
// never shown. filter() copies the array first, so sort() does not touch the cache.
function catalogue(rows) {
  return rows
    .filter((row) => row.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// --- DOM helpers ------------------------------------------------------------

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, ...attributes } = options;
  if (className) {
    node.className = className;
  }
  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) {
      node.setAttribute(name, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child) {
      node.append(child);
    }
  }
  return node;
}

function paragraphs(lines, className = null) {
  return (lines ?? []).map((line) => el('p', { className, text: line }));
}

function notice(text, kind = '') {
  return el('p', { className: `notice ${kind}`.trim(), text });
}

// Fills one container. On failure the page keeps working and the container says
// what did not load and what to do next.
async function fill(selector, build) {
  const host = document.querySelector(selector);
  if (!host) {
    return;
  }
  const name = host.dataset.contentName ?? 'This part of the page';
  try {
    const nodes = [].concat(await build()).filter(Boolean);
    host.replaceChildren(...nodes);
  } catch (error) {
    console.error(error);
    host.replaceChildren(
      notice(
        `${name} did not load. Reload the page to try again. If it still does ` +
          'not load, tell a professor: the content file may be missing or invalid.',
        'notice-problem'
      )
    );
  } finally {
    host.removeAttribute('aria-busy');
  }
}

// --- Dates ------------------------------------------------------------------

const DAY_AND_MONTH = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric'
});
const CLOCK_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit'
});
const FULL_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

// A date column holds a plain day with no time zone. new Date('2026-07-05') reads
// that as UTC midnight, which shows as the day before in this time zone, so build
// the date from its parts instead.
function parseDay(text) {
  const [year, month, day] = String(text).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function todayAsDay() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// --- Derived values ---------------------------------------------------------

// The active release is the one whose window contains today. There is no
// is_active column on releases on purpose: a stale flag gives a wrong answer
// quietly. Both sides are plain YYYY-MM-DD text, so a text compare is correct.
function activeRelease(releases) {
  const today = todayAsDay();
  return releases.find((row) => row.starts_on <= today && today <= row.ends_on) ?? null;
}

function upcomingEvents(events) {
  const from = startOfToday();
  return events
    .filter((row) => new Date(row.starts_at) >= from)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

// --- Shared page parts ------------------------------------------------------

async function renderHeading(page) {
  const pages = await read('pages');
  const copy = pages[page] ?? {};
  return [
    el('h1', { text: copy.title ?? '' }),
    copy.lede ? el('p', { className: 'lede', text: copy.lede }) : null
  ];
}

async function renderFooter() {
  const league = await read('league');
  const contact = league.contact ?? {};
  const contactValue = contact.href
    ? el('a', { href: contact.href, text: contact.value })
    : document.createTextNode(contact.value ?? '');

  return [
    contact.value
      ? el('p', { className: 'footer-contact' }, [
          el('strong', { text: `${contact.label}: ` }),
          contactValue
        ])
      : null,
    ...paragraphs(league.footer?.lines, 'footer-line')
  ];
}

// --- Home page --------------------------------------------------------------

function renderMeetingSection(league) {
  const meets = league.meets ?? {};
  // The venue name is the first line of the address, so it is held in one place.
  const lines = [league.store_name, ...(meets.address_lines ?? [])].filter(Boolean);
  const address = lines.flatMap((line, index) => [
    index > 0 ? el('br') : null,
    index === 0 ? el('strong', { text: line }) : document.createTextNode(line)
  ]);

  return [
    meets.summary ? el('p', { className: 'meets-when', text: meets.summary }) : null,
    meets.deadline_note
      ? el('p', { className: 'meets-deadline', text: meets.deadline_note })
      : null,
    address.length ? el('address', { className: 'meets-where' }, address) : null,
    ...paragraphs(meets.arrival_note ? [meets.arrival_note] : []),
    ...paragraphs(meets.cost_note ? [meets.cost_note] : [])
  ];
}

function renderStepsSection(section) {
  return el(
    'ol',
    { className: 'steps' },
    (section.items ?? []).map((item) =>
      el('li', { className: 'step' }, [
        el('h3', { className: 'step-heading', text: item.heading }),
        el('p', { text: item.body })
      ])
    )
  );
}

function renderTierTable(release, tiers, labels) {
  if (!release) {
    return notice(labels.no_release_note, 'notice-quiet');
  }

  const window = `Attend from ${FULL_DATE.format(
    parseDay(release.starts_on)
  )} through ${FULL_DATE.format(parseDay(release.ends_on))}`;

  // Both are optional: a release may be set up before its on-sale date is known.
  const facts = [];
  if (release.attendance_days) {
    facts.push(`${release.attendance_days} league days in this window.`);
  }
  if (release.product_release_on) {
    facts.push(`Set releases on ${FULL_DATE.format(parseDay(release.product_release_on))}.`);
  }

  const rows = tiers
    .filter((tier) => tier.release_id === release.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  if (!rows.length) {
    return notice(labels.no_release_note, 'notice-quiet');
  }

  return el('div', { className: 'tier-block' }, [
    el('table', { className: 'tier-table' }, [
      el('caption', {}, [
        el('span', { className: 'tier-release', text: release.name }),
        el('span', { className: 'tier-window', text: window }),
        facts.length ? el('span', { className: 'tier-facts', text: facts.join(' ') }) : null
      ]),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: labels.tier_weeks_heading ?? 'Weeks' }),
          el('th', { scope: 'col', text: labels.tier_product_heading ?? 'Prize' })
        ])
      ]),
      el(
        'tbody',
        {},
        rows.map((tier) =>
          el('tr', {}, [
            el('th', { scope: 'row', className: 'tier-weeks', text: tier.weeks_required }),
            el('td', { text: tier.name })
          ])
        )
      )
    ])
  ]);
}

function renderSection(section, { league, releases, tiers, labels }) {
  const body = [];
  if (section.kind === 'meeting') {
    body.push(...renderMeetingSection(league));
  } else if (section.kind === 'steps') {
    body.push(renderStepsSection(section));
  } else if (section.kind === 'loyalty') {
    body.push(...paragraphs(section.body));
    body.push(renderTierTable(activeRelease(releases), tiers, labels));
  } else {
    body.push(...paragraphs(section.body));
  }

  // A page with one section has its name in the h1 already, so the section
  // heading is optional. Without a heading there is nothing to label it with.
  if (!section.heading) {
    return el('section', { className: 'panel', id: section.id }, body);
  }

  return el(
    'section',
    { className: 'panel', id: section.id, 'aria-labelledby': `${section.id}-heading` },
    [el('h2', { id: `${section.id}-heading`, text: section.heading }), ...body]
  );
}

// Any page whose content is a list of sections in data/league.json.
async function renderSectionPage(page) {
  await fill('#page-heading', () => renderHeading(page));

  await fill('#page-sections', async () => {
    const [pages, league, releases, tiers, labels] = await Promise.all([
      read('pages'),
      read('league'),
      getRows('releases'),
      getRows('loyalty_tiers'),
      read('labels')
    ]);

    return (pages[page]?.sections ?? []).map((section) =>
      renderSection(section, { league, releases, tiers, labels })
    );
  });
}

// --- Schedule page ----------------------------------------------------------

function renderCapacity(capacities, labels) {
  if (!capacities.length) {
    return null;
  }

  const uncapped = capacities.find((row) => row.division === 'all');
  if (uncapped) {
    return el('p', { className: 'event-capacity' }, [
      document.createTextNode(`${labels.capacity_prefix} `),
      el('span', { className: 'count', text: uncapped.capacity }),
      document.createTextNode(` ${labels.capacity_suffix}.`)
    ]);
  }

  return el('div', { className: 'event-capacity' }, [
    el('p', { className: 'event-capacity-label', text: 'Space for each division' }),
    el(
      'ul',
      { className: 'division-list' },
      capacities.map((row) =>
        el('li', {}, [
          el('span', { text: labels.division?.[row.division] ?? row.division }),
          el('span', { className: 'count', text: row.capacity })
        ])
      )
    )
  ]);
}

function renderEventCard(event, capacities, labels) {
  const start = new Date(event.starts_at);
  const typeLabel = labels.event_type?.[event.event_type] ?? event.event_type;

  const badges = [el('li', { className: 'badge', text: typeLabel })];
  if (event.is_premier) {
    badges.push(el('li', { className: 'badge badge-note', text: labels.player_id_required }));
  }

  return el('li', { className: 'card event' }, [
    el('p', { className: 'event-when' }, [
      el('time', { datetime: event.starts_at, text: DAY_AND_MONTH.format(start) }),
      el('span', { className: 'event-time', text: CLOCK_TIME.format(start) })
    ]),
    el('h3', { className: 'event-name', text: event.name }),
    el('ul', { className: 'badges' }, badges),
    event.description ? el('p', { text: event.description }) : null,
    renderCapacity(capacities, labels),
    event.entry_fee
      ? el('p', { className: 'event-fee' }, [
          document.createTextNode(`${labels.entry_fee_prefix ?? 'Entry'} `),
          el('span', { className: 'count', text: event.entry_fee })
        ])
      : null,
    event.linked_group_id
      ? el('p', { className: 'event-note', text: labels.linked_group_note })
      : null,
    el('p', { className: 'event-signup' }, [
      el('span', {
        className: event.registration_open ? 'status status-open' : 'status status-closed',
        text: event.registration_open ? labels.registration_open : labels.registration_closed
      }),
      event.registration_open && labels.registration_help
        ? el('span', { className: 'status-help', text: labels.registration_help })
        : null
    ])
  ]);
}

async function renderSchedule() {
  await fill('#page-heading', () => renderHeading('schedule'));

  await fill('#event-list', async () => {
    const [pages, events, capacities, labels] = await Promise.all([
      read('pages'),
      getRows('events'),
      getRows('event_capacities'),
      read('labels')
    ]);

    const upcoming = upcomingEvents(events);
    if (!upcoming.length) {
      return notice(pages.schedule?.empty, 'notice-quiet');
    }

    return el(
      'ul',
      { className: 'card-list' },
      upcoming.map((event) =>
        renderEventCard(
          event,
          capacities.filter((row) => row.event_id === event.id),
          labels
        )
      )
    );
  });
}

// --- Prize wall -------------------------------------------------------------

// Earning actions get a card each: the labels are long and most carry a note or
// an eligibility rule.
function renderEarningCards(rows) {
  return el(
    'ul',
    { className: 'card-list' },
    rows.map((row) => {
      // Zero is how the data marks "professor discretion", so the card shows a
      // question mark rather than a number the player might read as an award.
      const discretionary = row.default_points === 0;

      return el('li', { className: 'card item' }, [
        el('div', { className: 'item-head' }, [
          el('h3', { className: 'item-label', text: row.label }),
          el('p', { className: 'points' }, [
            el('span', { className: 'points-value', text: discretionary ? '?' : row.default_points }),
            el('span', {
              className: 'points-unit',
              text: row.default_points === 1 ? 'point' : 'points'
            }),
            discretionary
              ? el('span', { className: 'sr-only', text: 'Set by a professor' })
              : null
          ])
        ]),
        row.eligibility_note
          ? el('ul', { className: 'badges' }, [
              el('li', { className: 'badge badge-note', text: row.eligibility_note })
            ])
          : null,
        row.notes ? el('p', { className: 'item-notes', text: row.notes }) : null
      ]);
    })
  );
}

// The item catalogue is long and every row is a label and a number, so it reads
// as a price table rather than as dozens of cards.
function renderPriceTable(rows, copy) {
  return el('div', { className: 'price-block' }, [
    el('table', { className: 'price-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: copy.item_heading ?? 'Item' }),
          el('th', { scope: 'col', className: 'price-amount', text: copy.amount_heading ?? 'Points' })
        ])
      ]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el('tr', {}, [
            el('th', { scope: 'row' }, [
              el('span', { className: 'price-label', text: row.label }),
              row.notes ? el('span', { className: 'price-notes', text: row.notes }) : null
            ]),
            el('td', { className: 'price-amount count', text: row.default_cost })
          ])
        )
      )
    ])
  ]);
}

function renderGoodToKnow(notes) {
  if (!notes?.length) {
    return null;
  }
  return el('section', { className: 'panel panel-quiet', 'aria-label': 'Good to know' }, [
    el('h2', { text: 'Good to know' }),
    ...paragraphs(notes)
  ]);
}

async function renderPrizeWall() {
  await fill('#page-heading', () => renderHeading('prizes'));

  await fill('#prize-wall', async () => {
    const [pages, rows] = await Promise.all([read('pages'), getRows('earning_actions')]);
    const copy = pages.prizes ?? {};
    const actions = catalogue(rows);

    return [
      copy.steps?.length
        ? el('section', { className: 'panel' }, [
            el('h2', { text: copy.steps_heading ?? 'How it works' }),
            el(
              'ol',
              { className: 'steps' },
              copy.steps.map((step) => el('li', { className: 'step' }, [el('p', { text: step })]))
            )
          ])
        : null,
      copy.items_link
        ? el('p', { className: 'callout' }, [
            el('a', { href: copy.items_link.href, text: copy.items_link.label })
          ])
        : null,
      el('h2', { className: 'list-heading', text: copy.earning_heading ?? 'Ways to earn prize points' }),
      actions.length ? renderEarningCards(actions) : notice(copy.empty, 'notice-quiet'),
      renderGoodToKnow(copy.notes)
    ];
  });
}

async function renderPrizeItems() {
  await fill('#page-back', async () => {
    const pages = await read('pages');
    const back = pages['prize-items']?.back;
    return back ? el('a', { className: 'back-link', href: back.href, text: back.label }) : null;
  });

  await fill('#page-heading', () => renderHeading('prize-items'));

  await fill('#value-list', async () => {
    const [pages, rows] = await Promise.all([read('pages'), getRows('prize_items')]);
    const copy = pages['prize-items'] ?? {};
    const items = catalogue(rows);

    return [
      items.length ? renderPriceTable(items, copy) : notice(copy.empty, 'notice-quiet'),
      renderGoodToKnow(copy.notes)
    ];
  });
}

// --- Start ------------------------------------------------------------------

const PAGES = {
  home: () => renderSectionPage('home'),
  loyalty: () => renderSectionPage('loyalty'),
  schedule: renderSchedule,
  prizes: renderPrizeWall,
  'prize-items': renderPrizeItems
};

const build = PAGES[document.body.dataset.page];
if (build) {
  build();
}
fill('#site-footer-content', renderFooter);
