// The league charter: what this league is for, and how we expect each other to
// behave while we are doing it.
//
// NOT PUBLISHED YET. The charter itself is finished, but it has not been put in
// front of the league, so for now the page renders only for a signed-in
// professor and everybody else gets a short note. That is the same kind of gate
// as everything else `auth.js` governs: it decides what to SHOW. This file is a
// static asset anybody can fetch, so a determined reader can read the text in
// the source -- which is fine, because none of it is secret. It is unannounced,
// not confidential. To publish it, delete the gate and the `nav-prof` class on
// the nav item in charter.html.
//
// Three layers, each pointing at the next: a value says what we care about, a
// responsibility says what that asks of us on a Sunday, and a source says where
// the expectation comes from in the Play! Pokemon rules. Every link on the page
// runs down that chain -- value card to its responsibilities, footnote marker to
// its source, source to the document it cites at the foot of the page -- so a
// professor asked "says who?" can get from the words to the paragraph in four
// taps without leaving the page until the last one.
import { el } from './supabase-client.js';
import { currentProfessor, mountProfessorBar } from './auth.js';

const host = document.querySelector('#charter');

// Taken from the finalised charter. The league is LoCo League here, as it is
// everywhere on this site -- the charter calls it by the venue's name, which is
// the room rather than the league.
const MISSION = 'The mission of LoCo League is to foster a community in which '
  + 'people can enjoy all aspects of Pokémon through a shared experience.';

// The documents the sources cite. Each is listed once at the foot of the page
// and linked to from every source that leans on it, rather than repeating a URL
// twenty-one times -- a link that moves then moves in one place.
//
// `host` follows the convention the professor resources page set: say where a
// link goes, and say when it is a file rather than a page. A phone has no status
// bar to read a destination off.
const DOCUMENTS = [
  {
    key: 'tournament-rules',
    name: 'Play! Pokémon Tournament Rules Handbook',
    revised: 'rev. September 1, 2026',
    href: 'https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-tournament-rules-handbook-en.pdf',
    host: 'pokemon.com · PDF'
  },
  {
    key: 'standards',
    name: 'Play! Pokémon Standards of Conduct',
    revised: 'rev. September 1, 2026',
    href: 'https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-standards-of-conduct-en.pdf',
    host: 'pokemon.com · PDF'
  },
  {
    key: 'penalties',
    name: 'Play! Pokémon Penalty Guidelines',
    revised: null,
    href: 'https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-penalty-guidelines-en.pdf',
    host: 'pokemon.com · PDF'
  },
  {
    key: 'league-handbook',
    name: 'Play! Pokémon League Handbook',
    revised: 'rev. February 13, 2024',
    href: 'https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-league-handbook-02132024-en.pdf',
    host: 'pokemon.com · PDF'
  },
  {
    key: 'inclusion',
    name: 'Play! Pokémon Inclusion Policy',
    revised: null,
    href: 'https://www.pokemon.com/us/play-pokemon/about/play-pokemon-inclusion-policy',
    host: 'pokemon.com'
  },
  {
    key: 'terms',
    name: 'Play! Pokémon Terms of Use',
    revised: null,
    href: 'https://www.pokemon.com/us/legal/play-pokemon-terms-of-use',
    host: 'pokemon.com'
  },
  {
    key: 'rules-hub',
    name: 'Play! Pokémon Rules & Resources',
    revised: 'the index of current documents',
    href: 'https://www.pokemon.com/us/play-pokemon/about/tournaments-rules-and-resources',
    host: 'pokemon.com'
  }
];

const DOC_BY_KEY = new Map(DOCUMENTS.map((doc) => [doc.key, doc]));

// A source is written as a run of pieces. A plain string is text; an object is a
// mention of one of the documents above and becomes a link down to it. Writing
// them this way rather than as one string is what lets a mention carry its own
// wording -- "the Penalty Guidelines" and "Play! Pokémon Penalty Guidelines" are
// the same document and should not have to be spelled the same way to link.
const cite = (doc, text) => ({ doc, text });

