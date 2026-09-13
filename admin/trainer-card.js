// The Trainer Card: badges, Elite 4 battles and Champion, for one season.
//
// Everything here is seasonal. Badges belong to a season, rank is worked out
// from that season's badges alone, and all three reset when the next season's
// badge list arrives -- which is why nothing is edited in place. Each of these
// tables grants INSERT and DELETE and no UPDATE, so an award is either recorded
// or removed, never amended. A badge awarded to the wrong player is taken off
// them and given to the right one.
//
// Rank is not stored and not computed here. player_rank() decides it from the
// badges, the ranks table and any Champion award, and this screen asks it rather
// than keeping a second opinion that could disagree.
import { supabase, el, problem } from '../supabase-client.js';
import { currentProfessor } from '../auth.js';
import { status, playerPicker } from './attendance-core.js';

const gate = document.querySelector('#gate');
const app = document.querySelector('#app');

let professor = null;
let season = null;
let badges = [];   // this season's badges, in order
let ranks = [];
let player = null;

// Set by the local demo so the panels can render without a session.
export function _setCard(s, b, r, p) { season = s; badges = b; ranks = r; player = p; }

const BATTLES = [1, 2, 3, 4];

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});

function day(value) {
  return value ? DAY.format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '';
}

// Colour by position in this season's list, the same rule the public player card
// uses, so next season's badges colour themselves without anyone assigning one.
function chipClass(index, earned) {
  return `badge-toggle badge-c${index % 13}` + (earned ? ' is-earned' : '');
}

// --- Loading -----------------------------------------------------------------

async function loadState(playerId) {
  const [held, elite, champion, rank] = await Promise.all([
    supabase.from('player_badges')
      .select('id, badge_id, awarded_on').eq('player_id', playerId),
    supabase.from('elite_four_wins')
      .select('id, battle_number, won_on').eq('player_id', playerId).eq('season_year', season),
    supabase.from('champion_awards')
      .select('id, season_year, awarded_on').eq('player_id', playerId),
    supabase.rpc('player_rank', { p_player_id: playerId, p_season: season })
  ]);

  const byBadge = new Map((held.data || []).map((r) => [r.badge_id, r]));

  return {
    // Only this season's badges count towards rank, so only those are shown as
    // toggles. Earlier seasons are history and are listed separately.
    held: byBadge,
    elite: new Map((elite.data || []).map((r) => [r.battle_number, r])),
    champion: (champion.data || []).find((r) => r.season_year === season) || null,
    championSeasons: (champion.data || []).map((r) => r.season_year).sort((a, b) => b - a),
    rank: rank.data || null
  };
}

// --- Badges ------------------------------------------------------------------

export function badgePanel(state) {
  const note = el('p', { className: 'form-status', role: 'status' });
  const earned = badges.filter((b) => state.held.has(b.id)).length;

  const chips = badges.map((badge, i) => {
    const row = state.held.get(badge.id);
    const button = el('button', {
      type: 'button',
      className: chipClass(i, !!row),
      'aria-pressed': row ? 'true' : 'false',
      title: badge.task
    }, [
      el('span', { className: 'badge-toggle-name', text: badge.name }),
      row ? el('span', { className: 'badge-toggle-date', text: day(row.awarded_on) }) : null
    ]);

    button.addEventListener('click', async () => {
      button.disabled = true;
      status(note, row ? `Taking ${badge.name} back.` : `Awarding ${badge.name}.`);
      try {
        const { error } = row
          ? await supabase.from('player_badges').delete().eq('id', row.id)
          : await supabase.from('player_badges').insert({
              player_id: player.player_id,
              badge_id: badge.id,
              awarded_by: professor.userId
            });
        if (error) throw error;
        await show(player.player_id);
      } catch (err) {
        console.error(err);
        button.disabled = false;
        status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
      }
    });

    return button;
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: `Badges (${earned} of ${badges.length})` }),
    el('p', { className: 'field-help',
      text: `Season ${season}. Tap a badge to award it, tap it again to take it `
          + 'back. A badge is earned once, so there is nothing to edit.' }),
    badges.length
      ? el('div', { className: 'badge-toggles' }, chips)
      : el('p', { className: 'muted-note',
          text: 'No badges have been set for this season yet.' }),
    note
  ]);
}

// --- Elite 4 -----------------------------------------------------------------

export function elitePanel(state) {
  const note = el('p', { className: 'form-status', role: 'status' });
  const won = state.elite.size;

  const buttons = BATTLES.map((n) => {
    const row = state.elite.get(n);
    const button = el('button', {
      type: 'button',
      className: 'battle-toggle' + (row ? ' is-won' : ''),
      'aria-pressed': row ? 'true' : 'false'
    }, [
      el('span', { className: 'battle-number', text: n }),
      el('span', { className: 'battle-state', text: row ? day(row.won_on) : 'Not won' })
    ]);

    button.addEventListener('click', async () => {
      button.disabled = true;
      status(note, row ? `Clearing battle ${n}.` : `Recording battle ${n}.`);
      try {
        const { error } = row
          ? await supabase.from('elite_four_wins').delete().eq('id', row.id)
          : await supabase.from('elite_four_wins').insert({
              player_id: player.player_id,
              season_year: season,
              battle_number: n,
              recorded_by: professor.userId
            });
        if (error) throw error;
        await show(player.player_id);
      } catch (err) {
        console.error(err);
        button.disabled = false;
        status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
      }
    });

    return button;
  });

  return el('section', { className: 'card' }, [
    el('h3', { text: `Elite 4 (${won} of 4)` }),
    el('p', { className: 'field-help',
      text: 'Only wins are recorded. A lost battle is nothing, and a player may '
          + 'try again as many times as they like, so there is no attempt to '
          + 'record. All four are needed before a Champion attempt, and all four '
          + 'reset next season.' }),
    el('div', { className: 'battle-toggles' }, buttons),
    note
  ]);
}

