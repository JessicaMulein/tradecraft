/**
 * Multi-city task 5.1: the ambient contract suite, SliceAmbient, the reference
 * simulator, and applyCouplings caps.
 */

import { createPrng } from '../prng/prng.js';
import { describe, expect, it } from 'vitest';

import { ambientCouplingCaps, applyCouplings, emptyCouplingDraft } from './apply.js';
import { runAmbientContract } from './contract.js';
import { referenceCity, referenceSimulator, referenceSpine } from './reference.js';
import { sliceAmbient, sliceCity, sliceSpine } from './slice-ambient.js';
import { exampleCouplings, type CityId } from './types.js';

const CITY = 'city:test' as CityId;

describe('ambient contract', () => {
  it('accepts SliceAmbient', () => {
    expect(() =>
      runAmbientContract({
        simulator: sliceAmbient(),
        city: CITY,
        initial: () =>
          sliceCity(CITY, {
            'npc:clerk': {
              entries: [
                { weekday: 0, phase: 0, loc: 'loc:cafe' },
                { weekday: 1, phase: 0, loc: 'loc:park' },
              ],
            },
          }),
        spine: () => sliceSpine(CITY),
        playerConcerning: (state) => state.whereabouts,
        disclosedFacts: (state) => state.disclosed,
        coarseSignature: (state) => state.schedules,
        spineSignature: (state) => state.spineStamp,
      }),
    ).not.toThrow();
  });

  it('accepts the path-dependent reference simulator', () => {
    expect(() =>
      runAmbientContract({
        simulator: referenceSimulator(),
        city: CITY,
        initial: () => referenceCity(CITY),
        spine: () => referenceSpine(CITY),
        playerConcerning: (state) => state.player,
        disclosedFacts: (state) => state.disclosed,
        coarseSignature: (state) => state.coarse,
        spineSignature: (state) => state.spineStamp,
        requireEveryKind: true,
        expectCoarseDivergence: true,
      }),
    ).not.toThrow();
  });

  it('rejects a simulator whose couplings depend on the tier', () => {
    const simulator = referenceSimulator();
    expect(() =>
      runAmbientContract({
        simulator: {
          ...simulator,
          couplings(_city, ambient) {
            return ambient.coarse.includes('coarse:') ? [] : ambient.pending;
          },
        },
        city: CITY,
        initial: () => referenceCity(CITY),
        spine: () => referenceSpine(CITY),
        playerConcerning: (state) => state.player,
        disclosedFacts: (state) => state.disclosed,
        coarseSignature: (state) => state.coarse,
      }),
    ).toThrow(/tier-independent/);
  });
});

describe('applyCouplings', () => {
  it('applies every kind and caps delay and cover suspicion', () => {
    const caps = ambientCouplingCaps('standard');
    const applied = applyCouplings(emptyCouplingDraft(), exampleCouplings(), caps);
    expect(applied.closed['loc:cafe']).toBe(2);
    expect(applied.crowd['loc:cafe']).toBe(0.5);
    expect(applied.routeDelay['route:harbor']).toBe(1);
    expect(applied.plotDelayDays).toBe(1);
    expect(applied.reroutes).toEqual([{ stage: 'stage:meet', from: 'loc:cafe' }]);
    expect(applied.outages).toEqual([{ channel: 'chan:drop', untilDay: 4 }]);
    expect(applied.suspicion).toBeCloseTo(0.01);
    expect(applied.reports).toHaveLength(1);
    expect(applied.detection['npc:clerk']).toBeCloseTo(0.02);

    const overDelay = applyCouplings(
      applied,
      [
        { kind: 'delay-stage', stage: 'stage:meet', days: 2 },
        { kind: 'cover-suspicion-delta', amount: 1, cause: 'ambient' },
      ],
      caps,
    );
    expect(overDelay.plotDelayDays).toBe(1);
    expect(overDelay.suspicion).toBeCloseTo(caps.maxCoverSuspicionPerDay);
    expect(overDelay.ledger.filter((entry) => entry.applied === false).length).toBeGreaterThan(0);
  });
});

describe('SliceAmbient', () => {
  it('places a background NPC from the slice schedule at both tiers', () => {
    const simulator = sliceAmbient();
    const city = sliceCity(CITY, {
      'npc:clerk': {
        entries: [
          { weekday: 0, phase: 0, loc: 'loc:cafe' },
          { weekday: 1, phase: 0, loc: 'loc:park' },
        ],
      },
    });
    const spine = sliceSpine(CITY);
    const full = simulator.advanceFull(CITY, city, spine, createPrng('slice'));
    const coarse = simulator.advanceCoarse(CITY, city, spine, createPrng('slice'));
    expect(full.next.whereabouts['npc:clerk']).toBe('loc:cafe');
    expect(coarse.next.whereabouts).toEqual(full.next.whereabouts);
    expect(full.next.schedules).toEqual(city.schedules);
    const tuesday = { time: { day: 1, phase: 0 as const }, placements: spine.placements };
    const moved = simulator.advanceFull(CITY, full.next, tuesday, createPrng('slice-day'));
    expect(moved.next.whereabouts['npc:clerk']).toBe('loc:park');
    expect(simulator.reconcile(CITY, moved.next, tuesday, [], createPrng('slice-reconcile'))).toBe(moved.next);
    expect(simulator.couplings(CITY, moved.next, tuesday.time)).toEqual([]);
  });
});

describe('reference simulator', () => {
  it('diverges in coarse detail and keeps couplings', () => {
    const simulator = referenceSimulator();
    const city = referenceCity(CITY);
    const spine = referenceSpine(CITY);
    const full = simulator.advanceFull(CITY, city, spine, createPrng('a'));
    const coarse = simulator.advanceCoarse(CITY, city, spine, createPrng('a'));
    expect(full.next.coarse).not.toEqual(coarse.next.coarse);
    expect(simulator.couplings(CITY, full.next, spine.time)).toEqual(
      simulator.couplings(CITY, coarse.next, spine.time),
    );
    expect(full.events[0]?.origin).toBe('ambient');
  });
});
