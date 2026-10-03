/**
 * Feature: content-expansion, Property 3: Side-by-side projection.
 *
 * This is the content-expansion task 3.16 property test. The design fixes
 * Property 3 (design, "Correctness Properties") as a three-part statement: for
 * any conforming set S containing several City Packs and any City Pack A in S,
 *
 *   - the Content Set of S projected onto A and its dependencies equals the
 *     Content Set of A and its dependencies loaded alone;
 *   - a world generated with `setting.city = A` from S equals the world
 *     generated from A and its dependencies alone, apart from the Content
 *     Manifest field;
 *   - the world references no City-Scoped Content of any other city.
 *
 *   Validates: Requirements 9.5, 10.1, 10.3.
 *
 * The property is exercised at the engine's setting boundary — the pure setting
 * step the generator runs when a City Pack is selected: `drawSetting` (the
 * Start Date and Game Year), `yearFilter` (the Effective-Year-Range projection),
 * `instantiateCity` + `foldInstantiatedCity` (the Instantiated City folded into
 * the slice `City`) and `cityView` (the read-only projection the later steps and
 * follow-on binders read, design "CityView"). Those pieces are the engine's view
 * of "the world generated with `setting.city = A`": together they fix the city
 * the core stream builds on and the Content Set the rest of generation reads, so
 * if they are identical whether computed from the multi-city set S or the
 * A-alone set, every downstream draw is too (the core stream is a pure function
 * of the city and the year-filtered set). The loader-level clause (the merged
 * Content Set and Content Manifest of a side-by-side load) is owned and tested
 * in `@tradecraft/content`'s load-order-independence property spec, whose
 * two-city case covers side-by-side loading (Req 10.1); here the clause is
 * modelled at the point the engine consumes it.
 *
 * The generator builds a random conforming multi-city set S (two or three City
 * Packs sharing one Era Pack and one Library layer, each conforming by
 * construction), then models the loader's projection onto a chosen city A: the
 * A-alone set keeps A's City Bundle, A's City-Scope ownership entries and the
 * shared Era/Library/Vocabulary dependencies, and drops the other cities. The
 * test asserts the three clauses:
 *
 *   1. projection equality — `yearFilter` of the A-alone set equals `yearFilter`
 *      of S restricted to A, and the `CityView` built from each is deep-equal;
 *   2. generated-world equality — the setting step (Start Date, Instantiated
 *      City, folded `City` and `CityView`) run on the same seed over S and over
 *      the A-alone set produce deep-equal results, apart from the Content
 *      Manifest (the fixtures carry none, so the equality is exact);
 *   3. no cross-city reference — every id the generated world (the folded `City`
 *      and the `CityView`) names belongs to A or to the shared layer, never to
 *      another city's City-Scoped Content.
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
  LocationType,
  RequiredQuery,
  TagVocabulary,
  WeatherTables,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { settingStreamSeed } from './stream.js';
import type {
  CityBundle,
  CityId,
  ContentSetV2,
  EraBundle,
} from './content-set-v2.js';
import {
  drawSetting,
  yearFilter,
  type SettingConfig,
  type SettingSelection,
} from './setting.js';
import { instantiateCity, type InstantiatedCity } from './instantiate-city.js';
import { foldInstantiatedCity } from './fold-city.js';
import { cityView, type CityView } from './city-view.js';

// ---------------------------------------------------------------------------
// A small shared Tag Vocabulary. The function facet carries the Required-Query
// Tags; every generated city is tagged against it with margin, so every city is
// conforming (instantiates for every seed) by construction.
// ---------------------------------------------------------------------------

const FUNCTION_TAGS = [
  'function:drop',
  'function:meet',
  'function:safe',
] as const;

/** The one Location Type the generated cities use, carrying no own function Tags. */
const CAFE_TYPE_ID = 'core/cafe';

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

const REQUIRED_QUERIES: readonly RequiredQuery[] = FUNCTION_TAGS.map((tag) => ({
  id: `rq-${tag.replace('function:', '')}`,
  query: [tag],
  minStatic: 1,
  minInstantiated: 1,
}));

const VOCAB: TagVocabulary = {
  facets: [{ id: 'function', appliesTo: ['location'] }],
  tags: FUNCTION_TAGS.map((id) => ({ id, description: id })),
  requiredQueries: [...REQUIRED_QUERIES],
};

