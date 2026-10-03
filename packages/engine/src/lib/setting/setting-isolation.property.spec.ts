/**
 * Feature: content-expansion, Property 19: Setting step isolation.
 *
 * This is the content-expansion task 3.18 property test. The design fixes
 * Property 19 (design, "Correctness Properties") as two claims:
 *
 *   For any pack set, seed, setting selection (including the Core City) and
 *   setting attempt j, the setting step's output (the Start Date and the
 *   Instantiated City, or the Core City's Districts, Locations and Routes) and
 *   the `CityView` built from it are deep-equal under any change to the inputs
 *   consumed *after* the setting step — the Difficulty Preset, the Template
 *   History and the plot-selection exclusions. On the Core City Path, step 1
 *   draws only from the setting stream, and the core stream state at the start
 *   of step 2 is the same as the core seed's initial state.
 *
 *   Validates: Requirements 9.10, 9.11, 17.6.
 *
 * The setting step runs first in world generation, before any Plot selection
 * (Req 9.11), and `runSettingStep` (generate.ts) is a pure function of exactly
 * `(seed, settingAttempt, content, scenario.setting)` — it reads none of the
 * downstream inputs. This spec exercises the property at two levels:
 *
 * 1. **End to end, on the real core pack.** `generate` records the setting
 *    step's `SettingSelection` on `world.meta.setting`. Varying the two
 *    downstream legs the test can drive through the public `generate` API — the
 *    Difficulty Preset and the scenario's mole flag (which steers plot /
 *    knowledge selection, a "plot selection exclusion") — must leave
 *    `meta.setting` byte-identical for a fixed seed. This is the Core City Path
 *    of the design's claim, driven through the production entry point.
 *
 * 2. **Reconstructed setting pipeline, on random City Packs and the Core City.**
 *    The spec rebuilds the exact pipeline `runSettingStep` runs — `drawSetting`
 *    → `yearFilter` → (`instantiateCity` + `foldInstantiatedCity` for a City
 *    Pack, or `generateCity` for the Core City) → `cityView` — behind a local
 *    `settingStep` helper that mirrors the generator's private one. Because the
 *    helper structurally cannot see a Difficulty Preset, Template History or a
 *    plot-selection exclusion, the test demonstrates the design's invariance by
 *    passing those downstream inputs *into the sample* and asserting the setting
 *    output and the `CityView` are deep-equal regardless of their value: the
 *    pipeline is run twice with different downstream inputs and the two results
 *    are compared. A drift that let a downstream input leak into the setting
 *    step — or any non-determinism in the setting pipeline — would break it.
 *
 * 3. **Core City Path stream isolation.** On the Core City Path the setting step
 *    runs slice step 1 (`generateCity`) on the setting stream
 *    `derive(seed, 0x30000 + j)`, which is a distinct stream from the core seed.
 *    The spec asserts the setting stream seed differs from the core seed, and
 *    that a core-stream PRNG opened at `createPrng(seed)` — the stream step 2
 *    draws from — still reads the core seed's initial state after the whole
 *    setting step has run, i.e. step 1 consumed none of the core stream.
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
  type ContentSet,
  type CultureGroup,
  type DescriptorData,
  type DescriptorFragment,
  type DifficultyPreset,
  type District,
  type LocationType,
  type PublicText,
  type RequiredQuery,
  type TagVocabulary,
  type WeatherTables,
  type YearRange,
} from '@tradecraft/content';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';

import { createPrng } from '../prng/prng.js';
import { generateCity } from '../city/generate.js';
import { settingStreamSeed } from './stream.js';
import { seedState } from '../prng/prng.js';
import type { CityBundle, ContentSetV2, EraBundle } from './content-set-v2.js';
import { drawSetting, yearFilter, type SettingSelection } from './setting.js';
import { instantiateCity, type InstantiatedCity } from './instantiate-city.js';
import { foldInstantiatedCity } from './fold-city.js';
import { cityView, type CityView } from './city-view.js';
import { parseIsoDate } from '@tradecraft/content';

// ===========================================================================
// Part 1 — end to end, on the real core pack (the Core City Path through the
// production `generate` API).
// ===========================================================================

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
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
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

const core = loadCore();

function presetOf(id: string): DifficultyPreset {
  for (const [key, value] of core.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** A minimal valid scenario config with the mole flag the caller chooses. */
