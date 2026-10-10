/**
 * Tests for authored city instantiation (content-expansion task 3.3):
 * `instantiateCity`.
 *
 * These exercise the seven-step algorithm with hand-built City Bundles and a
 * Tag Vocabulary. The checks pin:
 *
 * - the result respects the District and Location count bounds (step 1, 3, 6);
 * - every Required Query with `minInstantiated > 0` has at least that many
 *   Binders among the selected Locations (step 2; Req 4.6);
 * - the selected Districts are connected over the Route graph (steps 4–5);
 * - the selected Routes are exactly the authored Routes between selected
 *   Districts (step 7);
 * - the draw is deterministic in the setting stream (Req 9.8), and pure (no
 *   input mutation);
 * - an unbindable city returns `'infeasible'` (Req 9.9).
 *
 * A unit suite covers specific shapes; a fast-check property (Property-style)
 * covers the bounds-and-bindability invariant across random conforming cities.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  CityDefinition,
  CityLocation,
  CityRoute,
  District,
  LocationType,
  RequiredQuery,
  TagVocabulary,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { settingStreamSeed } from './stream.js';
import type { CityBundle } from './content-set-v2.js';
import {
  DEFAULT_DISTRICT_BOUND,
  DEFAULT_LOCATION_BOUND,
  districtEntityId,
  instantiateCity,
  locationEntityId,
  type InstantiatedCity,
} from './instantiate-city.js';

// --- fixtures --------------------------------------------------------------

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
  opts: { type?: string; tags?: string[]; weight?: number } = {},
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
    city: 'city/one',
    tags: opts.tags ?? [],
    basis: 'fictional',
    ...(opts.weight !== undefined ? { weight: opts.weight } : {}),
  };
}

function district(id: string): District {
  return {
    id,
    city: 'city/one',
    name: id,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: [],
  };
}

function route(a: string, b: string, cost: 0 | 1 = 1): CityRoute {
  return { a, b, cost };
}

function cityDefinition(
  overrides: Partial<CityDefinition> = {},
): CityDefinition {
  return {
    id: 'city/one',
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

function bundle(parts: {
  def?: CityDefinition;
  districts: District[];
  locations: CityLocation[];
  routes: CityRoute[];
  locationTypes?: LocationType[];
}): CityBundle {
  return {
    def: parts.def ?? cityDefinition(),
    districts: parts.districts,
    locations: parts.locations,
    routes: parts.routes,
    locationTypes: parts.locationTypes ?? [locationType('cafe')],
    newspapers: [],
    orgs: [],
    weather: { city: 'city/one', months: {} as never },
    covers: [],
    streets: [],
    locale: {} as never,
    variants: [],
    sources: [],
  };
}

function vocabulary(requiredQueries: RequiredQuery[]): TagVocabulary {
  return {
    facets: [{ id: 'function', appliesTo: ['location'] }],
    tags: [{ id: 'function:x', description: 'x' }],
    requiredQueries,
  };
}

function rqOf(
  id: string,
  query: string[],
  minInstantiated: number,
): RequiredQuery {
  return { id, query, minStatic: Math.max(minInstantiated, 1), minInstantiated };
}

/** The authored District ids behind an Instantiated City's `district:<id>` ids. */
function selectedDistrictSet(inst: InstantiatedCity): Set<string> {
  return new Set(inst.districts.map((id: string) => id.slice('district:'.length)));
}

/** Build the undirected District adjacency from a Route list, for test checks. */
function adjacencyOf(routes: readonly CityRoute[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adjacency.get(a);
    if (set === undefined) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const r of routes) {
    link(r.a, r.b);
    link(r.b, r.a);
  }
  return adjacency;
}

/**
 * A small connected grid city: four Districts in a path d1-d2-d3-d4, each with
 * three Locations. Two Locations carry `function:drop`, spread across Districts.
 */
function gridCity(): CityBundle {
  const districts = ['d1', 'd2', 'd3', 'd4'].map(district);
  const locations: CityLocation[] = [];
  for (const d of ['d1', 'd2', 'd3', 'd4']) {
    for (let i = 0; i < 3; i += 1) {
      locations.push(location(`${d}-l${i}`, d, { type: 'cafe' }));
    }
  }
  // Mark two drops in different Districts.
  locations.push(location('d1-drop', 'd1', { type: 'drop', tags: ['function:drop'] }));
  locations.push(location('d3-drop', 'd3', { type: 'drop', tags: ['function:drop'] }));
  const routes = [route('d1', 'd2'), route('d2', 'd3'), route('d3', 'd4')];
  return bundle({
    districts,
    locations,
    routes,
    locationTypes: [locationType('cafe'), locationType('drop')],
  });
}