const ERA: EraBundle = {
  id: 'era/cold-war-early',
  period: { from: 1945, to: 1965 },
};

// ---------------------------------------------------------------------------
// City-Pack fixtures, keyed by a per-city id so each city's content is
// unambiguously City-Scoped. The id of every City-Scoped record embeds the city
// slug, so clause 3 (no cross-city reference) can recognise a stray id.
// ---------------------------------------------------------------------------

interface CitySpec {
  readonly id: CityId;
  readonly slug: string;
  readonly districtCount: number;
  readonly cafesPerDistrict: number;
  readonly bindersPerQuery: number;
  readonly period: { from: number; to: number };
}

function locationId(slug: string, local: string): string {
  return `${slug}/${local}`;
}

function location(
  slug: string,
  local: string,
  district: string,
  tags: readonly string[] = [],
): CityLocation {
  return {
    id: locationId(slug, local),
    name: `${local}@${slug}`,
    aliases: [],
    type: CAFE_TYPE_ID,
    district,
    public: true,
    description: 'a place',
    atmosphere: [],
    city: `city-${slug}/${slug}`,
    tags: [...tags],
    basis: 'fictional',
  };
}

function district(slug: string, local: string): District {
  return {
    id: `${slug}/${local}`,
    city: `city-${slug}/${slug}`,
    name: `${local}@${slug}`,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: [],
  };
}

function route(a: string, b: string): CityRoute {
  return { a, b, cost: 1 };
}

function cityDefinition(spec: CitySpec): CityDefinition {
  return {
    id: spec.id,
    name: `City ${spec.slug}`,
    country: 'Nowhere',
    climate: 'climate:temperate',
    period: spec.period,
    startDates: {
      from: `${spec.period.from}-01-01`,
      to: `${spec.period.to}-12-31`,
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
    cultureWeights: [{ group: 'lib/g-main', weight: 1 }],
    services: [],
    // Bound the instantiation so a conforming city always places: Districts up
    // to the count the city has, Locations modest. This mirrors the bindability
    // property spec's bounds, which keep a connected city reliably feasible.
    instantiation: {
      districts: [Math.min(4, spec.districtCount), spec.districtCount],
      locations: [4, 10],
    },
  };
}

/** A connected, conforming City Bundle for one city spec. */
function bundleOf(spec: CitySpec): CityBundle {
  // District ids are namespaced `<slug>/dN`; a Location's `district` field and
  // every Route name the full District id, so `instantiateCity`'s District
  // lookup and adjacency walk read one consistent id space.
  const districtIds = Array.from(
    { length: spec.districtCount },
    (_, i) => `${spec.slug}/d${i}`,
  );
  const districts = Array.from({ length: spec.districtCount }, (_, i) =>
    district(spec.slug, `d${i}`),
  );

  const locations: CityLocation[] = [];
  // Plain cafés per District (non-Binders, available for the weighted fill).
  for (let d = 0; d < spec.districtCount; d += 1) {
    for (let j = 0; j < spec.cafesPerDistrict; j += 1) {
      locations.push(location(spec.slug, `d${d}-c${j}`, districtIds[d]));
    }
  }
  // Binder Locations per Required Query, round-robined across Districts.
  for (const tag of FUNCTION_TAGS) {
    for (let k = 0; k < spec.bindersPerQuery; k += 1) {
      const d = k % spec.districtCount;
      locations.push(
        location(
          spec.slug,
          `d${d}-${tag.replace('function:', '')}-${k}`,
          districtIds[d],
          [tag],
        ),
      );
    }
  }

  // A connected path over the Districts (full District ids, as the bundle
  // Routes name them).
  const routes: CityRoute[] = [];
  for (let i = 0; i < districtIds.length - 1; i += 1) {
    routes.push(route(districtIds[i], districtIds[i + 1]));
  }

  return {
    def: cityDefinition(spec),
    districts,
    locations,
    routes,
    locationTypes: [locationType(CAFE_TYPE_ID)],
    newspapers: [],
    orgs: [],
    weather: weatherTables(`city-${spec.slug}/${spec.slug}`),
    covers: [],
    streets: [],
    locale: {} as never,
    variants: [],
    sources: [],
  };
}

/** A minimal weather table (one condition per month). */
function weatherTables(city: string): WeatherTables {
  const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      [{ id: 'clear', label: 'Clear', weight: 1 }],
    ]),
  ) as WeatherTables['months'];
  return { city, months };
}