// --- Champion ----------------------------------------------------------------

export function championPanel(state) {
  const note = el('p', { className: 'form-status', role: 'status' });
  const earnedBadges = badges.filter((b) => state.held.has(b.id)).length;
  const eliteWon = state.elite.size;

  // Read from the ranks table rather than written in here, so the threshold
  // moving is a data change rather than a code change.
  const top = ranks.find((r) => r.requires_elite_four);
  const needBadges = ranks
    .filter((r) => r.badges_required != null)
    .reduce((max, r) => Math.max(max, r.badges_required), 0);

  const ready = earnedBadges >= needBadges && eliteWon === 4;

  const yes = el('button', { type: 'button', className: 'button button-danger',
    text: 'Yes, record it anyway' });
  const no = el('button', { type: 'button', className: 'link-button', text: 'Not yet' });
  const confirmRow = el('span', { className: 'confirm-row', hidden: 'hidden' }, [yes, no]);

  const go = el('button', {
    type: 'button',
    className: state.champion ? 'link-button' : 'button',
    text: state.champion ? 'Take the Champion award back' : 'Record them as Champion'
  });

  no.addEventListener('click', () => {
    confirmRow.hidden = true;
    go.hidden = false;
    status(note, '');
  });

  async function record() {
    go.disabled = true;
    yes.disabled = true;
    status(note, 'Recording.');
    try {
      const { error } = state.champion
        ? await supabase.from('champion_awards').delete().eq('id', state.champion.id)
        : await supabase.from('champion_awards').insert({
            player_id: player.player_id,
            season_year: season,
            awarded_by: professor.userId
          });
      if (error) throw error;
      await show(player.player_id);
    } catch (err) {
      console.error(err);
      go.disabled = false;
      yes.disabled = false;
      status(note, `That did not go through: ${err.message || 'unknown error'}.`, 'error');
    }
  }

  go.addEventListener('click', () => {
    if (state.champion || ready) { record(); return; }
    // Not blocked. The rank function does not check eligibility either, and a
    // professor who watched the battles outranks a count. It says what is
    // missing and asks.
    go.hidden = true;
    confirmRow.hidden = false;
    status(note, `They have ${earnedBadges} of the ${needBadges} badges needed and `
      + `${eliteWon} of 4 Elite 4 battles. Record it only if you saw them earn it.`);
  });

  yes.addEventListener('click', record);

  return el('section', { className: 'card' }, [
    el('h3', { text: `Champion, season ${season}` }),
    state.champion
      ? el('p', { className: 'live-state is-on',
          text: `League Champion for ${season}, recorded ${day(state.champion.awarded_on)}. `
              + 'That is one star on their card.' })
      : el('p', { className: 'field-help',
          text: `${top ? top.name : 'The top rank'} needs all four Elite 4 battles `
              + `and ${needBadges} badges. They have ${earnedBadges} badges and `
              + `${eliteWon} battles.` }),

    state.championSeasons.length
      ? el('p', { className: 'muted-note',
          text: `Champion in ${state.championSeasons.join(', ')}. `
              + `${state.championSeasons.length} star`
              + `${state.championSeasons.length === 1 ? '' : 's'} on their card.` })
      : null,

    el('p', {}, [go, confirmRow]),
    note
  ]);
}

// --- Render ------------------------------------------------------------------

const detail = el('div', { id: 'detail' });

async function show(playerId) {
  detail.replaceChildren(el('p', { className: 'notice', text: 'Loading.' }));
  try {
    const { data, error } = await supabase.from('players')
      .select('player_id, first_name, last_name').eq('player_id', playerId).maybeSingle();
    if (error) throw error;
    if (!data) {
      detail.replaceChildren(el('p', { className: 'notice notice-problem',
        text: 'No player has that ID.' }));
      return;
    }
    player = data;

    const state = await loadState(playerId);

    detail.replaceChildren(
      el('section', { className: 'card' }, [
        el('h2', { text: `${data.first_name} ${data.last_name}`.trim() }),
        el('p', { className: 'player-id count', text: data.player_id }),
        el('p', { className: 'rank-line' }, [
          el('span', { className: 'rank-name', text: state.rank || 'No rank' }),
          el('span', { className: 'muted-note', text: ` — season ${season}` })
        ]),
        el('p', { className: 'muted-note',
          text: 'Rank is worked out from this season’s badges and Champion '
              + 'award. It is not stored, so it follows whatever is recorded '
              + 'below.' })
      ]),
      badgePanel(state),
      elitePanel(state),
      championPanel(state)
    );
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    detail.replaceChildren(problem('That player'));
  }
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
    const { data: s } = await supabase.rpc('current_badge_season');
    season = s;

    const [b, r] = await Promise.all([
      supabase.from('badges').select('*')
        .eq('season_year', season).eq('is_active', true).order('sort_order'),
      supabase.from('trainer_card_ranks').select('*').order('sort_order')
    ]);
    if (b.error || r.error) throw b.error || r.error;
    badges = b.data || [];
    ranks = r.data || [];
  } catch (err) {
    console.error(err);
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'The badges and ranks could not be loaded, so nothing can be recorded '
          + 'safely. Reload the page and try again.' }));
    return;
  }

  if (!season) {
    gate.replaceChildren(el('p', { className: 'notice notice-problem',
      text: 'No badge season is set up. Add this season’s badges before '
          + 'recording Trainer Card progress.' }));
    return;
  }

  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('h2', { text: 'Find a player' }),
      playerPicker({ onPick: (p) => show(p.player_id) })
    ]),
    detail
  );

  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) show(fromUrl);
})();
