import { supabase, el, problem, playerLinks, badgeTile, formatMsrp, openRelease }
  from './supabase-client.js';
import { currentProfessor } from './auth.js';

const form = document.querySelector('#lookup-form');
const input = document.querySelector('#player-id');
const result = document.querySelector('#result');
const listHost = document.querySelector('#visible-players');

// Resolved once. The lookup and the browse list both need the answer, and asking
// twice is two round trips for one fact.
let professor = null;
const professorReady = currentProfessor().then((p) => { professor = p; return p; });

// Set once a professor is signed in, and read by the one submit handler rather
// than by a second listener racing the first: two listeners on the same form
// fire in registration order at the target, so a later one cannot pre-empt an
// earlier one and the plain ID lookup would always win.
let searchFilter = null;

const NOT_FOUND =
  'No public record for that Player ID. If it is yours, ask a professor to turn '
  + 'on visibility — it is off by default, and always off for players under 18 '
  + 'unless a parent has agreed.';

// `extra` is one line or several. Loyalty carries two — the tier reached, and
// the product asked for — as separate lines rather than one joined by a
// separator, because the first is a count and the second is a decision.
function stat(label, value, extra) {
  const lines = [].concat(extra || []).filter(Boolean);

  return el('div', { className: 'stat' }, [
    el('span', { className: 'stat-label', text: label }),
    el('span', { className: 'stat-value', text: value }),
    ...lines.map((line) => el('span', { className: 'stat-extra', text: line }))
  ]);
}

// What they asked for, under the tier they reached.
//
// A choice above what their Sundays reach is still shown — it is what they
// asked for and it is true — but it says what it needs, because the store's
// sheet leaves them in the tier they earned until they get there. `reached` is
// decided by get_player_summary(), which has the threshold; the card does not
// otherwise carry one and should not start re-deriving the rule.
function chosenLine(summary) {
  const choice = summary.loyalty_choice;
  if (!choice) return null;

  const price = formatMsrp(choice.msrp);
  const named = choice.product + (price ? ` (${price})` : '');

  return choice.reached
    ? `Taking the ${named}`
    : `Asked for the ${named} — ${choice.weeks_required} Sundays needed`;
}

function championStars(seasons) {
  if (!seasons.length) return null;
  const label = seasons.length === 1
    ? `League Champion, ${seasons[0]}`
    : `League Champion in ${seasons.length} seasons: ${seasons.join(', ')}`;

  return el('p', { className: 'champion-stars', 'aria-label': label }, [
    ...seasons.map((year) => el('span', { className: 'champion-star' }, [
      el('span', { className: 'star', 'aria-hidden': 'true', text: '★' }),
      el('span', { className: 'star-year', text: year })
    ]))
  ]);
}

// The badges this player holds in the seasons still being awarded, with the
// count saying how many exist so the set is not a mystery. Empty slots used to
// be here; a card mostly made of them was not worth the space.
function badgeList(summary) {
  const held = summary.badges || [];
  const total = summary.badges_available || held.length;
  const active = (summary.active_seasons || []).map(Number);

  if (!total) {
    return el('p', { className: 'muted-note',
      text: 'No badge list has been set for this season yet.' });
  }

  // Only what this player has earned, and already ordered by the summary:
  // newest season first, then the season's own order, so two cards are
  // comparable at a glance.
  //
  // A secret badge is here once earned and absent from the total until then,
  // so nothing on the card hints at one nobody has found.
  const count = el('p', { className: 'badge-count' }, [
    el('span', { className: 'count', text: `${held.length} of ${total}` }),
    el('span', { text: active.length > 1
      ? ` badges earned across seasons ${active.sort((a, b) => b - a).join(' and ')}`
      : ` badges earned in ${summary.season_year}` })
  ]);

  if (!held.length) {
    return el('div', {}, [
      count,
      el('p', { className: 'muted-note', text: 'No badges yet this season.' })
    ]);
  }

  const grid = (rows) => el('ul', { className: 'badge-grid' },
    rows.map((b) => el('li', {}, [badgeTile(b, { earned: true })])));

  // One season is the ordinary case and needs no heading. During a changeover
  // the years are worth saying, because a player holding badges from both
  // should be able to see which set each came from.
  if (active.length < 2) {
    return el('div', {}, [count, grid(held)]);
  }

  const years = [...new Set(held.map((b) => b.season_year))].sort((a, b) => b - a);
  return el('div', {}, [
    count,
    ...years.flatMap((year) => [
      el('span', { className: 'eyebrow', text: `Season ${year}` }),
      grid(held.filter((b) => b.season_year === year))
    ])
  ]);
}

