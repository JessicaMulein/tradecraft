import fc from 'fast-check';

import {
  compilePredicateRegistry,
  type Namer,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  predicateNamer,
  type Agenda,
  type CoverStory,
  type EntityId,
  type KnowledgeSlice,
  type NpcId,
  type NpcKnowledge,
  type Proposition,
  type SceneKind,
  type TalkScene,
  type WorldState,
} from '@tradecraft/engine';
import type {
  CallInput,
  CallKind,
  CallRequest,
  Gateway,
  NarrationStream,
  Role,
} from '@tradecraft/llm';
import type { ZodType } from 'zod';

import { buildVoiceSeam, type LiveSeamDeps } from './live-seams.js';
import {
  DEFAULT_TOKEN_BUDGET,
  estimateTokens,
} from '../prompt-builder/prompt-builder.js';
import { sliceKnowledge } from '../knowledge-slicer/knowledge-slicer.js';

/**
 * Property 56: Live prompt containment.
 *
 * "For any reachable state with an open Talk Scene and any player line: every
 * Proposition rendered into the live voice prompt belongs to the union of the
 * scene NPC's known Propositions, false beliefs, Cover Story, Told List and
 * Agenda promote list; the player's line appears only in `user` messages; and
 * the prompt's estimated token count is within the scenario's token budget."
 * (design.md, Property 56; Validates: Requirements 16.3, 16.5, 16.6.)
 *
 * This drives the *live voice seam* end to end offline. `buildVoiceSeam` builds
 * the NPC prompt with `buildPrompt` from the scene NPC's persona, Cover Story,
 * Agenda, Knowledge Slice, Told List and the scene's recent turns, then streams
 * a reply from the `voice`/`fast` role through the Refusal and Leak guards. The
 * test wires a capturing fake {@link Gateway} that records the chat messages the
 * seam sends and returns a benign, leak-free reply, so the seam completes on the
 * first attempt and the recorded messages are exactly the prompt the model would
 * see. It then asserts the three facets of the property against those messages:
 *
 *   1. Containment (Req 16.6, slice Property 5) — every Proposition sentence
 *      that appears in the system prompt traces back to a Proposition in the
 *      allowed union (known + false beliefs + Cover Story + Told List + Agenda
 *      promote). No sentence is invented for a Proposition the NPC does not hold,
 *      and a concealed Knowledge-Slice Proposition never reaches the prompt.
 *   2. Player line placement (Req 16.3) — the player's line appears only in a
 *      `user` message, never in the `system` prompt.
 *   3. Token budget (Req 16.5) — the system prompt's estimated token count is
 *      within the scenario's token budget.
 *
 * As in the Prompt Builder's own containment test, every Proposition in the
 * input space is generated to render to a *distinct, identifiable* sentence (a
 * unique object id woven into the second-person template), so the set of
 * Proposition sentences present in the prompt is exactly the set of allowed
 * sentences, and any stray sentence would be a Proposition from outside the
 * union. The sentence probe uses the same `predicateNamer(state)` and
 * `sliceKnowledge` path the seam's `buildPrompt` renders through, so the test
 * never second-guesses the renderer.
 */

// ---------------------------------------------------------------------------
// Fixtures: a predicate, a world the seam reads, and the scene NPC's knowledge.
// ---------------------------------------------------------------------------

const NPC: NpcId = 'npc:ana';

// A single predicate is enough: the second-person template renders only the
// {object}, so varying the object org id per proposition makes each rendered
// sentence unique and identifiable.
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
  id: NPC,
  name: 'Ana Vogel',
  background: 'A tired bookseller in the Inner City.',
  voiceTraits: ['dry'] as readonly string[],
  mannerisms: ['taps the counter'] as readonly string[],
};

/**
 * A minimal {@link WorldState} the voice seam reads: the scene NPC's persona,
 * the open Talk Scene, the Told List (`told[npc]`), the player's known-entity
 * set, and the registries the namer resolves against. Every other field the
 * full `WorldState` carries is irrelevant to `buildVoiceSeam`, so this is cast
 * through `unknown` — a spec-local stub, not a generated world.
 */
function worldState(told: readonly Proposition[], scene: TalkScene): WorldState {
  return {
    time: { day: 1, phase: 0 },
    city: { locations: { 'loc:shop': { id: 'loc:shop', name: 'The Bookshop' } } },
    orgs: {},
    npcs: { [NPC]: { id: NPC, persona } },
    told: { [NPC]: told },
    player: {
      loc: 'loc:shop',
      known: { entities: [] as readonly EntityId[], channels: [] },
      unkIds: {},
      scene,
    },
  } as unknown as WorldState;
}

/**
 * A fake Gateway that records every `stream` call's messages and returns a
 * benign, leak-free reply so both guards pass on the first attempt. The recorded
 * messages are the prompt the model would see; the first call carries the
 * un-reinforced prompt the seam built.
 */
class CapturingGateway implements Gateway {
  readonly calls: { role: Role; messages: CallInput }[] = [];

  stream(role: Role, input: CallInput): AsyncIterable<string> {
    this.calls.push({ role, messages: input });
    // A single sentence that names no registered entity: the Leak and Refusal
    // guards release it unchanged, so the seam completes on the first attempt.
    return (async function* () {
      yield 'The contact nods and says nothing in particular.';
    })();
  }
  structured<T>(_role: Role, _input: CallInput, _schema: ZodType<T>): Promise<T> {
    throw new Error('structured not used by the voice seam');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration not used by the voice seam');
  }
  describeCall<T>(
    _kind: CallKind,
    _role: Role,
    _input: CallInput,
    _schema?: ZodType<T>,
  ): CallRequest {
    throw new Error('describeCall not used by the voice seam');
  }
}

