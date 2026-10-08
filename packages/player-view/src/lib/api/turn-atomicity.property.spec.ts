/**
 * Property 29: Turn atomicity (design, "Correctness Properties"; task 16.9).
 *
 * **Validates: Requirements 16.4, 42.1, 42.4.**
 *
 * > For any pre-turn state and turn, injecting a failure at any model call
 * > before commit leaves the World State, Truth Store, PRNG state, action log,
 * > Journal and Notifications deep-equal to their pre-turn values. Retrying with
 * > successful responses yields the same post-turn state as an uninterrupted
 * > run. (design, Property 29)
 *
 * The Turn Pipeline runs each turn as one Turn Transaction: a dialogue line's
 * only model-touching steps (classify, voice) run *before* commit, so a
 * rejection there must discard the whole draft and leave every observable store
 * at its pre-turn value and `paused` the turn for retry (Req 16.4, 42.1, 42.4);
 * an action's only model step (the Narrator) runs *after* commit, so a Narrator
 * rejection leaves the committed fact-only turn intact (Req 42.6 — the
 * post-commit side of the atomicity boundary).
 *
 * This property drives the real {@link createTurnDriver} pipeline behind the
 * {@link PlayerViewEngine} facade over real generated worlds, with the
 * model-touching seams supplied as injected functions so the pipeline runs
 * model-free and deterministic. It sweeps seeds, both turn kinds (act / say),
 * and injected seam failures (classify reject, voice reject, narrate reject),
 * and asserts the all-or-nothing invariant:
 *
 *  - capture `(state ref, action-log length, journal entry count, notification
 *    count)` before the turn;
 *  - after a FAILED pre-commit turn, assert all four are unchanged and the
 *    stream `interrupted` then `paused`;
 *  - after a SUCCESS, assert the commit is coherent (an action advanced the
 *    clock and grew the log; a dialogue line grew the log and streamed speech);
 *  - a post-commit Narrator rejection still leaves the action's commit intact
 *    (fact-only), never rolled back;
 *  - `retry()` after a paused turn re-runs from the retained pre-turn state and
 *    is deterministic: two independent engines paused at the same pre-turn state
 *    and retried with the same successful seams reach the same observable
 *    commit.
 *
 * These complement the example-based pipeline tests in `turn-pipeline.spec.ts`;
 * the property drives the same seams across the input space rather than at one
 * hand-picked world.
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
  type NpcId,
  type ResolverContext,
  type TalkScene,
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
  type TurnPipelineConfig,
  type VoiceSeam,
} from './turn-pipeline.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors turn-pipeline.spec.ts)
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

function scenario(ambient = false) {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    ...(ambient ? { ambient: { enabled: true, density: 'sparse' as const } } : {}),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(ambient = false): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(ambient), cityData, descriptors, publicTexts };
}

function world(seed: string, ambient = false): WorldState {
  return generate(seed, inputs(ambient));
}

/**
 * Open a routine Talk Scene with the world's first NPC, the precondition a
 * dialogue (`say`) turn now requires (Req 15.4). An action (`act`) turn is
 * unaffected by an open scene, so the same seeded world serves both turn kinds.
 */
