/**
 * Property 53: Load refusal leaves the game unchanged (slice-integration task
 * 9.6).
 *
 * **Validates: Requirements 13.4, 13.5**
 *
 * The design states (Property 53): "For any reachable game state and any save
 * whose manifest differs, whose version differs, or whose bytes are arbitrary,
 * `saves.load` returns a `manifest-mismatch` (listing exactly `diffManifests`'
 * packs), `version` or `corrupt` error respectively, and the current Session is
 * deep-equal to before the call."
 *
 * This drives the real {@link PlayerViewEngine} through the saves facade — the
 * same wiring the sibling example spec (`saves-facade.spec.ts`) uses: a real
 * {@link GameFactory} and `newGame`, an in-memory {@link InMemorySaveStore} and
 * a small {@link SaveBridge} standing in for the pipeline/dialogue stores. The
 * example spec covers one representative of each refusal; this property sweeps
 * them across generated worlds and arbitrary refused payloads and, for each,
 * asserts both halves of the property:
 *
 *  1. **The typed error.** A manifest-mismatch save yields `manifest-mismatch`
 *     whose `differing` list equals `diffManifests(saved, loaded)` exactly; a
 *     wrong-version save yields `version`; an arbitrary/malformed payload yields
 *     `corrupt` (Req 13.4, 13.5).
 *  2. **The game is unchanged.** The live Session is identical after the refused
 *     load: the same {@link WorldState} *reference* (`toBe`), and the Case File,
 *     Journal, Notifications and action log snapshots deep-equal their
 *     pre-call values. The whole session serialises to the same canonical save
 *     bytes before and after (Req 13.4, 13.5).
 *
 * The refused payloads are built from a valid v2 snapshot of the current game so
 * each one passes the cheap checks a real refusal must still clear (a mismatched
 * manifest must otherwise be a readable, well-versioned save; a wrong-version
 * save must otherwise parse). The `savedAt` header is pinned to a generated ISO
 * string built from an integer epoch — never `fc.date().toISOString()`, which
 * can emit an Invalid-time-value — so the snapshots stay JSON-safe.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentManifest,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  generateGame,
  ScenarioConfigSchema,
  type GenerateInputs,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import {
  InMemorySaveStore,
  canonicalJson,
} from '../save/in-memory-save-store.js';
import {
  SAVE_VERSION,
  diffManifests,
  saveSnapshot,
  type SaveSnapshot,
} from '../save/save.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  createSavesController,
  type SaveBridge,
  type SaveBridgeParts,
} from './saves-controller.js';
import { ActionLog, ExtractionQueue } from './turn-pipeline.js';
import type { LoadedSession } from '../save/save.js';
import type { GameFactory, NewGameOptions } from './types.js';

// ---------------------------------------------------------------------------
// Bounded run count for CI (each case generates a world via newGame).
// ---------------------------------------------------------------------------

const RUNS = 40;

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors saves-facade.spec.ts)
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

// ---------------------------------------------------------------------------
// A small SaveBridge standing in for the pipeline/dialogue stores
// (mirrors saves-facade.spec.ts).
// ---------------------------------------------------------------------------

class TestSaveBridge implements SaveBridge {
  actionLog = new ActionLog();
  extractionQueue = new ExtractionQueue();
  flavourCache: Record<string, readonly string[]> = {};
  viewState: SaveBridgeParts['viewState'] = { hintsSeen: [], observedCoverState: {} };
  pipeline: SaveBridgeParts['pipeline'] = { turnCounter: 0, outcomeWritten: false };
  restored = 0;

  collect(): SaveBridgeParts {
    return {
      flavourCache: this.flavourCache,
      actionLog: this.actionLog,
      extractionQueue: this.extractionQueue,
      viewState: this.viewState,
      pipeline: this.pipeline,
    };
  }

  restore(loaded: LoadedSession): void {
    this.actionLog = loaded.actionLog;
    this.extractionQueue = loaded.extractionQueue;
    this.flavourCache = { ...loaded.flavourCache };
    this.viewState = loaded.viewState;
    this.pipeline = loaded.pipeline;
    this.restored += 1;
  }
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };

function makeEngine(saveStore: InMemorySaveStore, bridge = new TestSaveBridge()) {
  const seed = generateGame('seed-init', {
    content,
    preset: STANDARD,
    scenario: baseScenario(),
    cityData,
    descriptors,
    publicTexts,
  });
  const engine = new PlayerViewEngine({
    state: seed.world,
    caseFile: new CaseFile(),
    journal: new Journal(),
    cityData,
    ctx: { content, truth: seed.truth },
    brief: EMPTY_BRIEF,
    rules: implicationRules([]),
    notifications: new NotificationStore(),
    truth: seed.truth,
    gameFactory: makeGameFactory(),
  });
  engine.attachSaves(createSavesController(engine, { saveStore, bridge }));
  return { engine, saveStore, bridge };
}

const OPTS: NewGameOptions = { preset: 'standard', mole: true, narration: 'full' };

/** The live engine's loaded Content Manifest (what a refused load compares against). */
function loadedManifest(engine: PlayerViewEngine): ContentManifest {
  return engine.loadedManifest;
}

