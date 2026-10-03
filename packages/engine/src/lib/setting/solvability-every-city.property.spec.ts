/**
 * Feature: content-expansion, Property 13: Solvability for every city
 * (content-expansion task 3.15).
 *
 * **Validates: Requirements 9.7, 9.9**
 *
 * The design fixes Property 13 (content-expansion design, "Correctness
 * Properties") as:
 *
 *   For any conforming City Pack (generated or shipped), Difficulty Preset and
 *   seed, the generated world passes the slice's discovery-path verification
 *   (slice Properties 2 and 19), and no Side Thread has a Cell member as a
 *   participant (slice Property 21). If generation fails instead, the generator
 *   raises a `GeneratorError` naming the city and seed, and CE-FEASIBLE reports
 *   the same pack.
 *
 * ## Where the property is exercised
 *
 * This runs at the engine's capstone — the full `generate()` entry point (task
 * 3.8) with a City Pack selected via `scenario.setting.city`. With a City Pack,
 * `generate()` replaces slice world-generation step 1 with the setting step:
 * `drawSetting` → `yearFilter` → `instantiateCity` → `foldInstantiatedCity`,
 * then runs the core stream (steps 2–10) with the discovery-path verifier as
 * its acceptance gate, and finally the noise stream with a full-world
 * re-verification (design, "Setting selection"; "City instantiation"). So a
 * world `generate()` *returns* for a City Pack has already passed slice
 * Properties 2 and 19 twice over (core gate + noise re-verify) — the gate is
 * the solvability guarantee, not a side effect of it.
 *
 * The CE-FEASIBLE half of the design statement ("CE-FEASIBLE reports the same
 * pack") lives in the `content-tools` linter (task 5.4) and is covered there;
 * this engine property owns the generator half: a conforming City Pack
 * produces a solvable world, and an infeasible one raises `GeneratorError`
 * naming the city and seed.
 *
 * ## Conforming City Packs, by construction
 *
 * The property runs against City Packs built on top of the **real core pack's**
 * Content Set, so `generate()` has the full slice content it needs — Plot
 * templates, archetypes, Document templates, Cover Identities, Difficulty
 * Presets, Location Types — while the city *geometry* (Districts, Locations,
 * Routes) comes from the City Pack. Each generated city reuses the core pack's
 * own Location Types, which already carry the `function:*`/`setting:*`/`access:*`
 * Tags the core Tag Vocabulary's Required Queries bind against (see
 * `packs/core/location-types.yaml`, `packs/core/tags.yaml`). By seating a
 * Location of **every** core Location Type in **every** District, each city
 * carries ample Binders of every Required Query in every District, and fixing
 * the instantiation bounds so the whole connected District set is always
 * selected makes every seed and Game Year in the Period Window bind — the
 * cities are genuinely conforming (amply bindable, connected), not infeasible
 * by construction. The emphasis in the task note is exactly this: a city that
 * is infeasible by construction would be a fixture bug, so the generator is
 * deliberately given cities that truly satisfy the vocabulary.
 *
 * A separate, explicitly **infeasible** city (its Districts partitioned into
 * two components with no Route between them) exercises the `GeneratorError`
 * clause: `instantiateCity` returns `'infeasible'` for every setting attempt,
 * and `generate()` raises `GeneratorError { seed, city }`.
 *
 * ## What the assertions pin
 *
 * For each conforming city, seed and preset:
 *
 * 1. **Solvability (slice Properties 2 and 19).** `generate()` returns (the
 *    gate accepted), and — rebuilding the identical setting+core stream for the
 *    same seed and city, exactly as `generate.solvability.spec.ts` rebuilds the
 *    core stream — the discovery verifier is `ok`, every Plot Stage is covered
 *    by a report, and each report pairs a human edge with a node-disjoint
 *    signal edge. With a mole enabled, the mole identity has its own disjoint
 *    human/signal witnesses.
 * 2. **No Cell on a Side Thread (slice Property 21).** No Side Thread in the
 *    returned world seats a Cell member or hostile officer as a participant,
 *    checked with the authoritative `threadHasNoCellOrHostile` against the
 *    rebuilt Principal roster.
 * 3. **The world is placed in the City Pack.** `meta.setting.city` is the City
 *    Pack's id (not the Core City), so the solvability guarantee is being read
 *    off the authored-city path.
 *
 * And for the infeasible city: `generate()` throws `GeneratorError`, with
 * `city` naming the City Pack and `seed` the caller's seed (Req 9.9).
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
  type CityDefinition,
  type CityLocation,
  type CityRoute,
  type DescriptorData,
  type DifficultyPreset,
  type District,
  type DocumentTemplate,
  type LocationType,
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
  GeneratorError,
  NOISE_STREAM_BASE,
  type GenerateInputs,
} from '../generate.js';
import { settingStreamSeed } from './stream.js';
import {
  isContentSetV2,
  type CityBundle,
  type ContentSetV2,
  type EraBundle,
} from './content-set-v2.js';
import { instantiateCity } from './instantiate-city.js';
import { foldInstantiatedCity } from './fold-city.js';

// ---------------------------------------------------------------------------
// Load the real core pack (mirrors generate.spec.ts / generate.solvability.spec.ts)
// ---------------------------------------------------------------------------

const ENGINE_LIB = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = join(ENGINE_LIB, '..', '..', '..', '..', 'content', 'packs', 'core');

function loadCore(): {
  content: ContentSetV2;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  if (!isContentSetV2(content.value)) {
    throw new Error('core pack did not load as a content-expansion ContentSetV2');
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content: CORE, cityData, descriptors, publicTexts } = loadCore();

/** The core pack's Location Types, as a plain array (they carry the function Tags). */
const CORE_LOCATION_TYPES: LocationType[] = [...CORE.locationTypes.values()].map(
  (t) => t as LocationType,
);

