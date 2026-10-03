/**
 * Feature: content-expansion, task 10.2 — the shipped-city generation tests.
 *
 * **Validates: Requirements 9.7, 18.2, 18.3, 18.5**
 *
 * Task 3.15 proved Property 13 ("Solvability for every city") over *synthetic*
 * City Packs built on the core pack (`solvability-every-city.property.spec.ts`).
 * This task runs the same engine capstone over the **five real shipped City
 * Packs** — `city-vienna`, `city-berlin`, `city-istanbul`, `city-lisbon` and
 * `city-trieste` — loaded from disk through the real content loader together
 * with their required Era and Library Packs, exactly as a shipped scenario set
 * in one of those cities would load (Req 18.2: the five cities are complete and
 * lint clean at release).
 *
 * The design fixes Property 13 (content-expansion design, "Correctness
 * Properties") as: for any conforming City Pack (generated **or shipped**),
 * Difficulty Preset and seed, the generated world passes the slice's
 * discovery-path verification (slice Properties 2 and 19), no Side Thread seats
 * a Cell member (slice Property 21), and the world is placed in the City Pack
 * (its `meta.setting.city` is the City Pack id, not the Core City).
 *
 * ## What this test owns, over and above task 3.15
 *
 * Task 3.15's cities are conforming *by construction* (every District seats a
 * Location of every core Location Type, the bounds force the whole connected
 * set). This test instead asserts the **authored** shipped packs are conforming
 * in the field: that the real Vienna / Berlin / Istanbul / Lisbon / Trieste
 * geography — authored by hand against the core Tag Vocabulary — actually binds
 * every Required Query and yields a solvable world for every Difficulty Preset
 * and random seed. The CE-FEASIBLE release check (task 5.4) is the authoring
 * gate; this is the generator half, read off the shipped content.
 *
 * ## How the world is driven and re-verified
 *
 *   * `generate()` is called with `scenario.setting.city` set to each shipped
 *     City Pack id (`city-vienna/vienna`, `city-berlin/berlin`, …). With a City
 *     Pack selected, `generate()` replaces slice world-generation step 1 with
 *     the setting step (`drawSetting` → `yearFilter` → `instantiateCity` →
 *     `foldInstantiatedCity`), runs the core stream behind the discovery-path
 *     gate, and re-verifies on the noise stream — so a world it *returns* has
 *     already passed slice Properties 2 and 19 twice over.
 *   * To pin the guarantee explicitly, the test rebuilds the identical
 *     setting + core + first-noise stream for the same seed and city (mirroring
 *     `solvability-every-city.property.spec.ts`) and runs `verifyDiscoveryPaths`
 *     over the rebuilt `DiscoveryInputs`, asserting every Plot Stage is covered
 *     by a report pairing a human edge with a node-disjoint signal edge, the
 *     mole clause holds, and no Side Thread seats a Cell member or hostile
 *     officer (slice Property 21).
 *
 * ## The Vienna-vs-Core-City check (Req 9.7)
 *
 * A dedicated case drives `generate()` with `setting.city` set to Vienna and
 * asserts `world.meta.setting.city === 'city-vienna/vienna'` — the authored City
 * Pack, **not** the procedural Core City. The Core City is only used when
 * `setting.city` is `'core'`; selecting a City Pack must route step 1 through
 * `instantiateCity` on the shipped geography.
 *
 * ## Loader inputs
 *
 * The merged Content Set is a {@link ContentSetV2} carrying all five City Packs
 * at once. `cityData`, `descriptors` and `publicTexts` are the per-pack files
 * `generate()` reads outside the merged set (the Core City `city.yaml`, the
 * persona/descriptor pools and the book-cipher corpora); the City-Pack path
 * reads city geometry from the merged set's bundle instead of `cityData`, but
 * `GenerateInputs` still requires the three, so they are loaded from the core
 * pack exactly as every core-stream spec does.
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
  parseIsoDate,
  type CityData,
  type DescriptorData,
  type DifficultyPreset,
  type DocumentTemplate,
  type PublicText,
} from '@tradecraft/content';

import { createPrng, derive } from '../prng/prng.js';
import { type GameTime } from '../model/core.js';
import { generateOrgs, generatePrincipals } from '../city/principals.js';
import { generatePlot } from '../city/plot.js';
import { generateComms } from '../city/comms.js';
import { assignKnowledge } from '../city/knowledge.js';
import { generateStartingBrief } from '../city/starting-brief.js';
import {
  generateSideThreads,
  threadHasNoCellOrHostile,
} from '../noise/side-threads.js';
import { generateBackgroundNpcs } from '../noise/background.js';
import {
  isHumanEdge,
  isSignalEdge,
  verifyDiscoveryPaths,
  witnessesDisjoint,
  type DiscoveryInputs,
} from '../city/discovery.js';
import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from '../config/scenario-config.js';
import {
  generate,
  NOISE_STREAM_BASE,
  type GenerateInputs,
} from '../generate.js';
import { settingStreamSeed } from './stream.js';
import { drawSetting, yearFilter } from './setting.js';
import { isContentSetV2, type ContentSetV2 } from './content-set-v2.js';
import { instantiateCity } from './instantiate-city.js';
import { foldInstantiatedCity } from './fold-city.js';

/** The 1-based calendar month of an ISO Start Date (falls back to January). */
function startMonthOf(startDate: string): number {
  return parseIsoDate(startDate)?.month ?? 1;
}

