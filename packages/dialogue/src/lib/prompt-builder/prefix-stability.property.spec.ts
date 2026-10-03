import fc from 'fast-check';

import {
  compilePredicateRegistry,
  type EntityBinding,
  type Namer,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import type { EntityId, Proposition } from '@tradecraft/engine';

import {
  buildPrompt,
  estimateTokens,
  DEFAULT_TOKEN_BUDGET,
  type PromptInput,
  type PromptPersona,
  type RecentTurn,
  type ToldEntry,
} from './prompt-builder.js';

/**
 * Property 7: Prefix stability and budget.
 *
 * "For any two consecutive turns in a conversation with no knowledge or
 * cover-state change, prompt blocks 1–4 are byte-identical, and every prompt's
 * estimated token count is within budget." (design.md, Correctness Properties;
 * Validates: Requirements 15.1, 15.2.)
 *
 * The prompt is assembled static-to-dynamic (the design's Prompt Assembly
 * table). Blocks 1–4 — the global frame, the persona, the Knowledge Slice and
 * the Told List — change only when the NPC's knowledge or cover-state changes.
 * The dynamic tail (block 5 recent turns, block 6 current turn) changes every
 * turn. So across two consecutive turns that hold knowledge and cover fixed,
 * the head of the prompt up to the recent-turns marker must be byte-identical;
 * that stable prefix is what the inference server caches and reuses turn over
 * turn (Requirement 15.1). Separately, the builder trims recent turns then the
 * Told List until the prompt fits, so no assembled prompt may ever exceed the
 * token budget (Requirement 15.2).
 *
 * This test drives `buildPrompt` with generated conversations:
 *
 *   1. Prefix stability — fix the knowledge, cover-state, persona and Told List;
 *      take turn N and turn N+1 (the transcript grown by one exchange, a new
 *      player line) and assert the head preceding the recent-turns block is
 *      byte-identical. Generated conversations are kept inside budget so the
 *      head is blocks 1–4 at full size, never a trimmed variant.
 *   2. Budget — build the final turn against a range of budgets, including tight
 *      ones that force trimming, and assert the result is within budget and its
 *      reported token count matches its text.
 */

// ---------------------------------------------------------------------------
// Fixtures: a tiny predicate set and a namer, enough to render real sentences.
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

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([meetsAt, memberOf]);
  if (!result.ok) throw new Error('fixture predicates failed to compile');
  return result.registry;
}

const reg = registry();