// Numbered as they are in the charter. The index into this list is the footnote
// number minus one, so nothing here may be reordered without the markers moving
// with it -- which is why they are never written down beside the duties.
const SOURCES = [
  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 3.4 Teaching. ',
   '“Newer, less experienced competitors should be welcomed and supported.”'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 3.3 Respect; ',
   cite('penalties', 'Play! Pokémon Penalty Guidelines'), ' § 5.3.2. Competitors '
   + 'are expected to remain respectful to opponents; the Penalty Guidelines '
   + 'escalate “excessive celebration that is used to taunt another competitor '
   + 'or participant.”'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 1.3 Reporting; '
   + '§ 7.3. Participants are encouraged to bring concerns to event staff, who '
   + 'are the first point of contact for anything affecting a safe and welcoming '
   + 'event.'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 3.2 Fairness. ',
   '“Competitors should act with fairness and honesty during every game,” and a '
   + 'competitor “should prefer to lose a game than win by cheating.”'],

  [cite('penalties', 'Play! Pokémon Penalty Guidelines'), ', § 5.3.1 Unsporting '
   + 'Conduct, Severe. “A competitor willfully lies to tournament staff, such as '
   + 'during an investigation.” See also the ',
   cite('standards', 'Standards of Conduct'), ' § 3.3: remain respectful and '
   + 'forthright with staff, Judges, and customer support.'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.2 Prohibitions; ', cite('standards', 'Standards of Conduct'),
   ' § 2.2. Wagering, gambling, and bribery or coercion of other competitors are '
   + 'prohibited at Play! Pokémon events; the ',
   cite('penalties', 'Penalty Guidelines'), ' (§ 5.3.1 Severe) list bribery or '
   + 'coercion as grounds for Disqualification.'],

  [cite('league-handbook', 'Play! Pokémon League Handbook'), ', § 4.2 League '
   + 'Environment. League Owners and Leaders are encouraged to make parents '
   + '“feel confident about their children interacting with more experienced” '
   + 'members and to “include parents in discussions with young members.”'],

  [cite('inclusion', 'Play! Pokémon Inclusion Policy'), '. Play! Pokémon is '
   + 'committed to “fostering an inclusive and fair environment for all '
   + 'participants regardless of factors including but not limited to age, race, '
   + 'ethnicity, sexual orientation, gender, and disability.”'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 2 Event '
   + 'Expectations. Participants share responsibility for a “safe and '
   + 'family-friendly environment” at every event.'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.1 General Expectations; § 4.3.3 Appeals to the Head Judge; ',
   cite('standards', 'Standards of Conduct'), ' § 2.1. Participants must “Follow '
   + 'the direction of tournament staff.” The Standards of Conduct begin: '
   + '“Always follow instructions from event staff and security.” Rulings may be '
   + 'appealed only to the Head Judge, whose decision is final.'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 2.1 and § 2.4. '
   + 'Unwanted physical contact is prohibited, and “a costume does not imply '
   + 'consent” to touching or photography.'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.3.2.1 Spectator Responsibilities; ',
   cite('standards', 'Standards of Conduct'), ' § 3.2. Spectators may not '
   + 'communicate with competitors or interfere with a match in progress, and '
   + 'must maintain a reasonable distance from active matches. Outside assistance '
   + 'during a game is treated as cheating.'],

  [cite('penalties', 'Play! Pokémon Penalty Guidelines'), ', § 5.3.1 Unsporting '
   + 'Conduct, Minor. “A competitor leaves trash or other detritus in the play '
   + 'area after their match is over.”'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.2 Prohibitions. Participants are expected to maintain a “socially '
   + 'acceptable level of hygiene” for the comfort of others.'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 4.1 and § 4.3. '
   + 'Theft and property damage are listed violations of the Standards of '
   + 'Conduct; the ', cite('penalties', 'Penalty Guidelines'), ' (§ 5.3.1 Severe) '
   + 'list “assault, theft, or other criminal activity” as grounds for '
   + 'Disqualification.'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.3.1.1 Competitor Responsibilities; Pokémon TCG Rules & Formats (tempo '
   + 'guidelines). Competitors are responsible for playing at a reasonable pace. '
   + 'The TCG rules provide tempo guidance for searching, shuffling, and deciding '
   + 'on plays so that both players receive a fair share of the round.'],

  [cite('terms', 'Play! Pokémon Terms of Use'), ', Play by the Rules. '
   + 'Participants agree to follow the Standards of Conduct and all rules on the ',
   cite('rules-hub', 'Rules & Resources'), ' page; the ',
   cite('standards', 'Standards of Conduct'), ' § 3.1 describe the Spirit of the '
   + 'Game that every participant is expected to uphold.'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 3.1 Spirit of '
   + 'the Game. Play! Pokémon events are meant to be “community-focused and '
   + 'friendly” (', cite('terms', 'Terms of Use'), '); the Spirit of the Game '
   + 'places enjoyment and good sporting behavior above the result.'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 3.4 Teaching. ',
   '“Discussing strategies, offering tips, and reviewing plays after the match '
   + 'has completed is encouraged.”'],

  [cite('standards', 'Play! Pokémon Standards of Conduct'), ', § 4.3; ',
   cite('league-handbook', 'Play! Pokémon League Handbook'), ' § 4.2. '
   + '“Exploitative trading” is a listed violation. The League Handbook provides '
   + 'that “trades are ultimately reviewed by a League official before they can '
   + 'be completed” for younger members.'],

  [cite('tournament-rules', 'Play! Pokémon Tournament Rules Handbook'),
   ', § 3.3 Roles & Responsibilities. “Without competitors and staff alike, we '
   + 'wouldn’t be able to create tournaments that make the Pokémon community '
   + 'special.”']
];