/** The one shared Library Culture Group, referenced by every city. */
const CULTURE_GROUP: CultureGroup = {
  id: 'lib/g-main',
  name: 'Main',
  languages: ['de'],
  naming: { display: '{given} {family}', formal: '{honorific} {family}' },
  given: { f: ['Anna'], m: ['Hans'] },
  family: ['Müller'],
  voiceTraits: [],
  mannerisms: [],
  backgrounds: [],
};

const DESCRIPTOR: DescriptorFragment = {
  id: 'lib/frag-hat',
  slot: 'headwear',
  text: 'a hat',
};

// ---------------------------------------------------------------------------
// Building the Content Sets.
// ---------------------------------------------------------------------------

/**
 * The slice-side registries the setting step and the fold read. Only
 * `locationTypes` carries anything (the cities' café type); the other
 * registries are empty maps the functions never touch. Kept as one shared
 * value so the merged set and the projected set carry the same registry
 * instances where they should.
 */
function sliceRegistries(): Partial<ContentSetV2> {
  const locationTypes = new Map<string, LocationType>([
    [CAFE_TYPE_ID, locationType(CAFE_TYPE_ID)],
  ]);
  return {
    predicates: {},
    archetypes: new Map(),
    locationTypes,
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
  } as unknown as Partial<ContentSetV2>;
}

/** Build a {@link ContentSetV2} over a set of city specs. */
function makeSet(specs: readonly CitySpec[]): ContentSetV2 {
  const cities: Record<CityId, CityBundle> = {};
  const cityScopeOwner: Record<string, CityId> = {};
  for (const spec of specs) {
    const bundle = bundleOf(spec);
    cities[spec.id] = bundle;
    // Every City-Scoped record is owned by its city (the loader's
    // `cityScopeOwner`, task 2.1). The ids embed the city slug.
    for (const d of bundle.districts) {
      cityScopeOwner[d.id] = spec.id;
    }
    for (const loc of bundle.locations) {
      cityScopeOwner[loc.id] = spec.id;
    }
  }
  return {
    ...(sliceRegistries() as ContentSetV2),
    cities,
    era: ERA,
    cultureGroups: { [CULTURE_GROUP.id]: CULTURE_GROUP },
    descriptorFragments: [DESCRIPTOR],
    cityScopeOwner,
    tagVocabulary: VOCAB,
  } as ContentSetV2;
}

/**
 * Project a multi-city {@link ContentSetV2} onto one city A and its
 * dependencies — the engine's model of the loader projecting S onto A (design,
 * Property 3, clause 1). The result keeps A's City Bundle, the City-Scope
 * ownership entries A owns and the shared Era/Library/Vocabulary dependencies,
 * and drops every other city's City-Scoped Content. This mirrors
 * `makeSet([specForA])`: the A-alone set is exactly `makeSet` over A's spec, so
 * "S projected onto A" and "A loaded alone" are compared directly.
 */
function projectOnto(set: ContentSetV2, city: CityId): ContentSetV2 {
  const bundle = set.cities[city];
  const cities: Record<CityId, CityBundle> = { [city]: bundle };
  const cityScopeOwner: Record<string, CityId> = {};
  for (const [id, owner] of Object.entries(set.cityScopeOwner)) {
    if (owner === city) {
      cityScopeOwner[id] = owner;
    }
  }
  return {
    ...set,
    cities,
    cityScopeOwner,
  };
}

// ---------------------------------------------------------------------------
// The setting step, as the engine runs it for a City Pack (the pure pieces
// `generate` composes in `runSettingStep`): draw the Start Date, year-filter
// the set, instantiate and fold the city, and build the CityView. This is the
// engine's "world generated with setting.city = A", up to the deterministic
// core stream that reads only these outputs.
// ---------------------------------------------------------------------------

