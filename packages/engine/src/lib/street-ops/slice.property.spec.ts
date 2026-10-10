/**
 * Street-ops slices and stream independence (tasks 4.1, 4.2).
 *
 * **Validates: Requirements 1.2, 13.1, 13.2**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TruthStore } from '../truth/truth.js';
import { ensureStreetOps, streetOpsOf } from './slice.js';
import { emptyStreetOpsTruth, migrateStreetOpsState, migrateStreetOpsTruth } from './state.js';
import { streetReplayHeader, streetSubstream, STREET_STREAM_BASE } from './stream.js';
import type { WorldState } from '../model/state.js';

describe('street-ops slices', () => {
  it('loads a missing slice as empty and leaves a current slice in place', () => {
    const replay = streetReplayHeader();
    expect(migrateStreetOpsState(undefined, replay).counters.sessions).toBe(0);
    expect(migrateStreetOpsState({ version: 0 }, replay).vehicles).toEqual([]);
    const kept = migrateStreetOpsState(
      { version: 1, vehicles: [], knowledge: { 's-1': 'driven' }, told: [], counters: { sessions: 2 }, replay },
      replay,
    );
    expect(kept.counters.sessions).toBe(2);
    expect(kept.knowledge['s-1']).toBe('driven');
    expect(migrateStreetOpsTruth(undefined)).toEqual(emptyStreetOpsTruth());
  });

  it('omits the slice from a world and a truth store until something writes it', () => {
    const world = { meta: { seed: 'alpha' } } as WorldState;
    expect(streetOpsOf(world)).toBeUndefined();
    expect('ext' in ensureStreetOps(world)).toBe(true);
    expect(ensureStreetOps(world).ext?.streetOps?.replay.base).toBe(STREET_STREAM_BASE);
    const store = TruthStore.create({ get: () => undefined });
    expect(store.snapshot()).not.toHaveProperty('ext');
    store.ensureStreetOps();
    expect(store.streetOps()?.teams).toEqual({});
    expect(store.snapshot().ext?.streetOps?.version).toBe(1);
    const again = TruthStore.from({ get: () => undefined }, store.snapshot());
    expect(again.streetOps()?.statements).toEqual([]);
  });
});

describe('street stream', () => {
  it('keeps sub-streams independent', () => {
    // Feature: street-ops, Property 2: Determinism and stream independence
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 5 }),
        (seed, key, draws) => {
          const firstSpot = streetSubstream(seed, 'spot', key);
          const tail = streetSubstream(seed, 'tail', key);
          const spotValues: number[] = [];
          for (let i = 0; i < draws; i += 1) spotValues.push(firstSpot.next());
          for (let i = 0; i < draws; i += 1) tail.next();
          const secondSpot = streetSubstream(seed, 'spot', key);
          const again: number[] = [];
          for (let i = 0; i < draws; i += 1) again.push(secondSpot.next());
          expect(again).toEqual(spotValues);
          expect(streetSubstream(seed, 'checkpoint', key).next()).toBe(
            streetSubstream(seed, 'checkpoint', key).next(),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
