/**
 * Property 54: Save name safety (slice-integration design, "Correctness
 * Properties"; task 9.7).
 *
 * The design states the property as:
 *
 * > For any string, `saves.save` writes a file if and only if the string
 * > matches the allowed save-name set, and every written path lies inside the
 * > Saves Directory. (design, Property 54)
 *
 * **Validates: Requirements 13.6**
 *
 * Requirement 13.6: IF the save name contains a path separator, a
 * parent-directory segment or a character outside the allowed save-name set,
 * THEN THE Engine API SHALL reject the save with an error and write nothing.
 *
 * The allowed set is {@link SAVE_NAME} = `/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/`:
 * a name starts with an alphanumeric, then uses only letters, digits, spaces,
 * underscores and hyphens, up to 64 characters total.
 *
 * This drives the facade's own save path — the real {@link PlayerViewEngine}
 * started with a real {@link GameFactory} and `newGame`, over an in-memory
 * {@link InMemorySaveStore} — and over many fast-check-generated strings pins
 * the biconditional the property asserts:
 *
 *  - the facade's `saves.save` writes a save **iff** the name matches
 *    {@link SAVE_NAME} (checked both as the write succeeding/rejecting and as
 *    the store gaining/not gaining an entry), and
 *  - on every rejection the store is left exactly as it was — nothing is
 *    written (Req 13.6, "write nothing").
 *
 * The in-memory store makes the "written path lies inside the Saves Directory"
 * half of the design statement vacuous (there is no directory to escape), so
 * the facade's guard is the whole story here: a name with a path separator
 * (`has/slash`, `back\\slash`) or a parent-directory segment (`..`, `../x`)
 * never matches {@link SAVE_NAME} and so is rejected before any write, which is
 * exactly what the fs store relies on. The example-level coverage of the facade
 * surface lives in `saves-facade.spec.ts`; this is the property-level claim.
 *
 * The core-pack fixture and engine wiring mirror `saves-facade.spec.ts`; the
 * fast-check shape mirrors the sibling `*.property.spec.ts` files.
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
  type GenerateInputs,
  type ScenarioConfig,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { InMemorySaveStore } from '../save/in-memory-save-store.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  createSavesController,
  type SaveBridge,
  type SaveBridgeParts,
} from './saves-controller.js';
import { ActionLog, ExtractionQueue } from './turn-pipeline.js';
import { SAVE_NAME, isValidSaveName } from './types.js';
import type { LoadedSession } from '../save/save.js';
import type { GameFactory, NewGameOptions } from './types.js';

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
// A minimal SaveBridge standing in for the pipeline/dialogue stores.
// ---------------------------------------------------------------------------

class TestSaveBridge implements SaveBridge {
  actionLog = new ActionLog();
  extractionQueue = new ExtractionQueue();
  flavourCache: Record<string, readonly string[]> = {};
  viewState: SaveBridgeParts['viewState'] = { hintsSeen: [], observedCoverState: {} };
  pipeline: SaveBridgeParts['pipeline'] = { turnCounter: 0, outcomeWritten: false };

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
  }
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };

function makeEngine(saveStore = new InMemorySaveStore()) {
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
  engine.attachSaves(
    createSavesController(engine, { saveStore, bridge: new TestSaveBridge() }),
  );
  return { engine, saveStore };
}

const OPTS: NewGameOptions = { preset: 'standard', mole: true, narration: 'full' };

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A generator that mixes valid and invalid names so the biconditional is
 * exercised from both sides without relying on fully random strings (which are
 * almost always invalid). It draws:
 *
 *  - valid names built directly from {@link SAVE_NAME}'s allowed set, and
 *  - a set of hostile and boundary strings — empty, path separators,
 *    parent-directory segments, leading dot/space/hyphen, over-length, and
 *    characters outside the set — plus arbitrary unicode strings.
 */