function pastSeasons(summary) {
  // Only seasons that are finished with. A season still being awarded is shown
  // above in full, so repeating it here would just be noise.
  const active = new Set((summary.active_seasons || []).map(Number));
  const past = (summary.badge_seasons || [])
    .filter((s) => !active.has(Number(s.season_year)));
  if (!past.length) return null;

  return el('div', { className: 'past-seasons' }, [
    el('h3', { text: 'Previous seasons' }),
    el('ul', { className: 'season-list' },
      past.map((s) => el('li', {}, [
        el('span', { className: 'season-year count', text: s.season_year }),
        el('span', { text: `${s.rank} — ${s.badges_earned} badge`
          + (s.badges_earned === 1 ? '' : 's') })
      ])))
  ]);
}

// The same row the professor screens carry, pointing into admin/ from here.
// Nothing is `current`, because this page is not one of the four.
export function adminLinks(playerId) {
  return playerLinks(playerId, { prefix: 'admin/' });
}

export function summaryCard(summary) {
  const champions = summary.champion_seasons || [];
  const elite = summary.elite_four_wins || 0;

  const loyalty = summary.release_name
    ? stat('Loyalty', `${summary.loyalty_weeks ?? 0} Sunday`
        + ((summary.loyalty_weeks === 1) ? '' : 's'),
        [summary.tier_earned
          ? `${summary.tier_earned} tier reached, ${summary.release_name}`
          : `No tier yet, ${summary.release_name}`,
         chosenLine(summary)])
    : stat('Loyalty', 'Not counting', 'No release window is open');

  return el('section', { className: 'card summary', 'aria-label': 'Player summary' }, [
    el('h2', { className: 'summary-name', text: summary.display_label }),

    // Only ever present for a professor: a public caller receives nothing at all
    // for a player who is not visible, so this cannot appear to a player.
    summary.visible_publicly === false
      ? el('p', { className: 'not-public',
                  text: 'Not on the public site. Nobody has recorded consent for '
                      + 'this player, or it has lapsed.' })
      : null,

    professor ? adminLinks(summary.player_id) : null,

    handles(summary),

    championStars(champions),

    el('div', { className: 'stat-grid' }, [
      stat('Rank', summary.rank || 'League Trainer',
        `Season ${summary.rank_season || summary.season_year}`),
      stat('Prize points', summary.point_balance),
      loyalty,
      elite > 0 ? stat('Elite 4', `${elite} of 4`, 'battles won this season') : null
    ]),

    el('h3', { text: 'Badges' }),
    badgeList(summary),
    pastSeasons(summary)
  ]);
}

// A TCG Live name and, where there is one to show, a contact.
//
// get_player_summary() decides which of these this caller may see, so the page
// prints what it was given and never reasons about consent itself. contact
// arrives null for anybody who should not have it.
function handles(summary) {
  const rows = [];

  if (summary.ptcg_live) {
    rows.push(el('p', { className: 'handle' }, [
      el('span', { className: 'handle-label', text: 'Pokémon TCG Live' }),
      el('span', { className: 'handle-value', text: summary.ptcg_live })
    ]));
  }

  if (summary.contact) {
    rows.push(el('p', { className: 'handle' }, [
      el('span', { className: 'handle-label', text: 'Discord' }),
      el('span', { className: 'handle-value', text: summary.contact }),
      // Contact was private without exception until this was built, so a
      // professor reading one should be told which kind they are looking at
      // rather than left to assume the old rule.
      professor
        ? el('span', {
            className: summary.contact_public ? 'tag' : 'tag tag-hidden',
            text: summary.contact_public ? 'public' : 'professors only'
          })
        : null
    ]));
  }

  return rows.length ? el('div', { className: 'handle-set' }, rows) : null;
}

