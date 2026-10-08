/**
 * Path-dependent reference simulator. Full-tier detail diverges from coarse
 * detail, and the coupling list does not. Property 4 of multi-city uses this
 * later; the contract suite uses it now.
 */

import type { Proposition } from '../model/core.js';

import type { AmbientCoupling, AmbientSimulator, CityId, SpineView } from './types.js';
import { exampleCouplings } from './types.js';

export interface RefCity {
  readonly cityId: CityId;
  readonly player: {
    readonly memory: readonly string[];
    readonly gossip: readonly string[];
    readonly informants: readonly string[];
  };
  readonly disclosed: readonly Proposition[];
  readonly coarse: string;
  readonly pending: readonly AmbientCoupling[];
  readonly spineStamp: string;
}

export function referenceCity(city: CityId): RefCity {
  return {
    cityId: city,
    player: { memory: ['player:seen'], gossip: ['player:heard'], informants: ['npc:clerk'] },
    disclosed: [],
    coarse: 'start',
    pending: exampleCouplings(),
    spineStamp: 'spine',
  };
}

export function referenceSpine(city: CityId): SpineView {
  return { time: { day: 1, phase: 0 }, placements: { [city]: { city, loc: 'loc:cafe' } } };
}

export function referenceSimulator(): AmbientSimulator<RefCity> {
  return {
    advanceFull(_city, ambient, _spine, rng) {
      return {
        next: { ...ambient, coarse: `${ambient.coarse}|full:${rng.next()}` },
        events: [{ kind: 'reference', origin: 'ambient', visibility: 'hidden' }],
      };
    },
    advanceCoarse(_city, ambient, _spine, rng) {
      return {
        next: { ...ambient, coarse: `${ambient.coarse}|coarse:${rng.next()}` },
        events: [{ kind: 'reference', origin: 'ambient', visibility: 'hidden' }],
      };
    },
    reconcile(_city, ambient, _spine, disclosed) {
      return { ...ambient, disclosed: [...disclosed], coarse: `${ambient.coarse}|reconciled` };
    },
    couplings(_city, ambient) {
      return ambient.pending;
    },
  };
}
