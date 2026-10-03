/**
 * Unit and smoke tests for the setting wiring (content-expansion task 3.17).
 *
 * Task 3.8 wired the setting step into `generate()`: slice step 1 (the city)
 * now runs on the setting stream, a City Pack replaces the Core City Path with
 * `instantiateCity`, and a city that stays infeasible across every setting
 * attempt raises a `GeneratorError { seed, city }` (content-expansion Req 9.9).
 * Task 3.6 added currency scaling, the Local Terms glossary and the Specifics
 * Guard allowed-name set. This spec locks in that wiring with unit and smoke
 * tests (not a property test); the property tests for the setting step live in
 * the sibling `*.property.spec.ts` files.
 *
 * It covers:
 *
 * - **Core-pack smoke (Req 1.7).** The core pack alone still generates a
 *   verifiable Core City world through the setting wiring — the slice content
 *   smoke test the setting step must not disturb. Determinism is re-checked so
 *   the once-only golden-replay re-record stays reproducible: the same seed and
 *   inputs yield a byte-identical world under the bumped generator version.
 * - **The `GeneratorError` infeasible-city path (Req 9.9).** With a City Pack
 *   whose Tag Vocabulary names a Required Query no Location can bind,
 *   `instantiateCity` returns `'infeasible'` on every setting attempt, so
 *   `generate` exhausts the setting budget and throws a `GeneratorError` whose
 *   `phase` is `setting` and whose `city` names the City Pack.
 * - **Currency scaling (Req 9.6).** The chosen city's `budgetScale` and
 *   `rounding` scale the preset's starting Budget and the scenario money bundle
 *   at preset resolution, and the Core City (scale 1, rounding 1) is the
 *   identity.
 * - **Specifics Guard acceptance of `allowNames` (Req 8.6).** The chosen city's
 *   Locale `allowNames` plus its Local Terms join the Specifics Guard
 *   allowed-name set.
 * - **Local Terms in the glossary (Req 8.5).** The chosen city's Local Terms
 *   join the help glossary.
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
  type CityDefinition,
  type CityLocation,
  type CityRoute,
  type ContentSet,
  type Currency,
  type DescriptorData,
  type DifficultyPreset,
  type District,
  type GlossaryTerm,
  type Locale,
  type LocationType,
  type PublicText,
  type RequiredQuery,
  type TagVocabulary,
  type WeatherTables,
} from '@tradecraft/content';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from '../config/scenario-config.js';
import { verifyDiscoveryPaths } from '../city/discovery.js';
import {
  GENERATOR_VERSION,
  GeneratorError,
  generate,
  type GenerateInputs,
} from '../generate.js';
import type { CityBundle, ContentSetV2, EraBundle } from './content-set-v2.js';
import { buildLocaleContext } from './locale-render.js';
import {
  glossaryWithLocalTerms,
  specificsAllowedNames,
} from './locale-terms.js';
import {
  scaleMoney,
  scaleMoneyPolicy,
  scalePreset,
  type MoneyPolicy,
} from './currency.js';

// ---------------------------------------------------------------------------
// Loading the real core pack (the slice content smoke test's inputs)
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

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

/** A minimal valid scenario config with the chosen setting city. */
function scenario(city = 'core'): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    setting: { city },
    mole: false,
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

/** The `GenerateInputs` for a given scenario (core-only Content Set). */
function inputsFor(sc: ScenarioConfig): GenerateInputs {
  return {
    content,
    preset: STANDARD,
    scenario: sc,
    cityData,
    descriptors,
    publicTexts,
  };
}

// ---------------------------------------------------------------------------
// Core-pack smoke test (Req 1.7): the setting wiring leaves the Core City
// generating a verifiable, deterministic world under the bumped version.
// ---------------------------------------------------------------------------