// --- Asking to be listed ------------------------------------------------------
//
// Everything about how a player appears is decided here, in one place, in both
// directions: a player can ask to be listed, ask to be taken off again, or just
// record a TCG Live name. The alternative was a form that only ever added
// visibility and a quiet word with a professor for the other direction, which
// puts the easy half on the website and the half somebody might feel awkward
// about in a conversation.
//
// NOTHING HERE CHANGES ANYTHING. It writes a request. A professor reads it on
// the consent screen and decides, which is the rule everywhere: a visibility
// flag moves only through set_player_visibility(), only by a professor, and
// only with consent recorded against it.

const WANT = [
  ['want_player_id', 'My Player ID',
   'Shows you in the player list and lets people look you up.'],
  ['want_name', 'My name',
   'Shown as a first name and a last initial, never in full. Needs your Player ID shown too.'],
  ['want_contact', 'My Discord',
   'Anybody on the site could see it. Leave this off to give it to the professors only.']
];

// One refusal for a wrong Player ID, a wrong last name and a wrong birth year
// alike. Telling them apart would make these forms a way to test which Player
// IDs exist, and then to guess details against the ones that do.
const NOT_MATCHED =
  'That Player ID, last name and birth year do not go together. Check all three '
  + 'and try again, or ask a professor at league.';

// The proof a player gives before anything about them is changed or read back.
//
// IT USED TO BE A FIRST NAME, and a first name is not a secret here.
// display_label() publishes "Maya R." for every listed player, and the list on
// this very page is a column of exactly those with the Player ID beside each
// one — so for anybody listed, both halves of the old proof were already on
// screen.
//
// A last name and a birth year are in the never-public list at the top of
// CLAUDE.md. No page renders either, and get_player_summary() does not return
// them, which is exactly what makes them worth asking for. They are asked for
// and never shown: nothing here reads one back, and the year is all that is
// ever typed, because a full date of birth is not stored anywhere on this site.
function proofFields(uid, playerId) {
  const last = el('input', { id: `pf-last-${uid}`, autocomplete: 'family-name',
    required: 'required' });
  const year = el('input', { id: `pf-year-${uid}`, type: 'number',
    inputmode: 'numeric', autocomplete: 'off', required: 'required',
    min: '1900', max: String(new Date().getFullYear()), placeholder: 'e.g. 2014' });

  return {
    // An empty box goes as null rather than as 0. One is a question nobody
    // answered and the other is one answered wrongly, and Number('') is 0.
    read: () => ({
      p_player_id: playerId,
      p_last_name: last.value.trim(),
      p_birth_year: year.value.trim() === '' ? null : Number(year.value)
    }),
    nodes: [
      el('p', { className: 'field' }, [
        el('label', { for: last.id, text: 'Your last name' }), last
      ]),
      el('p', { className: 'field' }, [
        el('label', { for: year.id, text: 'The year you were born' }), year
      ]),
      el('p', { className: 'field-help',
        text: 'So we know this is you. Both have to match what we have for '
            + `${playerId}, and neither is ever shown on this site.` })
    ]
  };
}

const REFUSALS = {
  not_matched: NOT_MATCHED,
  nothing_asked: 'Nothing was filled in, so there is nothing to send. Tick what '
    + 'you would like changed, or add a TCG Live name.'
};

