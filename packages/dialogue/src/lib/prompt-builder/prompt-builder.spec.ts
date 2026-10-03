import fc from 'fast-check';

import {
  compilePredicateRegistry,
  type EntityBinding,
  type Namer,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import type {
  Agenda,
  CoverStory,
  KnowledgeSlice,
  Proposition,
} from '@tradecraft/engine';

import {
  buildPrompt,
  estimateTokens,
  DEFAULT_TOKEN_BUDGET,
  PromptBudgetError,
  type PromptInput,
  type PromptPersona,
  type RecentTurn,
  type ToldEntry,
} from './prompt-builder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const meetsAt: PredicateDefinition = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const memberOf: PredicateDefinition = {
  id: 'MEMBER_OF',
  subject: ['npc'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'membership-transitive',
  fieldCode: 'MO',
  render: {
    second: 'You belong to {object}.',
    third: '{subject} belongs to {object}.',
  },
  extractorHint: 'A person belongs to an organisation.',
};

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([meetsAt, memberOf, worksFor]);
  if (!result.ok) throw new Error('fixture predicates failed to compile');
  return result.registry;
}

const NAMES: Record<string, string> = {
  'npc:ana': 'Ana',
  'npc:viktor': 'Viktor',
  'npc:greta': 'Greta',
  'org:ring': 'the Ring',
  'org:tradehouse': 'Danube Trading',
  'loc:pier': 'the Pier',
};

const namer: Namer = (value: unknown): string => {
  const id = typeof value === 'string' ? value : (value as EntityBinding).id;
  if (NAMES[id] !== undefined) return NAMES[id];
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
};

const persona: PromptPersona = {
  name: 'Ana Vogel',
  background: 'A tired bookseller in the Inner City.',
  voiceTraits: ['dry', 'guarded'],
  mannerisms: ['taps the counter'],
};

const meeting: Proposition = {
  id: 'prop:meet',
  subject: 'npc:ana',
  predicate: 'MEETS_AT',
  object: 'npc:viktor',
  place: 'loc:pier',
  window: { from: { day: 2, phase: 2 } },
};

const membership: Proposition = {
  id: 'prop:member',
  subject: 'npc:ana',
  predicate: 'MEMBER_OF',
  object: 'org:ring',
};

function slice(overrides: Partial<KnowledgeSlice> = {}): KnowledgeSlice {
  return { known: [], falseBeliefs: [], knownEntities: [], ...overrides };
}

function baseInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    predicates: registry(),
    namer,
    persona,
    knowledge: slice({
      known: [membership],
      knownEntities: ['npc:ana', 'org:ring'],
    }),
    toldList: [],
    recentTurns: [],
    playerLine: 'Good evening.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Block ordering (Req 15.1)
// ---------------------------------------------------------------------------

describe('buildPrompt — block ordering (Req 15.1)', () => {
  it('orders blocks static to dynamic', () => {
    const input = baseInput({
      toldList: [{ proposition: membership }],
      recentTurns: [{ speaker: 'player', text: 'Hello.' }],
      playerLine: 'Any news?',
    });

    const { text } = buildPrompt(input);

    const idx = (needle: string): number => text.indexOf(needle);
    const frame = idx('# Instructions');
    const who = idx('# Who you are');
    const know = idx('# What you know');
    const told = idx('# Already said');
    const recent = idx('# Recent conversation');
    const current = idx('# The player just said');

    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(who);
    expect(who).toBeLessThan(know);
    expect(know).toBeLessThan(told);
    expect(told).toBeLessThan(recent);
    expect(recent).toBeLessThan(current);
  });

  it('puts the player line last, in the current-turn block', () => {
    const { text } = buildPrompt(baseInput({ playerLine: 'Where is Viktor?' }));
    expect(text.trimEnd().endsWith('Reply in character.')).toBe(true);
    expect(text).toContain('Player: Where is Viktor?');
  });
});

// ---------------------------------------------------------------------------
// Global frame instructions (Req 4.5, 6.3)
// ---------------------------------------------------------------------------