// ---------------------------------------------------------------------------
// Proposition generators: each proposition renders to a sentence unique to its
// source `tag`, so a sentence present in the prompt identifies its source.
// ---------------------------------------------------------------------------

function markedProp(tag: string, idx: number): Proposition {
  return {
    id: `prop:${tag}:${idx}`,
    subject: NPC,
    predicate: 'SAYS',
    object: `org:${tag}-${idx}` as EntityId,
  };
}

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
  // Index-based conceal selection over the Knowledge-Slice props.
  concealKnown: fc.array(fc.boolean(), { maxLength: 4 }),
  concealFalse: fc.array(fc.boolean(), { maxLength: 4 }),
  // Each run opens a fresh scene whose stakes pick the Model Role; both the
  // high-stakes `voice` and the routine `fast` route must contain the prompt.
  sceneKind: fc.constantFrom<SceneKind>(
    'routine',
    'interrogation',
    'recruitment-pitch',
    'confront-double-agent',
  ),
  // A distinctive player line: a `~`-fenced token that cannot occur incidentally
  // in the persona, frame or rendered sentences, so a substring scan of the
  // system prompt is a sound test of whether the line leaked out of the `user`
  // message (Req 16.3).
  playerLine: fc
    .string({ minLength: 1, maxLength: 60 })
    .map((s) => `~PLAYER~${s.replace(/[#\n~]/gu, ' ')}~END~`),
});

/** Drain the seam's streamed reply (ignored; the test asserts on the prompt). */
async function run(
  gateway: CapturingGateway,
  deps: LiveSeamDeps,
  line: string,
): Promise<void> {
  const seam = buildVoiceSeam(gateway, deps);
  await seam(line, 'small-talk', { npc: NPC, speakerName: 'Ana Vogel' });
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 56: Live prompt containment (Req 16.3, 16.5, 16.6)', () => {
  it('renders only allowed Propositions, keeps the player line to the user message, and stays within budget', async () => {
    await fc.assert(
      fc.asyncProperty(stateArb, async (state) => {
        const {
          known,
          falseBeliefs,
          coverPresents,
          promote,
          told,
          concealKnown,
          concealFalse,
          sceneKind,
          playerLine,
        } = state;

        // The Agenda conceal list: ids of Knowledge-Slice props to hide. Only
        // the Knowledge-Slice sources (known + falseBeliefs) can be concealed.
        const conceal: string[] = [
          ...known.filter((_, i) => concealKnown[i] === true),
          ...falseBeliefs.filter((_, i) => concealFalse[i] === true),
        ].map((p) => p.id);
        const concealSet = new Set(conceal);

        const slice: KnowledgeSlice = { known, falseBeliefs, knownEntities: [] };
        const coverStory: CoverStory = { presents: coverPresents };
        const agenda: Agenda = { conceal, promote, goals: ['stay calm'] };
        const npcKnowledge: NpcKnowledge = {
          knowledge: slice,
          cover: coverStory,
          agenda,
        };

        const scene: TalkScene = {
          npc: NPC,
          kind: sceneKind,
          openedAt: { day: 1, phase: 0 },
          via: 'talk',
          recent: [],
        };

        const stateValue = worldState(told, scene);
        const gateway = new CapturingGateway();
        const deps: LiveSeamDeps = {
          getState: () => stateValue,
          predicates: reg,
          npcKnowledge: (npc) => (npc === NPC ? npcKnowledge : undefined),
        };

        await run(gateway, deps, playerLine);

        // The seam always calls the gateway at least once; the first call is the
        // un-reinforced prompt the seam built.
        expect(gateway.calls.length).toBeGreaterThan(0);
        const first = gateway.calls[0];
        const messages = first.messages as readonly {
          role: string;
          content: string;
        }[];
        const system = messages.filter((m) => m.role === 'system');
        const user = messages.filter((m) => m.role === 'user');
        expect(system.length).toBe(1);
        expect(user.length).toBe(1);
        const systemText = system[0].content;

        // The same sentence probe the seam's `buildPrompt` renders through: the
        // state's own namer and the slicer, so the test never second-guesses the
        // renderer.
        const namer: Namer = predicateNamer(stateValue);
        const sentenceOf = (prop: Proposition): string =>
          sliceKnowledge({ known: [prop], falseBeliefs: [], knownEntities: [] }, reg, namer)
            .facts[0]?.sentence ?? '';

        // 2. Player line placement (Req 16.3): the player's line is the sole
        //    `user` message and never appears in the `system` prompt.
        expect(user[0].content).toBe(playerLine);
        expect(systemText.includes(playerLine)).toBe(false);

        // 3. Token budget (Req 16.5): the system prompt is within budget.
        expect(estimateTokens(systemText)).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);

        // 1. Containment (Req 16.6): every Proposition sentence present in the
        //    prompt is in the allowed union, and no concealed Knowledge-Slice
        //    proposition's sentence appears at all.
        const allowed: Proposition[] = [
          ...known.filter((p) => !concealSet.has(p.id)),
          ...falseBeliefs.filter((p) => !concealSet.has(p.id)),
          ...coverPresents,
          ...promote,
          ...told,
        ];
        const allowedSentences = new Set(allowed.map(sentenceOf));

        const everyProp: Proposition[] = [
          ...known,
          ...falseBeliefs,
          ...coverPresents,
          ...promote,
          ...told,
        ];
        for (const prop of everyProp) {
          const sentence = sentenceOf(prop);
          if (systemText.includes(sentence)) {
            expect(allowedSentences.has(sentence)).toBe(true);
          }
        }

        for (const prop of [...known, ...falseBeliefs]) {
          if (concealSet.has(prop.id)) {
            const sentence = sentenceOf(prop);
            expect(allowedSentences.has(sentence)).toBe(false);
            expect(systemText.includes(sentence)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