function requestPanel(summary) {
  const uid = Math.random().toString(36).slice(2, 8);
  const proof = proofFields(uid, summary.player_id);
  const contact = el('input', { id: `rq-dis-${uid}`, autocomplete: 'off',
    placeholder: 'your.name' });
  const ptcg = el('input', { id: `rq-tcg-${uid}`, autocomplete: 'off',
    placeholder: 'YourName1234' });
  const note = el('input', { id: `rq-note-${uid}`, autocomplete: 'off' });

  // Three-state on purpose: untouched means "leave this alone". A form that
  // sent false for everything nobody ticked would read as a request to be
  // hidden from somebody who only wanted to add a TCG Live name.
  const wants = WANT.map(([key, label, help]) => {
    const yes = el('input', { type: 'radio', name: `${key}-${uid}`,
      id: `${key}-y-${uid}`, value: 'yes' });
    const no = el('input', { type: 'radio', name: `${key}-${uid}`,
      id: `${key}-n-${uid}`, value: 'no' });
    const leave = el('input', { type: 'radio', name: `${key}-${uid}`,
      id: `${key}-l-${uid}`, value: 'leave' });
    leave.checked = true;

    return {
      key,
      read: () => (yes.checked ? true : no.checked ? false : null),
      node: el('fieldset', { className: 'want' }, [
        el('legend', { text: label }),
        el('p', { className: 'field-help', text: help }),
        el('p', { className: 'want-choices' }, [
          el('span', { className: 'field-inline' },
            [yes, el('label', { for: yes.id, text: 'Show it' })]),
          el('span', { className: 'field-inline' },
            [no, el('label', { for: no.id, text: 'Hide it' })]),
          el('span', { className: 'field-inline' },
            [leave, el('label', { for: leave.id, text: 'Leave as it is' })])
        ])
      ])
    };
  });

  const status = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Send the request' });

  const form = el('form', { className: 'request-form' }, [
    ...proof.nodes,

    ...wants.map((w) => w.node),

    el('p', { className: 'field' }, [
      el('label', { for: contact.id, text: 'Discord username, optional' }), contact
    ]),
    el('p', { className: 'field' }, [
      el('label', { for: ptcg.id, text: 'Pokémon TCG Live username, optional' }), ptcg
    ]),
    el('p', { className: 'field-help',
      text: 'A TCG Live name is shown to anybody who can already see you. It is '
          + 'a game handle, not a way to message you.' }),

    el('p', { className: 'field' }, [
      el('label', { for: note.id, text: 'Anything to add, optional' }), note
    ]),
    el('p', {}, [go]),
    status
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Sending.';

    try {
      const { data, error } = await supabase.rpc('request_visibility', {
        ...proof.read(),
        p_want_player_id: wants[0].read(),
        p_want_name: wants[1].read(),
        p_want_contact: wants[2].read(),
        p_contact: contact.value.trim() || null,
        p_ptcg_live: ptcg.value.trim() || null,
        p_note: note.value.trim() || null
      });
      if (error) throw error;

      go.disabled = false;

      if (!data || !data.ok) {
        status.className = 'form-status is-error';
        status.textContent = REFUSALS[data && data.code]
          || 'That could not be sent. Try again, or ask a professor at league.';
        return;
      }

      form.reset();
      status.className = 'form-status is-good';
      status.textContent = 'Sent. A professor will look at it before anything '
        + 'changes. Nothing on the site has changed yet.';
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status.className = 'form-status is-error';
      status.textContent = 'That could not be sent just now. Try again, or ask '
        + 'a professor at league.';
    }
  });

  return el('details', { className: 'disclosure request-panel' }, [
    el('summary', { text: 'Change what people can see, or add a TCG Live name' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: 'Ask us to list you, to take you off the site, or to record your '
            + 'usernames. A professor checks every request, and for anyone '
            + 'under 18 we ask a parent or guardian first.' }),
      form
    ])
  ]);
}