/**
 * A v2 snapshot of the engine's *current* session, pinned at `savedAt`. Used
 * both as the base for the refused payloads and as the before/after fingerprint
 * of the live Session (two snapshots at the same `savedAt` are byte-equal iff
 * the session is unchanged).
 */
function snapshotOf(engine: PlayerViewEngine, bridge: TestSaveBridge, savedAt: string): SaveSnapshot {
  const truth = engine.turnContext.truth;
  if (truth === undefined) throw new Error('no truth store on the facade');
  const parts = bridge.collect();
  return saveSnapshot({
    world: engine.state,
    journal: engine.journal,
    notifications: engine.notificationStoreRef,
    flavourCache: parts.flavourCache,
    actionLog: parts.actionLog,
    extractionQueue: parts.extractionQueue,
    caseFile: engine.caseFileStore,
    truth: truth.snapshot(),
    viewState: parts.viewState,
    pipeline: parts.pipeline,
    savedAt,
  });
}

/**
 * Bump every pack's version and hash so the saved manifest differs. The version
 * stays valid semver (the manifest schema validates it as semver, so an invalid
 * string would fail schema validation and be refused as `corrupt` before the
 * manifest gate ever runs); only its value changes.
 */
function mismatchManifest(snapshot: SaveSnapshot, version: string, hash: string): SaveSnapshot {
  return {
    ...snapshot,
    content: {
      ...snapshot.content,
      packs: snapshot.content.packs.map((p) => ({ ...p, version, hash })),
    },
  } as SaveSnapshot;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A short, deterministic seed string. */
const seedArb = fc.string({ minLength: 1, maxLength: 12 });

/** One of the shipped presets. */
const presetArb = fc.constantFrom('easy', 'standard', 'hard');

/**
 * A JSON-safe ISO timestamp built from an integer epoch within a safe range —
 * deliberately *not* `fc.date().toISOString()`, which can produce an
 * Invalid-time-value for out-of-range dates.
 */
const savedAtArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970-01-01 .. 2100-01-01
  .map((ms) => new Date(ms).toISOString());

/** A version number that is never the supported one. */
const wrongVersionArb = fc
  .integer({ min: 1, max: 20 })
  .filter((v) => v !== SAVE_VERSION);

/** A valid semver string distinct from any real pack version (always 10+.x.y). */
const altSemverArb = fc
  .tuple(
    fc.integer({ min: 10, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([a, b, c]) => `${a}.${b}.${c}`);

/** A differing pack hash: 64 lower-case hex chars, like a real one. */
const altHashArb = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((ns) => ns.map((n) => n.toString(16)).join(''));

/**
 * Arbitrary "bytes" for the corrupt case: either a string that is not valid
 * JSON, or valid JSON that is structurally not a save (so `parseAndLoad` must
 * fold it to `corrupt`). Both are stored verbatim as the save's bytes.
 */
const corruptBytesArb = fc.oneof(
  // Not valid JSON at all.
  fc.string({ maxLength: 40 }).map((s) => `${s}\u0000not json {`),
  // Valid JSON, but not a save snapshot. A readable numeric `version` other
  // than the supported one is a version error, so those values stay out of
  // this arbitrary.
  fc
    .oneof(
      fc
        .jsonValue()
        .map((v) => JSON.stringify(v))
        .filter((text) => {
          try {
            const parsed: unknown = JSON.parse(text);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              return true;
            }
            const version = (parsed as { version?: unknown }).version;
            return typeof version !== 'number' || version === SAVE_VERSION;
          } catch {
            return true;
          }
        }),
      fc.constant('null'),
      fc.constant('[]'),
      fc.constant('{}'),
      fc.constant('{"version":3}'),
    ),
);

// ---------------------------------------------------------------------------
// Assertions shared by every refusal
// ---------------------------------------------------------------------------

/**
 * Assert the live Session is unchanged after a refused load: the same
 * {@link WorldState} reference, and the Case File / Journal / Notifications /
 * action log and the whole canonical snapshot deep-equal their pre-call values.
 */
function expectUnchanged(
  engine: PlayerViewEngine,
  bridge: TestSaveBridge,
  before: {
    world: WorldState;
    canonical: string;
    caseFile: unknown;
    journalEntries: unknown;
    journalNotes: unknown;
    notifications: unknown;
    actionLog: unknown;
  },
  savedAt: string,
): void {
  // The current World State is the *same object*, not a rebuilt equal (Req 13.4).
  expect(engine.state).toBe(before.world);
  // The pipeline/dialogue stores were never reset.
  expect(bridge.restored).toBe(0);
  // Each view-safe store deep-equals its pre-call snapshot.
  expect(engine.caseFileStore.snapshot()).toEqual(before.caseFile);
  expect(engine.journal.entries()).toEqual(before.journalEntries);
  expect(engine.journal.notes()).toEqual(before.journalNotes);
  expect(engine.notificationStoreRef.list()).toEqual(before.notifications);
  expect(bridge.actionLog.all()).toEqual(before.actionLog);
  // The whole session serialises to the same canonical bytes as before.
  expect(canonicalJson(snapshotOf(engine, bridge, savedAt))).toBe(before.canonical);
}

/** Capture the before-call fingerprint of the live Session. */
function fingerprint(engine: PlayerViewEngine, bridge: TestSaveBridge, savedAt: string) {
  return {
    world: engine.state,
    canonical: canonicalJson(snapshotOf(engine, bridge, savedAt)),
    caseFile: engine.caseFileStore.snapshot(),
    journalEntries: engine.journal.entries(),
    journalNotes: engine.journal.notes(),
    notifications: engine.notificationStoreRef.list(),
    actionLog: bridge.actionLog.all(),
  };
}

// ---------------------------------------------------------------------------
// Property 53 (Req 13.4, 13.5)
// ---------------------------------------------------------------------------

describe('Property 53: Load refusal leaves the game unchanged', () => {
  it('a mismatched manifest yields manifest-mismatch (= diffManifests) and the game is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        presetArb,
        savedAtArb,
        altSemverArb,
        altHashArb,
        async (seed, presetId, savedAt, version, hash) => {
        const store = new InMemorySaveStore();
        const { engine, bridge } = makeEngine(store);
        await engine.newGame({ ...OPTS, preset: presetId, seed });

        // A save of the current game, with every pack's version/hash changed.
        const base = snapshotOf(engine, bridge, savedAt);
        const mismatched = mismatchManifest(base, version, hash);
        store.write('refused', canonicalJson(mismatched));

        const expectedDiff = diffManifests(
          mismatched.content as unknown as ContentManifest,
          loadedManifest(engine),
        );
        expect(expectedDiff.length).toBeGreaterThan(0);

        const before = fingerprint(engine, bridge, savedAt);
        const result = await engine.saves.load('refused');

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('manifest-mismatch');
        if (result.error.kind !== 'manifest-mismatch') return;
        // Lists exactly diffManifests' packs.
        expect(result.error.differing).toEqual(expectedDiff);

        expectUnchanged(engine, bridge, before, savedAt);
      },
      ),
      { numRuns: RUNS },
    );
  });

  it('a wrong-version save yields version and the game is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        presetArb,
        savedAtArb,
        wrongVersionArb,
        async (seed, presetId, savedAt, version) => {
          const store = new InMemorySaveStore();
          const { engine, bridge } = makeEngine(store);
          await engine.newGame({ ...OPTS, preset: presetId, seed });

          const base = snapshotOf(engine, bridge, savedAt);
          store.write('refused', canonicalJson({ ...base, version }));

          const before = fingerprint(engine, bridge, savedAt);
          const result = await engine.saves.load('refused');

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.kind).toBe('version');
          if (result.error.kind !== 'version') return;
          expect(result.error.saved).toBe(version);
          expect(result.error.supported).toBe(SAVE_VERSION);

          expectUnchanged(engine, bridge, before, savedAt);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('arbitrary / malformed bytes yield corrupt and the game is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        presetArb,
        savedAtArb,
        corruptBytesArb,
        async (seed, presetId, savedAt, bytes) => {
          const store = new InMemorySaveStore();
          const { engine, bridge } = makeEngine(store);
          await engine.newGame({ ...OPTS, preset: presetId, seed });
          store.write('refused', bytes);

          const before = fingerprint(engine, bridge, savedAt);
          const result = await engine.saves.load('refused');

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.kind).toBe('corrupt');

          expectUnchanged(engine, bridge, before, savedAt);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('a missing save yields corrupt and the game is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, presetArb, savedAtArb, async (seed, presetId, savedAt) => {
        const store = new InMemorySaveStore();
        const { engine, bridge } = makeEngine(store);
        await engine.newGame({ ...OPTS, preset: presetId, seed });

        const before = fingerprint(engine, bridge, savedAt);
        const result = await engine.saves.load('absent');

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('corrupt');

        expectUnchanged(engine, bridge, before, savedAt);
      }),
      { numRuns: RUNS },
    );
  });
});
