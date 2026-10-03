/**
 * Feature: slice-integration, Property 43: Turn gates (task 8.6).
 *
 * **Validates: Requirements 7.7, 15.4**
 *
 * The design states (slice-integration design, "Property 43: Turn gates"):
 *
 * > For any ended state, every action's quote through the Engine API is
 * > disallowed with an ended reason, `act` leaves the state unchanged, and `say`
 * > makes no seam call. For any state with no open Talk Scene and any line,
 * > `say` makes no seam call and leaves the World State, stores and action log
 * > unchanged.
 *
 * This drives the real {@link createTurnDriver} pipeline behind the
 * {@link PlayerViewEngine} facade over real generated worlds. The two gates it
 * pins — the ended gate (design step 2; Req 7.7) and the no-scene gate (Req
 * 15.4) — both sit *before* any model touch, so a classify / voice seam wired
 * into the pipeline is a tripwire: the property asserts those seams are never
 * reached. The walk that reaches an ended state is **action-only** (no `say`),
 * so the ended state itself is produced with no model seam either.
 *
 *   - **Ended ⇒ `act` is gated (Req 7.7).** An action-only walk of `wait` turns
 *     drives any generated world to an End Condition — the slice Plot runs on
 *     its own schedule, so a long enough walk always ends the game, and the
 *     clock stops at the ending phase (early stop) with no scene opened (an
 *     advance stops at an End Condition *or* an opened scene, never both). Once
 *     ended, calling `act` with any action — however nonsensical its arguments
 *     — streams exactly a disallowed `fact` chunk carrying an ended reason, then
 *     `done`, and commits nothing: the committed state is the SAME reference (an
 *     immutable value, so a swap would change it) and the action log, Journal
 *     and Notifications are untouched. This is the Engine API's refusal of an
 *     action once the game is over — the "quote through the Engine API is
 *     disallowed with an ended reason" the design names.
 *
 *   - **Ended ⇒ `say` makes no seam call (Req 7.7).** With classify and voice
 *     seams wired as counting tripwires, calling `say` on the ended state makes
 *     zero seam calls and leaves every observable store at its pre-turn value.
 *     (An ended state reached through play carries no open Talk Scene, so the
 *     no-scene gate below is what refuses the line; either way, no model is
 *     touched and nothing commits.)
 *
 *   - **No open scene ⇒ `say` is rejected without a model call or a state
 *     change (Req 15.4).** On a fresh, live world — which opens with no Talk
 *     Scene — `say` streams a fixed line and `done`, makes zero classify / voice
 *     calls, and leaves the World State reference, action log, Journal and
 *     Notifications unchanged. Any line, and an optional offer, is refused the
 *     same way.
 *
 * These complement the example-based gate tests in `turn-pipeline.spec.ts`; the
 * property drives both gates across seeds, action kinds and lines rather than at
 * one hand-picked world.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  generate,
  ScenarioConfigSchema,
  type Action,
  type GenerateInputs,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  ActionLog,
  ExtractionQueue,
  createTurnDriver,
  type ClassifySeam,
  type TurnPipelineConfig,
  type VoiceSeam,
} from './turn-pipeline.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors turn-pipeline.spec.ts / the sibling properties)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed: string): WorldState {
  return generate(seed, inputs());
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

// ---------------------------------------------------------------------------
// Counting seams (tripwires)
// ---------------------------------------------------------------------------

/**
 * A classify / voice seam pair that counts how many times it is called. Both
 * gates fire before any model touch, so after a gated turn both counters must
 * still read zero. The seams succeed if ever reached — a reach is the failure,
 * not the rejection — so a non-zero count fails the property loudly.
 */
function countingSeams(): {
  classify: ClassifySeam;
  voice: VoiceSeam;
  calls: () => number;
} {
  let classifyCalls = 0;
  let voiceCalls = 0;
  const classify: ClassifySeam = () => {
    classifyCalls += 1;
    return Promise.resolve('ask');
  };
  const voice: VoiceSeam = () => {
    voiceCalls += 1;
    return Promise.resolve({ released: ['I never met him.'], speaker: 'The contact' });
  };
  return { classify, voice, calls: () => classifyCalls + voiceCalls };
}

/**
 * Build a facade over `state`, wired to a pipeline from `config`, returning the
 * facade and its observable stores (the shared action log so the pipeline's
 * writes are visible, plus the Journal and Notification store). No Outcome Sink
 * is wired: the ended walk's single end write goes nowhere, which is fine — this
 * property is about the gates, not the Outcome Record (Property 42 owns that).
 */
function makeEngine(state: WorldState, config: TurnPipelineConfig = {}) {
  const caseFile = new CaseFile();
  const journal = new Journal();
  const notifications = new NotificationStore();
  const actionLog = config.actionLog ?? new ActionLog();
  const extractionQueue = config.extractionQueue ?? new ExtractionQueue();
  const ctx: ResolverContext = { content };
  const turnDriver = createTurnDriver({ ...config, actionLog, extractionQueue });
  const engine = new PlayerViewEngine({
    state,
    caseFile,
    journal,
    cityData,
    ctx,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications,
    turnDriver,
  });
  return { engine, journal, notifications, actionLog };
}

/** Drain a turn stream into an array of chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/**
 * Walk an engine to its End Condition with an action-only walk of `wait` turns
 * (each advancing up to four phases). The slice Plot runs on its own schedule,
 * so a long walk ends any generated world; the clock stops at the ending phase
 * with no scene opened. Returns once ended; throws if the bound is somehow not
 * enough (so a regression that stops ending games fails loudly rather than
 * silently passing a vacuous property).
 */
