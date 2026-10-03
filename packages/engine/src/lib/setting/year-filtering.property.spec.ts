/**
 * Feature: content-expansion, Property 8: Year filtering.
 *
 * The setting step (content-expansion tasks 3.2 and 3.8) draws the game's Start
 * Date and then prunes the Content Set to the Game Year before any later
 * generation step reads it. Property 8 is the end-to-end guarantee that falls
 * out of those two pieces (design, "Property 8: Year filtering"; Req 6.4, 9.2,
 * 9.3): for any pack set, City Pack, seed and optional configured Start Date
 * within range,
 *
 * 1. the drawn Start Date lies within the city's `startDates` window
 *    intersected with the era Period Window (Req 9.2); and
 * 2. every year-ranged content item that reaches the generated world — every
 *    Location, Route, newspaper, local organisation, Culture Weight, persona
 *    background, Descriptor Fragment, District sector and city Template Variant,
 *    and the Locations the `CityView` exposes — has an Effective Year Range that
 *    contains the Game Year (Req 9.3, 6.4).
 *
 * The Effective Year Range of a City-Scoped item is its own `years` intersected
 * with the city Period Window and the era Period Window; a Library item's
 * (persona backgrounds, Descriptor Fragments) is its own `years` intersected
 * with the era Period Window. `yearFilter` is the function under test for the
 * pruning; `drawSetting` for the Start Date; `instantiateCity` + `cityView` for
 * what the generated world actually surfaces. The test exercises the real
 * pipeline the generator runs in `runSettingStep` (`drawSetting` → `yearFilter`
 * → `instantiateCity` → `cityView`), so a drift between the pruning and what the
 * city instantiation / view reads would be caught.
 *
 * The generator produces random **conforming** City Pack sets: a city whose
 * Districts, Locations, Routes, newspapers, orgs, Culture Weights, District
 * sectors and Template Variants carry random Year Ranges (some undated), an Era
 * Pack with a random Period Window, and Culture Groups and Descriptor Fragments
 * with random background / fragment Year Ranges. The city is always amply
 * bindable (every District holds a drop Location) so `instantiateCity` succeeds
 * and the view is exercised for real.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  CityDefinition,
  CityLocation,
  CityRoute,
  CultureGroup,
  DescriptorFragment,
  District,
  LocalOrg,
  LocationType,
  Newspaper,
  RequiredQuery,
  TagVocabulary,
  TemplateVariant,
  WeatherTables,
  YearRange,
} from '@tradecraft/content';
import { daysFromEpoch, parseIsoDate } from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { settingStreamSeed } from './stream.js';
import type { CityBundle, ContentSetV2, EraBundle } from './content-set-v2.js';
import { drawSetting, yearFilter } from './setting.js';
import { instantiateCity, type InstantiatedCity } from './instantiate-city.js';
import { foldInstantiatedCity } from './fold-city.js';
import { cityView } from './city-view.js';

// ---------------------------------------------------------------------------
// Effective Year Range (the design's definition, mirrored for the assertion)
// ---------------------------------------------------------------------------

/**
 * Whether `year` lies inside an item's Effective Year Range: its own `years`
 * (when present) intersected with every supplied bounding Period Window. An
 * item with no own `years` is in range whenever the Game Year is inside the
 * bounding windows. This mirrors `yearInEffectiveRange` in `setting.ts`; it is
 * re-stated here so the test checks the design's rule independently of the code
 * under test rather than importing the same private helper.
 */
function inEffectiveRange(
  year: number,
  own: YearRange | undefined,
  bounds: readonly (YearRange | undefined)[],
): boolean {
  if (own !== undefined && (year < own.from || year > own.to)) {
    return false;
  }
  for (const bound of bounds) {
    if (bound !== undefined && (year < bound.from || year > bound.to)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fixtures and generators
// ---------------------------------------------------------------------------

const CITY_ID = 'city/one';

function weatherTables(city: string): WeatherTables {
  const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      [{ id: 'clear', label: 'Clear', weight: 1 }],
    ]),
  ) as WeatherTables['months'];
  return { city, months };
}

function locationType(id: string, tags: string[] = []): LocationType {
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
    tags,
  };
}