function withScene(state: WorldState): WorldState {
  const [npc] = Object.keys(state.npcs) as NpcId[];
  if (npc === undefined) throw new Error('generated world has no NPCs');
  const scene: TalkScene = {
    npc,
    kind: 'routine',
    openedAt: state.time,
    via: 'talk',
    recent: [],
  };
  return { ...state, player: { ...state.player, scene } };
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/** A wait action is always allowed, costs a phase and advances the clock. */
const WAIT: Action = { kind: 'wait', phases: 1 };

/**
 * Build a facade over a fresh world (at `seed`), wired to a pipeline from
 * `config`, returning the facade and its observable stores. The two pipeline
 * stores default to fresh instances the config shares, so a caller can observe
 * the action log the pipeline writes.
 */
function makeEngine(seed: string, config: TurnPipelineConfig = {}, ambient = false) {
  const state = withScene(world(seed, ambient));
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
 * The four observable values the atomicity invariant pins: the committed state
 * reference, the action-log length, the Journal entry count and the delivered
 * Notification count. A pre-commit failure must leave all four at their
 * pre-turn values.
 */
interface Snapshot {
  readonly state: WorldState;
  readonly logLength: number;
  readonly journalEntries: number;
  readonly notificationCount: number;
}

function snapshot(
  engine: PlayerViewEngine,
  journal: Journal,
  notifications: NotificationStore,
  actionLog: ActionLog,
): Snapshot {
  return {
    state: engine.state,
    logLength: actionLog.length,
    journalEntries: journal.entryCount,
    notificationCount: notifications.count,
  };
}

// ---------------------------------------------------------------------------
// Seams and failure injection
// ---------------------------------------------------------------------------

/** A classifier that always succeeds (labels every line the same). */
const okClassify: TurnPipelineConfig['classify'] = () => Promise.resolve('ask');

/** A voice seam that always succeeds with a fixed reply. */
const okVoice: VoiceSeam = () =>
  Promise.resolve({ released: ['I never met him.'], speaker: 'The contact' });

/** A Narrator seam that always succeeds with a fixed flavour line. */
const okNarrate: TurnPipelineConfig['narrate'] = () =>
  Promise.resolve(['A grey drizzle settles over the quay.']);

/** The pre-commit seam a `say` turn can fail at. */
type PreCommitSeam = 'classify' | 'voice';

/** Build a config whose named pre-commit seam rejects; the rest succeed. */
function failingSayConfig(seam: PreCommitSeam): TurnPipelineConfig {
  return {
    classify: seam === 'classify' ? () => Promise.reject(new Error('classifier down')) : okClassify,
    voice: seam === 'voice' ? () => Promise.reject(new Error('endpoint unreachable')) : okVoice,
  };
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
const preCommitSeamArb = fc.constantFrom<PreCommitSeam>('classify', 'voice');

// ---------------------------------------------------------------------------
// Property 29 — Turn atomicity
// ---------------------------------------------------------------------------

describe('Property 29: Turn atomicity (Req 16.4, 42.1, 42.4)', () => {
  it('leaves every observable store at its pre-turn value when a dialogue model call fails before commit', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, preCommitSeamArb, fc.boolean(), async (seed, seam, ambient) => {
        const { engine, journal, notifications, actionLog } = makeEngine(
          seed,
          failingSayConfig(seam),
          ambient,
        );

        const before = snapshot(engine, journal, notifications, actionLog);
        const chunks = await drain(engine.say('Tell me about the courier.'));
        const after = snapshot(engine, journal, notifications, actionLog);

        // All-or-nothing: a pre-commit failure commits nothing. The state is the
        // SAME reference (an immutable value, so a swap would change it), and the
        // action log, Journal and Notifications are all unchanged (Req 42.1, 42.4).
        expect(after.state).toBe(before.state);
        expect(after.logLength).toBe(before.logLength);
        expect(after.journalEntries).toBe(before.journalEntries);
        expect(after.notificationCount).toBe(before.notificationCount);

        // The stream told the UI to drop the attempt and that the turn is paused.
        const kinds = chunks.map((c) => c.kind);
        expect(kinds).toContain('interrupted');
        expect(kinds).toContain('paused');
        // Nothing was committed, so no speech reached the UI.
        expect(kinds).not.toContain('speech');
      }),
      { numRuns: 40 },
    );
  });

  it('commits coherently when an action turn succeeds (state advanced, action log grew together)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.boolean(), async (seed, ambient) => {
        const { engine, journal, notifications, actionLog } = makeEngine(seed, {
          narrate: okNarrate,
        }, ambient);

        const before = snapshot(engine, journal, notifications, actionLog);
        const chunks = await drain(engine.act(WAIT));
        const after = snapshot(engine, journal, notifications, actionLog);

        // The whole transaction committed together: the clock advanced (a new
        // state value), and the action-log grew with it. Journal and
        // Notifications never go backwards.
        expect(after.state).not.toBe(before.state);
        expect(after.state.time).not.toEqual(before.state.time);
        expect(after.logLength).toBeGreaterThan(before.logLength);
        expect(after.journalEntries).toBeGreaterThanOrEqual(before.journalEntries);
        expect(after.notificationCount).toBeGreaterThanOrEqual(before.notificationCount);

        // The committed action is in the log at the advanced time.
        const actionEntry = actionLog.all().find((e) => e.kind === 'action');
        expect(actionEntry).toBeDefined();
        expect(actionEntry?.at).toEqual(after.state.time);

        // A successful turn ends with `done` and never pauses.
        const kinds = chunks.map((c) => c.kind);
        expect(kinds.at(-1)).toBe('done');
        expect(kinds).not.toContain('paused');
      }),
      { numRuns: 40 },
    );
  });

  it('commits coherently when a dialogue turn succeeds (log grew, speech streamed, nothing paused)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.boolean(), async (seed, ambient) => {
        const { engine, journal, notifications, actionLog } = makeEngine(seed, {
          classify: okClassify,
          voice: okVoice,
        }, ambient);

        const before = snapshot(engine, journal, notifications, actionLog);
        const chunks = await drain(engine.say('Tell me about the courier.'));
        const after = snapshot(engine, journal, notifications, actionLog);

        // The dialogue line committed: the action log grew by its `line` entry,
        // and the Journal/Notifications never go backwards.
        expect(after.logLength).toBeGreaterThan(before.logLength);
        expect(after.journalEntries).toBeGreaterThanOrEqual(before.journalEntries);
        expect(after.notificationCount).toBeGreaterThanOrEqual(before.notificationCount);
        expect(actionLog.all().some((e) => e.kind === 'line')).toBe(true);

        const kinds = chunks.map((c) => c.kind);
        expect(kinds).toContain('speech');
        expect(kinds.at(-1)).toBe('done');
        expect(kinds).not.toContain('paused');
      }),
      { numRuns: 40 },
    );
  });

  it('keeps the action commit intact when the Narrator fails after commit (fact-only, never rolled back)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.boolean(), async (seed, ambient) => {
        const { engine, journal, notifications, actionLog } = makeEngine(seed, {
          narrate: () => Promise.reject(new Error('narrator timeout')),
        }, ambient);

        const before = snapshot(engine, journal, notifications, actionLog);
        const chunks = await drain(engine.act(WAIT));
        const after = snapshot(engine, journal, notifications, actionLog);

        // A post-commit failure never rolls back: the state still advanced and
        // the action-log still grew (Req 42.6 — the post-commit side of the
        // atomicity boundary).
        expect(after.state).not.toBe(before.state);
        expect(after.state.time).not.toEqual(before.state.time);
        expect(after.logLength).toBeGreaterThan(before.logLength);

        // The turn is fact-only (no flavour) but completes normally — it never
        // pauses, because the commit already stands.
        const kinds = chunks.map((c) => c.kind);
        expect(kinds).not.toContain('flavour');
        expect(kinds).not.toContain('paused');
        expect(kinds.at(-1)).toBe('done');
      }),
      { numRuns: 40 },
    );
  });

  it('retries a paused turn from the pre-turn state deterministically', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.boolean(), async (seed, ambient) => {
        // Two independent engines at the same seed. Each fails its first `say`
        // (voice rejects), pausing at the pre-turn state, then retries with the
        // same successful seams. A deterministic retry from the retained
        // pre-turn state must reach the same observable commit on both.
        function pauseThenRetry() {
          let attempt = 0;
          const voice: TurnPipelineConfig['voice'] = () => {
            attempt += 1;
            if (attempt === 1) return Promise.reject(new Error('endpoint unreachable'));
            return okVoice('', 'ask', { npc: 'npc:x' as NpcId, speakerName: 'The contact' });
          };
          return makeEngine(seed, { classify: okClassify, voice }, ambient);
        }

        const a = pauseThenRetry();
        const b = pauseThenRetry();

        const preA = a.engine.state;
        await drain(a.engine.say('Tell me about the courier.'));
        await drain(b.engine.say('Tell me about the courier.'));

        // Paused: nothing committed, the pre-turn state retained on both.
        expect(a.engine.state).toBe(preA);
        expect(a.actionLog.length).toBe(0);
        expect(b.actionLog.length).toBe(0);

        const retryA = await drain(a.engine.retry());
        const retryB = await drain(b.engine.retry());

        // The retry re-ran from the pre-turn state and committed cleanly: the
        // dialogue line is logged exactly once (the retry's commit), speech
        // streamed, and the turn completed.
        expect(a.actionLog.all().filter((e) => e.kind === 'line')).toHaveLength(1);
        expect(retryA.some((c) => c.kind === 'speech')).toBe(true);
        expect(retryA.at(-1)?.kind).toBe('done');

        // Determinism: two independent runs from the same pre-turn state reach
        // the same observable commit — same action-log shape and the same
        // committed stream.
        expect(a.actionLog.all()).toEqual(b.actionLog.all());
        expect(a.engine.state).toEqual(b.engine.state);
        expect(retryA).toEqual(retryB);
      }),
      { numRuns: 30 },
    );
  });
});
