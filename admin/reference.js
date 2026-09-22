// Reference data: badges, Trainer Card ranks, and releases with their loyalty
// tiers.
//
// These are the tables that decide what the rest of the site means. A badge list
// defines a season; a rank's thresholds decide who is what; a release's window
// decides which attendance counts towards loyalty and which tier it reaches.
// None of it is hardcoded anywhere, which is why this screen exists.
//
// Badges are seasonal and the season is the badge list. current_badge_season()
// is max(season_year) on this table, so adding a 2027 list is what rolls the
// league over -- every player's rank is then judged on 2027 badges and last
// year's stay as history. That is a consequence worth knowing before you add
// one.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status } from './attendance-core.js';
import { artField, uploadArt, removeArt } from './badge-art.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let badges = [];
let ranks = [];
let releases = [];
let tiers = [];

const TIER_NAMES = ['Crystal', 'Gold', 'Silver'];

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});

function day(value) {
  return value ? DAY.format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '';
}

const field = (text, input) =>
  el('p', { className: 'field' }, [el('label', { text }, [input])]);

async function loadAll() {
  const [b, r, rel, t] = await Promise.all([
    supabase.from('badges').select('*')
      .order('season_year', { ascending: false }).order('sort_order'),
    supabase.from('trainer_card_ranks').select('*').order('sort_order'),
    supabase.from('releases').select('*').order('starts_on', { ascending: false }),
    supabase.from('loyalty_tiers').select('*').order('weeks_required', { ascending: false })
  ]);
  if (b.error || r.error || rel.error || t.error) {
    throw b.error || r.error || rel.error || t.error;
  }
  badges = b.data || [];
  ranks = r.data || [];
  releases = rel.data || [];
  tiers = t.data || [];
}

// --- Badges ------------------------------------------------------------------

