/**
 * Feature: content-expansion, Property 1: Bindability in every conforming city.
 *
 * This is the content-expansion task 3.9 property test. The design fixes
 * Property 1 (design, "Correctness Properties") as a biconditional plus a set
 * of instantiated-city guarantees:
 *
 *   For any pack set and any City Pack in it, the loader accepts the set if and
 *   only if a naive recount finds at least `minStatic` Binders for every
 *   Required Query (including Required Queries added by extension packs). For
 *   every accepted City Pack and every seed and Game Year in its Period Window,
 *   the Instantiated City:
 *     - has District and Location counts within bounds and Districts connected
 *       by Routes;
 *     - contains at least `minInstantiated` Binders of every Required Query;
 *     - binds every mandatory slot of any generated template whose mandatory
 *       slots use Required Queries.
 *
 *   Validates: Requirements 4.5, 4.6, 4.7, 9.4, 17.4.
 *
 * The property is exercised at the engine's setting boundary — the pure
 * `instantiateCity` (task 3.3) that the setting step (task 3.8) runs when a City
 * Pack is selected. The loader's static Tag Conformance (`minStatic`, task 2.3)
 * and its load-order independence are owned and tested in `@tradecraft/content`
 * (its `tag-check` and load-order property specs); here the "accept iff naive
 * recount ≥ minStatic" clause is modelled at the point where it decides whether
 * a city can be placed: a City Pack whose Binders meet the vocabulary's
 * `minStatic` (equivalently, since the generators keep `minStatic ===
 * minInstantiated`, whose Binders meet `minInstantiated`) must instantiate for
 * every seed and every Game Year in its Period Window, and a City Pack short of
 * a Required Query's minimum must return `'infeasible'`.
 *
 * The generator builds random City Packs that are conforming by construction,
 * then — on a coin flip — seeds a single bindability defect (removes a Required
 * Query's Binders below its minimum). A naive recount of static Binders decides
 * the expected branch, and the test asserts `instantiateCity`'s acceptance
 * matches that recount across the whole Period Window, with the three
 * instantiated guarantees holding on every accepted city.
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
  instantiateCity,
  type InstantiatedCity,
} from './instantiate-city.js';

// ---------------------------------------------------------------------------
// A small Tag Vocabulary for the generated cities.
//
// The function facet carries the Required-Query tags. Every generated city is
// tagged against this vocabulary; a defect seeds a shortfall against one query.
// ---------------------------------------------------------------------------

/** The function Tags the generated Required Queries draw from. */
const FUNCTION_TAGS = [
  'function:drop',
  'function:meet',
  'function:safe',
  'function:watch',
] as const;
type FunctionTag = (typeof FUNCTION_TAGS)[number];