function location(
  id: string,
  district: string,
  opts: { type?: string; tags?: string[]; years?: YearRange } = {},
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
    tags: opts.tags ?? [],
    basis: 'fictional',
    ...(opts.years ? { years: opts.years } : {}),
  };
}

function district(id: string, sector?: District['sector']): District {
  return {
    id,
    city: CITY_ID,
    name: id,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: [],
    ...(sector ? { sector } : {}),
  };
}

function cityDefinition(overrides: Partial<CityDefinition> = {}): CityDefinition {
  return {
    id: CITY_ID,
    name: 'Testville',
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
    cultureWeights: [{ group: 'g-main', weight: 1 }],
    services: ['svc-own'],
    ...overrides,
  };
}

function vocabulary(requiredQueries: RequiredQuery[]): TagVocabulary {
  return {
    facets: [{ id: 'function', appliesTo: ['location'] }],
    tags: [{ id: 'function:drop', description: 'drop' }],
    requiredQueries,
  };
}

/** An optional Year Range inside `[1940, 1970]`, or `undefined` for an undated item. */
const yearRangeArb: fc.Arbitrary<YearRange | undefined> = fc.option(
  fc
    .tuple(fc.integer({ min: 1940, max: 1970 }), fc.integer({ min: 1940, max: 1970 }))
    .map(([a, b]): YearRange => (a <= b ? { from: a, to: b } : { from: b, to: a })),
  { nil: undefined },
);

/**
 * A random conforming City Pack set. The city period and era period are random
 * windows that overlap the city's `startDates` window (so `drawSetting` always
 * finds a date), and every year-ranged kind carries a random (possibly absent)
 * Year Range. Each District holds a drop Location so the single Required Query
 * is amply bindable and `instantiateCity` succeeds.
 */
