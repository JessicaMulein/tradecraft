/**
 * Behaviour tests for the facade's `saves` surface (slice-integration task 9.4;
 * design, "Facade: saves"; Requirements 13.1–13.6).
 *
 * These drive the real {@link PlayerViewEngine}, started with a real
 * {@link GameFactory} and `newGame`, over an in-memory {@link InMemorySaveStore}
 * and a small {@link SaveBridge} standing in for the pipeline/dialogue stores.
 * They prove the facade's own responsibilities on the save path — not the pure
 * snapshot round-trip (that is `save.property.spec.ts`), but the facade wiring
 * around it:
 *
 *  - `save` rejects an invalid name *before* writing anything (Req 13.6), and
 *    on a valid name writes a canonical-JSON save the store lists with a
 *    matching manifest (Req 13.1, 13.2);
 *  - `list` maps stored headers to `SaveInfo` and flags a manifest mismatch;
 *  - `load` restores the saved game and swaps the Session in (Req 13.3), and
 *    maps a missing/unreadable/malformed save to `corrupt`, an old version to
 *    `version`, and a differing manifest to `manifest-mismatch`, leaving the
 *    current game untouched on every refusal (Req 13.4, 13.5).
 *
 * The property-level claims (Properties 52–54) are separate tasks; this spec is
 * the example-level coverage of the facade surface.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  type GenerateInputs,
  type ScenarioConfig,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import {
  InMemorySaveStore,
  canonicalJson,
} from '../save/in-memory-save-store.js';
import { SAVE_VERSION, saveSnapshot } from '../save/save.js';
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
// Core-pack fixtures (mirrors the sibling specs)
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
// A small SaveBridge standing in for the pipeline/dialogue stores.
// ---------------------------------------------------------------------------

/**
 * A test {@link SaveBridge}: it holds the pipeline/dialogue parts a save
 * composes beside the facade's own stores (the action log, extraction queue,
 * Flavour cache, view bookkeeping and resumable counters), hands them to
 * `saves.save` through {@link collect}, and records the loaded parts on
 * {@link restore} so a test can assert the pipeline was reset.
 */
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

function makeEngine(saveStore = new InMemorySaveStore(), bridge = new TestSaveBridge()) {
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

/** Build a v2 snapshot for the current session's world and Truth Store. */
function snapshotOf(engine: PlayerViewEngine) {
  const truth = engine.turnContext.truth;
  if (truth === undefined) throw new Error('no truth store on the facade');
  return saveSnapshot({
    world: engine.state,
    journal: engine.journal,
    notifications: engine.notificationStoreRef,
    flavourCache: {},
    actionLog: new ActionLog(),
    extractionQueue: new ExtractionQueue(),
    caseFile: new CaseFile(),
    truth: truth.snapshot(),
    viewState: { hintsSeen: [], observedCoverState: {} },
    pipeline: { turnCounter: 0, outcomeWritten: false },
    savedAt: '2024-01-01T00:00:00.000Z',
  });
}

// ---------------------------------------------------------------------------
// save (Req 13.1, 13.6)
// ---------------------------------------------------------------------------

describe('saves.save — name validation and writing (Req 13.1, 13.6)', () => {
  it('rejects an invalid name before writing anything (Req 13.6)', async () => {
    const { engine, saveStore } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'alpha' });

    for (const bad of ['', '../escape', 'has/slash', 'back\\slash', '..', '.hidden', 'a'.repeat(65)]) {
      await expect(engine.saves.save(bad)).rejects.toThrow();
    }
    // Nothing was written for any rejected name.
    expect(saveStore.list()).toHaveLength(0);
  });

  it('writes a canonical-JSON save under a valid name and returns its info (Req 13.1)', async () => {
    const { engine, saveStore } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'bravo' });

    const info = await engine.saves.save('My Save_1');
    expect(info.name).toBe('My Save_1');
    expect(info.seed).toBe('bravo');
    expect(info.difficulty).toBe(STANDARD.id);
    expect(info.manifestMatches).toBe(true);

    // The store holds exactly the canonical-JSON bytes for the current session.
    const listed = saveStore.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('My Save_1');
    expect(listed[0]?.header).not.toBe('corrupt');
  });
});

// ---------------------------------------------------------------------------
// list (Req 13.2)
// ---------------------------------------------------------------------------