// ---------------------------------------------------------------------------
// The shipped packs on disk
// ---------------------------------------------------------------------------

const ENGINE_LIB = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(ENGINE_LIB, '..', '..', '..', '..', 'content', 'packs');
const packDir = (id: string): string => join(PACKS_DIR, id);

/**
 * One shipped City Pack: the pack id selected on the command line, its merged
 * City-Bundle key (the namespaced City id `generate()` is pointed at and
 * `meta.setting.city` carries), and the Library/Era packs it draws on. The
 * loader pulls dependencies in transitively, so the pack set is the City Pack
 * plus everything it requires.
 */
interface ShippedCity {
  /** The City Pack id (its directory and `pack.yaml` id). */
  readonly pack: string;
  /** The namespaced City Bundle id, `<pack>/<name>`. */
  readonly cityId: string;
  /** The pack ids selected to load this city (the City Pack + its deps). */
  readonly select: readonly string[];
}

const CORE = 'core';
const ERA = 'era-cold-war-early';

/**
 * The five shipped cities (content-expansion task 9, Req 18.2), with the pack
 * set each requires (mirrors the per-city load specs under
 * `@tradecraft/content`). Trieste is included (Req 18.3): it is required by the
 * multi-city `region-core` template, so its generation path ships here too.
 */
const SHIPPED: readonly ShippedCity[] = [
  {
    pack: 'city-vienna',
    cityId: 'city-vienna/vienna',
    select: [CORE, ERA, 'lib-central-europe', 'lib-russian', 'city-vienna'],
  },
  {
    pack: 'city-berlin',
    cityId: 'city-berlin/berlin',
    select: [CORE, ERA, 'lib-central-europe', 'lib-russian', 'city-berlin'],
  },
  {
    pack: 'city-istanbul',
    cityId: 'city-istanbul/istanbul',
    select: [CORE, ERA, 'lib-eastern-mediterranean', 'city-istanbul'],
  },
  {
    pack: 'city-lisbon',
    cityId: 'city-lisbon/lisbon',
    select: [
      CORE,
      ERA,
      'lib-iberian',
      'lib-western',
      'lib-central-europe',
      'lib-russian',
      'lib-eastern-mediterranean',
      'city-lisbon',
    ],
  },
  {
    pack: 'city-trieste',
    cityId: 'city-trieste/trieste',
    select: [
      CORE,
      ERA,
      'lib-central-europe',
      'lib-eastern-mediterranean',
      'lib-western',
      'lib-russian',
      'city-trieste',
    ],
  },
];