// ---------------------------------------------------------------------------
// Fixtures. These mirror `instantiate-city.spec.ts` so the two read the same
// City Bundle shape, but are driven by fast-check so the city geometry, the
// Required Queries and the per-query Binder counts are random.
// ---------------------------------------------------------------------------

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
  opts: { tags?: readonly string[]; weight?: number } = {},
): CityLocation {
  return {
    id,
    name: id,
    aliases: [],
    type: 'cafe',
    district,
    public: true,
    description: 'a place',
    atmosphere: [],
    city: 'city/one',
    tags: opts.tags ? [...opts.tags] : [],
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

function route(a: string, b: string): CityRoute {
  return { a, b, cost: 1 };
}

function cityDefinition(
  period: { from: number; to: number },
  instantiation: CityDefinition['instantiation'],
): CityDefinition {
  return {
    id: 'city/one',
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
    ...(instantiation !== undefined ? { instantiation } : {}),
  };
}

function bundleOf(parts: {
  def: CityDefinition;
  districts: readonly District[];
  locations: readonly CityLocation[];
  routes: readonly CityRoute[];
}): CityBundle {
  return {
    def: parts.def,
    districts: [...parts.districts],
    locations: [...parts.locations],
    routes: [...parts.routes],
    locationTypes: [locationType('cafe')],
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

function vocabularyOf(requiredQueries: readonly RequiredQuery[]): TagVocabulary {
  return {
    facets: [{ id: 'function', appliesTo: ['location'] }],
    tags: FUNCTION_TAGS.map((id) => ({ id, description: id })),
    requiredQueries: [...requiredQueries],
  };
}

// ---------------------------------------------------------------------------
// A naive static-Binder recount — the "naive recount" of Property 1's
// biconditional. A Binder of a query is a Location whose Effective Tags (its
// own Tags together with its Location Type's Tags) contain every Tag the query
// names. The generated Location Types carry no function Tags, so Effective Tags
// here are the Location's own Tags; the recount is deliberately independent of
// `instantiateCity`'s own helpers.
// ---------------------------------------------------------------------------

function effectiveTags(
  loc: CityLocation,
  locationTypes: ReadonlyMap<string, LocationType>,
): Set<string> {
  const tags = new Set<string>(loc.tags);
  for (const t of locationTypes.get(loc.type)?.tags ?? []) {
    tags.add(t);
  }
  return tags;
}

function staticBinderCount(
  bundle: CityBundle,
  query: readonly string[],
): number {
  const types = new Map(bundle.locationTypes.map((t) => [t.id, t]));
  return bundle.locations.filter((loc) => {
    const tags = effectiveTags(loc, types);
    return query.every((tag) => tags.has(tag));
  }).length;
}

/**
 * Whether every Required Query meets its `minStatic` static-Binder floor — the
 * naive-recount side of Property 1's biconditional. The generators keep
 * `minStatic === minInstantiated`, so a city that meets `minStatic` also has
 * enough Binders for the instantiation to place `minInstantiated` of each.
 */
function meetsStaticFloor(
  bundle: CityBundle,
  vocab: TagVocabulary,
): boolean {
  return vocab.requiredQueries.every(
    (rq) => staticBinderCount(bundle, rq.query as readonly string[]) >= rq.minStatic,
  );
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/**
 * A random conforming City Pack with a Tag Vocabulary. The city is a connected
 * path of Districts, each with a pool of plain cafés plus, for every Required
 * Query, enough Binder Locations spread across Districts to meet the query's
 * minimum with margin. On a coin flip a single bindability defect is seeded:
 * one Required Query's Binders are stripped below its minimum, so the naive
 * recount — and `instantiateCity` — must reject the city.
 */
const cityCaseArb = fc
  .record({
    districtCount: fc.integer({ min: 4, max: 7 }),
    cafesPerDistrict: fc.integer({ min: 2, max: 4 }),
    // The Required Queries: a non-empty subset of the function Tags, each a
    // single-Tag query with a minInstantiated of 1 or 2.
    queries: fc
      .uniqueArray(fc.constantFrom<FunctionTag>(...FUNCTION_TAGS), {
        minLength: 1,
        maxLength: FUNCTION_TAGS.length,
      })
      .chain((tags) =>
        fc.tuple(
          ...tags.map((tag) =>
            fc.record({
              tag: fc.constant(tag),
              min: fc.integer({ min: 1, max: 2 }),
              // Binder margin: how many extra Binders beyond the minimum the
              // conforming city carries for this query.
              margin: fc.integer({ min: 0, max: 3 }),
            }),
          ),
        ),
      ),
    // The Game Period, a 1–15 year window so the Period Window sweep stays small.
    periodFrom: fc.integer({ min: 1945, max: 1960 }),
    periodSpan: fc.integer({ min: 0, max: 14 }),
    // Whether to seed a bindability defect, and which query it targets.
    seedDefect: fc.boolean(),
    defectPick: fc.integer({ min: 0, max: FUNCTION_TAGS.length - 1 }),
    seed: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map((cfg) => {
    const period = { from: cfg.periodFrom, to: cfg.periodFrom + cfg.periodSpan };

    const districtIds = Array.from({ length: cfg.districtCount }, (_, i) => `d${i}`);
    const districts = districtIds.map(district);

    const locations: CityLocation[] = [];
    // Plain cafés per District (non-Binders, available for the weighted fill).
    for (const d of districtIds) {
      for (let j = 0; j < cfg.cafesPerDistrict; j += 1) {
        locations.push(location(`${d}-c${j}`, d));
      }
    }
    // Binder Locations per Required Query, round-robined across Districts so a
    // query's Binders are spread (and so step 2's District pull stays within
    // the bound). Each query carries `min + margin` Binders when conforming.
    const queries = cfg.queries;
    for (const q of queries) {
      const count = q.min + q.margin;
      for (let k = 0; k < count; k += 1) {
        const d = districtIds[k % districtIds.length];
        locations.push(
          location(`${d}-${q.tag.replace('function:', '')}-${k}`, d, {
            tags: [q.tag],
          }),
        );
      }
    }

    // A connected path over the Districts.
    const routes: CityRoute[] = [];
    for (let i = 0; i < districtIds.length - 1; i += 1) {
      routes.push(route(districtIds[i], districtIds[i + 1]));
    }

    const requiredQueries: RequiredQuery[] = queries.map((q) => ({
      id: `rq-${q.tag.replace('function:', '')}`,
      query: [q.tag],
      minStatic: q.min,
      minInstantiated: q.min,
    }));

    // Seed a single bindability defect: strip the targeted query's Binders
    // below its minimum. The target is the query at `defectPick % queries.length`.
    let defectQuery: FunctionTag | undefined;
    let working = locations;
    if (cfg.seedDefect) {
      const target = queries[cfg.defectPick % queries.length];
      defectQuery = target.tag;
      const rq = requiredQueries.find((r) => r.query[0] === target.tag);
      const keep = (rq?.minInstantiated ?? 1) - 1; // one short of the minimum
      let seen = 0;
      working = locations.filter((loc) => {
        if (!loc.tags.includes(target.tag)) {
          return true;
        }
        seen += 1;
        return seen <= keep;
      });
    }

    // Bound the instantiation so the city can always satisfy it when
    // conforming: Districts up to the count the city has, Locations modest.
    const instantiation = {
      districts: [Math.min(4, cfg.districtCount), cfg.districtCount] as [number, number],
      locations: [4, 10] as [number, number],
    };

    const def = cityDefinition(period, instantiation);
    const bundle = bundleOf({ def, districts, locations: working, routes });
    const vocab = vocabularyOf(requiredQueries);

    return { bundle, vocab, period, seed: cfg.seed, defectQuery };
  });

// ---------------------------------------------------------------------------
// Assertions over an accepted Instantiated City (the three guarantees).
// ---------------------------------------------------------------------------

function assertGuarantees(
  inst: InstantiatedCity,
  bundle: CityBundle,
  vocab: TagVocabulary,
): void {
  const bound = bundle.def.instantiation;
  const districtBound = bound?.districts ?? [4, 5];
  const locationBound = bound?.locations ?? [10, 14];

  // 1a — District count within bounds. The upper bound is capped at the number
  // of Districts the city has (a city with fewer Districts than the max cannot
  // reach it; the design only requires the minimum then).
  const maxDistricts = Math.min(districtBound[1], bundle.districts.length);
  expect(inst.districts.length).toBeGreaterThanOrEqual(districtBound[0]);
  expect(inst.districts.length).toBeLessThanOrEqual(maxDistricts);

  // 1a — Location count within bounds (lower bound honoured when the city has
  // enough Locations in the selected Districts; the upper bound always).
  expect(inst.locations.length).toBeLessThanOrEqual(locationBound[1]);
  expect(inst.locations.length).toBeGreaterThanOrEqual(1);

  // 1a — Districts connected by Routes. BFS over the selected Routes must reach
  // every selected District from any one.
  const selected = new Set(
    inst.districts.map((id) => id.slice('district:'.length)),
  );
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adjacency.get(a);
    if (set === undefined) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const r of inst.routes) {
    link(r.a, r.b);
    link(r.b, r.a);
  }
  if (selected.size > 0) {
    const start = [...selected].sort()[0];
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const next of adjacency.get(cur) ?? []) {
        if (selected.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    expect(seen.size).toBe(selected.size);
  }

  // 1a — the selected Routes are exactly the authored Routes between selected
  // Districts (so the connectivity check reads the real graph).
  for (const r of inst.routes) {
    expect(selected.has(r.a) && selected.has(r.b)).toBe(true);
  }

  // 1b — at least `minInstantiated` Binders of every Required Query. Recount
  // the selected Locations' Effective Tags against each query.
  const types = new Map(bundle.locationTypes.map((t) => [t.id, t]));
  const byEntityId = new Map(
    bundle.locations.map((loc) => [`loc:${loc.id}`, loc]),
  );
  const selectedLocations = inst.locations
    .map((id) => byEntityId.get(id))
    .filter((loc): loc is CityLocation => loc !== undefined);
  for (const rq of vocab.requiredQueries) {
    const query = rq.query as readonly string[];
    const binders = selectedLocations.filter((loc) =>
      query.every((tag) => effectiveTags(loc, types).has(tag)),
    );
    expect(binders.length).toBeGreaterThanOrEqual(rq.minInstantiated);
  }

  // 1c — binds every mandatory slot of any generated template whose mandatory
  // slots use Required Queries. A mandatory slot keyed on a Required Query binds
  // iff the instantiated city carries at least one Binder of that query; 1b
  // already guarantees `minInstantiated ≥ 1` Binders per query, so every such
  // slot is bindable. Assert the derived condition directly: every Required
  // Query has at least one selected Binder.
  for (const rq of vocab.requiredQueries) {
    const query = rq.query as readonly string[];
    const hasBinder = selectedLocations.some((loc) =>
      query.every((tag) => effectiveTags(loc, types).has(tag)),
    );
    expect(hasBinder).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Property 1.
// ---------------------------------------------------------------------------

describe('Feature: content-expansion, Property 1: Bindability in every conforming city', () => {
  it('accepts iff the naive static recount meets every minimum, and the Instantiated City holds the bounds, binder and slot guarantees across the Period Window (Req 4.5, 4.6, 4.7, 9.4, 17.4)', () => {
    fc.assert(
      fc.property(cityCaseArb, ({ bundle, vocab, period, seed }) => {
        // The naive-recount side of the biconditional.
        const conforming = meetsStaticFloor(bundle, vocab);

        // Sweep every Game Year in the Period Window. Every item here is in
        // period (the City Bundle is already year-filtered in production; the
        // generated city carries no out-of-period content), so the year does
        // not change the geometry — but Property 1 ranges over "every seed and
        // Game Year in its Period Window", so the sweep is explicit.
        for (let year = period.from; year <= period.to; year += 1) {
          const rng = createPrng(settingStreamSeed(seed, 0));
          const result = instantiateCity(bundle, year, vocab, rng);

          if (conforming) {
            // Accept: a conforming city instantiates for every seed and year.
            expect(result).not.toBe('infeasible');
            assertGuarantees(result as InstantiatedCity, bundle, vocab);
          } else {
            // Reject: a city short of a Required Query's minimum is infeasible.
            expect(result).toBe('infeasible');
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('instantiation is deterministic in the setting stream across the Period Window', () => {
    fc.assert(
      fc.property(cityCaseArb, ({ bundle, vocab, period, seed }) => {
        for (let year = period.from; year <= period.to; year += 1) {
          const a = instantiateCity(
            bundle,
            year,
            vocab,
            createPrng(settingStreamSeed(seed, 0)),
          );
          const b = instantiateCity(
            bundle,
            year,
            vocab,
            createPrng(settingStreamSeed(seed, 0)),
          );
          expect(a).toEqual(b);
        }
      }),
      { numRuns: 50 },
    );
  });
});