// --- Choosing which product you want -----------------------------------------
//
// A tier earns the right to BUY at MSRP, and now that the price is on the
// programs page the next question answers itself: somebody who turned up eleven
// Sundays may not want to spend $161.64 on a Booster Box. This is where they
// say which product they would rather have instead.
//
// IT ASKS FOR A PRODUCT, NOT A TIER NAME. Crystal, Gold and Silver are how the
// thresholds are written down; what a player is actually choosing between is a
// Booster Box, an Elite Trainer Box and a Booster Bundle. So each option leads
// with the product and its price, and the tier and its Sundays are the quiet
// line underneath — there to answer "can I take that one yet", not to be the
// thing being picked. What goes to the database is the tier's id, because the
// row is what identifies a product and a product name is free text a professor
// can retype on the releases screen.
//
// A CEILING, NEVER A CLAIM. Choosing the Elite Trainer Box does not award Gold.
// What a player may buy is still whatever their Sundays earned, and the store's
// sheet moves them into the product they chose only where their Sundays reach
// that product's tier. So a choice made in week two still reads correctly in
// week eleven, and one above what has been reached simply waits.
//
// IT SAVES STRAIGHT AWAY, unlike the visibility request above it. That one is a
// professor's decision because it publishes something about a child and needs
// consent recorded against it. This records a preference about a purchase, on a
// card that is already public, and a player at home should not need somebody's
// approval to answer a question about their own money.
//
// The options come from loyalty_tiers, which is public and is the same list the
// programs page prints. What they chose comes back on the card itself, through
// get_player_summary() — there is deliberately no second read to keep in step
// with it, which is why the form opens on what is already recorded rather than
// on nothing.

const CHOICE_REFUSALS = {
  not_matched: NOT_MATCHED,
  no_release: 'No release is taking choices at the moment. Ask a professor '
    + 'which one is being counted next.',
  unknown_product: 'That is not one of this release’s products. Reload the page '
    + 'and try again.'
};

const CHOICE_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
});
const asDay = (d) => CHOICE_DAY.format(new Date(`${d}T12:00:00Z`));

// What was just recorded, in a sentence. The card above says the same thing in
// its own words; this one says it where the player is looking, immediately.
function choiceLine(data) {
  const choice = data.choice;
  const until = data.ends_on
    ? ` You can change this until ${asDay(data.ends_on)}.` : '';

  if (!choice) {
    return `Saved. Nothing is recorded for ${data.release_name}, so you will be `
      + `offered the best product your Sundays reach.${until}`;
  }

  const price = formatMsrp(choice.msrp);
  const named = choice.product + (price ? ` (${price})` : '');

  return choice.reached
    ? `Saved. For ${data.release_name} you are taking the ${named}.${until}`
    : `Saved. For ${data.release_name} you have asked for the ${named}, which `
      + `needs ${choice.weeks_required} Sundays. Until you reach that you are `
      + `offered the best product you have.${until}`;
}

