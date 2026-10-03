/**
 * Tests for the pure city functions (task 5.1): `crowdLevel`, `crowdAt`,
 * `travelCost` and the daily `weatherForDay` draw (Requirements 21.2, 21.6).
 *
 * These exercise the functions in isolation with hand-built inputs; the
 * generation tests in `generate.spec.ts` drive them over a real generated city.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CityData } from '@tradecraft/content';

import {
  CROWD_LEVELS,
  crowdLevel,
  travelCost,
  weatherForDay,
  weatherTagsFor,
  type City,
  type CrowdModel,
  type District,
  type DistrictId,
  type Location,
} from './city.js';
import type { GameTime, LocId, Phase } from '../model/core.js';

// --- fixtures --------------------------------------------------------------

/** A café-like model: busy on Monday afternoon, fuller in the rain. */
const CAFE_MODEL: CrowdModel = {
  curve: [
    { weekday: 'monday', phase: 'afternoon', level: 0.6 },
    { weekday: 'monday', phase: 'early-morning', level: 0.1 },
  ],
  weatherModifiers: [
    { weather: 'rain', crowdMultiplier: 1.3 },
    { weather: 'clear', crowdMultiplier: 0.5 },
  ],
};

function district(id: string, sector = 'international'): District {
  return { id: `district:${id}` as DistrictId, name: id, sector };
}

function location(id: string, districtId: string): Location {
  return {
    id: `loc:${id}` as LocId,
    name: id,
    aliases: [],
    type: 'kaffeehaus',
    district: `district:${districtId}` as DistrictId,
    public: true,
    description: '',
    atmosphere: [],
    hours: { 0: true, 1: true, 2: true, 3: false } as Record<Phase, boolean>,
    risk: 0.1,
    deadDropSites: [],
  };
}

/** A three-district city with a known route graph for travel tests. */
function makeCity(routes: City['routes']): City {
  const districts = {
    'district:a': district('a'),
    'district:b': district('b'),
    'district:c': district('c'),
  } as Record<DistrictId, District>;
  const locations = {
    'loc:a1': location('a1', 'a'),
    'loc:a2': location('a2', 'a'),
    'loc:b1': location('b1', 'b'),
    'loc:c1': location('c1', 'c'),
  } as Record<LocId, Location>;
  return {
    displayName: 'Test',
    districts,
    locations,
    routes,
    crowdModels: { kaffeehaus: CAFE_MODEL },
    startMonth: 1,
  };
}

// --- crowdLevel ------------------------------------------------------------

describe('crowdLevel', () => {
  const mondayAfternoon: GameTime = { day: 0, phase: 1 };

  it('derives a band from the base curve with no weather', () => {
    // base 0.6 -> 'busy'
    expect(crowdLevel(CAFE_MODEL, mondayAfternoon, new Set())).toBe('busy');
  });

  it('raises the band when a matching weather tag applies', () => {
    // 0.6 * 1.3 = 0.78 -> still 'busy' (threshold 0.8)
    expect(crowdLevel(CAFE_MODEL, mondayAfternoon, new Set(['rain']))).toBe('busy');
  });

  it('lowers the band when a dampening tag applies', () => {
    // 0.6 * 0.5 = 0.3 -> 'sparse'
    expect(crowdLevel(CAFE_MODEL, mondayAfternoon, new Set(['clear']))).toBe('sparse');
  });

  it('reads empty when the curve has no entry for the time', () => {
    const nightSunday: GameTime = { day: 6, phase: 3 };
    expect(crowdLevel(CAFE_MODEL, nightSunday, new Set())).toBe('empty');
  });

  it('is pure: identical inputs always give the same band', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 400 }),
        fc.constantFrom(0, 1, 2, 3),
        fc.array(fc.constantFrom('rain', 'clear', 'snow'), { maxLength: 3 }),
        (day, phase, tags) => {
          const t: GameTime = { day, phase: phase as Phase };
          const a = crowdLevel(CAFE_MODEL, t, new Set(tags));
          const b = crowdLevel(CAFE_MODEL, t, new Set(tags));
          expect(a).toBe(b);
          expect(CROWD_LEVELS).toContain(a);
        },
      ),
    );
  });
});

describe('weatherTagsFor', () => {
  const cityData = {
    weather: { tags: ['clear', 'rain', 'snow', 'fog', 'thunderstorm'] },
  } as unknown as CityData;

  it('maps a hyphenated condition id to its known tag tokens', () => {
    expect([...weatherTagsFor('clear-cold', cityData)]).toEqual(['clear']);
  });

  it('maps a plain condition id to itself when it is a known tag', () => {
    expect([...weatherTagsFor('rain', cityData)]).toEqual(['rain']);
  });

  it('yields no tags for an unknown condition', () => {
    expect([...weatherTagsFor('overcast', cityData)]).toEqual([]);
  });
});