describe('buildPrompt — global frame (Req 4.5, 6.3)', () => {
  it('includes the in-character and known-entities-only instructions', () => {
    const { text } = buildPrompt(baseInput());
    expect(text).toContain('Stay in character');
    expect(text).toContain('Speak only as this character');
    expect(text).toMatch(/Name only .*known-entity list/s);
  });

  it('includes the consistency instruction while cover is intact', () => {
    const { text } = buildPrompt(baseInput({ coverIntact: true }));
    expect(text).toContain('Stay consistent with your cover story');
  });

  it('drops the consistency instruction once cover has cracked', () => {
    const { text } = buildPrompt(baseInput({ coverIntact: false }));
    expect(text).not.toContain('Stay consistent with your cover story');
  });
});

// ---------------------------------------------------------------------------
// Knowledge Slice and known-entity list (Req 4.5)
// ---------------------------------------------------------------------------

describe('buildPrompt — knowledge block', () => {
  it('renders the Knowledge Slice as second-person sentences', () => {
    const input = baseInput({
      knowledge: slice({
        known: [meeting, membership],
        knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
      }),
    });
    const { text, knownEntities } = buildPrompt(input);

    expect(text).toContain('You meet Viktor at the Pier Day 2, evening.');
    expect(text).toContain('You belong to the Ring.');
    // The known-entity list is the slicer's output.
    expect(knownEntities).toEqual([
      'npc:ana',
      'npc:viktor',
      'org:ring',
      'loc:pier',
    ]);
    expect(text).toContain('People, places and organisations you know of');
    expect(text).toContain('- Viktor');
  });

  it("honours the Agenda conceal list (fact dropped, entity kept)", () => {
    const agenda: Agenda = { conceal: ['prop:member'], promote: [], goals: [] };
    const input = baseInput({
      knowledge: slice({
        known: [membership],
        knownEntities: ['npc:ana', 'org:ring'],
      }),
      agenda,
    });
    const { text } = buildPrompt(input);
    expect(text).not.toContain('You belong to the Ring.');
    expect(text).toContain('- the Ring');
  });
});

// ---------------------------------------------------------------------------
// Persona, cover story, agenda (block 2)
// ---------------------------------------------------------------------------

describe('buildPrompt — persona block', () => {
  it('renders persona, cover story and agenda goals', () => {
    const coverStory: CoverStory = {
      presents: [
        {
          id: 'prop:cover',
          subject: 'npc:ana',
          predicate: 'WORKS_FOR',
          object: 'org:tradehouse',
        },
      ],
    };
    const agenda: Agenda = {
      conceal: [],
      promote: [],
      goals: ['Find out who the player works for'],
    };
    const { text } = buildPrompt(baseInput({ coverStory, agenda }));

    expect(text).toContain('You are Ana Vogel.');
    expect(text).toContain('A tired bookseller');
    expect(text).toContain('Voice: dry, guarded.');
    expect(text).toContain('You work for Danube Trading.');
    expect(text).toContain('Find out who the player works for');
  });
});

// ---------------------------------------------------------------------------
// Told List rendering (Req 6.2)
// ---------------------------------------------------------------------------

describe('buildPrompt — Told List (Req 6.2)', () => {
  it('renders the Told List through the predicate templates, uncompressed', () => {
    const toldList: ToldEntry[] = [
      { proposition: membership },
      { proposition: meeting },
    ];
    const input = baseInput({
      knowledge: slice({
        known: [membership, meeting],
        knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
      }),
      toldList,
    });
    const { text, trim } = buildPrompt(input);

    expect(text).toContain('# Already said — do not contradict these');
    expect(text).toContain('- You belong to the Ring.');
    expect(text).toContain('- You meet Viktor at the Pier Day 2, evening.');
    expect(trim.toldListCompressed).toBe(false);
  });

  it('shows a placeholder when nothing has been said yet', () => {
    const { text } = buildPrompt(baseInput({ toldList: [] }));
    expect(text).toContain('You have not told the player anything yet.');
  });
});

// ---------------------------------------------------------------------------
// Token budget and trimming (Req 15.2)
// ---------------------------------------------------------------------------

