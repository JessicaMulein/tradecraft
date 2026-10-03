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
  EntityId,
  KnowledgeSlice,
  Proposition,
} from '@tradecraft/engine';

import { buildPrompt, type PromptInput, type ToldEntry } from './prompt-builder.js';
import { sliceKnowledge } from '../knowledge-slicer/knowledge-slicer.js';

/**
 * Property 5: Knowledge containment.
 *
 * "For any NPC and state, every Proposition rendered into that NPC's prompt
 * belongs to the union of the NPC's known Propositions, false beliefs, Cover
 * Story, Told List and Agenda promote list." (design.md, Correctness
 * Properties; Validates: Requirements 4.1, 5.1.)
 *
 * The Prompt Builder renders Propositions in four places — the Knowledge Slice
 * block (known + false beliefs, concealed facts dropped), the Cover Story lines
 * in the persona block, the Agenda `promote` lines in the persona block, and
 * the Told List block. The test fixes those four sources as the only Proposition
 * sources, generates arbitrary states over them, builds the prompt, and asserts
 * two things:
 *
 *   1. Containment — every Proposition sentence that appears in the prompt
 *      traces back to a Proposition in the allowed union. No sentence is
 *      invented for a Proposition the NPC does not hold.
 *   2. Concealment — a Knowledge-Slice Proposition on the Agenda `conceal` list
 *      never has its sentence appear in the prompt (Requirement 5.1): a secret
 *      the NPC must not reveal cannot reach the model.
 *
 * The containment check works because every Proposition in the input space is
 * generated to render to a *distinct, identifiable* sentence (its id is woven
 * into the sentence text through a per-proposition predicate). So the set of
 * Proposition sentences present in the prompt is exactly the set of allowed
 * sentences, and any stray sentence would be a Proposition from outside the
 * union.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTITIES = ['npc:ana', 'npc:viktor', 'npc:greta'] as const;
const ORGS = ['org:ring', 'org:tradehouse'] as const;

const NAMES: Record<string, string> = {
  'npc:ana': 'Ana',
  'npc:viktor': 'Viktor',
  'npc:greta': 'Greta',
  'org:ring': 'the Ring',
  'org:tradehouse': 'Danube Trading',
};

const namer: Namer = (value: unknown): string => {
  const id = typeof value === 'string' ? value : (value as EntityBinding).id;
  if (NAMES[id] !== undefined) return NAMES[id];
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
};

// A single predicate is enough: the proposition's *subject* carries the unique
// marker that makes each rendered sentence identifiable (see `markedProp`).
const says: PredicateDefinition = {
  id: 'SAYS',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'SY',
  render: {
    second: 'You are tied to {object}.',
    third: '{subject} is tied to {object}.',
  },
  extractorHint: 'A person is tied to an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([says]);
  if (!result.ok) throw new Error('fixture predicate failed to compile');
  return result.registry;
}

const reg = registry();

const persona = {
  name: 'Ana Vogel',
  background: 'A tired bookseller in the Inner City.',
  voiceTraits: ['dry'],
  mannerisms: ['taps the counter'],
};

/**
 * The exact sentence `buildPrompt` renders a Proposition to — computed through
 * the same `sliceKnowledge` path the builder uses, so the test never second-
 * guesses the renderer. This is the canonical "did this Proposition reach the
 * prompt?" probe.
 */