function badgeRow(badge) {
  const name = el('input', { value: badge.name });
  const code = el('input', { value: badge.code });
  const task = el('input', { value: badge.task });
  const order = el('input', { type: 'number', step: '1', value: badge.sort_order });
  const art = artField(badge, { label: 'Replace the picture' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const save = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save' });

  const toggle = el('button', {
    type: 'button',
    className: badge.is_active ? 'link-button' : 'button button-quiet',
    text: badge.is_active ? 'Retire this badge' : 'Bring it back'
  });
  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: 'Yes, retire it' });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Keep it' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    toggle.hidden = false;
    status(note, '');
  });

  toggle.addEventListener('click', () => {
    if (!badge.is_active) { setActive(true); return; }
    toggle.hidden = true;
    confirmRow.hidden = false;
    status(note, 'Retiring a badge takes it out of the season it belongs to, so '
      + 'it stops counting towards rank. Players who earned it keep the award.');
  });

  yes.addEventListener('click', () => setActive(false));

  async function setActive(value) {
    toggle.disabled = true;
    yes.disabled = true;
    status(note, 'Saving.');
    try {
      const { error } = await supabase.from('badges')
        .update({ is_active: value }).eq('id', badge.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      toggle.disabled = false;
      yes.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  }

  const form = el('form', {}, [
    field('Name', name),
    field('Code', code),
    el('p', { className: 'field-help',
      text: 'The stable key. Names get reworded; this is what an award points at, '
          + 'and what decides the badge’s colour. Changing it on a badge '
          + 'players already hold is safe but pointless.' }),
    field('Task', task),
    field('Sort order', order),
    ...art.nodes,
    el('p', { className: 'item-actions' }, [save, toggle, confirmRow]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !code.value.trim() || !task.value.trim()) {
      status(note, 'A badge needs a name, a code and a task.', 'error');
      return;
    }
    save.disabled = true;
    status(note, 'Saving.');
    try {
      const patch = {
        name: name.value.trim(),
        code: code.value.trim(),
        task: task.value.trim(),
        sort_order: Number(order.value) || 0
      };

      // A new picture brings its own colours. Uploaded before the row is
      // written, so a failed upload leaves the badge exactly as it was rather
      // than pointing at a file that is not there.
      const picked = art.chosen();
      if (picked) {
        status(note, 'Uploading the picture.');
        patch.image_path = await uploadArt(badge, picked);
        patch.tile_color = picked.tile_color;
        patch.tile_edge = picked.tile_edge;
      }

      const { error } = await supabase.from('badges').update(patch).eq('id', badge.id);
      if (error) throw error;

      // Only once the row points at the new file.
      if (picked && badge.image_path) await removeArt(badge.image_path);

      await refresh();
    } catch (err) {
      console.error(err);
      save.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('li', { className: 'item-row' + (badge.is_active ? '' : ' is-retired') }, [
    el('details', { className: 'disclosure' }, [
      el('summary', {}, [
        el('span', { className: 'player-label', text: badge.name }),
        el('span', { className: 'count', text: badge.code }),
        badge.is_active ? null : el('span', { className: 'tag tag-voided', text: 'retired' })
      ]),
      el('div', { className: 'disclosure-body' }, [form])
    ])
  ]);
}

function addBadgePanel(current) {
  const name = el('input', {});
  const code = el('input', {});
  const task = el('input', {});
  const season = el('input', { type: 'number', step: '1', value: current || new Date().getFullYear() });
  const art = artField(null, { label: 'Badge picture' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Add the badge' });
  const warn = el('p', { className: 'field-help' });

  function syncWarning() {
    const value = Number(season.value);
    if (current && value > current) {
      warn.className = 'field-help is-warning';
      warn.textContent = `Season ${value} is later than ${current}, the season `
        + 'running now. Adding this makes it the current season straight away: '
        + `every player's rank starts being judged on ${value} badges, and `
        + `${current} becomes history. Add the whole list at once if that is what `
        + 'you mean.';
    } else {
      warn.className = 'field-help';
      warn.textContent = current
        ? `Season ${current} is running now. A badge added to it counts towards `
          + 'rank immediately.'
        : 'The first badge sets the season.';
    }
  }
  season.addEventListener('input', syncWarning);
  syncWarning();

  const form = el('form', {}, [
    field('Name', name),
    field('Code', code),
    el('p', { className: 'field-help',
      text: 'Short, lowercase, no spaces. Unique within the season.' }),
    field('Task', task),
    field('Season', season),
    warn,
    ...art.nodes,
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !code.value.trim() || !task.value.trim()) {
      status(note, 'A badge needs a name, a code and a task.', 'error');
      return;
    }
    const year = Number(season.value);
    if (!Number.isInteger(year)) {
      status(note, 'The season must be a year.', 'error');
      return;
    }

    go.disabled = true;
    status(note, 'Adding.');
    try {
      const sameSeason = badges.filter((b) => b.season_year === year);
      const nextOrder = sameSeason.reduce((max, b) => Math.max(max, b.sort_order), 0) + 10;

      const row = {
        name: name.value.trim(),
        code: code.value.trim(),
        task: task.value.trim(),
        season_year: year,
        sort_order: nextOrder
      };

      // Without a picture the tile falls back to plain gold, which is what made
      // a professor-created badge look broken. Not refused, because a badge
      // with its art still to come is a reasonable half-finished thing, but the
      // result says so.
      const picked = art.chosen();
      if (picked) {
        status(note, 'Uploading the picture.');
        row.image_path = await uploadArt(
          { code: row.code, season_year: row.season_year }, picked);
        row.tile_color = picked.tile_color;
        row.tile_edge = picked.tile_edge;
      }

      const { error } = await supabase.from('badges').insert(row);
      if (error) throw error;
      form.reset();
      go.disabled = false;
      await refresh();
      if (!picked) {
        status(note, 'Added, but with no picture yet, so its tile is plain gold. '
          + 'Open it below to add one.', 'error');
      }
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, err.message && err.message.includes('badges_season_code_key')
        ? 'That code is already used in that season. Codes are unique within a season.'
        : `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: 'Add a badge' }),
    form
  ]);
}

function badgeSection() {
  const seasons = [...new Set(badges.map((b) => b.season_year))].sort((a, b) => b - a);
  const current = seasons.length ? seasons[0] : null;

  return el('div', { className: 'reference-section' }, [
    el('p', { className: 'section-note',
      text: current
        ? `Season ${current} is the current one, because it is the latest season `
          + 'with badges. Rank is judged on these and nothing else.'
        : 'No badges exist yet. The first one you add sets the season.' }),

    ...seasons.map((year) => {
      const list = badges.filter((b) => b.season_year === year);
      return el('section', { className: 'card' }, [
        el('h3', { text: year === current ? `Season ${year}, running now` : `Season ${year}` }),
        el('ul', { className: 'item-list' }, list.map(badgeRow))
      ]);
    }),

    addBadgePanel(current)
  ]);
}

// --- Ranks -------------------------------------------------------------------

function rankRow(rank) {
  const name = el('input', { value: rank.name });
  const qualification = el('input', { value: rank.qualification });
  const reward = el('input', { value: rank.reward ?? '' });
  const benefit = el('input', { value: rank.benefit ?? '' });
  const badgesNeeded = el('input', { type: 'number', step: '1', min: '0',
    value: rank.badges_required ?? '' });
  const visitsNeeded = el('input', { type: 'number', step: '1', min: '0',
    value: rank.visits_required ?? '' });
  const elite = el('input', { type: 'checkbox' });
  elite.checked = !!rank.requires_elite_four;
  const order = el('input', { type: 'number', step: '1', value: rank.sort_order });

  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save' });

  const eliteId = `elite-${rank.id}`;
  elite.id = eliteId;

  const form = el('form', {}, [
    field('Name', name),
    field('How it is earned', qualification),
    field('Reward, optional', reward),
    field('Benefit, optional', benefit),
    field('Badges needed', badgesNeeded),
    el('p', { className: 'field-help',
      text: 'Blank means this rank is not reached by badge count. The highest '
          + 'number across all ranks is what the Trainer Card screen calls the '
          + 'Champion threshold.' }),
    field('Visits needed', visitsNeeded),
    el('p', { className: 'field field-inline' }, [
      elite, el('label', { for: eliteId, text: 'Needs all four Elite 4 battles' })
    ]),
    field('Sort order', order),
    el('p', { className: 'field-help',
      text: 'Lowest first, the order a player climbs them. The first is the entry '
          + 'rank everybody starts at.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !qualification.value.trim()) {
      status(note, 'A rank needs a name and a way to earn it.', 'error');
      return;
    }
    go.disabled = true;
    status(note, 'Saving.');
    try {
      const { error } = await supabase.from('trainer_card_ranks').update({
        name: name.value.trim(),
        qualification: qualification.value.trim(),
        reward: reward.value.trim() || null,
        benefit: benefit.value.trim() || null,
        badges_required: badgesNeeded.value === '' ? null : Number(badgesNeeded.value),
        visits_required: visitsNeeded.value === '' ? null : Number(visitsNeeded.value),
        requires_elite_four: elite.checked,
        sort_order: Number(order.value) || 0
      }).eq('id', rank.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('li', { className: 'item-row' }, [
    el('details', { className: 'disclosure' }, [
      el('summary', {}, [
        el('span', { className: 'player-label', text: rank.name }),
        el('span', { className: 'count',
          text: rank.requires_elite_four
            ? 'Elite 4'
            : (rank.badges_required != null
                ? `${rank.badges_required} badges`
                : (rank.visits_required != null ? `${rank.visits_required} visits` : 'entry')) })
      ]),
      el('div', { className: 'disclosure-body' }, [form])
    ])
  ]);
}

function rankSection() {
  return el('div', { className: 'reference-section' }, [
    el('p', { className: 'section-note',
      text: 'The ladder. player_rank() reads these thresholds rather than having '
          + 'them written into it, so moving one changes every player’s rank '
          + 'at once. There is no add or remove here: four ranks is the program, '
          + 'and a fifth would need the public pages thought through first.' }),
    el('section', { className: 'card' }, [
      ranks.length
        ? el('ul', { className: 'item-list' }, ranks.map(rankRow))
        : el('p', { className: 'muted-note', text: 'No ranks are set up.' })
    ])
  ]);
}

// --- Releases ----------------------------------------------------------------

function tierRows(release) {
  const mine = tiers.filter((t) => t.release_id === release.id);
  const note = el('p', { className: 'form-status', role: 'status' });
  const inputs = new Map();

  const fields = TIER_NAMES.map((tierName) => {
    const existing = mine.find((t) => t.tier_name === tierName);
    const weeks = el('input', { type: 'number', step: '1', min: '0',
      value: existing ? existing.weeks_required : '' });
    const product = el('input', { value: existing ? existing.product : '' });
    inputs.set(tierName, { weeks, product, existing });
    return el('div', { className: 'tier-row' }, [
      el('h5', { text: tierName }),
      field('Sundays needed', weeks),
      field('What it earns', product)
    ]);
  });

  const go = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save tiers' });

  const form = el('form', {}, [
    el('p', { className: 'field-help',
      text: 'Leave both blank to drop a tier from this release. Not every release '
          + 'has all three, and the thresholds move release to release.' }),
    ...fields,
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    status(note, 'Saving.');

    try {
      const keep = [];
      const drop = [];
      let order = 0;

      for (const tierName of TIER_NAMES) {
        const { weeks, product, existing } = inputs.get(tierName);
        const blank = weeks.value.trim() === '' && !product.value.trim();

        if (blank) {
          if (existing) drop.push(existing.id);
          continue;
        }
        const n = Number(weeks.value);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`${tierName} needs a whole number of Sundays.`);
        }
        if (!product.value.trim()) {
          throw new Error(`${tierName} needs to say what it earns.`);
        }
        keep.push({
          ...(existing ? { id: existing.id } : {}),
          release_id: release.id,
          tier_name: tierName,
          weeks_required: n,
          product: product.value.trim(),
          sort_order: order++
        });
      }

      if (drop.length) {
        const { error } = await supabase.from('loyalty_tiers').delete().in('id', drop);
        if (error) throw error;
      }
      if (keep.length) {
        const { error } = await supabase.from('loyalty_tiers')
          .upsert(keep, { onConflict: 'release_id,tier_name' });
        if (error) throw error;
      }

      go.disabled = false;
      await refresh();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('div', {}, [el('h4', { text: 'Loyalty tiers' }), form]);
}

function releaseRow(release) {
  const name = el('input', { value: release.name });
  const starts = el('input', { type: 'date', value: String(release.starts_on).slice(0, 10) });
  const ends = el('input', { type: 'date', value: String(release.ends_on).slice(0, 10) });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button button-quiet', text: 'Save' });

  const today = new Date().toISOString().slice(0, 10);
  const running = String(release.starts_on) <= today && today <= String(release.ends_on);

  const form = el('form', {}, [
    field('Name', name),
    field('Starts', starts),
    field('Ends', ends),
    el('p', { className: 'field-help',
      text: 'The window decides which attendance counts towards loyalty. There is '
          + 'no active flag: the release running now is the one today falls '
          + 'inside, so two overlapping windows would fight.' }),
    el('p', {}, [go]),
    note,
    tierRows(release)
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !starts.value || !ends.value) {
      status(note, 'A release needs a name and both dates.', 'error');
      return;
    }
    if (ends.value < starts.value) {
      status(note, 'The end date is before the start date.', 'error');
      return;
    }
    go.disabled = true;
    status(note, 'Saving.');
    try {
      const { error } = await supabase.from('releases').update({
        name: name.value.trim(),
        starts_on: starts.value,
        ends_on: ends.value
      }).eq('id', release.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not save: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  const mine = tiers.filter((t) => t.release_id === release.id);

  return el('li', { className: 'item-row' }, [
    el('details', { className: 'disclosure' }, [
      el('summary', {}, [
        el('span', { className: 'player-label', text: release.name }),
        el('span', { className: 'count', text: `${mine.length} tier${mine.length === 1 ? '' : 's'}` }),
        running ? el('span', { className: 'tag tag-division', text: 'running now' }) : null,
        release.finalized_at ? el('span', { className: 'tag tag-voided', text: 'finalized' }) : null
      ]),
      el('div', { className: 'disclosure-body' }, [
        el('p', { className: 'muted-note',
          text: `${day(release.starts_on)} to ${day(release.ends_on)}` }),
        form
      ])
    ])
  ]);
}

function addReleasePanel() {
  const name = el('input', {});
  const starts = el('input', { type: 'date' });
  const ends = el('input', { type: 'date' });
  const note = el('p', { className: 'form-status', role: 'status' });
  const go = el('button', { type: 'submit', className: 'button', text: 'Add the release' });

  const form = el('form', {}, [
    field('Name', name),
    field('Starts', starts),
    field('Ends', ends),
    el('p', { className: 'field-help',
      text: 'Add the tiers once it exists. A release with no tiers counts Sundays '
          + 'and awards nothing, which is a legitimate way to start.' }),
    el('p', {}, [go]),
    note
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !starts.value || !ends.value) {
      status(note, 'A release needs a name and both dates.', 'error');
      return;
    }
    if (ends.value < starts.value) {
      status(note, 'The end date is before the start date.', 'error');
      return;
    }

    // Overlap is not refused, because the database does not refuse it either and
    // a professor correcting one window at a time would be blocked halfway. It
    // is worth saying out loud, because active_release() picks only one.
    const clash = releases.find((r) =>
      String(r.starts_on) <= ends.value && starts.value <= String(r.ends_on));

    go.disabled = true;
    status(note, 'Adding.');
    try {
      const { error } = await supabase.from('releases').insert({
        name: name.value.trim(),
        starts_on: starts.value,
        ends_on: ends.value
      });
      if (error) throw error;
      form.reset();
      go.disabled = false;
      await refresh();
      if (clash) {
        status(note, `Added, but this overlaps ${clash.name}. Only one release can `
          + 'be the one running on any given day, so fix the windows before the '
          + 'overlap starts.', 'error');
      }
    } catch (err) {
      console.error(err);
      go.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: 'Add a release' }),
    form
  ]);
}

function releaseSection() {
  return el('div', { className: 'reference-section' }, [
    el('p', { className: 'section-note',
      text: 'Loyalty resets each release. Weeks come from counting distinct days '
          + 'attended inside the window, so a window that moves changes what has '
          + 'already been earned.' }),
    el('section', { className: 'card' }, [
      releases.length
        ? el('ul', { className: 'item-list' }, releases.map(releaseRow))
        : el('p', { className: 'muted-note', text: 'No releases yet.' })
    ]),
    addReleasePanel()
  ]);
}

// --- Render ------------------------------------------------------------------

function render() {
  app.replaceChildren(
    el('nav', { className: 'jump-links', 'aria-label': 'On this page' }, [
      el('a', { href: '#badges', text: 'Badges' }),
      el('a', { href: '#ranks', text: 'Ranks' }),
      el('a', { href: '#releases', text: 'Releases' })
    ]),

    el('div', { id: 'badges' }, [
      el('h2', { className: 'section-heading', text: 'Badges' }),
      badgeSection()
    ]),

    el('div', { id: 'ranks' }, [
      el('h2', { className: 'section-heading', text: 'Trainer Card ranks' }),
      rankSection()
    ]),

    el('div', { id: 'releases' }, [
      el('h2', { className: 'section-heading', text: 'Releases and loyalty' }),
      releaseSection()
    ])
  );
}

async function refresh() {
  await loadAll();
  render();
}

(async () => {
  professor = await currentProfessor();
  if (!professor) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem' }, [
      el('span', { text: 'Sign in first. ' }),
      el('a', { href: 'index.html', text: 'Professor tools' })
    ]));
    return;
  }

  try {
    await refresh();
  } catch (err) {
    console.error(err);
    app.replaceChildren(problem('The reference data'));
  }
})();

export { badgeSection, rankSection, releaseSection };

// Set by the local demo so the sections can render without a session.
export function _setReference(b, r, rel, t) {
  badges = b; ranks = r; releases = rel; tiers = t;
}
