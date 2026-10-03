/**
 * Feature: slice-integration, Property 52: Save/load round trip through the
 * facade (task 9.5).
 *
 * **Validates: Requirements 13.3, 13.8, 13.9**
 *
 * The design states (slice-integration design, "Property 52: Save/load round
 * trip through the facade"):
 *
 * > For any reachable game state, `saves.save(n)` followed by `saves.load(n)`
 * > (over an in-memory Save Store) restores a game whose World State, Truth
 * > Store, Case File, Journal, Notifications and action log deep-equal those at
 * > the save. For any continuation action sequence, playing it after the load
 * > yields the same states and chunk streams as playing it without the save and
 * > load.
 *
 * This drives the *real* saves facade end to end — a {@link PlayerViewEngine}
 * started with a real {@link GameFactory} and `newGame`, the real
 * {@link createTurnDriver} action turn, and the real {@link createSavesController}
 * over an {@link InMemorySaveStore} and a {@link SaveBridge} wired to the same
 * pipeline stores the driver holds. Unlike the example-level
 * `saves-facade.spec.ts` (which stubs the bridge), this property plays an
 * *action-only* walk (`wait` turns, no model seams) through the pipeline to
 * reach a reachable game state, then exercises the two halves of the property:
 *
 *   - **Round trip (13.3, 13.8).** After `save(n)` then `load(n)`, the restored
 *     game's World State, Truth Store, Case File, Journal, Notifications and
 *     action log deep-equal the ones captured at the save. The save goes through
 *     the real snapshot/canonical-JSON/`parseAndLoad` path the fs store uses, so
 *     this is a genuine serialise/restore round trip, not an in-memory alias.
 *
 *   - **Continuation agreement (13.9).** A continuation walk played on the
 *     loaded game produces the same committed World States *and* the same turn
 *     chunk streams as the same walk played on a baseline game that continued
 *     straight from the pre-save state without any save or load. The baseline is
 *     a fresh facade seeded at exactly the saved World State and Truth Store, so
 *     "with" and "without" the save/load start from a deep-equal state and must
 *     stay in lockstep.
 *
 * Walks are kept modest so the game stays live across the prefix and the
 * continuation (the slice Plot ends any game on a long enough `wait` walk;
 * Property 42 relies on exactly that). The `savedAt` header stamp is the one
 * wall-clock value a save carries; it lives in the header only and never touches
 * the round-tripped World State / Truth Store / stores, so it is left to the
 * facade's default and is not asserted here (and no `fc.date()` is used, so the
 * Invalid-time-value flake cannot arise).
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
  generateGame,
  ScenarioConfigSchema,
  TruthStore,
  type Action,
  type GenerateInputs,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { HINT_TRIGGER_ORDER } from '../aids/hints.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { InMemorySaveStore } from '../save/in-memory-save-store.js';
import type { LoadedSession } from '../save/save.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  createSavesController,
  type SaveBridge,
  type SaveBridgeParts,
} from './saves-controller.js';
import {
  ActionLog,
  ExtractionQueue,
  createTurnDriver,
} from './turn-pipeline.js';
import type { GameFactory, NewGameOptions } from './types.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors saves-facade.spec.ts / save.property.spec.ts)
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
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
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

function baseScenario(): ScenarioConfig {
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

function makeGameFactory(): GameFactory {
  return {
    generate(seed: string, opts: NewGameOptions) {
      const inputs: GenerateInputs = {
        content,
        preset: preset(opts.preset),
        scenario: { ...baseScenario(), mole: opts.mole, narration: opts.narration },
        cityData,
        descriptors,
        publicTexts,
      };
      const { world, truth } = generateGame(seed, inputs);
      return { inputs, world, truth };
    },
  };
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

// ---------------------------------------------------------------------------
// A SaveBridge wired to the driver's own pipeline stores.
// ---------------------------------------------------------------------------

/**
 * A {@link SaveBridge} that shares the {@link ActionLog} and
 * {@link ExtractionQueue} the Turn Pipeline driver holds, so a save composes the
 * live pipeline state (`collect`) and a load resets the recorded pipeline parts
 * (`restore`). The round-trip assertions read the restored action log from
 * {@link actionLog}.
 */