// The charter's own order, and its own words. `note` is the footnote number,
// which is the charter's numbering rather than anything this page works out --
// the appendix is written against those numbers.
const VALUES = [
  {
    word: 'Kindness',
    slug: 'kindness',
    meaning: 'We treat others with compassion, patience, and understanding, '
      + 'recognizing that even small acts of kindness can make a meaningful '
      + 'difference. We strive to make every interaction a positive experience '
      + 'for those around us.',
    duties: [
      { note: 1, text: 'Welcome newer and less experienced players, and support '
        + 'them without condescension.' },
      { note: 2, text: 'Win and lose graciously. Greet your opponent at the '
        + 'start, thank them at the end, and keep your reaction to a result '
        + 'about the game, not the person.' },
      { note: 3, text: 'If someone at the table is having a hard day, notice, '
        + 'and let staff know if they need help.' }
    ]
  },
  {
    word: 'Honesty',
    slug: 'honesty',
    meaning: 'We act with integrity, speak truthfully, engage authentically, '
      + 'and take responsibility for our actions. We value fairness in '
      + 'competition and believe that doing what is right matters more than '
      + 'winning.',
    duties: [
      { note: 4, text: 'Call your own mistakes. If you notice an error in a '
        + 'game, yours or your opponent’s, raise it with your opponent, and when '
        + 'necessary a Judge, right away.' },
      { note: 5, text: 'Be truthful with Judges, organizers, and store staff, '
        + 'including during an investigation. Judges will be careful, fair, and '
        + 'impartial when making judge calls.' },
      { note: 6, text: 'No wagering or gambling on games, matches, or results, '
        + 'and no offering anything to influence a result. Gambling and other '
        + 'high-risk activities are not allowed in our space.' }
    ]
  },
  {
    word: 'Hospitality',
    slug: 'hospitality',
    meaning: 'We welcome everyone with warmth and openness, creating an '
      + 'environment where newcomers and longtime members alike feel included '
      + 'and valued. We actively seek opportunities to help others feel '
      + 'comfortable, connected, and part of our community.',
    duties: [
      { note: 7, text: 'Introduce yourself to someone you haven’t met, and make '
        + 'sure new arrivals know where to sign in, sit, and ask questions. '
        + 'Parents, spectators, and staff are part of that welcome too: greet '
        + 'other families and help new parents find their footing.' },
      { note: 8, text: 'Be open to games with any other player, regardless of '
        + 'skill level or deck, and be willing to try new experiences with other '
        + 'players.' },
      { note: 9, text: 'When you or others bring food or resources to share, be '
        + 'generous with them. Make sure everyone gets a chance to enjoy what is '
        + 'being shared, and don’t take more than your fair share.' }
    ]
  },
  {
    word: 'Respectfulness',
    slug: 'respectfulness',
    meaning: 'We treat every person with dignity, appreciating differences in '
      + 'age, background, experience, and perspective. We respect the feelings, '
      + 'boundaries, and contributions of others, even when we disagree or '
      + 'compete against one another.',
    duties: [
      { note: 10, text: 'Follow the rules of the game, the current Play! Pokémon '
        + 'rules, and directions from League staff, Judges, and store personnel. '
        + 'Accept a Judge’s ruling at the table; appeals go through the Head '
        + 'Judge.' },
      { note: 11, text: 'Respect personal space. Ask before touching another '
        + 'person’s cards, belongings, or costume, and accept “no” as the '
        + 'answer.' },
      { note: 12, text: 'Don’t comment on, coach, or interfere with a game that '
        + 'isn’t yours, keep a reasonable distance from active tables, and keep '
        + 'your volume at a level that lets others concentrate.' }
    ]
  },
  {
    word: 'Stewardship',
    slug: 'stewardship',
    meaning: 'We take responsibility in caring for our shared spaces, '
      + 'resources, and community, improving them where we can. We recognize '
      + 'that the continued success of our league depends on the care and '
      + 'commitment of every league member.',
    duties: [
      { note: 13, text: 'Keep our play space clean. Wrappers, drinks, and dice '
        + 'go with you when you leave your table, and everyone helps clean up at '
        + 'the end of League each week.' },
      { note: 14, text: 'Maintain basic personal hygiene so others can enjoy '
        + 'sharing the space.' },
      { note: 15, text: 'Treat the store’s space, tables, mats, and loaner '
        + 'materials as if they were your own. Report damage instead of hiding '
        + 'it, and don’t take what isn’t yours.' }
    ]
  },
  {
    word: 'Playfulness',
    slug: 'playfulness',
    meaning: 'We embrace the joy, creativity, curiosity, and spirit of adventure '
      + 'that Pokémon inspires. We remember that games are meant to be enjoyed, '
      + 'and that having fun together is more important than the outcome of any '
      + 'competition.',
    duties: [
      { note: 16, text: 'Play at a lively pace. Shuffle, search, and decide '
        + 'within a reasonable time so your opponent gets their share of the '
        + 'round.' },
      { note: 17, text: 'Try new decks, formats, and side events, and bring your '
        + 'curiosity. Don’t bring, or invite others into, activities that run '
        + 'contrary to the values of our League.' },
      { note: 18, text: 'Above all, have fun. Keep competition in proportion; if '
        + 'it stops being fun for anyone, that matters more than the result. '
        + 'This is a game meant to bring joy to everyone who plays it.' }
    ]
  },
  {
    word: 'Benevolence',
    slug: 'benevolence',
    meaning: 'We seek opportunities to improve the experiences and well-being of '
      + 'others through generosity, encouragement, and selfless service. We '
      + 'believe that a strong community is built not only on what we receive '
      + 'from it, but on what we willingly give back.',
    duties: [
      { note: 19, text: 'Help someone learn. Teach a new player, walk through a '
        + 'rules question after the match, or lend a deck. Never stand between '
        + 'someone and the fun of League.' },
      { note: 20, text: 'Trade fairly. Never pressure a younger or less '
        + 'experienced player into a lopsided trade. Fairness and consent are '
        + 'what make trading a positive part of League for everyone.' },
      { note: 21, text: 'Give back to the League some of what you gain from it. '
        + 'Volunteer to set up, break down, or run a side event, and offer the '
        + 'same welcome you got on your first day.' }
    ]
  }
];