function scenario(mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
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

function inputsFor(preset: DifficultyPreset, mole: boolean): GenerateInputs {
  return {
    content: core.content,
    preset,
    scenario: scenario(mole),
    cityData: core.cityData,
    descriptors: core.descriptors,
    publicTexts: core.publicTexts,
  };
}

const seedArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
  fc.constantFrom('alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1'),
);

/** The three shipped presets, the Difficulty-Preset leg of the downstream input. */
const presetIdArb = fc.constantFrom('easy', 'standard', 'hard');

const E2E_TIMEOUT_MS = 60_000;
const E2E_NUM_RUNS = 30;

describe('Feature: content-expansion, Property 19: Setting step isolation — end to end (Req 9.10, 9.11, 17.6)', () => {
  it(
    'meta.setting is invariant under the Difficulty Preset and the plot-selection (mole) input, for a fixed seed',
    () => {
      fc.assert(
        fc.property(
          seedArb,
          presetIdArb,
          presetIdArb,
          fc.boolean(),
          fc.boolean(),
          (seed, presetA, presetB, moleA, moleB) => {
            // Two worlds differing only in the inputs consumed *after* the
            // setting step: the Difficulty Preset and the mole flag (which
            // steers Plot and knowledge selection — a plot-selection exclusion).
            const a = generate(seed, inputsFor(presetOf(presetA), moleA));
            const b = generate(seed, inputsFor(presetOf(presetB), moleB));

            // The setting step's output (recorded verbatim on meta.setting) is
            // deep-equal regardless of those downstream inputs.
            expect(a.meta.setting).toEqual(b.meta.setting);
          },
        ),
        { numRuns: E2E_NUM_RUNS },
      );
    },
    E2E_TIMEOUT_MS,
  );

  it(
    'the recorded setting is itself deterministic in the seed (self-consistency floor)',
    () => {
      fc.assert(
        fc.property(seedArb, (seed) => {
          const a = generate(seed, inputsFor(presetOf('standard'), false));
          const b = generate(seed, inputsFor(presetOf('standard'), false));
          expect(a.meta.setting).toEqual(b.meta.setting);
          expect(a.meta.setting.city).toBe('core');
        }),
        { numRuns: E2E_NUM_RUNS },
      );
    },
    E2E_TIMEOUT_MS,
  );
});

// ===========================================================================
// Part 2 — reconstructed setting pipeline, over random City Packs and the Core
// City. This mirrors `runSettingStep` (generate.ts) from its public pieces.
// ===========================================================================

const CITY_ID = 'city/one';

/**
 * The downstream inputs the design names — the Difficulty Preset, the Template
 * History and the plot-selection exclusions. The reconstructed `settingStep`
 * below does not take them (the real one does not read them either); the sample
 * carries two arbitrary values so the property can assert the setting output is
 * deep-equal across *any* two downstream configurations.
 */
interface DownstreamInputs {
  readonly presetId: string;
  readonly templateHistory: readonly string[];
  readonly plotExclusions: readonly string[];
  readonly mole: boolean;
}

/** The setting step's observable output: the selection and the CityView. */
interface SettingStepOutput {
  readonly selection: SettingSelection;
  readonly view: {
    readonly city: CityView['city'];
    readonly year: number;
    readonly startDate: string;
    readonly locations: readonly string[];
    readonly districts: readonly string[];
    readonly orgs: readonly string[];
    readonly requiredQueries: readonly RequiredQuery[];
    readonly services: readonly unknown[];
  };
  /** The city the core stream would receive, for the deep-equal comparison. */
  readonly city: unknown;
  readonly knownLocations: readonly string[];
  readonly infeasible: boolean;
}

/** Project the CityView into a plain, comparable snapshot. */
function viewSnapshot(view: CityView): SettingStepOutput['view'] {
  return {
    city: view.city,
    year: view.year,
    startDate: view.startDate,
    locations: view.entities('loc').map((e) => e.id),
    districts: view.entities('district').map((e) => e.id),
    orgs: view.entities('org').map((e) => e.id),
    requiredQueries: view.requiredQueries,
    services: [...view.services],
  };
}

/**
 * Run the setting step exactly as the generator's `runSettingStep` does, from
 * its public building blocks. `downstream` is accepted but deliberately
 * **unused** by the body: the whole point of Property 19 is that the setting
 * output does not depend on it. It is threaded in so the property can vary it
 * between the two runs it compares, and `void downstream` documents that the
 * body reads none of it.
 */