class SharedSaveBridge implements SaveBridge {
  flavourCache: Record<string, readonly string[]> = {};
  pipeline: SaveBridgeParts['pipeline'] = { turnCounter: 0, outcomeWritten: false };

  /** The facade whose live view-side hints the bridge snapshots into a save. */
  engine?: PlayerViewEngine;

  constructor(
    public actionLog: ActionLog,
    public extractionQueue: ExtractionQueue,
  ) {}

  /**
   * The Player-View bookkeeping a save carries. The composition-root bridge
   * reads the live hints-seen set; the HintStore has no bulk enumeration, so
   * this folds its `hasSeen` over the fixed trigger set to recover exactly the
   * triggers whose hint has fired this game. Capturing it is what lets a load
   * preserve the first-occurrence rule so a continued game never re-fires a
   * hint the saved game already showed (Req 13.9).
   */
  private viewState(): SaveBridgeParts['viewState'] {
    const hints = this.engine?.hints;
    const hintsSeen =
      hints === undefined
        ? []
        : HINT_TRIGGER_ORDER.filter((t) => hints.hasSeen(t));
    return { hintsSeen, observedCoverState: {} };
  }

  collect(): SaveBridgeParts {
    return {
      flavourCache: this.flavourCache,
      actionLog: this.actionLog,
      extractionQueue: this.extractionQueue,
      viewState: this.viewState(),
      pipeline: this.pipeline,
    };
  }

  restore(loaded: LoadedSession): void {
    this.actionLog = loaded.actionLog;
    this.extractionQueue = loaded.extractionQueue;
    this.flavourCache = { ...loaded.flavourCache };
    this.pipeline = loaded.pipeline;
  }
}

/**
 * Build a facade over the given world with the real action-turn pipeline (no
 * model seams) and, when a store/bridge are supplied, the real saves
 * controller. The driver and the bridge share one action log and extraction
 * queue, so `saves.save` composes exactly the live pipeline state.
 */
function makeEngine(
  state: WorldState,
  truth: TruthStore,
  saveStore?: InMemorySaveStore,
): { engine: PlayerViewEngine; bridge: SharedSaveBridge } {
  const actionLog = new ActionLog();
  const extractionQueue = new ExtractionQueue();
  const bridge = new SharedSaveBridge(actionLog, extractionQueue);
  const turnDriver = createTurnDriver({ actionLog, extractionQueue });
  const engine: PlayerViewEngine = new PlayerViewEngine({
    state,
    caseFile: new CaseFile(),
    journal: new Journal(),
    cityData,
    ctx: { content, truth },
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications: new NotificationStore(),
    truth,
    gameFactory: makeGameFactory(),
    turnDriver,
  });
  bridge.engine = engine;
  if (saveStore !== undefined) {
    engine.attachSaves(createSavesController(engine, { saveStore, bridge }));
  }
  return { engine, bridge };
}

/**
 * A fresh facade started on a `newGame` of the given seed. Passing a save store
 * wires the real saves controller; omitting it gives a `newGame` facade whose
 * hints are enabled (as the game under test is) but with no saves surface — the
 * baseline game for the continuation property.
 */
async function newGameEngine(
  seed: string,
  saveStore?: InMemorySaveStore,
): Promise<{ engine: PlayerViewEngine; bridge: SharedSaveBridge }> {
  const init = generateGame('seed-init', {
    content,
    preset: STANDARD,
    scenario: baseScenario(),
    cityData,
    descriptors,
    publicTexts,
  });
  const made = makeEngine(init.world, init.truth, saveStore);
  await made.engine.newGame({ ...OPTS, seed });
  return made;
}

const OPTS: NewGameOptions = { preset: 'standard', mole: true, narration: 'full' };

/** Drain a turn stream into an array of chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** A single `wait` turn advancing `phases` phases (1–4). */
function waitAction(phases: 1 | 2 | 3 | 4): Action {
  return { kind: 'wait', phases };
}

/**
 * Snapshot of the facade's save-relevant stores at a moment, taken through the
 * same accessors the controller composes a save from. Used to assert the loaded
 * game deep-equals the one at the save (Req 13.3, 13.8).
 */