describe('setting wiring — core pack alone still generates a verifiable world (Req 1.7)', () => {
  const SEEDS = ['alpha', 'bravo', 'charlie', 'smoke-1'];

  it('generates a verifiable Core City world for every seed (slice content smoke)', () => {
    for (const seed of SEEDS) {
      // Spy on the discovery gate to witness that attempt 0 already passes for
      // the core pack through the setting wiring — the gate is not vacuously
      // satisfied, and `generate` returns only when the gate accepts.
      let firstOk: boolean | undefined;
      const spy: typeof verifyDiscoveryPaths = (args) => {
        const r = verifyDiscoveryPaths(args);
        if (firstOk === undefined) {
          firstOk = r.ok;
        }
        return r;
      };
      const world = generate(seed, inputsFor(scenario('core')), {
        verifier: spy,
      });
      expect(firstOk).toBe(true);
      // The world is populated by the core-stream steps on the Core City Path.
      expect(world.meta.seed).toBe(seed);
      expect(Object.keys(world.city.locations).length).toBeGreaterThan(0);
      expect(world.plot.stages.length).toBeGreaterThan(0);
      expect(Object.keys(world.npcs).length).toBeGreaterThan(0);
    }
  });

  it('records the Core City on meta.setting and the bumped generator version', () => {
    const world = generate('alpha', inputsFor(scenario('core')));
    expect(world.meta.generatorVersion).toBe(GENERATOR_VERSION);
    expect(world.meta.setting.city).toBe('core');
    // The setting step draws a Start Date and Game Year even for the Core City.
    expect(world.meta.setting.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(world.meta.setting.year).toBeGreaterThan(0);
  });

  it('is byte-identical across two runs (the golden-replay re-record is reproducible)', () => {
    for (const seed of SEEDS) {
      const a = generate(seed, inputsFor(scenario('core')));
      const b = generate(seed, inputsFor(scenario('core')));
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic City Pack fixtures for the GeneratorError infeasible path.
// ---------------------------------------------------------------------------

const INFEASIBLE_CITY_ID = 'city-void/void';

const ERA: EraBundle = {
  id: 'era/cold-war-early',
  period: { from: 1945, to: 1965 },
};

/** A Tag Vocabulary whose single Required Query no Location in the city binds. */
const UNBINDABLE_VOCAB: TagVocabulary = {
  facets: [{ id: 'function', appliesTo: ['location'] }],
  tags: [{ id: 'function:nowhere', description: 'a tag no Location carries' }],
  requiredQueries: [
    {
      id: 'rq-nowhere',
      query: ['function:nowhere'],
      minStatic: 1,
      minInstantiated: 1,
    } satisfies RequiredQuery,
  ],
};

function locationType(id: string): LocationType {
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
    tags: [],
  };
}

function district(local: string): District {
  return {
    id: `city-void/${local}`,
    city: INFEASIBLE_CITY_ID,
    name: local,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: [],
  };
}

function location(local: string, districtLocal: string): CityLocation {
  return {
    id: `city-void/${local}`,
    name: local,
    aliases: [],
    type: 'city-void/cafe',
    district: `city-void/${districtLocal}`,
    public: true,
    description: 'a place',
    atmosphere: [],
    city: INFEASIBLE_CITY_ID,
    // Carries no `function:nowhere` Tag, so the Required Query never binds.
    tags: [],
    basis: 'fictional',
  };
}

function route(a: string, b: string): CityRoute {
  return { a: `city-void/${a}`, b: `city-void/${b}`, cost: 1 };
}

function weatherTables(): WeatherTables {
  const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      [{ id: 'clear', label: 'Clear', weight: 1 }],
    ]),
  ) as WeatherTables['months'];
  return { city: INFEASIBLE_CITY_ID, months };
}

function infeasibleCityDefinition(): CityDefinition {
  return {
    id: INFEASIBLE_CITY_ID,
    name: 'Void',
    country: 'Nowhere',
    climate: 'climate:temperate',
    period: { from: 1948, to: 1960 },
    startDates: { from: '1949-01-01', to: '1955-12-31' },
    currency: {
      name: 'Mark',
      symbol: 'M',
      subunit: 'pfennig',
      format: '{amount} {symbol}',
      rounding: 1,
      budgetScale: 1,
    },
    languages: [{ id: 'de', name: 'German', share: 1 }],
    cultureWeights: [{ group: 'lib/g-main', weight: 1 }],
    services: [],
  };
}

/** A connected City Bundle whose Locations can never bind the Required Query. */
function infeasibleBundle(): CityBundle {
  const districts = [district('d0'), district('d1')];
  const locations = [
    location('d0-c0', 'd0'),
    location('d0-c1', 'd0'),
    location('d1-c0', 'd1'),
    location('d1-c1', 'd1'),
  ];
  const routes = [route('d0', 'd1')];
  return {
    def: infeasibleCityDefinition(),
    districts,
    locations,
    routes,
    locationTypes: [locationType('city-void/cafe')],
    newspapers: [],
    orgs: [],
    weather: weatherTables(),
    covers: [],
    streets: [],
    locale: {} as never,
    variants: [],
    sources: [],
  };
}

/** Spread the loaded core Content Set into a V2 set that adds the void city. */
function setWithInfeasibleCity(): ContentSetV2 {
  return {
    ...(content as ContentSetV2),
    cities: { [INFEASIBLE_CITY_ID]: infeasibleBundle() },
    era: ERA,
    cultureGroups: {},
    descriptorFragments: [],
    cityScopeOwner: {},
    tagVocabulary: UNBINDABLE_VOCAB,
  } as ContentSetV2;
}

// ---------------------------------------------------------------------------
// GeneratorError infeasible-city path (Req 9.9)
// ---------------------------------------------------------------------------

describe('setting wiring — GeneratorError for an infeasible city (Req 9.9)', () => {
  function infeasibleInputs(): GenerateInputs {
    return {
      ...inputsFor(scenario(INFEASIBLE_CITY_ID)),
      content: setWithInfeasibleCity(),
    };
  }

  it('throws a GeneratorError naming the city after exhausting setting attempts', () => {
    expect(() => generate('alpha', infeasibleInputs())).toThrowError(
      GeneratorError,
    );
  });

  it('the error names the seed, the city and the setting phase', () => {
    try {
      generate('doomed', infeasibleInputs());
      throw new Error('expected generate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GeneratorError);
      const gen = err as GeneratorError;
      expect(gen.seed).toBe('doomed');
      // The city instantiation stayed infeasible on every setting attempt, so
      // the setting-phase error names the City Pack (Req 9.9).
      expect(gen.phase).toBe('setting');
      expect(gen.city).toBe(INFEASIBLE_CITY_ID);
      // No core discovery result was produced (the core stream never ran), so
      // the message reports the infeasibility reason rather than a stage.
      expect(gen.message).toContain('doomed');
      expect(gen.message).toContain(INFEASIBLE_CITY_ID);
      expect(gen.message).toContain('infeasible');
    }
  });

  it('respects a lower injected setting-attempt ceiling', () => {
    try {
      generate('alpha', infeasibleInputs(), { maxSettingAttempts: 2 });
      throw new Error('expected generate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GeneratorError);
      expect((err as GeneratorError).attempts).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Currency scaling at preset resolution (Req 9.6)
// ---------------------------------------------------------------------------

describe('setting wiring — currency scaling (Req 9.6)', () => {
  // A city currency with a non-trivial scale and rounding, as a City Pack sets.
  const SCHILLING: Currency = {
    name: 'Schilling',
    symbol: 'S',
    subunit: 'groschen',
    format: '{amount} {symbol}',
    rounding: 5,
    budgetScale: 10,
  };
  const CREDITS: Currency = {
    name: 'credits',
    symbol: 'cr',
    subunit: 'cr',
    format: '{whole}',
    rounding: 1,
    budgetScale: 1,
  };

  it('scales the preset starting Budget by budgetScale and rounds to the step', () => {
    const scaled = scalePreset(STANDARD, SCHILLING);
    // The real preset's starting Budget, scaled ×10 and rounded to 5.
    expect(scaled.startingBudget).toBe(scaleMoney(STANDARD.startingBudget, SCHILLING));
    expect(scaled.startingBudget % 5).toBe(0);
    // Every other field is carried through unchanged, and the input is pure.
    expect(scaled.id).toBe(STANDARD.id);
    expect(STANDARD.startingBudget).not.toBe(scaled.startingBudget);
  });

  it('scales the scenario money bundle by the same rule', () => {
    const policy: MoneyPolicy = {
      fundsBase: 100,
      fundsCap: 1000,
      retainer: 50,
      pitchAmount: 33,
    };
    const scaled = scaleMoneyPolicy(policy, SCHILLING);
    expect(scaled).toEqual({
      fundsBase: 1000, // 100 ×10 → 1000.
      fundsCap: 10000, // 1000 ×10 → 10000.
      retainer: 500, //  50 ×10 → 500.
      pitchAmount: 330, //  33 ×10 = 330 → nearest 5 = 330.
    });
  });

  it('is the identity for the Core City currency (slice money numbers unchanged)', () => {
    expect(scalePreset(STANDARD, CREDITS).startingBudget).toBe(
      STANDARD.startingBudget,
    );
    expect(scaleMoney(1234, CREDITS)).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// Local Terms glossary (Req 8.5) and Specifics Guard allowNames (Req 8.6)
// ---------------------------------------------------------------------------

describe('setting wiring — Locale glossary and Specifics Guard (Req 8.5, 8.6)', () => {
  const CITY_ID = 'city-vienna/vienna';

  const CITY_LOCALE: Locale = {
    scope: { city: CITY_ID },
    date: {
      long: '{weekday}, {day} {month} {year}',
      short: '{day}/{month}/{year}',
      months: [
        'Jänner',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember',
      ],
      weekdays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    },
    currency: { pattern: '{amount} {symbol}' },
    honorifics: { f: ['Frau'], m: ['Herr'] },
    address: '{street} {number}, {district}',
    terms: [
      { term: 'Kaffeehaus', definition: 'a Viennese coffee house' },
      { term: 'Ringstrasse', definition: 'the boulevard encircling the old city' },
    ],
    allowNames: ['Prater', 'Stephansdom'],
  };

  function viennaBundle(): CityBundle {
    return {
      def: {
        ...infeasibleCityDefinition(),
        id: CITY_ID,
        name: 'Vienna',
      },
      districts: [],
      locations: [],
      routes: [],
      locationTypes: [],
      newspapers: [],
      orgs: [],
      weather: { city: CITY_ID, months: {} } as unknown as WeatherTables,
      covers: [],
      streets: [],
      locale: CITY_LOCALE,
      variants: [],
      sources: [],
    };
  }

  function viennaSet(): ContentSetV2 {
    return {
      ...(content as ContentSetV2),
      cities: { [CITY_ID]: viennaBundle() },
      era: ERA,
      cultureGroups: {},
      descriptorFragments: [],
      cityScopeOwner: {},
      tagVocabulary: UNBINDABLE_VOCAB,
    } as ContentSetV2;
  }

  const CTX = buildLocaleContext(viennaSet(), CITY_ID, '1950-01-01');

  it('adds the city Local Terms to the help glossary (Req 8.5)', () => {
    const base = new Map<string, GlossaryTerm>([
      ['Asset', { term: 'Asset', definition: 'a recruited source' }],
    ]);
    const merged = glossaryWithLocalTerms(base, CTX);
    // The base term survives and the city's Local Terms are added.
    expect(merged.get('Asset')?.definition).toBe('a recruited source');
    expect(merged.get('Kaffeehaus')?.definition).toBe('a Viennese coffee house');
    expect(merged.get('Ringstrasse')?.definition).toContain('boulevard');
    // The base map is not mutated.
    expect(base.has('Kaffeehaus')).toBe(false);
  });

  it('adds the city allowNames and Local Terms to the Specifics Guard set (Req 8.6)', () => {
    const allowed = specificsAllowedNames(CTX);
    // allowNames first (authored order), then the Local Terms, de-duplicated.
    expect(allowed).toEqual([
      'Prater',
      'Stephansdom',
      'Kaffeehaus',
      'Ringstrasse',
    ]);
  });
});