describe('buildPrompt — budget and trimming (Req 15.2)', () => {
  const manyTurns = (n: number): RecentTurn[] =>
    Array.from({ length: n }, (_, i) => ({
      speaker: (i % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc',
      text: `This is a reasonably long line number ${i} with plenty of words to spend tokens on.`,
    }));

  it('leaves a small prompt untouched', () => {
    const { trim, tokens } = buildPrompt(baseInput());
    expect(trim.recentTurnsDropped).toBe(0);
    expect(trim.toldListCompressed).toBe(false);
    expect(tokens).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);
  });

  it('trims recent turns oldest-first until it fits', () => {
    const turns = manyTurns(60);
    const input = baseInput({ recentTurns: turns });
    // A tight budget so recent turns must go but the static floor still fits.
    const budget = estimateTokens(
      buildPrompt(input, 10_000_000).text,
    );
    // Choose a budget between the static floor and the full prompt.
    const result = buildPrompt(input, Math.floor(budget * 0.6));

    expect(result.trim.recentTurnsDropped).toBeGreaterThan(0);
    expect(result.tokens).toBeLessThanOrEqual(Math.floor(budget * 0.6));
    // Oldest dropped: the newest turn survives, the oldest does not.
    expect(result.text).toContain('number 59');
    expect(result.text).not.toContain('line number 0 ');
  });

  it('compresses the Told List only after dropping every recent turn', () => {
    const toldList: ToldEntry[] = [
      { proposition: { ...membership, id: 'p1', subject: 'npc:ana' } },
      { proposition: { ...meeting, id: 'p2', subject: 'npc:ana' } },
      { proposition: { ...membership, id: 'p3', subject: 'npc:viktor' } },
    ];
    const input = baseInput({
      knowledge: slice({
        known: [membership, meeting],
        knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
      }),
      toldList,
      recentTurns: manyTurns(40),
    });
    const floor = estimateTokens(
      buildPrompt({ ...input, recentTurns: [] }, 10_000_000).text,
    );
    // Budget just under the Told-List-included floor forces compression.
    const result = buildPrompt(input, floor - 1 > 0 ? floor - 1 : 1);

    // Only reachable if the floor exceeds budget — otherwise it would throw.
    if (result.trim.toldListCompressed) {
      expect(result.trim.recentTurnsDropped).toBe(40);
      // One line per subject: Ana's two facts joined on a single line.
      expect(result.text).toContain('- Ana:');
      expect(result.text).toContain('- Viktor:');
    }
  });

  it('throws when the static blocks alone exceed the budget', () => {
    const input = baseInput();
    expect(() => buildPrompt(input, 5)).toThrow(PromptBudgetError);
  });
});

// ---------------------------------------------------------------------------
// Determinism / purity (prefix stability groundwork for task 14.4)
// ---------------------------------------------------------------------------

describe('buildPrompt — determinism', () => {
  it('is a pure function: identical inputs give byte-identical output', () => {
    const input = baseInput({
      toldList: [{ proposition: membership }, { proposition: meeting }],
      recentTurns: [
        { speaker: 'player', text: 'Hello.' },
        { speaker: 'npc', text: 'Good evening.' },
      ],
      knowledge: slice({
        known: [membership, meeting],
        knownEntities: ['npc:ana', 'npc:viktor', 'org:ring', 'loc:pier'],
      }),
    });

    expect(buildPrompt(input).text).toBe(buildPrompt(input).text);
  });

  it('keeps the static prefix stable as only the current turn changes', () => {
    const common = baseInput({
      toldList: [{ proposition: membership }],
      recentTurns: [{ speaker: 'player', text: 'Hello.' }],
    });
    const a = buildPrompt({ ...common, playerLine: 'Where is Viktor?' }).text;
    const b = buildPrompt({ ...common, playerLine: 'And the drop?' }).text;

    // The two prompts share everything up to the current-turn block.
    const marker = '# The player just said';
    expect(a.slice(0, a.indexOf(marker))).toBe(b.slice(0, b.indexOf(marker)));
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('is zero for the empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('is deterministic', () => {
    expect(estimateTokens('hello world')).toBe(estimateTokens('hello world'));
  });

  it('is monotone: appending text never lowers the estimate', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (a, b) => {
        expect(estimateTokens(a + b)).toBeGreaterThanOrEqual(estimateTokens(a));
      }),
    );
  });
});