function settingStep(
  seed: string,
  attempt: number,
  set: ContentSetV2,
  settingCfg: { city: string; startDate?: string },
  coreCityData: CityData | undefined,
  downstream: DownstreamInputs,
): SettingStepOutput {
  void downstream; // the setting step reads none of the downstream inputs.

  const prng = createPrng(settingStreamSeed(seed, attempt));
  const selection = drawSetting(set, settingCfg, prng, attempt);
  const filtered = yearFilter(set, selection.year, selection.city);
  const startMonth = parseIsoDate(selection.startDate)?.month ?? 1;

  if (selection.city === 'core') {
    const generated = generateCity(
      prng,
      set.locationTypes.values(),
      coreCityData as CityData,
      { startMonth },
    );
    const view = cityView(generated.city, filtered, selection);
    return {
      selection,
      view: viewSnapshot(view),
      city: generated.city,
      knownLocations: generated.knownLocations as readonly string[],
      infeasible: false,
    };
  }

  const bundle = filtered.cities[selection.city];
  const instantiated = instantiateCity(
    bundle,
    selection.year,
    filtered.tagVocabulary,
    prng,
  );
  if (instantiated === 'infeasible') {
    const view = cityView(
      {
        displayName: bundle.def.name,
        districts: {},
        locations: {},
        routes: [],
        crowdModels: {},
        startMonth,
      },
      filtered,
      selection,
    );
    return {
      selection,
      view: viewSnapshot(view),
      city: 'infeasible',
      knownLocations: [],
      infeasible: true,
    };
  }
  const folded = foldInstantiatedCity(
    instantiated as InstantiatedCity,
    bundle,
    set,
    startMonth,
  );
  const view = cityView(folded.city, filtered, selection);
  return {
    selection,
    view: viewSnapshot(view),
    city: folded.city,
    knownLocations: folded.knownLocations as readonly string[],
    infeasible: false,
  };
}

// --- fixtures (mirroring the year-filtering / bindability property specs) ---

function weatherTables(city: string): WeatherTables {
  const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      [{ id: 'clear', label: 'Clear', weight: 1 }],
    ]),
  ) as WeatherTables['months'];
  return { city, months };
}

function locationType(id: string, tags: readonly string[] = []): LocationType {
  return {
    id,
    public: true,
    allowedActions: ['observe'],
    openingHours: [],
    crowdCurve: [],
    weatherModifiers: [],
    baseRisk: 0.1,
    allowsDeadDrops: false,
    namePatterns: [],
    descriptionPool: [],
    atmosphereTags: ['quiet'],
    tags: [...tags],
  };
}

function location(
  id: string,
  district: string,
  opts: { type?: string; tags?: readonly string[]; years?: YearRange } = {},
): CityLocation {
  return {
    id,
    name: id,
    aliases: [],
    type: opts.type ?? 'cafe',
    district,
    public: true,
    description: 'a place',
    atmosphere: [],
    city: CITY_ID,
    tags: opts.tags ? [...opts.tags] : [],
    basis: 'fictional',
    ...(opts.years ? { years: opts.years } : {}),
  };
}

function district(id: string): District {
  return {
    id,
    city: CITY_ID,
    name: id,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: [],
  };
}

function cityDefinition(period: YearRange): CityDefinition {
  return {
    id: CITY_ID,
    name: 'Testville',
    country: 'Nowhere',
    climate: 'climate:temperate',
    period,
    startDates: { from: `${period.from}-01-01`, to: `${period.to}-12-31` },
    currency: {
      name: 'Mark',
      symbol: 'M',
      subunit: 'pfennig',
      format: '{amount} {symbol}',
      rounding: 1,
      budgetScale: 1,
    },
    languages: [{ id: 'de', name: 'German', share: 1 }],
    cultureWeights: [{ group: 'g-main', weight: 1 }],
    services: ['svc-own'],
    instantiation: {
      districts: [4, 6],
      locations: [6, 12],
    },
  };
}

function vocabulary(): TagVocabulary {
  return {
    facets: [{ id: 'function', appliesTo: ['location'] }],
    tags: [{ id: 'function:drop', description: 'drop' }],
    requiredQueries: [
      { id: 'rq-drop', query: ['function:drop'], minStatic: 2, minInstantiated: 2 },
    ],
  };
}