const allowedFirst = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const allowedRest = `${allowedFirst} _-`;

const validName = fc
  .tuple(
    fc.constantFrom(...allowedFirst.split('')),
    fc.string({ unit: fc.constantFrom(...allowedRest.split('')), maxLength: 63 }),
  )
  .map(([head, tail]) => head + tail);

const hostileName = fc.constantFrom(
  '',
  '..',
  '.',
  '../escape',
  '..\\escape',
  'has/slash',
  'back\\slash',
  'a/../b',
  '.hidden',
  ' leadingspace',
  '-leadinghyphen',
  '_leadingunderscore',
  'has.dot',
  'tab\tname',
  'new\nline',
  'emoji😀',
  'a'.repeat(64), // 64 chars — valid, boundary (starts alnum, 63 more)
  'a'.repeat(65), // 65 chars — one over the limit, invalid
  'name!',
  'name@host',
);

/** The mixed name space the property quantifies over. */
const anyName = fc.oneof(
  { weight: 3, arbitrary: validName },
  { weight: 3, arbitrary: hostileName },
  { weight: 2, arbitrary: fc.string({ maxLength: 70 }) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 70 }) },
);

// ---------------------------------------------------------------------------
// Property 54
// ---------------------------------------------------------------------------

describe('Property 54: Save name safety (Req 13.6)', () => {
  it('isValidSaveName agrees with SAVE_NAME for any string', () => {
    fc.assert(
      fc.property(anyName, (name) => {
        expect(isValidSaveName(name)).toBe(SAVE_NAME.test(name));
      }),
    );
  });

  it('rejects every name with a path separator, a parent-directory segment or an out-of-set character', () => {
    fc.assert(
      fc.property(anyName, (name) => {
        // Any disallowed shape must fail the predicate: a leading non-alnum,
        // a path separator, a parent-directory segment, any character outside
        // the allowed set, or a length over 64.
        const hasSeparator = name.includes('/') || name.includes('\\');
        const hasParentSegment = /(^|[/\\])\.\.([/\\]|$)/.test(name);
        const outOfSet = !SAVE_NAME.test(name);
        if (hasSeparator || hasParentSegment) {
          // A separator or parent segment is never in the allowed set.
          expect(isValidSaveName(name)).toBe(false);
        }
        // The predicate rejects exactly the out-of-set names.
        expect(isValidSaveName(name)).toBe(!outOfSet);
      }),
    );
  });

  it('saves.save writes iff the name is valid, and writes nothing on rejection (Req 13.6)', async () => {
    await fc.assert(
      fc.asyncProperty(anyName, async (name) => {
        const { engine, saveStore } = makeEngine();
        await engine.newGame({ ...OPTS, seed: 'alpha' });

        const before = saveStore.list();
        const valid = isValidSaveName(name);

        if (valid) {
          const info = await engine.saves.save(name);
          expect(info.name).toBe(name);
          // The store gained exactly this save.
          const after = saveStore.list();
          expect(after).toHaveLength(before.length + 1);
          expect(after.some((e) => e.name === name)).toBe(true);
        } else {
          await expect(engine.saves.save(name)).rejects.toThrow();
          // Nothing was written: the store is byte-for-byte as before (Req 13.6).
          const after = saveStore.list();
          expect(after).toEqual(before);
        }
      }),
    );
  });

  it('a rejected name never writes, even after a prior valid save exists', async () => {
    await fc.assert(
      fc.asyncProperty(validName, hostileName, async (good, bad) => {
        fc.pre(!isValidSaveName(bad));
        const { engine, saveStore } = makeEngine();
        await engine.newGame({ ...OPTS, seed: 'bravo' });

        await engine.saves.save(good);
        const after = saveStore.list();

        await expect(engine.saves.save(bad)).rejects.toThrow();
        // The earlier save is intact and no new entry appeared.
        expect(saveStore.list()).toEqual(after);
      }),
    );
  });
});