const NAMES: Record<string, string> = {
  'npc:ana': 'Ana',
  'npc:viktor': 'Viktor',
  'org:ring': 'the Ring',
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

const membership: Proposition = {
  id: 'prop:member',
  subject: 'npc:ana',
  predicate: 'MEMBER_OF',
  object: 'org:ring',
};

const meeting: Proposition = {
  id: 'prop:meet',
  subject: 'npc:ana',
  predicate: 'MEETS_AT',
  object: 'npc:viktor',
  place: 'loc:pier',
  window: { from: { day: 2, phase: 2 } },
};

const KNOWN_ENTITIES: EntityId[] = [
  'npc:ana',
  'npc:viktor',
  'org:ring',
  'loc:pier',
];

/** The marker that begins block 5 (recent turns): everything before it is the
 * static-to-dynamic head, blocks 1–4. */
const RECENT_MARKER = '# Recent conversation';

/** The prefix of a prompt up to the recent-turns block: blocks 1–4. */
function prefix(text: string): string {
  const at = text.indexOf(RECENT_MARKER);
  // The head is always present: blocks 1–4 precede the recent-turns block.
  expect(at).toBeGreaterThan(0);
  return text.slice(0, at);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A line of player/NPC chat: short, bounded, with block-marker characters
// stripped so a generated turn can never forge a new section header.
const lineArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.replace(/[#\n]/gu, ' ').trim())
  .filter((s) => s.length > 0);

const turnArb: fc.Arbitrary<RecentTurn> = fc.record({
  speaker: fc.constantFrom<'player' | 'npc'>('player', 'npc'),
  text: lineArb,
});

// A whole conversation: the turn-invariant parts (knowledge, cover, Told List)
// plus a growing transcript the two consecutive turns slice from.
const conversationArb = fc.record({
  // Which facts the NPC knows — fixed across the two turns.
  known: fc.subarray([membership, meeting], { minLength: 0 }),
  // Which of them the NPC has already told the player — also fixed.
  toldMembership: fc.boolean(),
  toldMeeting: fc.boolean(),
  // The NPC's cover-state — fixed across the two consecutive turns.
  coverIntact: fc.boolean(),
  // The transcript grows by exactly one exchange between turn N and turn N+1.
  history: fc.array(turnArb, { minLength: 0, maxLength: 12 }),
  nextTurn: turnArb,
  playerLineA: lineArb,
  playerLineB: lineArb,
});

function toldListOf(c: {
  toldMembership: boolean;
  toldMeeting: boolean;
}): ToldEntry[] {
  return [
    ...(c.toldMembership ? [{ proposition: membership }] : []),
    ...(c.toldMeeting ? [{ proposition: meeting }] : []),
  ];
}

function sharedInput(c: {
  known: Proposition[];
  toldMembership: boolean;
  toldMeeting: boolean;
  coverIntact: boolean;
}): Omit<PromptInput, 'recentTurns' | 'playerLine'> {
  return {
    predicates: reg,
    namer,
    persona,
    coverIntact: c.coverIntact,
    knowledge: {
      known: c.known,
      falseBeliefs: [],
      knownEntities: KNOWN_ENTITIES,
    },
    toldList: toldListOf(c),
  };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 7: Prefix stability and budget (Req 15.1, 15.2)', () => {
  it('keeps blocks 1–4 byte-identical across consecutive turns with no knowledge/cover change', () => {
    fc.assert(
      fc.property(conversationArb, (c) => {
        const shared = sharedInput(c);

        // Turn N and turn N+1 differ only in the dynamic tail: the transcript
        // grows by one exchange and the player says a new line. Knowledge,
        // cover-state, persona and Told List are identical in both.
        const turnN = buildPrompt({
          ...shared,
          recentTurns: c.history,
          playerLine: c.playerLineA,
        });
        const turnNplus1 = buildPrompt({
          ...shared,
          recentTurns: [...c.history, c.nextTurn],
          playerLine: c.playerLineB,
        });

        // Blocks 1–4 are byte-identical: the server's prefix cache is reusable.
        expect(prefix(turnN.text)).toBe(prefix(turnNplus1.text));

        // The generated conversation stays within budget, so the stable head is
        // blocks 1–4 at full size rather than a trimmed Told List.
        expect(turnN.trim.toldListCompressed).toBe(false);
        expect(turnNplus1.trim.toldListCompressed).toBe(false);
        expect(turnN.tokens).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);
        expect(turnNplus1.tokens).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);
      }),
      { numRuns: 200 },
    );
  });

  it('keeps every assembled prompt within the token budget, trimming as needed', () => {
    fc.assert(
      fc.property(
        conversationArb,
        // A range of budgets, including tight ones that force trimming, but all
        // comfortably above this small fixture's untrimmable static floor.
        fc.integer({ min: 400, max: DEFAULT_TOKEN_BUDGET }),
        (c, budget) => {
          const input: PromptInput = {
            ...sharedInput(c),
            recentTurns: [...c.history, c.nextTurn],
            playerLine: c.playerLineB,
          };

          const built = buildPrompt(input, budget);

          // Within budget after trimming, and the reported count matches the
          // text actually returned.
          expect(built.tokens).toBeLessThanOrEqual(budget);
          expect(built.tokens).toBe(estimateTokens(built.text));
        },
      ),
      { numRuns: 200 },
    );
  });
});