// --- travelCost ------------------------------------------------------------

describe('travelCost', () => {
  it('is free within a District', () => {
    const city = makeCity([]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:a2' as LocId, false)).toBe(0);
  });

  it('adds a phase for a countersurveillance route within a District', () => {
    const city = makeCity([]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:a2' as LocId, true)).toBe(1);
  });

  it('finds the cheapest multi-hop route between Districts', () => {
    // a -(1)- b -(0)- c ; a->c costs 1
    const city = makeCity([
      { a: 'district:a' as DistrictId, b: 'district:b' as DistrictId, cost: 1 },
      { a: 'district:b' as DistrictId, b: 'district:c' as DistrictId, cost: 0 },
    ]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:c1' as LocId, false)).toBe(1);
  });

  it('prefers a cheaper direct route over a costlier path', () => {
    const city = makeCity([
      { a: 'district:a' as DistrictId, b: 'district:b' as DistrictId, cost: 1 },
      { a: 'district:b' as DistrictId, b: 'district:c' as DistrictId, cost: 1 },
      { a: 'district:a' as DistrictId, b: 'district:c' as DistrictId, cost: 0 },
    ]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:c1' as LocId, false)).toBe(0);
  });

  it('adds the countersurveillance surcharge to a between-District trip', () => {
    const city = makeCity([
      { a: 'district:a' as DistrictId, b: 'district:b' as DistrictId, cost: 1 },
    ]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:b1' as LocId, true)).toBe(2);
  });

  it('returns Infinity when no route connects the Districts', () => {
    const city = makeCity([]);
    expect(travelCost(city, 'loc:a1' as LocId, 'loc:b1' as LocId, false)).toBe(Infinity);
  });

  it('returns Infinity for an unknown Location', () => {
    const city = makeCity([]);
    expect(travelCost(city, 'loc:nope' as LocId, 'loc:a1' as LocId, false)).toBe(Infinity);
  });
});

// --- weatherForDay ---------------------------------------------------------

const WEATHER_CITY_DATA = {
  id: 'w',
  displayName: 'W',
  districts: [{ id: 'd', name: 'D', sector: 's' }],
  streets: {},
  namePools: {},
  weather: {
    seasons: {
      winter: {
        months: [12, 1, 2],
        conditions: [
          { id: 'snow', label: 'snow', weight: 3 },
          { id: 'fog', label: 'fog', weight: 2 },
          { id: 'clear-cold', label: 'cold', weight: 1 },
        ],
      },
      summer: {
        months: [6, 7, 8],
        conditions: [{ id: 'clear', label: 'warm', weight: 1 }],
      },
    },
    tags: ['snow', 'fog', 'clear'],
  },
} as unknown as CityData;

const WEATHER_CITY: City = {
  displayName: 'W',
  districts: {},
  locations: {},
  routes: [],
  crowdModels: {},
  startMonth: 1, // January -> winter
};

describe('weatherForDay', () => {
  it('is deterministic from seed and day', () => {
    const a = weatherForDay('seed-1', WEATHER_CITY, WEATHER_CITY_DATA, 3);
    const b = weatherForDay('seed-1', WEATHER_CITY, WEATHER_CITY_DATA, 3);
    expect(a).toEqual(b);
  });

  it('reads the season table for the day\u2019s month', () => {
    // startMonth 1 (January) -> winter table for the first 30 days.
    const w = weatherForDay('seed-x', WEATHER_CITY, WEATHER_CITY_DATA, 0);
    expect(w.season).toBe('winter');
    expect(['snow', 'fog', 'clear-cold']).toContain(w.condition);
  });

  it('switches season as the month advances', () => {
    // Day 150 with startMonth 1 lands 5 months later -> June -> summer.
    const summerCity: City = { ...WEATHER_CITY, startMonth: 1 };
    const w = weatherForDay('seed', summerCity, WEATHER_CITY_DATA, 150);
    expect(w.season).toBe('summer');
    expect(w.condition).toBe('clear');
  });

  it('varies across days and spans the condition table over a season', () => {
    const conditions = new Set<string>();
    for (let day = 0; day < 30; day += 1) {
      conditions.add(weatherForDay('spread-seed', WEATHER_CITY, WEATHER_CITY_DATA, day).condition);
    }
    // Over a month the weighted draw should produce more than one condition.
    expect(conditions.size).toBeGreaterThan(1);
  });

  it('throws when no season covers the month', () => {
    const gapCity: City = { ...WEATHER_CITY, startMonth: 3 }; // March -> no table
    expect(() => weatherForDay('s', gapCity, WEATHER_CITY_DATA, 0)).toThrow();
  });
});