const dutyId = (slug) => `duty-${slug}`;
const noteId = (n) => `note-${n}`;
const refId = (n) => `ref-${n}`;
const docId = (key) => `doc-${key}`;

// --- The three sections -------------------------------------------------------

function missionSection() {
  return el('section', { className: 'charter-mission', 'aria-labelledby': 'mission-heading' }, [
    el('h2', { id: 'mission-heading', className: 'charter-eyebrow', text: 'Our mission' }),
    el('p', { className: 'charter-statement', text: MISSION })
  ]);
}

// The word large, the definition under it, and the card linking down to what
// that value asks of us. The link is the word alone rather than the whole card:
// a card wrapped in an anchor makes the definition part of the link's name, and
// a four-line link is no use to anybody reading with their ears. The word is a
// block, so the tap target is still the full width of the card.
function valuesSection() {
  return el('section', { 'aria-labelledby': 'values-heading' }, [
    el('h2', { id: 'values-heading', className: 'charter-eyebrow', text: 'Our values' }),
    el('p', { className: 'field-help',
      text: 'Seven values, and what each one asks of us on a league day. Choose '
          + 'a value to jump to its responsibilities.' }),
    el('ul', { className: 'value-grid' }, VALUES.map((value) =>
      el('li', { className: 'value-card' }, [
        el('a', { className: 'value-word', href: `#${dutyId(value.slug)}`, text: value.word }),
        el('p', { className: 'value-meaning', text: value.meaning })
      ])))
  ]);
}