// --- unit tests ------------------------------------------------------------

describe('instantiateCity (Req 9.4, 4.6, 9.9)', () => {
  it('keeps a fixed landmark without changing the rest of the draw', () => {
    const plain = gridCity();
    const pinned = gridCity();
    pinned.locations.push(
      location('d1-imperial', 'd1', { tags: ['function:fixed-landmark'] }),
    );
    const vocab = vocabulary([]);
    const seed = settingStreamSeed('pin', 0);
    const without = instantiateCity(plain, 1950, vocab, createPrng(seed)) as InstantiatedCity;
    const withLandmark = instantiateCity(
      pinned,
      1950,
      vocab,
      createPrng(seed),
    ) as InstantiatedCity;
    const extra = locationEntityId('d1-imperial');
    expect(withLandmark.locations).toContain(extra);
    expect(withLandmark.locations.filter((id) => id !== extra)).toEqual(without.locations);
  });

  it('selects Districts and Locations within the default bounds', () => {
    const city = gridCity();
    const vocab = vocabulary([]);
    const rng = createPrng(settingStreamSeed('seed-1', 0));
    const result = instantiateCity(city, 1950, vocab, rng);

    expect(result).not.toBe('infeasible');
    const inst = result as InstantiatedCity;
    expect(inst.districts.length).toBeGreaterThanOrEqual(DEFAULT_DISTRICT_BOUND[0]);
    expect(inst.districts.length).toBeLessThanOrEqual(DEFAULT_DISTRICT_BOUND[1]);
    expect(inst.locations.length).toBeGreaterThanOrEqual(1);
    expect(inst.locations.length).toBeLessThanOrEqual(DEFAULT_LOCATION_BOUND[1]);
  });

  it('places at least minInstantiated Binders of every Required Query', () => {
    const city = gridCity();
    const vocab = vocabulary([rqOf('rq-drop', ['function:drop'], 2)]);
    const rng = createPrng(settingStreamSeed('seed-2', 0));
    const result = instantiateCity(city, 1950, vocab, rng);

    expect(result).not.toBe('infeasible');
    const inst = result as InstantiatedCity;
    const drops = inst.locations.filter(
      (id: string) =>
        id === locationEntityId('d1-drop') || id === locationEntityId('d3-drop'),
    );
    expect(drops.length).toBe(2);
  });

  it('returns the authored Routes between selected Districts (step 7)', () => {
    const city = gridCity();
    const vocab = vocabulary([]);
    const rng = createPrng(settingStreamSeed('seed-3', 0));
    const result = instantiateCity(city, 1950, vocab, rng) as InstantiatedCity;

    const selected = selectedDistrictSet(result);
    for (const r of result.routes) {
      expect(selected.has(r.a)).toBe(true);
      expect(selected.has(r.b)).toBe(true);
    }
    // Every authored route whose endpoints are both selected must be present.
    const expected = city.routes.filter(
      (r: CityRoute) => selected.has(r.a) && selected.has(r.b),
    );
    expect(result.routes.length).toBe(expected.length);
  });

  it('selects a Route-connected set of Districts (steps 4–5)', () => {
    const city = gridCity();
    const vocab = vocabulary([rqOf('rq-drop', ['function:drop'], 2)]);
    const rng = createPrng(settingStreamSeed('seed-4', 0));
    const result = instantiateCity(city, 1950, vocab, rng) as InstantiatedCity;

    const selected = selectedDistrictSet(result);
    const adjacency = adjacencyOf(city.routes);
    // BFS over the selected set must reach every selected District.
    const start = [...selected].sort()[0];
    const seen = new Set<string>([start]);
    const stack: string[] = [start];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const nxt of adjacency.get(cur) ?? []) {
        if (selected.has(nxt) && !seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    expect(seen.size).toBe(selected.size);
  });

  it('is deterministic for the same setting stream and does not mutate inputs', () => {
    const city = gridCity();
    const vocab = vocabulary([rqOf('rq-drop', ['function:drop'], 1)]);
    const locationsBefore = JSON.stringify(city.locations);
    const routesBefore = JSON.stringify(city.routes);

    const a = instantiateCity(city, 1950, vocab, createPrng(settingStreamSeed('s', 0)));
    const b = instantiateCity(city, 1950, vocab, createPrng(settingStreamSeed('s', 0)));

    expect(a).toEqual(b);
    expect(JSON.stringify(city.locations)).toBe(locationsBefore);
    expect(JSON.stringify(city.routes)).toBe(routesBefore);
  });

  it('uses Effective Tags (own ∪ Location Type) to find Binders', () => {
    // The Binder tag comes from the Location Type, not the Location itself.
    const districts = ['d1', 'd2', 'd3', 'd4'].map(district);
    const locations: CityLocation[] = [];
    for (const d of ['d1', 'd2', 'd3', 'd4']) {
      locations.push(location(`${d}-a`, d, { type: 'cafe' }));
    }
    locations.push(location('d2-safe', 'd2', { type: 'safehouse' }));
    const city = bundle({
      districts,
      locations,
      routes: [route('d1', 'd2'), route('d2', 'd3'), route('d3', 'd4')],
      locationTypes: [
        locationType('cafe'),
        locationType('safehouse', ['function:safe']),
      ],
    });
    const vocab = vocabulary([rqOf('rq-safe', ['function:safe'], 1)]);
    const result = instantiateCity(
      city,
      1950,
      vocab,
      createPrng(settingStreamSeed('s', 0)),
    ) as InstantiatedCity;

    expect(result).not.toBe('infeasible');
    expect(result.locations).toContain(locationEntityId('d2-safe'));
  });

  it('returns "infeasible" when a Required Query has no Binders', () => {
    const city = gridCity();
    const vocab = vocabulary([rqOf('rq-missing', ['function:nowhere'], 1)]);
    const result = instantiateCity(
      city,
      1950,
      vocab,
      createPrng(settingStreamSeed('s', 0)),
    );
    expect(result).toBe('infeasible');
  });

  it('honours authored instantiation bounds', () => {
    const districts = Array.from({ length: 8 }, (_, i) => district(`d${i}`));
    const locations: CityLocation[] = [];
    for (let i = 0; i < 8; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        locations.push(location(`d${i}-l${j}`, `d${i}`));
      }
    }
    // A connected path over all eight Districts.
    const routes: CityRoute[] = [];
    for (let i = 0; i < 7; i += 1) {
      routes.push(route(`d${i}`, `d${i + 1}`));
    }
    const def = cityDefinition({
      instantiation: { districts: [6, 6], locations: [20, 20] },
    });
    const city = bundle({ def, districts, locations, routes });
    const vocab = vocabulary([]);
    const result = instantiateCity(
      city,
      1950,
      vocab,
      createPrng(settingStreamSeed('s', 0)),
    ) as InstantiatedCity;

    expect(result).not.toBe('infeasible');
    expect(result.districts.length).toBe(6);
    expect(result.locations.length).toBe(20);
  });
});

