/**
 * Whole-system ambient properties that read the player-facing session.
 *
 * Property 1: determinism, a scrambled wall clock, save/load and replay.
 * Property 2: ambient disabled matches a world generated with no ambient block.
 * Property 21: a model failure before commit leaves ambient unchanged, and a
 * retry matches an uninterrupted turn.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentManifest,
  type DifficultyPreset,
} from '@tradecraft/content';
import {
  ScenarioConfigSchema,
  ambientDayBoundary,
  ambientPhase,
  createPrng,
  generate,
  quote,
  resolve,
  type Action,
  type GenerateInputs,
  type NpcId,
  type ResolverContext,
  type TalkScene,
  type WorldState,
} from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PlayerViewEngine } from '../api/engine-api.js';
import { ActionLog, ExtractionQueue, createTurnDriver, type TurnPipelineConfig } from '../api/turn-pipeline.js';
import type { TurnChunk } from '../api/types.js';
import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { cityView, dutiesView, storiesView } from '../city/city-views.js';
import { Journal } from '../journal/journal.js';
import { notify } from '../notify/notify.js';
import { NotificationStore } from '../notify/store.js';
import { loadSnapshot, saveSnapshot, type SaveSources } from '../save/save.js';

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

const DENSITIES = ['sparse', 'standard', 'rich'] as const;
const PRESETS = ['easy', 'standard', 'hard'] as const;

function loadCore() {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack data failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const CORE = loadCore();

function presetOf(id: string): DifficultyPreset {
  for (const [key, value] of CORE.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no preset ${id}`);
}

function inputs(presetId: string, density: (typeof DENSITIES)[number] | 'off' | 'disabled'): GenerateInputs {
  const ambient =
    density === 'off'
      ? undefined
      : density === 'disabled'
        ? { enabled: false as const, density: 'standard' as const }
        : { enabled: true as const, density };
  return {
    content: CORE.content,
    preset: presetOf(presetId),
    scenario: ScenarioConfigSchema.parse({
      difficulty: { preset: presetId },
      mole: true,
      ...(ambient === undefined ? {} : { ambient }),
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    }),
    cityData: CORE.cityData,
    descriptors: CORE.descriptors,
    publicTexts: CORE.publicTexts,
  };
}

const CTX: ResolverContext = { content: CORE.content };

function withClock<T>(run: () => T): T {
  const now = Date.now;
  const perf = performance.now;
  let tick = 0;
  Date.now = () => 1_700_000_000_000 + tick;
  performance.now = () => {
    tick += 1;
    return tick * 17.5;
  };
  try {
    return run();
  } finally {
    Date.now = now;
    performance.now = perf;
  }
}

/** A wait, then the day and phase ticks. The model gateway is never passed in. */
function play(seed: string, presetId: string, density: (typeof DENSITIES)[number]): WorldState {
  const world = generate(seed, inputs(presetId, density));
  const rng = createPrng(world.rng);
  const action: Action = { kind: 'wait', phases: 1 };
  const { next } = resolve(world, action, rng, CTX);
  const played = { ...next, rng: rng.state() };
  return ambientPhase(ambientDayBoundary(played).state).state;
}

function sourcesOf(world: WorldState): SaveSources {
  return {
    world,
    journal: new Journal(),
    notifications: new NotificationStore(),
    flavourCache: {},
    actionLog: new ActionLog(),
    extractionQueue: new ExtractionQueue(),
    caseFile: new CaseFile(),
    truth: { facts: [], allegiances: new Map(), identities: new Map(), claimTruths: [] },
    viewState: { hintsSeen: [], observedCoverState: {} },
    pipeline: { turnCounter: 0, outcomeWritten: false },
    savedAt: '2026-01-01T00:00:00.000Z',
  };
}

function sliceOf(world: WorldState): WorldState {
  const scenario = { ...world.meta.scenario };
  delete scenario.ambient;
  const { ambient: _ambient, ...rest } = world;
  return { ...rest, meta: { ...rest.meta, scenario } };
}

function viewOf(world: WorldState) {
  const file = new CaseFile();
  return {
    city: cityView(world, file, []),
    stories: storiesView(world),
    duties: dutiesView(world),
    notices: notify(
      [
        {
          id: 'evt:probe',
          at: world.time,
          visibility: 'player',
          kind: 'public-announcement',
          text: 'The office is closed tomorrow.',
        },
      ],
      world,
    ),
  };
}