function captureStores(engine: PlayerViewEngine, bridge: SharedSaveBridge) {
  const truth = engine.turnContext.truth;
  if (truth === undefined) throw new Error('no truth store on the facade');
  return {
    world: engine.state,
    truth: truth.snapshot(),
    caseFile: engine.caseFileStore.snapshot(),
    journal: engine.journal.snapshot(),
    notifications: engine.notificationStoreRef.list(),
    actionLog: bridge.actionLog.all(),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

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

/** A short prefix walk to reach a reachable state (kept modest to stay live). */
const prefixArb = fc.array(
  fc.integer({ min: 1, max: 3 }) as fc.Arbitrary<1 | 2 | 3>,
  { minLength: 0, maxLength: 6 },
);

/** A short continuation walk (kept modest so the game stays live across it). */
const continuationArb = fc.array(
  fc.integer({ min: 1, max: 3 }) as fc.Arbitrary<1 | 2 | 3>,
  { minLength: 1, maxLength: 6 },
);

/** A valid save name (the facade validates names; Req 13.6 is Property 54). */
const nameArb = fc.constantFrom('slot', 'My Save_1', 'autosave', 'game-1');

// ---------------------------------------------------------------------------
// Property 52 (Req 13.3, 13.8, 13.9)
// ---------------------------------------------------------------------------

describe('Property 52: Save/load round trip through the facade (Req 13.3, 13.8, 13.9)', () => {
  it('save then load restores a game deep-equal to the one at the save (Req 13.3, 13.8)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, prefixArb, nameArb, async (seed, prefix, name) => {
        const store = new InMemorySaveStore();
        const { engine, bridge } = await newGameEngine(seed, store);

        // Walk to a reachable state; stop early if the game ends so the save is
        // of a live, mid-game state.
        for (const phases of prefix) {
          if (engine.state.ended !== undefined) break;
          await drain(engine.act(waitAction(phases)));
        }

        const before = captureStores(engine, bridge);

        await engine.saves.save(name);
        const result = await engine.saves.load(name);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const after = captureStores(engine, bridge);

        // World State, Truth Store, Case File, Journal, Notifications and the
        // action log all restore deep-equal to the save (Req 13.3, 13.8).
        expect(after.world).toEqual(before.world);
        expect(after.world.rng).toEqual(before.world.rng);
        expect(after.truth).toEqual(before.truth);
        expect(after.caseFile).toEqual(before.caseFile);
        expect(after.journal).toEqual(before.journal);
        expect(after.notifications).toEqual(before.notifications);
        expect(after.actionLog).toEqual(before.actionLog);
      }),
      { numRuns: 40 },
    );
  });

  it('continuing after a load yields the same states and chunks as continuing without the save/load (Req 13.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        prefixArb,
        continuationArb,
        nameArb,
        async (seed, prefix, continuation, name) => {
          const store = new InMemorySaveStore();
          // Two identical games of the same seed: `engine` is saved and loaded;
          // `baseline` is the same game continued WITHOUT any save or load. Both
          // start from `newGame`, so their whole Session — World State, Truth
          // Store, Case File, Journal, Notifications and the view-side hints-seen
          // set — begins deep-equal and tracks the same prefix.
          const { engine } = await newGameEngine(seed, store);
          const { engine: baseline } = await newGameEngine(seed);

          // Walk both to the same reachable, still-live state.
          for (const phases of prefix) {
            if (engine.state.ended !== undefined) break;
            await drain(engine.act(waitAction(phases)));
            await drain(baseline.act(waitAction(phases)));
          }
          // The continuation only makes sense from a live game.
          fc.pre(engine.state.ended === undefined);
          // Sanity: the two games are in lockstep at the save point.
          expect(engine.state).toEqual(baseline.state);

          // Save `engine`, then load the same game back into it.
          await engine.saves.save(name);
          const loaded = await engine.saves.load(name);
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) return;

          // Play the same continuation walk on the loaded game and on the
          // baseline, comparing step by step the committed World State and the
          // turn's chunk stream (Req 13.9).
          for (const phases of continuation) {
            const loadedChunks = await drain(engine.act(waitAction(phases)));
            const baselineChunks = await drain(baseline.act(waitAction(phases)));

            expect(engine.state).toEqual(baseline.state);
            expect(engine.state.rng).toEqual(baseline.state.rng);
            expect(loadedChunks).toEqual(baselineChunks);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