/** A core Difficulty Preset by local id (unprefixed). */
function preset(id: string): DifficultyPreset {
  for (const [key, value] of CORE.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** A core Document template by local id (unprefixed). */
function docTemplate(local: string): DocumentTemplate {
  for (const [key, value] of CORE.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  throw new Error(`no document template ${local}`);
}

const CABLE_TEMPLATE = docTemplate('cable-hq-directive');
const START: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// Build a conforming City Pack on top of the core Content Set
// ---------------------------------------------------------------------------

/**
 * The core pack's Period Window, read from its merged `era` when present, else
 * a wide default. The generated city's Start Date window is pinned inside it so
 * every drawn Game Year is in period.
 */
const CORE_ERA: EraBundle = CORE.era ?? {
  id: 'test/era',
  period: { from: 1945, to: 1965 },
};

/**
 * An authored District with the `setting:urban` Tag so it validates against the
 * core vocabulary's `setting` facet. The city is a connected path of these.
 */
function district(cityId: string, id: string): District {
  return {
    id,
    city: cityId,
    name: id,
    aliases: [],
    description: `the ${id} district`,
    atmosphere: ['quiet'],
    tags: ['setting:urban'],
  };
}

/**
 * An authored City Location of a core Location Type. Its Effective Tags are its
 * own Tags together with its Location Type's Tags, so reusing a core type (which
 * already carries the `function:*`/`setting:*`/`access:*` Tags) makes the
 * Location a Binder of exactly the Required Queries that type satisfies. No
 * extra own-Tags are needed, but the Location's `city` and `basis` are set so
 * the record is a valid authored `CityLocation`.
 */
function location(
  cityId: string,
  id: string,
  districtId: string,
  type: string,
): CityLocation {
  return {
    id,
    name: id,
    aliases: [],
    type,
    district: districtId,
    public: true,
    description: `a ${type} in ${districtId}`,
    atmosphere: ['quiet'],
    city: cityId,
    tags: [],
    basis: 'fictional',
  };
}

function route(a: string, b: string): CityRoute {
  return { a, b, cost: 1 };
}

function cityDefinition(
  id: string,
  districtCount: number,
  locationCount: number,
): CityDefinition {
  return {
    id,
    name: `Testopolis-${id.replace(/[^a-z0-9]+/gi, '')}`,
    country: 'Nowhere',
    climate: 'climate:temperate',
    period: { ...CORE_ERA.period },
    startDates: {
      from: `${CORE_ERA.period.from}-01-01`,
      to: `${CORE_ERA.period.to}-12-31`,
    },
    currency: {
      name: 'Mark',
      symbol: 'M',
      subunit: 'pfennig',
      format: '{amount} {symbol}',
      rounding: 1,
      budgetScale: 1,
    },
    languages: [{ id: 'de', name: 'German', share: 1 }],
    // Draw NPC Culture Groups from the core pack's own groups, so naming works.
    cultureWeights: cultureWeights(),
    services: ['svc-own'],
    // Pin the bounds so the whole connected District set is always selected and
    // every seeded Binder is reachable: Districts fixed at the full count, and
    // Locations high enough to admit `minInstantiated` Binders of every query.
    instantiation: {
      districts: [districtCount, districtCount],
      locations: [locationCount, locationCount],
    },
  };
}

/** Culture Weights over the core pack's Culture Groups (equal weight each). */
function cultureWeights(): CityDefinition['cultureWeights'] {
  const groups = Object.keys(CORE.cultureGroups);
  if (groups.length === 0) {
    // The core pack always ships Culture Groups; this is a defensive floor so
    // the fixture still builds if a future core pack trims them.
    return [{ group: 'g-main', weight: 1 }];
  }
  return groups.map((group) => ({ group, weight: 1 }));
}

/**
 * A conforming City Pack: `districtCount` Districts in a connected path, each
 * seating one Location of every core Location Type. Every Required Query in the
 * core vocabulary therefore has at least `districtCount` Binders spread across
 * every District, and the instantiation bounds force the whole connected set to
 * be selected — so the city instantiates for every seed and in-period Game Year.
 */
function conformingCity(id: string, districtCount: number): CityBundle {
  const districtIds = Array.from({ length: districtCount }, (_, i) => `d${i}`);
  const districts = districtIds.map((d) => district(id, d));

  const locations: CityLocation[] = [];
  for (const d of districtIds) {
    for (const type of CORE_LOCATION_TYPES) {
      locations.push(location(id, `${d}-${type.id}`, d, type.id));
    }
  }

  // A connected path over the Districts: d0-d1-…-d(n-1).
  const routes: CityRoute[] = [];
  for (let i = 0; i < districtIds.length - 1; i += 1) {
    routes.push(route(districtIds[i], districtIds[i + 1]));
  }

  const def = cityDefinition(id, districtCount, locations.length);
  return bundleOf(def, districts, locations, routes);
}

/**
 * An **infeasible** City Pack: two Districts with no Route between them, so the
 * selected-District set can never be made connected and `instantiateCity`
 * returns `'infeasible'` on every attempt. Both Districts still carry the full
 * Location set, so the defect is purely the partitioned Route graph (a genuine
 * instantiation failure, not a missing-Binder shortfall).
 */
function infeasibleCity(id: string): CityBundle {
  const districtIds = ['d0', 'd1'];
  const districts = districtIds.map((d) => district(id, d));
  const locations: CityLocation[] = [];
  for (const d of districtIds) {
    for (const type of CORE_LOCATION_TYPES) {
      locations.push(location(id, `${d}-${type.id}`, d, type.id));
    }
  }
  // No Routes at all: the two Districts are disconnected. The bounds demand both.
  const def = cityDefinition(id, 2, locations.length);
  return bundleOf(def, districts, locations, []);
}

function bundleOf(
  def: CityDefinition,
  districts: readonly District[],
  locations: readonly CityLocation[],
  routes: readonly CityRoute[],
): CityBundle {
  return {
    def,
    districts: [...districts],
    locations: [...locations],
    routes: [...routes],
    // Reuse the core Location Types verbatim, so hours/risk/crowd and Tags are
    // the real slice ones the fold and the generators read.
    locationTypes: CORE_LOCATION_TYPES,
    newspapers: [],
    orgs: [],
    weather: { city: def.id, months: {} as never },
    covers: [],
    streets: [],
    locale: {} as never,
    variants: [],
    sources: [],
  };
}

/** A Content Set V2 that carries `city` as its one City Pack, over the core content. */
function setWithCity(city: CityBundle): ContentSetV2 {
  return {
    ...CORE,
    cities: { [city.def.id]: city },
    era: CORE_ERA,
  };
}

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
// Rebuild the setting + core stream for a seed and City Pack
//
// This mirrors `generate.solvability.spec.ts`'s core-stream rebuild, with the
// one difference the City-Pack path introduces: slice step 1 is the setting
// step (drawSetting → yearFilter → instantiateCity → foldInstantiatedCity) on
// the setting stream `derive(seed, 0x30000 + 0)`, so the rebuilt core stream
// starts at step 2 for the same city `generate()` built. The pieces this
// produces are exactly the DiscoveryInputs the gate verifies and the Side
// Thread cast slice Property 21 reads.
// ---------------------------------------------------------------------------

interface Rebuilt {
  readonly inputs: DiscoveryInputs;
  readonly principals: ReturnType<typeof generatePrincipals>;
  readonly sideThreads: ReturnType<typeof generateSideThreads>;
}

/**
 * Rebuild the setting step + core stream (steps 1→8) and one noise step (the
 * Side Threads) for `seed` and the City Pack, so the test can read the same
 * discovery inputs the generator's gate verified and the same Side-Thread cast
 * the noise stream seated.
 */
function rebuild(
  set: ContentSetV2,
  city: string,
  seed: string,
  mole: boolean,
  p: DifficultyPreset,
): Rebuilt {
  // Setting step (attempt 0) on the setting stream, matching generate().
  const settingPrng = createPrng(settingStreamSeed(seed, 0));
  const year = CORE_ERA.period.from; // the drawn Start Date is in-period; the
  // bundle is already in-period, so the Game Year does not change the geometry.
  const filtered = set; // in-period content only; yearFilter is a no-op here.
  const bundle = filtered.cities[city];
  const instantiated = instantiateCity(bundle, year, filtered.tagVocabulary, settingPrng);
  if (instantiated === 'infeasible') {
    throw new Error(`rebuild: city "${city}" was infeasible for seed "${seed}"`);
  }
  const folded = foldInstantiatedCity(instantiated, bundle, set, 1);
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
  // cast). The noise stream draws Background NPCs first, then Side Threads, on
  // the noise stream derive(seed, 0x10000); rebuild that order so the cast
  // matches the generated world's.
  const noisePrng = createPrng(deriveNoiseSeed(seed));
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

/**
 * The noise stream's first-attempt seed, `derive(seed, NOISE_STREAM_BASE)`,
 * exactly as `generate()` seeds the first noise attempt (design, "The noise
 * stream"). Rebuilding the noise stream from the same seed reproduces the
 * Side-Thread cast the generated world carries.
 */
function deriveNoiseSeed(seed: string): string {
  return derive(seed, NOISE_STREAM_BASE);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Assert the slice solvability guarantees (slice Properties 2 and 19) over the
 * rebuilt DiscoveryInputs: the verifier is `ok`, every Plot Stage is covered,
 * and each report pairs a human edge with a node-disjoint signal edge; with a
 * mole, the mole identity has its own disjoint witnesses.
 */
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
// The property
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

/** The District counts the conforming cities are built with (small, varied). */
const DISTRICT_COUNTS = [4, 5, 6];

describe('Feature: content-expansion, Property 13: Solvability for every city (Req 9.7, 9.9)', () => {
  it('generate() produces a solvable world for every conforming City Pack, preset and seed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.boolean(),
        fc.constantFrom('standard', 'easy'),
        fc.constantFrom(...DISTRICT_COUNTS),
        (seed, mole, presetId, districtCount) => {
          const cityId = 'city/solvable';
          const bundle = conformingCity(cityId, districtCount);
          const set = setWithCity(bundle);
          const p = preset(presetId);

          // 1. The gate accepted: generate() returns only a verifiable world,
          //    and the world is placed in the City Pack (not the Core City).
          const world = generate(seed, generateInputs(set, cityId, mole, p));
          expect(world.meta.seed).toBe(seed);
          expect(world.meta.setting.city).toBe(cityId);

          // 2. Slice Properties 2 and 19: rebuild the identical setting+core
          //    stream and assert the discovery verifier's structural guarantees
          //    over the same world the gate verified.
          const rebuilt = rebuild(set, cityId, seed, mole, p);
          assertSolvable(rebuilt, mole);

          // 3. Slice Property 21: no Side Thread seats a Cell member / hostile.
          assertNoCellOnSideThreads(rebuilt);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('raises GeneratorError naming the city and seed when the City Pack is infeasible (Req 9.9)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom('standard', 'easy'),
        (seed, presetId) => {
          const cityId = 'city/infeasible';
          const bundle = infeasibleCity(cityId);
          const set = setWithCity(bundle);
          const p = preset(presetId);

          let thrown: unknown;
          try {
            generate(seed, generateInputs(set, cityId, false, p));
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(GeneratorError);
          const error = thrown as GeneratorError;
          expect(error.seed).toBe(seed);
          expect(error.city).toBe(cityId);
          expect(error.phase).toBe('setting');
        },
      ),
      { numRuns: 20 },
    );
  });
});