describe('saves.list — headers and manifest match (Req 13.2)', () => {
  it('lists saved games with their headers and a matching manifest flag', async () => {
    const { engine } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'charlie' });
    await engine.saves.save('one');
    await engine.saves.save('two');

    const list = engine.saves.list();
    expect(list.map((s) => s.name).sort()).toEqual(['one', 'two']);
    for (const info of list) {
      expect(info.seed).toBe('charlie');
      expect(info.manifestMatches).toBe(true);
    }
  });

  it('flags a save whose manifest differs from the loaded packs', async () => {
    // Pre-seed the store with a save whose manifest has a different version.
    const { engine } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'delta' });
    const snapshot = snapshotOf(engine);
    const mismatched = {
      ...snapshot,
      content: {
        ...snapshot.content,
        packs: snapshot.content.packs.map((p) => ({ ...p, version: '9.9.9', hash: 'deadbeef' })),
      },
    };
    const store = new InMemorySaveStore({ old: canonicalJson(mismatched) });
    const { engine: engine2 } = makeEngine(store);
    await engine2.newGame({ ...OPTS, seed: 'delta' });

    const list = engine2.saves.list();
    const old = list.find((s) => s.name === 'old');
    expect(old?.manifestMatches).toBe(false);
  });

  it('is empty when no SaveStore is wired', async () => {
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
    });
    expect(engine.saves.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// load (Req 13.3, 13.4, 13.5)
// ---------------------------------------------------------------------------

describe('saves.load — restore and refusal (Req 13.3, 13.4, 13.5)', () => {
  it('restores the saved game and swaps the Session in (Req 13.3)', async () => {
    const { engine, bridge } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'echo' });
    const savedTime = engine.state.time;
    const savedSeed = engine.state.meta.seed;
    await engine.saves.save('slot');

    // Start a different game, then load the save back.
    await engine.newGame({ ...OPTS, seed: 'foxtrot' });
    expect(engine.state.meta.seed).toBe('foxtrot');

    const result = await engine.saves.load('slot');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.seed).toBe(savedSeed);
    expect(engine.state.meta.seed).toBe(savedSeed);
    expect(engine.state.time).toEqual(savedTime);
    // The pipeline/dialogue stores were reset through the bridge.
    expect(bridge.restored).toBeGreaterThan(0);
  });

  it('maps a missing save to a corrupt error and leaves the game unchanged (Req 13.4)', async () => {
    const { engine } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'golf' });
    const before = engine.state;

    const result = await engine.saves.load('nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
    expect(engine.state).toBe(before);
  });

  it('maps an unreadable (non-JSON) save to a corrupt error (Req 13.5)', async () => {
    const store = new InMemorySaveStore({ broken: 'not json at all' });
    const { engine } = makeEngine(store);
    await engine.newGame({ ...OPTS, seed: 'hotel' });

    const result = await engine.saves.load('broken');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it('maps a wrong-version save to a version error (Req 13.5)', async () => {
    const { engine } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'india' });
    const snapshot = snapshotOf(engine);
    const store = new InMemorySaveStore({
      future: canonicalJson({ ...snapshot, version: SAVE_VERSION + 1 }),
    });
    const { engine: engine2 } = makeEngine(store);
    await engine2.newGame({ ...OPTS, seed: 'india' });

    const result = await engine2.saves.load('future');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('version');
  });

  it('maps a mismatched manifest to a manifest-mismatch error (Req 13.5)', async () => {
    const { engine } = makeEngine();
    await engine.newGame({ ...OPTS, seed: 'juliet' });
    const snapshot = snapshotOf(engine);
    const mismatched = {
      ...snapshot,
      content: {
        ...snapshot.content,
        packs: snapshot.content.packs.map((p) => ({ ...p, version: '9.9.9', hash: 'deadbeef' })),
      },
    };
    const store = new InMemorySaveStore({ old: canonicalJson(mismatched) });
    const { engine: engine2 } = makeEngine(store);
    await engine2.newGame({ ...OPTS, seed: 'juliet' });
    const before = engine2.state;

    const result = await engine2.saves.load('old');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest-mismatch');
    // The current game is untouched by a refused load (Req 13.4).
    expect(engine2.state).toBe(before);
  });
});