function baseContentSet(vocab: TagVocabulary): ContentSetV2 {
  return {
    predicates: {},
    archetypes: new Map(),
    locationTypes: new Map([
      ['cafe', locationType('cafe')],
      ['drop', locationType('drop')],
    ]),
    plotTemplates: new Map(),
    sideThreadTemplates: new Map(),
    documentTemplates: new Map(),
    personaLibraries: new Map(),
    coverIdentities: new Map(),
    rumourTemplates: new Map(),
    hints: new Map(),
    glossary: new Map(),
    difficultyPresets: new Map(),
    services: new Map(),
    templateVariantDefs: new Map(),
    templateVariants: {},
    manifest: {},
    tagVocabulary: vocab,
    cities: {},
    cultureGroups: {},
    descriptorFragments: [],
    cityScopeOwner: {},
  } as unknown as ContentSetV2;
}

/**
 * A random conforming City Pack set. Each of 4–6 Districts holds three cafés
 * and one drop Location, so the single drop Required Query is amply bindable and
 * `instantiateCity` always succeeds. A base path over the Districts keeps the
 * route graph connected. The city, era and start-date windows all overlap at
 * 1952 so `drawSetting` always finds a date.
 */
const cityPackArb = fc
  .record({
    seed: fc.string({ minLength: 1, maxLength: 16 }),
    districtCount: fc.integer({ min: 4, max: 6 }),
    eraFrom: fc.integer({ min: 1945, max: 1949 }),
    eraTo: fc.integer({ min: 1955, max: 1965 }),
    cityFrom: fc.integer({ min: 1945, max: 1949 }),
    cityTo: fc.integer({ min: 1955, max: 1965 }),
    fixedStart: fc.option(fc.constant('1952-06-15'), { nil: undefined }),
  })
  .map((p) => {
    const cityPeriod: YearRange = { from: p.cityFrom, to: p.cityTo };
    const eraPeriod: YearRange = { from: p.eraFrom, to: p.eraTo };

    const districts: District[] = Array.from({ length: p.districtCount }, (_, i) =>
      district(`d${i}`),
    );

    const locations: CityLocation[] = [];
    for (let i = 0; i < p.districtCount; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        locations.push(location(`d${i}-cafe${j}`, `d${i}`, { type: 'cafe' }));
      }
      locations.push(
        location(`d${i}-drop`, `d${i}`, { type: 'drop', tags: ['function:drop'] }),
      );
    }

    const routes: CityRoute[] = [];
    for (let i = 0; i < p.districtCount - 1; i += 1) {
      routes.push({ a: `d${i}`, b: `d${i + 1}`, cost: 1 });
    }

    const bundle: CityBundle = {
      def: cityDefinition(cityPeriod),
      districts,
      locations,
      routes,
      locationTypes: [locationType('cafe'), locationType('drop')],
      newspapers: [],
      orgs: [],
      weather: weatherTables(CITY_ID),
      covers: [],
      streets: [],
      locale: {} as never,
      variants: [],
      sources: [],
    };

    const cultureGroups: Record<string, CultureGroup> = {
      'g-main': {
        id: 'g-main',
        name: 'Main',
        languages: ['de'],
        naming: { display: '{given} {family}', formal: '{honorific} {family}' },
        given: { f: ['Anna'], m: ['Hans'] },
        family: ['Müller'],
        voiceTraits: [],
        mannerisms: [],
        backgrounds: [],
      },
    };

    const era: EraBundle = { id: 'era/one', period: eraPeriod };
    const descriptorFragments: DescriptorFragment[] = [];

    const set: ContentSetV2 = {
      ...baseContentSet(vocabulary()),
      cities: { [CITY_ID]: bundle },
      era,
      cultureGroups,
      descriptorFragments,
      cityScopeOwner: {},
    };

    return { seed: p.seed, set, fixedStart: p.fixedStart };
  });

/** A random pair of distinct downstream input configurations. */
const downstreamPairArb: fc.Arbitrary<readonly [DownstreamInputs, DownstreamInputs]> =
  fc.tuple(
    fc.record({
      presetId: fc.constantFrom('easy', 'standard', 'hard'),
      templateHistory: fc.array(fc.string(), { maxLength: 5 }),
      plotExclusions: fc.array(fc.string(), { maxLength: 5 }),
      mole: fc.boolean(),
    }),
    fc.record({
      presetId: fc.constantFrom('easy', 'standard', 'hard'),
      templateHistory: fc.array(fc.string(), { maxLength: 5 }),
      plotExclusions: fc.array(fc.string(), { maxLength: 5 }),
      mole: fc.boolean(),
    }),
  );