async function walkToEnd(engine: PlayerViewEngine): Promise<void> {
  for (let i = 0; i < 200 && engine.state.ended === undefined; i += 1) {
    await drain(engine.act({ kind: 'wait', phases: 4 }));
  }
  if (engine.state.ended === undefined) {
    throw new Error('the action-only walk did not reach an End Condition within the bound');
  }
}

// ---------------------------------------------------------------------------
// Input-space arbitraries (bounded for CI)
// ---------------------------------------------------------------------------

/** A varied, non-empty seed set to sweep the generator over. */
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

const seedArb = fc.constantFrom(...SEEDS);

/**
 * A spread of action kinds — including nonsensical arguments — to show the
 * ended gate is kind-independent: it fires before `quote` or any simulation, so
 * even an action that would otherwise be disallowed or malformed is refused the
 * same way. The gate never inspects these, which is the point.
 */
const endedActionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.integer({ min: 1, max: 4 }).map((phases): Action => ({ kind: 'wait', phases: phases as 1 | 2 | 3 | 4 })),
  fc.constant<Action>({ kind: 'intercept' }),
  fc.constant<Action>({ kind: 'cable', body: { kind: 'funds' } }),
  fc.constant<Action>({ kind: 'cable', body: { kind: 'report', body: '' } }),
  fc
    .string()
    .map((to): Action => ({ kind: 'travel', to: `loc:${to}` as never, countersurveillance: false })),
  fc.string().map((at): Action => ({ kind: 'surveil', at: `loc:${at}` as never, phases: 1 })),
  fc.string().map((doc): Action => ({ kind: 'read', doc: `doc:${doc}` as never })),
);

/** Arbitrary dialogue lines, including the empty line. */
const lineArb = fc.string();

/** An optional, non-negative offer the no-scene gate must refuse before any check. */
const offerArb = fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined });

// ---------------------------------------------------------------------------
// Property 43 — Turn gates
// ---------------------------------------------------------------------------

describe('Property 43: Turn gates (Req 7.7, 15.4)', () => {
  it('once ended, act is refused with an ended reason and commits nothing, for any action', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.array(endedActionArb, { minLength: 1, maxLength: 4 }), async (seed, actions) => {
        const { engine, journal, notifications, actionLog } = makeEngine(world(seed));
        await walkToEnd(engine);

        // An ended state reached by play opens no Talk Scene (the advance stops
        // at an End Condition OR an opened scene, never both).
        expect(engine.state.player.scene).toBeUndefined();

        for (const action of actions) {
          const before = engine.state;
          const logLenBefore = actionLog.length;
          const journalBefore = journal.entryCount;
          const notifyBefore = notifications.count;

          const chunks = await drain(engine.act(action));

          // The stream is exactly a disallowed `fact` carrying an ended reason,
          // then `done` — no simulate, no narration, no `ended` re-emit.
          const kinds = chunks.map((c) => c.kind);
          expect(kinds).toEqual(['fact', 'done']);
          const fact = chunks[0];
          expect(fact?.kind === 'fact' && fact.text.toLowerCase()).toContain('over');

          // Nothing committed: the state is the SAME reference and every store
          // is untouched (Req 7.7 — no further action is taken once ended).
          expect(engine.state).toBe(before);
          expect(actionLog.length).toBe(logLenBefore);
          expect(journal.entryCount).toBe(journalBefore);
          expect(notifications.count).toBe(notifyBefore);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('once ended, say makes no model seam call and commits nothing', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, lineArb, async (seed, line) => {
        const seams = countingSeams();
        const { engine, journal, notifications, actionLog } = makeEngine(world(seed), {
          classify: seams.classify,
          voice: seams.voice,
        });
        await walkToEnd(engine);

        const before = engine.state;
        const logLenBefore = actionLog.length;
        const journalBefore = journal.entryCount;
        const notifyBefore = notifications.count;

        const chunks = await drain(engine.say(line));

        // No model was touched (Req 7.7 — an ended game accepts no dialogue
        // line), and nothing committed. The turn completes without pausing.
        expect(seams.calls()).toBe(0);
        expect(engine.state).toBe(before);
        expect(actionLog.length).toBe(logLenBefore);
        expect(journal.entryCount).toBe(journalBefore);
        expect(notifications.count).toBe(notifyBefore);
        const kinds = chunks.map((c) => c.kind);
        expect(kinds).not.toContain('speech');
        expect(kinds).not.toContain('paused');
        expect(kinds.at(-1)).toBe('done');
      }),
      { numRuns: 30 },
    );
  });

  it('with no open scene, say is rejected without a model call or a state change, for any line', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, lineArb, offerArb, async (seed, line, offer) => {
        const seams = countingSeams();
        const { engine, journal, notifications, actionLog } = makeEngine(world(seed), {
          classify: seams.classify,
          voice: seams.voice,
        });

        // A fresh generated world opens with no Talk Scene — the precondition of
        // the no-scene gate (Req 15.4).
        expect(engine.state.player.scene).toBeUndefined();

        const before = engine.state;
        const chunks = await drain(engine.say(line, offer === undefined ? undefined : { offer }));

        // The line is refused before any model touch: zero seam calls (Req
        // 15.4 — rejected without a model call) and the World State reference and
        // every store are unchanged (rejected without a state change).
        expect(seams.calls()).toBe(0);
        expect(engine.state).toBe(before);
        expect(actionLog.length).toBe(0);
        expect(journal.entryCount).toBe(0);
        expect(notifications.count).toBe(0);

        // The stream is a single fixed `fact` and `done`, never speech or a pause.
        const kinds = chunks.map((c) => c.kind);
        expect(kinds).toEqual(['fact', 'done']);
        expect(kinds).not.toContain('speech');
        expect(kinds).not.toContain('paused');
      }),
      { numRuns: 40 },
    );
  });
});