// The marker is a link into the appendix and carries an id of its own, so the
// source can send a reader back to the line that cited it. `aria-label` is what
// makes it usable: read aloud, a bare "1" in the middle of a sentence is noise.
// Every class on this page is `charter-`, because `.note-text` was already
// taken by the attendance history table's week note and redefining it there
// would silently restyle that. The names collided once; do not reuse them.
function marker(n) {
  return el('sup', { className: 'charter-note-ref' }, [
    el('a', { id: refId(n), href: `#${noteId(n)}`,
      'aria-label': `Source ${n}`, text: String(n) })
  ]);
}

function dutySection(value) {
  return el('section', { className: 'duty-set', 'aria-labelledby': dutyId(value.slug) }, [
    el('h3', { id: dutyId(value.slug), className: 'duty-heading', text: value.word }),
    el('ul', { className: 'duty-list' }, value.duties.map((duty) =>
      el('li', {}, [
        el('span', { text: duty.text }),
        marker(duty.note)
      ])))
  ]);
}

function responsibilitiesSection() {
  return el('section', { 'aria-labelledby': 'duties-heading' }, [
    el('h2', { id: 'duties-heading', className: 'charter-eyebrow', text: 'Our responsibilities' }),
    ...VALUES.map(dutySection)
  ]);
}

// --- The appendix -------------------------------------------------------------

// A source's pieces: strings stay text, mentions become links down to the
// document list. Nothing here goes out to pokemon.com -- one place holds the
// URLs, and that place is the bottom of the page.
function sourceBody(pieces) {
  return pieces.map((piece) => {
    if (typeof piece === 'string') return el('span', { text: piece });
    const doc = DOC_BY_KEY.get(piece.doc);
    return el('a', { href: `#${docId(piece.doc)}`, text: piece.text,
      title: doc ? `${doc.name}, listed below` : null });
  });
}

function sourcesSection() {
  return el('section', { 'aria-labelledby': 'sources-heading' }, [
    el('h2', { id: 'sources-heading', text: 'Appendix: sources' }),
    el('p', { className: 'field-help',
      text: 'Numbers correspond to the markers in the responsibilities above. '
          + 'Choose a number to go back to the line that cited it, or a document '
          + 'name to find it in the list at the foot of the page.' }),
    el('ol', { className: 'charter-note-list' }, SOURCES.map((pieces, index) => {
      const n = index + 1;
      return el('li', { id: noteId(n), className: 'charter-note-item' }, [
        el('a', { className: 'charter-note-number', href: `#${refId(n)}`,
          'aria-label': `Back to responsibility ${n}`, text: `${n}.` }),
        el('p', { className: 'charter-note-text' }, sourceBody(pieces))
      ]);
    }))
  ]);
}

function documentsSection() {
  return el('section', { 'aria-labelledby': 'documents-heading' }, [
    el('h2', { id: 'documents-heading', text: 'Referenced documents' }),
    el('ul', { className: 'charter-doc-list' }, DOCUMENTS.map((doc) =>
      el('li', { id: docId(doc.key), className: 'charter-doc-item' }, [
        el('a', { className: 'charter-doc-name', href: doc.href,
          target: '_blank', rel: 'noopener', text: doc.name }),
        doc.revised ? el('span', { className: 'charter-doc-rev', text: doc.revised }) : null,
        el('span', { className: 'charter-doc-host', text: doc.host })
      ])))
  ]);
}

function charter() {
  return [
    missionSection(),
    valuesSection(),
    responsibilitiesSection(),
    sourcesSection(),
    documentsSection(),
    el('p', { className: 'section-note',
      text: 'This charter is finished. It is here for the professors to read '
          + 'before it goes up for the league.' })
  ];
}

function notYet() {
  return [
    el('p', { className: 'notice notice-quiet',
      text: 'The league charter is not published yet. It will be here once the '
          + 'professors have put it in front of the league.' }),
    el('p', {}, [
      el('a', { href: 'index.html', text: 'Back to the home page' })
    ])
  ];
}

async function load() {
  try {
    const professor = await currentProfessor();
    host.replaceChildren(...(professor ? charter() : notYet()));
  } finally {
    host.removeAttribute('aria-busy');
  }
}

load();
mountProfessorBar();