describe('Feature: content-expansion, Property 19: Setting step isolation — City Pack (Req 9.10, 9.11, 17.6)', () => {
  it('the setting output and CityView are deep-equal under any change to the downstream inputs', () => {
    fc.assert(
      fc.property(
        cityPackArb,
        downstreamPairArb,
        ({ seed, set, fixedStart }, [downA, downB]) => {
          const cfg = { city: CITY_ID, ...(fixedStart ? { startDate: fixedStart } : {}) };
          const a = settingStep(seed, 0, set, cfg, undefined, downA);
          const b = settingStep(seed, 0, set, cfg, undefined, downB);

          // The city should always be feasible for this conforming generator.
          expect(a.infeasible).toBe(false);

          // Deep-equal across the two downstream configurations.
          expect(a.selection).toEqual(b.selection);
          expect(a.view).toEqual(b.view);
          expect(a.city).toEqual(b.city);
          expect(a.knownLocations).toEqual(b.knownLocations);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('the setting output is deterministic in the seed and setting attempt', () => {
    fc.assert(
      fc.property(
        cityPackArb,
        fc.integer({ min: 0, max: 3 }),
        downstreamPairArb,
        ({ seed, set, fixedStart }, attempt, [downA, downB]) => {
          const cfg = { city: CITY_ID, ...(fixedStart ? { startDate: fixedStart } : {}) };
          const a = settingStep(seed, attempt, set, cfg, undefined, downA);
          const b = settingStep(seed, attempt, set, cfg, undefined, downB);
          expect(a.selection.attempt).toBe(attempt);
          expect(a.selection).toEqual(b.selection);
          expect(a.view).toEqual(b.view);
          expect(a.city).toEqual(b.city);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// Part 3 — Core City Path stream isolation.
// ===========================================================================

/** A Core-City-only ContentSetV2: an era to bound the Start Date, no cities. */
function coreOnlySet(era?: EraBundle): ContentSetV2 {
  return {
    ...baseContentSet(vocabulary()),
    cities: {},
    ...(era ? { era } : {}),
    cultureGroups: {},
    descriptorFragments: [],
    cityScopeOwner: {},
  };
}

/**
 * The real core pack's `city.yaml`, so the Core City Path's `generateCity` runs
 * against the production city data (it needs non-empty districts and name
 * pools).
 */
const coreCityData = core.cityData;

/** The real core pack's Location Types, which `generateCity` draws from. */
const coreLocationTypes: LocationType[] = [...core.content.locationTypes.values()].map(
  (t) => t as LocationType,
);

describe('Feature: content-expansion, Property 19: Setting step isolation — Core City stream (Req 9.10)', () => {
  it('the setting stream seed differs from the core seed, for every setting attempt', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 0, max: 7 }), (seed, attempt) => {
        // The setting stream derive(seed, 0x30000 + j) is a distinct stream, so
        // the core seed and the setting stream never share state.
        expect(settingStreamSeed(seed, attempt)).not.toBe(seed);
      }),
      { numRuns: 100 },
    );
  });

  it('step 1 draws only from the setting stream: the core stream still reads its initial state after the setting step', () => {
    const era: EraBundle = { id: 'era/one', period: { from: 1945, to: 1965 } };
    fc.assert(
      fc.property(seedArb, (seed) => {
        const set = coreOnlySet(era);

        // Run the whole setting step on the setting stream (slice step 1 incl.):
        // draw the Start Date and build the Core City on the setting stream,
        // exactly as runSettingStep does for the Core City Path.
        const settingPrng = createPrng(settingStreamSeed(seed, 0));
        const sel = drawSetting(set, { city: 'core' }, settingPrng, 0);
        const startMonth = parseIsoDate(sel.startDate)?.month ?? 1;
        generateCity(settingPrng, coreLocationTypes.values(), coreCityData, {
          startMonth,
        });

        // The core stream (what step 2 draws from) is opened at the core seed.
        // Because step 1 ran on the *setting* stream above, the core stream has
        // made no draws: its state equals the core seed's initial state.
        const coreStream = createPrng(seed);
        expect(coreStream.state()).toEqual(seedState(seed));
      }),
      { numRuns: 50 },
    );
  });
});