function sentenceOf(prop: Proposition): string {
  const view = sliceKnowledge(
    { known: [prop], falseBeliefs: [], knownEntities: [] },
    reg,
    namer,
  );
  return view.facts[0]?.sentence ?? '';
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A Proposition whose rendered sentence is unique to its `tag`. The tag is
 * carried as the subject entity id so the second-person template ("You are tied
 * to {object}.") does not itself distinguish props — instead we vary the
 * *object* org and the id, and we assert containment by id-bearing sentences.
 *
 * To make each proposition's rendered text distinct we encode the tag into a
 * synthetic unknown-entity object id, which the namer renders verbatim.
 */
function markedProp(tag: string, idx: number): Proposition {
  const uniqueOrg = `org:${tag}-${idx}` as EntityId;
  return {
    id: `prop:${tag}:${idx}`,
    subject: 'npc:ana' as EntityId,
    predicate: 'SAYS',
    object: uniqueOrg,
  };
}

/** An arbitrary short list of marked propositions for one source `tag`. */
function propsArb(tag: string): fc.Arbitrary<Proposition[]> {
  return fc
    .integer({ min: 0, max: 4 })
    .map((n) => Array.from({ length: n }, (_, i) => markedProp(tag, i)));
}

const stateArb = fc.record({
  known: propsArb('known'),
  falseBeliefs: propsArb('false'),
  coverPresents: propsArb('cover'),
  promote: propsArb('promote'),
  told: propsArb('told'),
  // Index-based conceal selection over the Knowledge-Slice props, applied below.
  concealKnown: fc.array(fc.boolean(), { maxLength: 4 }),
  concealFalse: fc.array(fc.boolean(), { maxLength: 4 }),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 5: Knowledge containment (Req 4.1, 5.1)', () => {
  it('renders only Propositions from the known/false/cover/told/promote union, and never a concealed one', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const {
          known,
          falseBeliefs,
          coverPresents,
          promote,
          told,
          concealKnown,
          concealFalse,
        } = state;

        // The Agenda conceal list: ids of Knowledge-Slice props to hide.
        const conceal: string[] = [
          ...known.filter((_, i) => concealKnown[i] === true),
          ...falseBeliefs.filter((_, i) => concealFalse[i] === true),
        ].map((p) => p.id);
        const concealSet = new Set(conceal);

        const knownEntities: EntityId[] = [...ENTITIES, ...ORGS];

        const coverStory: CoverStory = { presents: coverPresents };
        const agenda: Agenda = { conceal, promote, goals: ['stay calm'] };
        const toldList: ToldEntry[] = told.map((p) => ({ proposition: p }));

        const slice: KnowledgeSlice = { known, falseBeliefs, knownEntities };

        const input: PromptInput = {
          predicates: reg,
          namer,
          persona,
          coverStory,
          agenda,
          knowledge: slice,
          toldList,
          recentTurns: [],
          playerLine: 'Good evening.',
        };

        const { text } = buildPrompt(input);

        // The allowed union of Propositions, minus concealed ones. Concealment
        // only applies to the Knowledge-Slice sources (known + falseBeliefs);
        // Cover Story, Told List and promote are always allowed to render.
        const allowed: Proposition[] = [
          ...known.filter((p) => !concealSet.has(p.id)),
          ...falseBeliefs.filter((p) => !concealSet.has(p.id)),
          ...coverPresents,
          ...promote,
          ...told,
        ];
        const allowedSentences = new Set(allowed.map(sentenceOf));

        // Every proposition we generated anywhere, so we can scan the prompt
        // for *any* proposition sentence and check it is in the allowed set.
        const everyProp: Proposition[] = [
          ...known,
          ...falseBeliefs,
          ...coverPresents,
          ...promote,
          ...told,
        ];

        // 1. Containment: any proposition sentence present in the prompt is in
        //    the allowed union. (A sentence present but not allowed = a leak.)
        for (const prop of everyProp) {
          const sentence = sentenceOf(prop);
          if (text.includes(sentence)) {
            expect(allowedSentences.has(sentence)).toBe(true);
          }
        }

        // 2. Concealment (Req 5.1): no concealed Knowledge-Slice proposition's
        //    sentence appears anywhere in the prompt — unless that exact
        //    sentence is independently allowed via another source (cover/told/
        //    promote), which the generated ids keep disjoint by construction.
        for (const prop of [...known, ...falseBeliefs]) {
          if (concealSet.has(prop.id)) {
            const sentence = sentenceOf(prop);
            // Concealed Knowledge-Slice props are generated with 'known'/'false'
            // tags; cover/told/promote use disjoint tags, so an allowed
            // sentence can never equal a concealed one. The concealed sentence
            // must be absent.
            expect(allowedSentences.has(sentence)).toBe(false);
            expect(text.includes(sentence)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