function tierPanel(summary, onSaved) {
  const uid = Math.random().toString(36).slice(2, 8);
  const proof = proofFields(uid, summary.player_id);

  const options = el('div', { className: 'tier-choices' }, [
    el('p', { className: 'notice notice-quiet',
      text: 'Loading this release’s products.' })
  ]);
  const status = el('p', { className: 'form-status', role: 'status' });
  const save = el('button', { type: 'submit', className: 'button',
    text: 'Save my choice' });

  // Set once the options are drawn. Until then there is nothing to pick and the
  // button is disabled, so it cannot be called before it exists.
  let pick = () => undefined;

  function unavailable(text) {
    options.replaceChildren(el('p', { className: 'notice notice-quiet', text }));
    save.disabled = true;
  }

  function drawOptions(tiers) {
    const group = `tier-${uid}`;

    // The form opens on what is recorded, which it can do because the card has
    // already been told. Nothing was ticked here at first, back when the choice
    // was unreadable without a second call — and a form that opens on nothing
    // makes Save ambiguous, because "leave it alone" and "clear it" look the
    // same. Opening on the current answer makes an untouched Save a no-op.
    const current = summary.loyalty_choice ? summary.loyalty_choice.tier_id : '';

    const rows = tiers.map((t) => {
      const price = formatMsrp(t.msrp);
      const input = el('input', { type: 'radio', name: group, value: t.id,
        id: `tier-${t.id}-${uid}` });
      input.checked = t.id === current;

      return { value: t.id, input, node: el('p', { className: 'field-inline' }, [
        input,
        el('label', { for: input.id }, [
          el('span', { className: 'tier-product', text: t.product }),
          price ? el('span', { text: ` — ${price}` }) : null,
          el('span', { className: 'tier-note',
            text: `${t.tier_name}, ${t.weeks_required} Sundays` })
        ])
      ]) };
    });

    // No preference is a real answer and has to be sayable, or stepping back up
    // to "give me the best I earn" would mean asking a professor to delete a
    // row. It is what a player with no choice recorded is already on.
    const none = el('input', { type: 'radio', name: group, value: '',
      id: `tier-none-${uid}` });
    none.checked = !current;

    rows.push({ value: '', input: none,
      node: el('p', { className: 'field-inline' }, [
        none,
        el('label', { for: none.id }, [
          el('span', { className: 'tier-product',
            text: 'Whatever I earn' }),
          el('span', { className: 'tier-note',
            text: 'No preference — the best product my Sundays reach' })
        ])
      ]) });

    pick = () => {
      const hit = rows.find((r) => r.input.checked);
      return hit ? hit.value : undefined;
    };

    options.replaceChildren(
      el('p', { className: 'field-help',
        text: 'Pick the one you would like. You can always take less than you '
            + 'earn, never more — a product above what you have reached waits '
            + 'until you reach it.' }),
      ...rows.map((r) => r.node));
  }

  const form = el('form', { className: 'request-form choice-form' }, [
    ...proof.nodes,
    options,
    el('p', {}, [save]),
    status
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const tier = pick();
    if (tier === undefined) return;
    if (!form.reportValidity()) return;

    save.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Saving.';

    try {
      const { data, error } = await supabase.rpc('choose_loyalty_product', {
        ...proof.read(),
        p_tier_id: tier || null
      });
      if (error) throw error;

      save.disabled = false;

      if (!data || !data.ok) {
        status.className = 'form-status is-error';
        status.textContent = CHOICE_REFUSALS[data && data.code]
          || 'That could not be saved. Try again, or ask a professor at league.';
        return;
      }

      status.className = 'form-status is-good';
      status.textContent = choiceLine(data);

      // The card above is now out of date, and it is the thing that carries
      // this from here on. Redrawing it rather than reloading keeps the panel
      // open and the fields filled, which matters to somebody who has just
      // typed their last name and may want to change their mind again.
      if (onSaved) onSaved(data.choice || null);
    } catch (err) {
      console.error(err);
      save.disabled = false;
      status.className = 'form-status is-error';
      status.textContent = 'That could not be saved just now. Try again, or ask '
        + 'a professor at league.';
    }
  });

  const panel = el('details', { className: 'disclosure choice-panel' }, [
    el('summary', { text: 'Choose which product you want this release' }),
    el('div', { className: 'disclosure-body' }, [
      el('p', { className: 'field-help',
        text: 'Reaching a tier is the right to buy that product at its list '
            + 'price, not a prize. If the one you have earned costs more than '
            + 'you want to spend, say so here and the store will have the '
            + 'smaller one ready for you instead. It shows on your card above '
            + 'and on the list the store works from.' }),
      form
    ])
  ]);

  // Read when it is opened rather than on every lookup. Most people looking a
  // Player ID up are reading the card, and two requests each for a panel nobody
  // unfolded is two requests wasted.
  let loaded = false;
  panel.addEventListener('toggle', async () => {
    if (!panel.open || loaded) return;
    loaded = true;

    try {
      const open = await openRelease();
      if (!open) {
        unavailable(CHOICE_REFUSALS.no_release);
        return;
      }
      if (!open.tiers.length) {
        unavailable(`No products have been set for ${open.release.name} yet. `
          + 'Ask a professor.');
        return;
      }
      drawOptions(open.tiers);
    } catch (err) {
      console.error(err);
      options.replaceChildren(problem('This release’s products'));
      save.disabled = true;
    }
  });

  return panel;
}

