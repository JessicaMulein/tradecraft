/**
 * Region clock properties (multi-city tasks 5.3 and 5.4).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import { asTruth, type Proposition } from '../model/core.js';
import type { CityTier } from '../region/world.js';
import type { Residency, ServiceState } from '../region/services.js';
import { initialCityStreams } from '../region/streams.js';

import {
  advanceRegion,
  arrive,
  initialRegionClock,
  spineProjection,
  type RegionClockState,
} from './clock.js';
import { referenceCity, referenceSimulator, type RefCity } from './reference.js';
import type { CityId, ServiceId } from './types.js';

function region(seed: string, count: number): RegionClockState<RefCity> {
  const order = Array.from({ length: count }, (_, index) => `city:c${index}` as CityId);
  const saved = initialCityStreams(seed, order);
  const ambient: Record<CityId, RefCity> = {};
  const placements: RegionClockState<RefCity>['placements'] = {};
  for (const city of order) {
    ambient[city] = referenceCity(city);
    placements[`npc:${city}`] = { city, loc: 'loc:cafe' };
  }
  const services: Record<ServiceId, ServiceState> = {
    'service:bravo': residence('service:bravo', order),
    'service:alpha': residence('service:alpha', order),
  };
  return initialRegionClock({
    seed,
    order,
    playerCity: order[0] ?? null,
    ambient,
    spine: saved.spine,
    ambientStreams: saved.ambient,
    services,
    placements,
  });
}

function residence(id: ServiceId, cities: readonly CityId[]): ServiceState {
  const residencies: Record<CityId, Residency> = {};
  for (const city of cities) {
    residencies[city] = { officers: [], channels: [], drops: [], capacity: 1 };
  }
  return {
    id,
    kind: 'hostile',
    doctrine: { riskTolerance: 0.2, securityConsciousness: 0.2, deceptionAppetite: 0.2 },
    residencies,
    beliefs: {
      ...emptyHostileBeliefs(),
      coverSuspicion: 0,
      watch: asTruth({ persons: [], descriptors: [] }),
    },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
  };
}

function allFull(order: readonly CityId[]): Record<CityId, CityTier> {
  const tiers: Record<CityId, CityTier> = {};
  for (const city of order) {
    tiers[city] = 'full';
  }
  return tiers;
}

describe('region clock properties', () => {
  it('Property 3: Spine tier equivalence', () => {
    // Feature: multi-city, Property 3: Spine tier equivalence
    const simulator = referenceSimulator();
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 32 }),
        (seed, count, phases, bits) => {
          let varied = region(seed, count);
          let full = region(seed, count);
          const fullTiers = allFull(varied.order);
          let bit = 0;
          for (let step = 0; step < phases; step += 1) {
            const tiers: Record<CityId, CityTier> = {};
            for (const city of varied.order) {
              const flag = bits[bit % bits.length] === true;
              bit += 1;
              tiers[city] = flag ? 'full' : 'coarse';
            }
            varied = advanceRegion(varied, simulator, { tiers, debug: true });
            full = advanceRegion(full, simulator, { tiers: fullTiers, debug: true });
            expect(spineProjection(varied)).toEqual(spineProjection(full));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 4: Bounded Ambient divergence on arrival', () => {
    // Feature: multi-city, Property 4: Bounded Ambient divergence on arrival
    const simulator = referenceSimulator();
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 6 }),
        (seed, count, phases) => {
          const away = region(seed, count);
          const destination = away.order[away.order.length - 1];
          if (destination === undefined) {
            return;
          }
          const disclosed: Proposition = {
            id: `prop:${destination}`,
            subject: 'npc:clerk',
            predicate: 'LOCATED_AT',
            object: 'loc:cafe',
            place: 'loc:cafe',
          };
          let coarseRun = initialRegionClock({
            ...away,
            playerCity: null,
          });
          let fullRun = initialRegionClock({
            ...away,
            playerCity: away.order[0] ?? null,
          });
          const fullTiers = allFull(away.order);
          for (let step = 0; step < phases; step += 1) {
            coarseRun = advanceRegion(coarseRun, simulator, { debug: true });
            fullRun = advanceRegion(fullRun, simulator, { tiers: fullTiers, debug: true });
          }
          coarseRun = arrive(coarseRun, destination, [disclosed], simulator, { debug: true });
          fullRun = arrive(fullRun, destination, [disclosed], simulator, { debug: true });
          const kept = coarseRun.ambient[destination]?.disclosed ?? [];
          expect(kept.map((fact) => fact.id)).toContain(disclosed.id);
          expect(spineProjection(coarseRun)).toEqual(spineProjection(fullRun));
          expect(coarseRun.factLines).toEqual(fullRun.factLines);
          expect(coarseRun.ambient[destination]).not.toEqual(fullRun.ambient[destination]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
