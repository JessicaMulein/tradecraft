/**
 * Tests for city generation (task 5.1; Requirements 21.1, 21.2, 21.8).
 *
 * These load the real core pack and its `city.yaml`, generate a city on the
 * core PRNG stream, and check the invariants the slice fixes: District and
 * Location counts in range, every Location Type represented, a connected Route
 * graph, risk ratings drawn from the Location Type `baseRisk`, public Locations
 * marked known, and — the determinism that underpins Property 1 — the same seed
 * and content producing an identical city.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  type CityData,
  type ContentSet,
  type LocationType,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { travelCost, type City } from './city.js';
import {
  generateCity,
  MAX_DISTRICTS,
  MAX_LOCATIONS,
  MIN_DISTRICTS,
  MIN_LOCATIONS,
  type GeneratedCity,
} from './generate.js';

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

function loadCore(): { content: ContentSet; cityData: CityData } {
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
    throw new Error(
      `city.yaml failed to load:\n${cityData.errors
        .map((e) => `  ${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return { content: content.value, cityData: cityData.value };
}

const { content, cityData } = loadCore();
const locationTypes = [...content.locationTypes.values()];
const typeById = new Map<string, LocationType>(
  locationTypes.map((t) => [t.id, t]),
);

function gen(seed: string): GeneratedCity {
  return generateCity(createPrng(seed), locationTypes, cityData);
}

/** Every District reachable from every other over the Route graph. */
function isConnected(city: City): boolean {
  const ids = Object.keys(city.districts);
  if (ids.length <= 1) {
    return true;
  }
  const adj = new Map<string, string[]>();
  for (const route of city.routes) {
    (adj.get(route.a) ?? adj.set(route.a, []).get(route.a)!).push(route.b);
    (adj.get(route.b) ?? adj.set(route.b, []).get(route.b)!).push(route.a);
  }
  const seen = new Set<string>([ids[0]]);
  const stack = [ids[0]];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size === ids.length;
}

describe('generateCity', () => {
  it('generates 5\u20137 Districts and 16\u201322 Locations', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { city } = gen(seed);
        const districtCount = Object.keys(city.districts).length;
        const locationCount = Object.keys(city.locations).length;
        expect(districtCount).toBeGreaterThanOrEqual(MIN_DISTRICTS);
        expect(districtCount).toBeLessThanOrEqual(MAX_DISTRICTS);
        expect(locationCount).toBeGreaterThanOrEqual(MIN_LOCATIONS);
        expect(locationCount).toBeLessThanOrEqual(MAX_LOCATIONS);
      }),
      { numRuns: 50 },
    );
  });

  it('represents every Location Type at least once', () => {
    const { city } = gen('variety-seed');
    const stampedTypes = new Set(Object.values(city.locations).map((l) => l.type));
    for (const type of locationTypes) {
      expect(stampedTypes.has(type.id)).toBe(true);
    }
  });

  it('places every Location in a generated District', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { city } = gen(seed);
        for (const loc of Object.values(city.locations)) {
          expect(city.districts[loc.district]).toBeDefined();
        }
      }),
      { numRuns: 30 },
    );
  });

  it('connects the Districts with Routes so every pair is reachable', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { city } = gen(seed);
        expect(isConnected(city)).toBe(true);
        // Every Route costs 0 or 1 phase and names two distinct Districts.
        for (const route of city.routes) {
          expect([0, 1]).toContain(route.cost);
          expect(route.a).not.toBe(route.b);
          expect(city.districts[route.a]).toBeDefined();
          expect(city.districts[route.b]).toBeDefined();
        }
      }),
      { numRuns: 30 },
    );
  });

  it('makes travelCost finite between every pair of Locations', () => {
    const { city } = gen('reachable-seed');
    const locIds = Object.keys(city.locations) as Array<keyof typeof city.locations>;
    for (const from of locIds) {
      for (const to of locIds) {
        expect(travelCost(city, from, to, false)).toBeLessThan(Infinity);
      }
    }
  });

  it('draws each Location risk from its Location Type baseRisk', () => {
    const { city } = gen('risk-seed');
    for (const loc of Object.values(city.locations)) {
      const type = typeById.get(loc.type);
      expect(type).toBeDefined();
      expect(loc.risk).toBe(type!.baseRisk);
    }
  });

  it('marks exactly the public Locations as known (Req 21.8)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { city, knownLocations } = gen(seed);
        const known = new Set(knownLocations);
        for (const loc of Object.values(city.locations)) {
          const type = typeById.get(loc.type);
          expect(loc.public).toBe(type!.public);
          expect(known.has(loc.id)).toBe(loc.public);
        }
        // No private Location is known at game start.
        for (const id of knownLocations) {
          expect(city.locations[id].public).toBe(true);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('stamps a description and atmosphere tags from the Location Type pools', () => {
    const { city } = gen('flavour-seed');
    for (const loc of Object.values(city.locations)) {
      const type = typeById.get(loc.type)!;
      expect(type.descriptionPool).toContain(loc.description);
      expect(loc.atmosphere).toEqual(type.atmosphereTags);
    }
  });

  it('folds opening hours onto the four engine phases', () => {
    const { city } = gen('hours-seed');
    for (const loc of Object.values(city.locations)) {
      expect(Object.keys(loc.hours).sort()).toEqual(['0', '1', '2', '3']);
      for (const open of Object.values(loc.hours)) {
        expect(typeof open).toBe('boolean');
      }
    }
  });

  it('builds a crowd model for every stamped Location Type', () => {
    const { city } = gen('crowd-seed');
    for (const loc of Object.values(city.locations)) {
      expect(city.crowdModels[loc.type]).toBeDefined();
    }
  });
});

describe('determinism (underpins Property 1)', () => {
  it('produces an identical city for the same seed and content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (seed) => {
        const a = gen(seed);
        const b = gen(seed);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      }),
      { numRuns: 40 },
    );
  });

  it('produces different cities for different seeds (not a constant)', () => {
    const a = JSON.stringify(gen('seed-alpha'));
    const b = JSON.stringify(gen('seed-beta'));
    expect(a).not.toEqual(b);
  });

  it('is independent of Location Type iteration order', () => {
    const forward = generateCity(createPrng('order-seed'), locationTypes, cityData);
    const reversed = generateCity(
      createPrng('order-seed'),
      [...locationTypes].reverse(),
      cityData,
    );
    expect(JSON.stringify(forward)).toEqual(JSON.stringify(reversed));
  });
});