async function lookUp(playerId) {
  const id = String(playerId || '').trim();
  if (!id) return;

  // Settled before the card is built, so the professor links are there on the
  // first render rather than appearing a moment later.
  await professorReady;

  result.replaceChildren(el('p', { className: 'notice', text: 'Looking that up.' }));

  try {
    const { data, error } = await supabase.rpc('get_player_summary', { p_player_id: id });
    if (error) throw error;

    if (!data) {
      result.replaceChildren(el('p', { className: 'notice notice-problem', text: NOT_FOUND }));
      return;
    }
    // The card carries the chosen product, so saving one in the panel below
    // leaves it stale. It is redrawn in place rather than by looking the player
    // up again, which would fold the panel away and empty the fields somebody
    // may be about to use a second time.
    let card = summaryCard(data);
    const panel = tierPanel(data, (choice) => {
      data.loyalty_choice = choice;
      const fresh = summaryCard(data);
      card.replaceWith(fresh);
      card = fresh;
    });

    result.replaceChildren(card, panel, requestPanel(data));
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    result.replaceChildren(problem('That player'));
  }
}

// Guarded, so this module can be imported by a page that has no lookup form.
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value.trim();

    // A professor typing a name is the obvious thing to try, so it has to work.
    // Digits are always an ID lookup; a name that matches one player opens them,
    // and a name that matches several leaves the list filtered so they can pick.
    if (searchFilter && typed && !/^[0-9]+$/.test(typed)) {
      const shown = searchFilter(typed);
      if (shown.length === 1) {
        lookUp(shown[0].player_id);
        return;
      }
      result.replaceChildren(el('p', { className: 'notice',
        text: shown.length
          ? `${shown.length} players match. Pick one from the list.`
          : 'Nobody matches that name or ID.' }));
      return;
    }

    lookUp(input.value);
  });

  // A link can carry an ID, so a professor can hand someone a direct link.
  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) {
    input.value = fromUrl;
    lookUp(fromUrl);
  }
}

// The browse list, in two versions.
//
// For the public it is consent-gated: non-consented players are absent rather
// than anonymised, because this is a browse list rather than a set that has to
// be complete.
//
// For a signed-in professor it is everybody, with a name search. Consent decides
// what the public sees; it was never meant to decide what the people running the
// league can look up, and a professor who cannot find a player on the player
// page just goes and finds them on an admin screen anyway.

function playerButton(id, label, extra) {
  return el('li', {}, [
    el('button', { type: 'button', className: 'player-button', 'data-id': id }, [
      el('span', { className: 'player-label', text: label }),
      el('span', { className: 'player-id count', text: id }),
      extra || null
    ])
  ]);
}