interface SettingStepOutput {
  readonly selection: SettingSelection;
  readonly city: ReturnType<typeof foldInstantiatedCity>['city'];
  readonly knownLocations: readonly string[];
  readonly view: CityView;
}

function runSettingStep(
  set: ContentSetV2,
  cityId: CityId,
  seed: string,
): SettingStepOutput {
  const cfg: SettingConfig = { city: cityId };
  const prng = createPrng(settingStreamSeed(seed, 0));
  const selection = drawSetting(set, cfg, prng, 0);
  const filtered = yearFilter(set, selection.year, selection.city);
  const bundle = filtered.cities[cityId];
  const instantiated = instantiateCity(
    bundle,
    selection.year,
    filtered.tagVocabulary,
    prng,
  );
  if (instantiated === 'infeasible') {
    throw new Error(`city ${cityId} was unexpectedly infeasible`);
  }
  const startMonth = Number(selection.startDate.slice(5, 7));
  const folded = foldInstantiatedCity(
    instantiated as InstantiatedCity,
    bundle,
    filtered,
    startMonth,
  );
  const view = cityView(folded.city, filtered, selection);
  return {
    selection,
    city: folded.city,
    knownLocations: folded.knownLocations,
    view,
  };
}

/** The CityView projected into a plain, comparable shape (its lists id-sorted). */
function viewSnapshot(view: CityView): unknown {
  const kinds = ['loc', 'district', 'org', 'item'] as const;
  return {
    city: view.city,
    year: view.year,
    startDate: view.startDate,
    entities: Object.fromEntries(
      kinds.map((k) => [k, view.entities(k)]),
    ),
    binders: Object.fromEntries(
      kinds.map((k) => [
        k,
        Object.fromEntries(
          FUNCTION_TAGS.map((tag) => [tag, view.binders(k, [tag])]),
        ),
      ]),
    ),
    requiredQueries: view.requiredQueries,
    services: view.services,
  };
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const citySpecArb = (slug: string): fc.Arbitrary<CitySpec> =>
  fc
    .record({
      districtCount: fc.integer({ min: 4, max: 6 }),
      cafesPerDistrict: fc.integer({ min: 2, max: 4 }),
      bindersPerQuery: fc.integer({ min: 1, max: 3 }),
      periodFrom: fc.integer({ min: 1946, max: 1958 }),
      periodSpan: fc.integer({ min: 2, max: 6 }),
    })
    .map((cfg) => ({
      id: `city-${slug}/${slug}`,
      slug,
      districtCount: cfg.districtCount,
      cafesPerDistrict: cfg.cafesPerDistrict,
      bindersPerQuery: cfg.bindersPerQuery,
      period: { from: cfg.periodFrom, to: cfg.periodFrom + cfg.periodSpan },
    }));

/** A set of two or three distinct city specs, plus which one is the target A. */
const sceneArb = fc
  .uniqueArray(fc.constantFrom('vienna', 'berlin', 'trieste'), {
    minLength: 2,
    maxLength: 3,
  })
  .chain((slugs) =>
    fc.record({
      specs: fc.tuple(...slugs.map((s) => citySpecArb(s))),
      targetIndex: fc.integer({ min: 0, max: slugs.length - 1 }),
      seed: fc.string({ minLength: 1, maxLength: 12 }),
    }),
  );

// ---------------------------------------------------------------------------
// Clause 3 helper — collect every id the generated world names, and the set of
// ids that belong to A or the shared layer.
// ---------------------------------------------------------------------------

/** Every id the folded `City` and `CityView` reference (Districts, Locations, Routes). */
function worldReferencedIds(out: SettingStepOutput): string[] {
  const ids = new Set<string>();
  for (const d of Object.values(out.city.districts)) {
    ids.add(d.id);
  }
  for (const loc of Object.values(out.city.locations)) {
    ids.add(loc.id);
    ids.add(loc.district);
  }
  for (const r of out.city.routes) {
    ids.add(r.a);
    ids.add(r.b);
  }
  for (const e of out.view.entities('loc')) {
    ids.add(e.id);
  }
  for (const e of out.view.entities('district')) {
    ids.add(e.id);
  }
  return [...ids].sort();
}

/**
 * The ids owned by any city other than A, in the engine's slice-id form
 * (`loc:<content-id>` / `district:<content-id>`). If the generated world names
 * one of these, it has leaked another city's City-Scoped Content (clause 3).
 */
function foreignCityIds(set: ContentSetV2, a: CityId): Set<string> {
  const foreign = new Set<string>();
  for (const [cityId, bundle] of Object.entries(set.cities)) {
    if (cityId === a) {
      continue;
    }
    for (const d of bundle.districts) {
      foreign.add(`district:${d.id}`);
    }
    for (const loc of bundle.locations) {
      foreign.add(`loc:${loc.id}`);
    }
  }
  return foreign;
}

// ---------------------------------------------------------------------------
// Property 3.
// ---------------------------------------------------------------------------

describe('Feature: content-expansion, Property 3: Side-by-side projection', () => {
  it('projects S onto A equal to A loaded alone, generates the same world, and references no other city (Req 9.5, 10.1, 10.3)', () => {
    fc.assert(
      fc.property(sceneArb, ({ specs, targetIndex, seed }) => {
        const multi = makeSet(specs);
        const target = specs[targetIndex];
        const a = target.id;

        // The A-alone set is `makeSet` over A's spec alone — the loader's
        // "A and its dependencies loaded alone".
        const alone = makeSet([target]);

        // --- Clause 1: projection equality ---------------------------------
        // The multi-city set projected onto A equals the A-alone set, on every
        // field the engine reads.
        const projected = projectOnto(multi, a);
        expect(projected.cities).toEqual(alone.cities);
        expect(projected.cityScopeOwner).toEqual(alone.cityScopeOwner);
        expect(projected.era).toEqual(alone.era);
        expect(projected.cultureGroups).toEqual(alone.cultureGroups);
        expect(projected.descriptorFragments).toEqual(alone.descriptorFragments);
        expect(projected.tagVocabulary).toEqual(alone.tagVocabulary);

        // Year-filtering the two sets for a Game Year in A's window yields the
        // same City Bundle for A (the Effective-Year-Range projection is
        // per-city, so S and A-alone filter A identically).
        const year = target.period.from;
        const filteredMulti = yearFilter(multi, year, a);
        const filteredAlone = yearFilter(alone, year, a);
        expect(filteredMulti.cities[a]).toEqual(filteredAlone.cities[a]);

        // --- Clause 2: the generated world is the same ---------------------
        // The setting step run on the same seed over S and over the A-alone set
        // produces deep-equal Start Date, Instantiated City (folded), and
        // CityView. The fixtures carry no Content Manifest, so the equality is
        // exact (the design excludes only the Manifest field).
        const fromMulti = runSettingStep(multi, a, seed);
        const fromAlone = runSettingStep(alone, a, seed);

        expect(fromMulti.selection).toEqual(fromAlone.selection);
        expect(fromMulti.city).toEqual(fromAlone.city);
        expect([...fromMulti.knownLocations]).toEqual([
          ...fromAlone.knownLocations,
        ]);
        expect(viewSnapshot(fromMulti.view)).toEqual(
          viewSnapshot(fromAlone.view),
        );

        // --- Clause 3: no cross-city reference -----------------------------
        // Every id the world generated from S names belongs to A or the shared
        // layer; none is another city's City-Scoped Content.
        const referenced = worldReferencedIds(fromMulti);
        const foreign = foreignCityIds(multi, a);
        for (const id of referenced) {
          expect(foreign.has(id)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('the Start Date and city are drawn only from A, regardless of the other cities in S', () => {
    fc.assert(
      fc.property(sceneArb, ({ specs, targetIndex, seed }) => {
        const multi = makeSet(specs);
        const target = specs[targetIndex];
        const a = target.id;

        const out = runSettingStep(multi, a, seed);

        // The chosen city is A, and the Start Date lands inside A's window.
        expect(out.selection.city).toBe(a);
        expect(out.selection.year).toBeGreaterThanOrEqual(target.period.from);
        expect(out.selection.year).toBeLessThanOrEqual(target.period.to);

        // Every folded Location traces back to an authored Location of A.
        const authoredA = new Set(
          bundleOf(target).locations.map((loc) => `loc:${loc.id}`),
        );
        for (const loc of Object.values(out.city.locations)) {
          expect(authoredA.has(loc.id)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });
});