describe('ambient session properties', () => {
  it('replays and reloads one ambient run', () => {
    // Feature: ambient-world, Property 1: Ambient determinism, save and replay
    const gateway = (): never => {
      throw new Error('ambient tick called the model');
    };
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        fc.constantFrom(...PRESETS),
        fc.constantFrom(...DENSITIES),
        (seed, presetId, density) => {
          expect(ambientDayBoundary.length).toBe(1);
          expect(ambientPhase.length).toBe(1);
          const first = withClock(() => play(seed, presetId, density));
          const second = withClock(() => play(seed, presetId, density));
          expect(second).toEqual(first);
          expect(second.ambient).toEqual(first.ambient);
          expect(gateway).toThrow('ambient tick called the model');
          const snapshot = JSON.parse(JSON.stringify(saveSnapshot(sourcesOf(first))));
          const loaded = loadSnapshot(snapshot, first.meta.content as unknown as ContentManifest);
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) {
            return;
          }
          expect(loaded.session.world).toEqual(first);
          expect(loaded.session.world.ambient).toEqual(first.ambient);
          expect(quote(first, { kind: 'wait', phases: 1 }, CTX)).toEqual(
            quote(loaded.session.world, { kind: 'wait', phases: 1 }, CTX),
          );
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);

  it('matches a slice run when ambient is switched off', () => {
    // Feature: ambient-world, Property 2: Ambient-off equivalence
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,8}$/), fc.constantFrom(...PRESETS), (seed, presetId) => {
        const absent = generate(seed, inputs(presetId, 'off'));
        const disabled = generate(seed, inputs(presetId, 'disabled'));
        expect(disabled.ambient).toBeUndefined();
        expect(sliceOf(disabled)).toEqual(sliceOf(absent));
        expect(ambientDayBoundary(disabled).state).toBe(disabled);
        expect(ambientPhase(disabled).state).toBe(disabled);
        expect(viewOf(disabled)).toEqual(viewOf(absent));
        const action: Action = { kind: 'wait', phases: 1 };
        const left = resolve(absent, action, createPrng('off'), CTX);
        const right = resolve(disabled, action, createPrng('off'), CTX);
        expect(sliceOf(right.next)).toEqual(sliceOf(left.next));
        expect(right.result).toEqual(left.result);
        const log = new ActionLog();
        expect(log.all()).toEqual([]);
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'fox-trot'] as const;

function withScene(state: WorldState): WorldState {
  const [npc] = Object.keys(state.npcs) as NpcId[];
  if (npc === undefined) {
    throw new Error('generated world has no NPCs');
  }
  const scene: TalkScene = { npc, kind: 'routine', openedAt: state.time, via: 'talk', recent: [] };
  return { ...state, player: { ...state.player, scene } };
}

function makeEngine(seed: string, config: TurnPipelineConfig) {
  const state = withScene(generate(seed, inputs('standard', 'sparse')));
  const actionLog = config.actionLog ?? new ActionLog();
  const extractionQueue = new ExtractionQueue();
  const engine = new PlayerViewEngine({
    state,
    caseFile: new CaseFile(),
    journal: new Journal(),
    cityData: CORE.cityData,
    ctx: CTX,
    brief: EMPTY_BRIEF,
    rules: implicationRules([]),
    notifications: new NotificationStore(),
    turnDriver: createTurnDriver({ ...config, actionLog, extractionQueue }),
  });
  return engine;
}

async function drain(stream: AsyncIterable<TurnChunk>): Promise<void> {
  for await (const chunk of stream) {
    void chunk;
  }
}

const ask = () => Promise.resolve('ask' as const);
const voice = () => Promise.resolve({ released: ['I never met him.'], speaker: 'The contact' });

describe('ambient turn atomicity', () => {
  it('keeps ambient unchanged when a model call fails, and a retry matches a clean turn', async () => {
    // Feature: ambient-world, Property 21: Ambient turn atomicity
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...SEEDS), async (seed) => {
        const failed = makeEngine(seed, {
          classify: ask,
          voice: () => Promise.reject(new Error('endpoint unreachable')),
        });
        const before = failed.state.ambient;
        await drain(failed.say('Tell me about the courier.'));
        expect(failed.state.ambient).toEqual(before);

        let attempt = 0;
        const retried = makeEngine(seed, {
          classify: ask,
          voice: () => {
            attempt += 1;
            if (attempt === 1) {
              return Promise.reject(new Error('endpoint unreachable'));
            }
            return voice();
          },
        });
        await drain(retried.say('Tell me about the courier.'));
        await drain(retried.retry());
        const clean = makeEngine(seed, { classify: ask, voice });
        await drain(clean.say('Tell me about the courier.'));
        expect(retried.state.ambient).toEqual(clean.state.ambient);
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});