async function professorList() {
  // Two reads, because neither answers on its own. players has everybody;
  // public_players is who is actually listed.
  //
  // This used to mark the tag from `show_player_id === true` alone, and that
  // flag is three-valued. Null means "use the age-based default", which for an
  // adult is YES -- so every consenting adult who had never been toggled by
  // hand read as "not public" here while appearing correctly on the public
  // list. It was wrong in the other direction too, and more quietly: an
  // explicit true whose attendance has gone stale is no longer in force, and
  // this called that one public.
  //
  // id_visible() is the only thing that knows the answer, and public_players
  // is that function applied to everybody. The view is security_invoker =
  // false, so it returns the same rows for a professor as for anybody else --
  // which is exactly the property needed here: the tag should say what a
  // player would see, not what this session can see.
  const [all, listed] = await Promise.all([
    supabase.from('players')
      .select('player_id, first_name, last_name')
      .order('first_name'),
    supabase.from('public_players').select('player_id')
  ]);
  if (all.error || listed.error) throw all.error || listed.error;

  const publicIds = new Set((listed.data || []).map((p) => p.player_id));

  const rows = (all.data || []).map((p) => ({
    player_id: p.player_id,
    name: `${p.first_name} ${p.last_name}`.trim(),
    listed: publicIds.has(p.player_id)
  }));

  const listEl = el('ul', { className: 'player-list' });
  const count = el('p', { className: 'muted-note' });

  // No search box of its own. The page already has one field asking for a Player
  // ID, and two boxes doing the same job a few centimetres apart is the kind of
  // thing that makes a professor hesitate at the desk. The lookup field becomes
  // the search field instead.
  function draw(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const shown = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.player_id.includes(q))
      : rows;

    count.textContent = q
      ? `${shown.length} of ${rows.length} players match.`
      : `${rows.length} players. You are signed in, so you can see everybody.`;

    listEl.replaceChildren(...shown.map((r) => playerButton(
      r.player_id,
      r.name,
      r.listed ? null : el('span', { className: 'tag tag-hidden', text: 'not public' })
    )));

    return shown;
  }

  draw('');
  listHost.replaceChildren(count, listEl);

  return draw;
}

function wireSearch(filter, signedIn) {
  searchFilter = filter;

  const label = document.querySelector('label[for="player-id"]');
  if (label) label.textContent = 'Player ID or name';
  input.placeholder = signedIn ? 'e.g. 1234567 or Maya' : 'e.g. 1234567 or Maya R.';
  input.removeAttribute('inputmode');
  input.removeAttribute('required');
  input.type = 'search';

  input.addEventListener('input', () => filter(input.value));
}

async function publicList() {
  const { data, error } = await supabase
    .from('public_players').select('*').order('display_label');
  if (error) throw error;

  if (!data.length) {
    listHost.replaceChildren(el('p', { className: 'notice notice-quiet',
      text: 'No players are listed yet. Visibility is off by default, and a '
          + 'professor turns it on only with the player’s consent, or a '
          + 'parent’s for anyone under 18.' }));
    return null;
  }

  const listEl = el('ul', { className: 'player-list' });
  const count = el('p', { className: 'muted-note' });

  // Searched on display_label, which is exactly what consent already decided:
  // a player whose name is public reads as "Maya R." and so can be found by
  // name, and one who consented only to their ID reads as the ID and can only
  // be found by that. Nothing here can match on a value the public may not see,
  // because there is no such value in this list to match against.
  function draw(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const shown = q
      ? data.filter((p) => p.display_label.toLowerCase().includes(q)
                        || p.player_id.includes(q))
      : data;

    count.textContent = q
      ? `${shown.length} of ${data.length} match.`
      : `${data.length} player` + (data.length === 1 ? '' : 's')
        + ' have chosen to be listed.';

    listEl.replaceChildren(...shown.map((p) =>
      playerButton(p.player_id, p.display_label)));

    return shown;
  }

  draw('');
  listHost.replaceChildren(count, listEl);

  return draw;
}

(async () => {
  if (!listHost) return;
  try {
    const signedIn = await professorReady;
    const filter = signedIn ? await professorList() : await publicList();

    // The public gets the same one field. It only ever searches what consent has
    // already made public, so a name finds somebody exactly when they agreed to
    // be found by name.
    if (filter) wireSearch(filter, signedIn);

    listHost.addEventListener('click', (e) => {
      const button = e.target.closest('.player-button');
      if (!button) return;
      input.value = button.dataset.id;
      lookUp(button.dataset.id);
    });
  } catch (err) {
    console.error(err);
    listHost.replaceChildren(problem('The player list'));
  } finally {
    listHost.removeAttribute('aria-busy');
  }
})();
