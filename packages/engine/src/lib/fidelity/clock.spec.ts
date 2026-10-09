/**
 * Region clock (multi-city task 5.2).
 */

import { describe, expect, it } from 'vitest';

import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import { asTruth, type Proposition } from '../model/core.js';
import { createPrng, type PrngState } from '../prng/prng.js';
import type { Residency, ServiceState } from '../region/services.js';
import { cityAmbientSeed, citySpineSeed } from '../region/streams.js';

import { AmbientContractError } from './contract.js';
import {
  advanceRegion,
  arrive,
  assignTiers,
  initialRegionClock,
  serviceTickOrder,
  type RegionClockState,
} from './clock.js';
import { referenceCity, referenceSimulator, type RefCity } from './reference.js';
import type { AmbientSimulator, CityId, ServiceId } from './types.js';

const CITIES = ['city:alpha', 'city:bravo'] as const satisfies readonly CityId[];

function streams(seed: string, cities: readonly CityId[]) {
  const spine: Record<CityId, PrngState> = {};
  const ambientStreams: Record<CityId, PrngState> = {};
  cities.forEach((city, index) => {
    spine[city] = createPrng(citySpineSeed(seed, index)).state();
    ambientStreams[city] = createPrng(cityAmbientSeed(seed, index)).state();
  });
  return { spine, ambientStreams };
}

function service(id: ServiceId, cities: readonly CityId[]): ServiceState {
  const residencies: Record<CityId, Residency> = {};
  for (const city of cities) {
    residencies[city] = { officers: [], channels: [], drops: [], capacity: 1 };
  }
  return {
    id,
    kind: 'hostile',
    doctrine: { riskTolerance: 0.4, securityConsciousness: 0.4, deceptionAppetite: 0.4 },
    residencies,
    beliefs: {
      ...emptyHostileBeliefs(),
      coverSuspicion: 0,
      watch: asTruth({ persons: [], descriptors: [] }),
    },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
  };
}

function clock(
  playerCity: CityId | null,
  services: Readonly<Record<ServiceId, ServiceState>> = {},
): RegionClockState<RefCity> {
  const order = [...CITIES];
  const saved = streams('clock-seed', order);
  const ambient: Record<CityId, RefCity> = {};
  for (const city of order) {
    ambient[city] = referenceCity(city);
  }
  return initialRegionClock({
    seed: 'clock-seed',
    order,
    playerCity,
    ambient,
    spine: saved.spine,
    ambientStreams: saved.ambientStreams,
    services,
    placements: {
      'npc:clerk': { city: 'city:bravo', loc: 'loc:cafe' },
    },
  });
}

const FACT: Proposition = {
  id: 'prop:seen',
  subject: 'npc:clerk',
  predicate: 'LOCATED_AT',
  object: 'loc:cafe',
  place: 'loc:cafe',
};

describe('region clock', () => {
  it('keeps the current city full and every other city, and transit, coarse', () => {
    expect(assignTiers(CITIES, 'city:alpha')).toEqual({
      'city:alpha': 'full',
      'city:bravo': 'coarse',
    });
    expect(assignTiers(CITIES, null)).toEqual({
      'city:alpha': 'coarse',
      'city:bravo': 'coarse',
    });
  });

  it('ticks services in service id order and residency cities in region order', () => {
    const services = {
      'service:bravo': service('service:bravo', CITIES),
      'service:alpha': service('service:alpha', ['city:bravo', 'city:alpha']),
    };
    expect(serviceTickOrder(CITIES, services)).toEqual([
      { service: 'service:alpha', city: 'city:alpha' },
      { service: 'service:alpha', city: 'city:bravo' },
      { service: 'service:bravo', city: 'city:alpha' },
      { service: 'service:bravo', city: 'city:bravo' },
    ]);
    let stepped = clock('city:alpha', services);
    for (let phase = 0; phase < 4; phase += 1) {
      stepped = advanceRegion(stepped, referenceSimulator(), { debug: false });
    }
    expect(stepped.time).toEqual({ day: 1, phase: 0 });
    expect(stepped.serviceLog).toEqual(serviceTickOrder(CITIES, services));
  });

  it('advances each spine stream in city order before ambient', () => {
    const start = clock('city:alpha');
    const next = advanceRegion(start, referenceSimulator(), { debug: false });
    expect(next.spine['city:alpha']).not.toEqual(start.spine['city:alpha']);
    expect(next.spine['city:bravo']).not.toEqual(start.spine['city:bravo']);
    expect(next.tiers).toEqual({ 'city:alpha': 'full', 'city:bravo': 'coarse' });
    expect(next.ambient['city:alpha']?.coarse).toContain('|full:');
    expect(next.ambient['city:bravo']?.coarse).toContain('|coarse:');
    expect(next.coupling.ledger.length).toBeGreaterThan(0);
  });

  it('reconciles before writing arrival fact lines and keeps disclosed facts', () => {
    const calls: string[] = [];
    const simulator = referenceSimulator();
    const wrapped: AmbientSimulator<RefCity> = {
      ...simulator,
      reconcile(city, ambient, spine, disclosed, rng) {
        calls.push('reconcile');
        return simulator.reconcile(city, ambient, spine, disclosed, rng);
      },
    };
    const arrived = arrive(clock(null), 'city:bravo', [FACT], wrapped, { debug: false });
    expect(calls).toEqual(['reconcile']);
    expect(arrived.factLines).toEqual(['npc:clerk at loc:cafe']);
    expect(arrived.ambient['city:bravo']?.disclosed).toEqual([FACT]);
    expect(arrived.tiers['city:bravo']).toBe('full');
    expect(arrived.tiers['city:alpha']).toBe('coarse');
  });

  it('falls back to the coarse city when reconciliation drops a disclosed fact', () => {
    const simulator = referenceSimulator();
    const dropping: AmbientSimulator<RefCity> = {
      ...simulator,
      reconcile(_city, ambient) {
        return { ...ambient, disclosed: [] };
      },
    };
    const before = clock(null);
    const arrived = arrive(before, 'city:bravo', [FACT], dropping, { debug: true });
    expect(arrived.ambient['city:bravo']).toEqual(before.ambient['city:bravo']);
    expect(arrived.factLines).toEqual(['npc:clerk at loc:cafe']);
    expect(arrived.contractLog).toEqual([
      'reconciliation contradicted a disclosed fact in city:bravo',
    ]);
  });

  it('throws AmbientContractError in a debug build when sampled couplings differ by tier', () => {
    const simulator = referenceSimulator();
    const divergent: AmbientSimulator<RefCity> = {
      ...simulator,
      couplings(_city, ambient) {
        return ambient.coarse.includes('|full:') ? ambient.pending : [];
      },
    };
    expect(() => advanceRegion(clock('city:alpha'), divergent, { debug: true })).toThrow(
      AmbientContractError,
    );
    const logged = advanceRegion(clock('city:alpha'), divergent, { debug: false });
    expect(logged.contractLog[0]).toContain('couplings differ between tiers');
  });
});