const packSetArb = fc
  .record({
    seed: fc.string({ minLength: 1 }),
    // The era Period Window. Kept wide enough to overlap the fixed startDates
    // window (1949–1955) so a Start Date is always drawable.
    eraFrom: fc.integer({ min: 1945, max: 1949 }),
    eraTo: fc.integer({ min: 1955, max: 1965 }),
    // The city Period Window, likewise overlapping the startDates window.
    cityFrom: fc.integer({ min: 1945, max: 1949 }),
    cityTo: fc.integer({ min: 1955, max: 1965 }),
    districtCount: fc.integer({ min: 4, max: 6 }),
    // Per-item Year Ranges.
    locYears: fc.array(yearRangeArb, { minLength: 24, maxLength: 24 }),
    routeYears: fc.array(yearRangeArb, { minLength: 3, maxLength: 3 }),
    paperYears: fc.array(yearRangeArb, { minLength: 2, maxLength: 2 }),
    orgYears: fc.array(yearRangeArb, { minLength: 2, maxLength: 2 }),
    weightYears: fc.array(yearRangeArb, { minLength: 2, maxLength: 2 }),
    sectorYears: yearRangeArb,
    bgYears: fc.array(yearRangeArb, { minLength: 3, maxLength: 3 }),
    fragYears: fc.array(yearRangeArb, { minLength: 3, maxLength: 3 }),
    // Whether to fix the Start Date (always inside the common 1952 overlap).
    fixedStart: fc.option(fc.constant('1952-06-15'), { nil: undefined }),
  })
  .map((p) => {
    const eraPeriod = { from: p.eraFrom, to: p.eraTo };
    const cityPeriod = { from: p.cityFrom, to: p.cityTo };

    const districts: District[] = Array.from({ length: p.districtCount }, (_, i) =>
      district(
        `d${i}`,
        i === 0 && p.sectorYears
          ? { power: 'us', years: p.sectorYears }
          : undefined,
      ),
    );

    // Each District holds (a) three always-in-period cafés and one always-in-
    // period drop, so even if every dated item is filtered out there are at
    // least 4 × districtCount ≥ 16 in-period Locations — comfortably above the
    // Location target (default [10, 14]) and enough drop Binders for the drop
    // Required Query, keeping the city feasible under any year filtering; and
    // (b) one extra café carrying a random, possibly-absent Year Range, so the
    // filter has dated items to prune. The dated cafés are the ones that make
    // the filtered Location set vary with the Game Year.
    const locations: CityLocation[] = [];
    let locYearIdx = 0;
    for (let i = 0; i < p.districtCount; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        locations.push(location(`d${i}-cafe${j}`, `d${i}`, { type: 'cafe' }));
      }
      locations.push(
        location(`d${i}-drop`, `d${i}`, { type: 'drop', tags: ['function:drop'] }),
      );
      locations.push(
        location(`d${i}-dated`, `d${i}`, {
          type: 'cafe',
          years: p.locYears[locYearIdx % p.locYears.length],
        }),
      );
      locYearIdx += 1;
    }

    // The base path d0-d1-…-d(n-1) is always undated so the District graph is
    // route-connected under any year filtering (a dated base edge could drop
    // and disconnect the city, which would make instantiation infeasible —
    // that is a `CE-PERIOD`/`CE-FEASIBLE` content defect, not what Property 8
    // tests). The *dated* routes are redundant skip edges (d(i) → d(i+2)); the
    // filter prunes them without threatening connectivity, so they exercise
    // route year filtering while keeping the city conforming and feasible.
    const routes: CityRoute[] = [];
    for (let i = 0; i < p.districtCount - 1; i += 1) {
      routes.push({ a: `d${i}`, b: `d${i + 1}`, cost: 1 });
    }
    for (let i = 0; i + 2 < p.districtCount; i += 1) {
      const years = p.routeYears[i % p.routeYears.length];
      if (years) {
        routes.push({ a: `d${i}`, b: `d${i + 2}`, cost: 1, years });
      }
    }

    const newspapers: Newspaper[] = p.paperYears.map((years, i) => ({
      id: `np-${i}`,
      city: CITY_ID,
      masthead: `Paper ${i}`,
      language: 'de',
      stance: 's',
      register: 'r',
      days: ['monday'],
      price: 1,
      soldAt: ['venue:cafe'],
      ...(years ? { years } : {}),
    })) as Newspaper[];

    const orgs: LocalOrg[] = p.orgYears.map((years, i) => ({
      id: `org-${i}`,
      city: CITY_ID,
      name: `Org ${i}`,
      aliases: [],
      kind: 'bank',
      tags: ['org:bank'],
      members: [],
      ...(years ? { years } : {}),
    })) as LocalOrg[];

    const cultureWeights = [
      { group: 'g-main', weight: 1 },
      ...p.weightYears.map((years, i) => ({
        group: `g-extra-${i}`,
        weight: 1,
        ...(years ? { years } : {}),
      })),
    ];

    const variants: TemplateVariant[] = [];

    const def = cityDefinition({ period: cityPeriod, cultureWeights });
    const bundle: CityBundle = {
      def,
      districts,
      locations,
      routes,
      locationTypes: [locationType('cafe'), locationType('drop')],
      newspapers,
      orgs,
      weather: weatherTables(CITY_ID),
      covers: [],
      streets: [],
      locale: {} as never,
      variants,
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
        backgrounds: p.bgYears.map((years, i) => ({
          text: `background ${i}`,
          tags: [],
          ...(years ? { years } : {}),
        })),
      },
    };

    const descriptorFragments: DescriptorFragment[] = p.fragYears.map((years, i) => ({
      id: `frag-${i}`,
      slot: 'clothing',
      text: `frag ${i}`,
      ...(years ? { years } : {}),
    }));

    const era: EraBundle = { id: 'era/one', period: eraPeriod };

    const base = {
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
      tagVocabulary: vocabulary([
        { id: 'rq-drop', query: ['function:drop'], minStatic: 2, minInstantiated: 2 },
      ]),
    } as unknown as ContentSetV2;

    const set: ContentSetV2 = {
      ...base,
      cities: { [CITY_ID]: bundle },
      era,
      cultureGroups,
      descriptorFragments,
      cityScopeOwner: {},
    };

    return { seed: p.seed, set, fixedStart: p.fixedStart };
  });

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Property 8: year filtering (content-expansion; Req 6.4, 9.2, 9.3)', () => {
  it('draws an in-window Start Date and keeps only in-period content in the generated world', () => {
    fc.assert(
      fc.property(packSetArb, ({ seed, set, fixedStart }) => {
        const rng = createPrng(settingStreamSeed(seed, 0));
        const cfg = { city: CITY_ID, ...(fixedStart ? { startDate: fixedStart } : {}) };

        // --- Part 1: the Start Date lies within startDates ∩ era window ------
        const selection = drawSetting(set, cfg, rng, 0);
        const parsed = parseIsoDate(selection.startDate);
        expect(parsed).toBeDefined();
        const day = daysFromEpoch(parsed!);

        const bundle = set.cities[CITY_ID];
        const sdFrom = daysFromEpoch(parseIsoDate(bundle.def.startDates.from)!);
        const sdTo = daysFromEpoch(parseIsoDate(bundle.def.startDates.to)!);
        const eraLo = daysFromEpoch({ year: set.era!.period.from, month: 1, day: 1 });
        const eraHi = daysFromEpoch({ year: set.era!.period.to, month: 12, day: 31 });
        const lo = Math.max(sdFrom, eraLo);
        const hi = Math.min(sdTo, eraHi);
        expect(day).toBeGreaterThanOrEqual(lo);
        expect(day).toBeLessThanOrEqual(hi);
        expect(selection.year).toBe(parsed!.year);

        const year = selection.year;
        const cityPeriod = bundle.def.period;
        const eraPeriod = set.era!.period;
        const cityBounds: readonly (YearRange | undefined)[] = [cityPeriod, eraPeriod];
        const eraBounds: readonly (YearRange | undefined)[] = [eraPeriod];

        // --- Part 2: year-filter and check every surviving item -------------
        const filtered = yearFilter(set, year, CITY_ID);
        const fb = filtered.cities[CITY_ID];

        for (const loc of fb.locations) {
          expect(inEffectiveRange(year, loc.years, cityBounds)).toBe(true);
        }
        for (const route of fb.routes) {
          expect(inEffectiveRange(year, route.years, cityBounds)).toBe(true);
        }
        for (const paper of fb.newspapers) {
          expect(inEffectiveRange(year, paper.years, cityBounds)).toBe(true);
        }
        for (const org of fb.orgs) {
          expect(inEffectiveRange(year, org.years, cityBounds)).toBe(true);
        }
        for (const weight of fb.def.cultureWeights) {
          expect(inEffectiveRange(year, weight.years, cityBounds)).toBe(true);
        }
        for (const d of fb.districts) {
          // A District stays a graph node; a surviving sector must be in period.
          if (d.sector !== undefined) {
            expect(inEffectiveRange(year, d.sector.years, cityBounds)).toBe(true);
          }
        }
        // Template Variants carry no own Year Range in the slice schema, so
        // their Effective Year Range is bounded only by the city and era
        // windows (an out-of-period city is filtered as a whole upstream). A
        // surviving variant is therefore in period whenever the Game Year is
        // inside those windows — which it is, since the Start Date was drawn
        // from exactly that intersection.
        for (const variant of fb.variants) {
          void variant;
          expect(inEffectiveRange(year, undefined, cityBounds)).toBe(true);
        }
        for (const group of Object.values(filtered.cultureGroups)) {
          for (const bg of group.backgrounds) {
            expect(inEffectiveRange(year, bg.years, eraBounds)).toBe(true);
          }
        }
        for (const frag of filtered.descriptorFragments) {
          expect(inEffectiveRange(year, frag.years, eraBounds)).toBe(true);
        }

        // --- Part 3: the Locations the generated world surfaces are in period
        // The generator instantiates the city from the *year-filtered* bundle
        // and projects it through the CityView; every Location the view exposes
        // must therefore trace back to an in-period authored Location.
        const instantiated = instantiateCity(
          fb,
          year,
          filtered.tagVocabulary,
          createPrng(settingStreamSeed(seed, 0)),
        );
        expect(instantiated).not.toBe('infeasible');
        const inst = instantiated as InstantiatedCity;

        const inPeriodLocIds = new Set(
          fb.locations
            .filter((loc) => inEffectiveRange(year, loc.years, cityBounds))
            .map((loc) => `loc:${loc.id}`),
        );
        for (const locId of inst.locations) {
          expect(inPeriodLocIds.has(locId)).toBe(true);
        }

        const folded = foldInstantiatedCity(inst, fb, filtered, 6);
        const view = cityView(folded.city, filtered, selection);
        for (const entity of view.entities('loc')) {
          expect(inPeriodLocIds.has(entity.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