/**
 * The directory list for a selection: the directory of each selected pack. The
 * loader resolves transitive dependencies among whatever directories it is
 * given, so passing the selected packs' own directories is enough — but the
 * selected set here already names every dependency explicitly.
 */
function dirsFor(select: readonly string[]): string[] {
  return select.map(packDir);
}

/**
 * Load one shipped city's full pack set as a {@link ContentSetV2}, surfacing
 * every loader error. A shipped City Pack loads with no ContentErrors at
 * release (Req 18.2), so a failure here is a release regression, not a test
 * artifact.
 */
function loadShipped(city: ShippedCity): ContentSetV2 {
  const result = loadContent(dirsFor(city.select), [...city.select]);
  if (!result.ok) {
    throw new Error(
      `${city.pack} failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  if (!isContentSetV2(result.value)) {
    throw new Error(`${city.pack} did not load as a content-expansion ContentSetV2`);
  }
  return result.value;
}

/** Every shipped city's merged Content Set, loaded once. */
const SETS: ReadonlyMap<string, ContentSetV2> = new Map(
  SHIPPED.map((city) => [city.cityId, loadShipped(city)]),
);

function setFor(cityId: string): ContentSetV2 {
  const set = SETS.get(cityId);
  if (set === undefined) {
    throw new Error(`no loaded set for ${cityId}`);
  }
  return set;
}

// ---------------------------------------------------------------------------
// The Core City `city.yaml`, descriptor pools and public texts
//
// `generate()` reads these three pieces outside the merged Content Set. The
// City-Pack path builds its geometry from the merged bundle (not `cityData`),
// but every scenario still passes the three — the descriptor pools name the
// personae `generatePrincipals` / the Background NPCs draw, and the public
// texts are the book-cipher corpora. They are loaded from the core pack, as in
// every core-stream spec (`generate.solvability.spec.ts`, `discovery.spec.ts`).
// ---------------------------------------------------------------------------

const CORE_DIR = packDir(CORE);

function loadCoreData(): {
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('core city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('core descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('core public texts failed to load');
  }
  return {
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { cityData, descriptors, publicTexts } = loadCoreData();

/** A Difficulty Preset by local id, from any shipped set (presets are core). */
function preset(id: string): DifficultyPreset {
  const anySet = SETS.values().next().value as ContentSetV2;
  for (const [key, value] of anySet.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** A Document template by local id, from any shipped set (templates are core). */
function docTemplate(local: string): DocumentTemplate {
  const anySet = SETS.values().next().value as ContentSetV2;
  for (const [key, value] of anySet.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  throw new Error(`no document template ${local}`);
}

/** The three shipped Difficulty Presets (content-expansion scales them per city). */
const PRESET_IDS = ['easy', 'standard', 'hard'] as const;
const CABLE_TEMPLATE = docTemplate('cable-hq-directive');
const START: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// generate() inputs
// ---------------------------------------------------------------------------

/** A minimal valid scenario config placing the game in `city`, with the mole flag. */
function scenario(city: string, mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    setting: { city },
    mole,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function generateInputs(
  set: ContentSetV2,
  city: string,
  mole: boolean,
  p: DifficultyPreset,
): GenerateInputs {
  return {
    content: set,
    preset: p,
    scenario: scenario(city, mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

// ---------------------------------------------------------------------------
// Rebuild the setting + core + first-noise stream for a seed and shipped city
//
// Mirrors solvability-every-city.property.spec.ts: slice step 1 is the setting
// step on the setting stream `derive(seed, 0x30000 + 0)` (drawSetting →
// yearFilter → instantiateCity → foldInstantiatedCity), so the rebuilt core
// stream starts at step 2 for the same city `generate()` built. The pieces this
// produces are exactly the DiscoveryInputs the gate verified and the
// Side-Thread cast slice Property 21 reads.
// ---------------------------------------------------------------------------

interface Rebuilt {
  readonly inputs: DiscoveryInputs;
  readonly principals: ReturnType<typeof generatePrincipals>;
  readonly sideThreads: ReturnType<typeof generateSideThreads>;
}

function rebuild(
  set: ContentSetV2,
  city: string,
  seed: string,
  mole: boolean,
  p: DifficultyPreset,
): Rebuilt {
  // Setting step (attempt 0) on the setting stream, matching generate()'s
  // runSettingStep exactly: one setting prng draws the Start Date, then
  // instantiateCity draws the city from the same stream (so the stream is at
  // the position generate() left it after the Start-Date draw).
  const settingPrng = createPrng(settingStreamSeed(seed, 0));
  const selection = drawSetting(set, { city }, settingPrng, 0);
  const filtered = yearFilter(set, selection.year, city);
  const bundle = filtered.cities[city];
  if (bundle === undefined) {
    throw new Error(`rebuild: no bundle for ${city}`);
  }
  const instantiated = instantiateCity(
    bundle,
    selection.year,
    filtered.tagVocabulary,
    settingPrng,
  );
  if (instantiated === 'infeasible') {
    throw new Error(`rebuild: shipped city "${city}" was infeasible for seed "${seed}"`);
  }
  const folded = foldInstantiatedCity(
    instantiated,
    bundle,
    set,
    startMonthOf(selection.startDate),
  );
  const builtCity = folded.city;

  // Core stream, starting at step 2 (the setting step owns step 1).
  const prng = createPrng(seed);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, set, descriptors, builtCity, orgs);
  const { plot } = generatePlot(prng, set, p, builtCity, orgs, principals, START);
  const comms = generateComms(prng, set, builtCity, orgs, principals, plot, START);
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    builtCity,
    { hqFalseBeliefRate: p.hqFalseBeliefRate },
    { mole },
  );
  const { brief } = generateStartingBrief(
    seed,
    set,
    builtCity,
    principals,
    comms,
    knowledge.station,
    CABLE_TEMPLATE,
    { city: builtCity, npcs: principals.npcs, orgs: orgs.orgs },
    { startingBudget: p.startingBudget },
  );

  // The Side Threads the noise stream seats (slice Property 21 reads their
  // cast): Background NPCs first, then Side Threads, on the first noise attempt
  // stream derive(seed, NOISE_STREAM_BASE), matching generate().
  const noisePrng = createPrng(derive(seed, NOISE_STREAM_BASE));
  const principalNames = new Set<string>(
    Object.values(principals.npcs).map((npc) => npc.persona.name),
  );
  const background = generateBackgroundNpcs(
    noisePrng,
    set,
    descriptors,
    builtCity,
    orgs,
    p.noiseCounts.backgroundNpcs,
    principalNames,
  );
  const sideThreads = generateSideThreads(
    noisePrng,
    set,
    builtCity,
    principals,
    background.npcs,
    p.noiseCounts.sideThreads,
    START,
  );

  return {
    inputs: {
      brief,
      plot,
      knowledge,
      comms,
      city: builtCity,
      orgs,
      principals,
    },
    principals,
    sideThreads,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Assert slice Properties 2 and 19 over the rebuilt DiscoveryInputs. */
function assertSolvable(rebuilt: Rebuilt, mole: boolean): void {
  const result = verifyDiscoveryPaths(rebuilt.inputs);

  expect(result.ok).toBe(true);
  expect(result.failure).toBeUndefined();

  const coveredStageIds = new Set(result.stages.map((s) => s.stage));
  for (const stage of rebuilt.inputs.plot.stages) {
    expect(coveredStageIds.has(stage.id)).toBe(true);
  }
  for (const report of result.stages) {
    expect(isHumanEdge(report.human.edge)).toBe(true);
    expect(isSignalEdge(report.signal.edge)).toBe(true);
    expect(witnessesDisjoint(report.human, report.signal)).toBe(true);
  }

  if (mole) {
    const moleReport = result.mole;
    expect(moleReport).toBeDefined();
    if (moleReport === undefined) {
      throw new Error('expected a mole report when the mole is enabled');
    }
    expect(isHumanEdge(moleReport.human.edge)).toBe(true);
    expect(isSignalEdge(moleReport.signal.edge)).toBe(true);
    expect(witnessesDisjoint(moleReport.human, moleReport.signal)).toBe(true);
  } else {
    expect(result.mole).toBeUndefined();
  }
}

/** Assert slice Property 21: no Side Thread seats a Cell member or hostile officer. */
function assertNoCellOnSideThreads(rebuilt: Rebuilt): void {
  for (const thread of rebuilt.sideThreads.sideThreads) {
    expect(threadHasNoCellOrHostile(thread, rebuilt.principals)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// 1. One world per shipped city and preset (Req 18.2, 18.3, 18.5)
// ---------------------------------------------------------------------------

describe('Feature: content-expansion, task 10.2 — shipped-city generation', () => {
  const FIXED_SEED = 'shipped-10-2';

  for (const city of SHIPPED) {
    for (const presetId of PRESET_IDS) {
      it(`generates a solvable world placed in ${city.cityId} on the ${presetId} preset`, () => {
        const set = setFor(city.cityId);
        const p = preset(presetId);

        // A world is produced and placed in the City Pack (not the Core City).
        const world = generate(FIXED_SEED, generateInputs(set, city.cityId, false, p));
        expect(world.meta.seed).toBe(FIXED_SEED);
        expect(world.meta.setting.city).toBe(city.cityId);
        expect(world.meta.setting.city).not.toBe('core');

        // Property 13: rebuild the identical setting + core stream and assert the
        // discovery verifier's structural guarantees over the same world the gate
        // verified, plus slice Property 21.
        const rebuilt = rebuild(set, city.cityId, FIXED_SEED, false, p);
        assertSolvable(rebuilt, false);
        assertNoCellOnSideThreads(rebuilt);
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Vienna uses city-vienna, not the Core City (Req 9.7)
  // -------------------------------------------------------------------------

  it('places a Vienna scenario in city-vienna, not the procedural Core City (Req 9.7)', () => {
    const viennaId = 'city-vienna/vienna';
    const set = setFor(viennaId);

    for (const presetId of PRESET_IDS) {
      const p = preset(presetId);
      const world = generate('vienna-not-core', generateInputs(set, viennaId, false, p));
      // The authored City Pack id, never the Core City.
      expect(world.meta.setting.city).toBe(viennaId);
      expect(world.meta.setting.city).not.toBe('core');
      // The displayed city name is Vienna's, read off the shipped City Definition.
      expect(world.city.displayName.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Property 13 over the shipped City Packs with random seeds (Req 9.7)
// ---------------------------------------------------------------------------

describe('Feature: content-expansion, Property 13 over the shipped City Packs (Req 9.7)', () => {
  it('every shipped city, preset and random seed yields a solvable world in that city', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SHIPPED.map((c) => c.cityId)),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        // A random, non-trivial seed string drives drawSetting's Start-Date draw
        // and the whole generator stream.
        fc.string({ minLength: 1, maxLength: 24 }),
        (cityId, presetId, mole, seed) => {
          const set = setFor(cityId);
          const p = preset(presetId);

          // generate() returns only a gate-verified world placed in the City Pack.
          const world = generate(seed, generateInputs(set, cityId, mole, p));
          expect(world.meta.seed).toBe(seed);
          expect(world.meta.setting.city).toBe(cityId);

          // Property 13: the rebuilt discovery inputs are solvable, and no Side
          // Thread seats a Cell member or hostile (slice Property 21).
          const rebuilt = rebuild(set, cityId, seed, mole, p);
          assertSolvable(rebuilt, mole);
          assertNoCellOnSideThreads(rebuilt);
        },
      ),
      { numRuns: 60 },
    );
  });
});