// --- property --------------------------------------------------------------

describe('instantiateCity invariants over random conforming cities', () => {
  it('respects bounds and binds every Required Query', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 4, max: 8 }),
        (seed, districtCount) => {
          // A connected path of `districtCount` Districts, each with four cafés
          // and one drop, so every Required Query is amply bindable.
          const districts = Array.from({ length: districtCount }, (_, i) =>
            district(`d${i}`),
          );
          const locations: CityLocation[] = [];
          for (let i = 0; i < districtCount; i += 1) {
            for (let j = 0; j < 4; j += 1) {
              locations.push(location(`d${i}-l${j}`, `d${i}`));
            }
            locations.push(
              location(`d${i}-drop`, `d${i}`, {
                type: 'drop',
                tags: ['function:drop'],
              }),
            );
          }
          const routes: CityRoute[] = [];
          for (let i = 0; i < districtCount - 1; i += 1) {
            routes.push(route(`d${i}`, `d${i + 1}`));
          }
          const city = bundle({
            districts,
            locations,
            routes,
            locationTypes: [locationType('cafe'), locationType('drop')],
          });
          const vocab = vocabulary([rqOf('rq-drop', ['function:drop'], 2)]);
          const result = instantiateCity(
            city,
            1950,
            vocab,
            createPrng(settingStreamSeed(seed, 0)),
          );

          expect(result).not.toBe('infeasible');
          const inst = result as InstantiatedCity;
          // Bounds.
          expect(inst.districts.length).toBeGreaterThanOrEqual(
            DEFAULT_DISTRICT_BOUND[0],
          );
          expect(inst.districts.length).toBeLessThanOrEqual(
            DEFAULT_DISTRICT_BOUND[1],
          );
          expect(inst.locations.length).toBeLessThanOrEqual(
            DEFAULT_LOCATION_BOUND[1],
          );
          // Required Query bound.
          const drops = inst.locations.filter((id: string) =>
            id.endsWith('-drop'),
          );
          expect(drops.length).toBeGreaterThanOrEqual(2);
          // Routes stay within the selected Districts.
          const selected = selectedDistrictSet(inst);
          for (const r of inst.routes) {
            expect(selected.has(r.a) && selected.has(r.b)).toBe(true);
          }
          // Ids are well-formed.
          for (const d of inst.districts) {
            expect(d).toBe(districtEntityId(d.slice('district:'.length)));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
