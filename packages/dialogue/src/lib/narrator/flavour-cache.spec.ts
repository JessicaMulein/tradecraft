import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import {
  CROWD_LEVELS,
  type CrowdLevel,
  type LocId,
  type Phase,
} from '@tradecraft/engine';

import {
  LocationFlavourCache,
  flavourCacheKey,
  type FlavourCacheCoords,
} from './flavour-cache.js';

/** A sample set of coords for the explicit example tests. */
const cafeMorningBusy: FlavourCacheCoords = {
  loc: 'loc:cafe' as LocId,
  phase: 1,
  crowd: 'busy',
};

const flavour = ['The windows fog with the breath of the lunch crowd.'];

describe('flavourCacheKey', () => {
  it('composes the stable `loc|phase|crowd` key', () => {
    expect(flavourCacheKey(cafeMorningBusy)).toBe('loc:cafe|1|busy');
  });

  it('is deterministic: identical coords give identical keys', () => {
    const a = flavourCacheKey({ loc: 'loc:pier' as LocId, phase: 3, crowd: 'empty' });
    const b = flavourCacheKey({ loc: 'loc:pier' as LocId, phase: 3, crowd: 'empty' });
    expect(a).toBe(b);
  });

  it('adds a non-open location status to the key', () => {
    expect(flavourCacheKey({ ...cafeMorningBusy, status: 'open' })).toBe('loc:cafe|1|busy');
    expect(flavourCacheKey({ ...cafeMorningBusy, status: 'raided' })).toBe('loc:cafe|1|busy|raided');
  });

  it('is sensitive to the Location', () => {
    const base: FlavourCacheCoords = { loc: 'loc:cafe' as LocId, phase: 1, crowd: 'busy' };
    const other: FlavourCacheCoords = { ...base, loc: 'loc:bar' as LocId };
    expect(flavourCacheKey(other)).not.toBe(flavourCacheKey(base));
  });

  it('is sensitive to the phase', () => {
    const base: FlavourCacheCoords = { loc: 'loc:cafe' as LocId, phase: 1, crowd: 'busy' };
    const other: FlavourCacheCoords = { ...base, phase: 2 };
    expect(flavourCacheKey(other)).not.toBe(flavourCacheKey(base));
  });

  it('is sensitive to the crowd band', () => {
    const base: FlavourCacheCoords = { loc: 'loc:cafe' as LocId, phase: 1, crowd: 'busy' };
    const other: FlavourCacheCoords = { ...base, crowd: 'packed' };
    expect(flavourCacheKey(other)).not.toBe(flavourCacheKey(base));
  });
});

describe('LocationFlavourCache', () => {
  it('misses on an empty cache', () => {
    const cache = LocationFlavourCache.empty();
    expect(cache.get(cafeMorningBusy)).toBeUndefined();
    expect(cache.has(cafeMorningBusy)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('returns the stored Flavour on a hit', () => {
    const cache = LocationFlavourCache.empty();
    cache.set(cafeMorningBusy, flavour);
    expect(cache.get(cafeMorningBusy)).toEqual(flavour);
    expect(cache.has(cafeMorningBusy)).toBe(true);
  });

  it('getOrProduce produces and stores on a miss, calling the producer once', async () => {
    const cache = LocationFlavourCache.empty();
    const produce = vi.fn(() => flavour);

    const first = await cache.getOrProduce(cafeMorningBusy, produce);

    expect(first).toEqual(flavour);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(cache.has(cafeMorningBusy)).toBe(true);
  });

  it('getOrProduce returns the identical cached value on a hit without producing again', async () => {
    const cache = LocationFlavourCache.empty();
    const produce = vi.fn(() => flavour);
    const regenerate = vi.fn(() => ['A completely different description.']);

    const first = await cache.getOrProduce(cafeMorningBusy, produce);
    const second = await cache.getOrProduce(cafeMorningBusy, regenerate);

    // Same key reuses the first Flavour; the second producer is never called.
    expect(second).toEqual(first);
    expect(regenerate).not.toHaveBeenCalled();
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct entries for coords that differ in any one part', async () => {
    const cache = LocationFlavourCache.empty();

    const atCafe: FlavourCacheCoords = { loc: 'loc:cafe' as LocId, phase: 1, crowd: 'busy' };
    const otherLoc: FlavourCacheCoords = { ...atCafe, loc: 'loc:bar' as LocId };
    const otherPhase: FlavourCacheCoords = { ...atCafe, phase: 2 };
    const otherCrowd: FlavourCacheCoords = { ...atCafe, crowd: 'packed' };

    cache.set(atCafe, ['cafe']);
    cache.set(otherLoc, ['bar']);
    cache.set(otherPhase, ['afternoon']);
    cache.set(otherCrowd, ['packed']);

    expect(cache.size).toBe(4);
    expect(cache.get(atCafe)).toEqual(['cafe']);
    expect(cache.get(otherLoc)).toEqual(['bar']);
    expect(cache.get(otherPhase)).toEqual(['afternoon']);
    expect(cache.get(otherCrowd)).toEqual(['packed']);
  });

  it('does not alias stored Flavour: mutating the input or the result leaves the entry intact', () => {
    const cache = LocationFlavourCache.empty();
    const input = ['original'];
    cache.set(cafeMorningBusy, input);

    input.push('mutated after set');
    const got = cache.get(cafeMorningBusy) as string[];
    got.push('mutated after get');

    expect(cache.get(cafeMorningBusy)).toEqual(['original']);
  });

  it('round-trips through a save snapshot', () => {
    const cache = LocationFlavourCache.empty();
    cache.set(cafeMorningBusy, flavour);
    cache.set({ loc: 'loc:pier' as LocId, phase: 3, crowd: 'empty' }, ['The pier is deserted.']);

    const snapshot = cache.snapshot();
    expect(snapshot).toEqual({
      'loc:cafe|1|busy': flavour,
      'loc:pier|3|empty': ['The pier is deserted.'],
    });

    const rehydrated = LocationFlavourCache.from(snapshot);
    expect(rehydrated.get(cafeMorningBusy)).toEqual(flavour);
    expect(rehydrated.size).toBe(2);
  });

  it('snapshot does not alias the live cache', () => {
    const cache = LocationFlavourCache.empty();
    cache.set(cafeMorningBusy, ['original']);
    const snapshot = cache.snapshot() as Record<string, string[]>;
    snapshot['loc:cafe|1|busy'].push('mutated');
    expect(cache.get(cafeMorningBusy)).toEqual(['original']);
  });
});

/**
 * Arbitrary cache coords, spanning the whole key space: any `loc:<slug>` id,
 * every phase ordinal and every crowd band.
 */
const arbCoords: fc.Arbitrary<FlavourCacheCoords> = fc.record({
  loc: fc
    .string({ minLength: 1 })
    // Keep the slug free of the `|` separator and newlines so the key stays
    // readable; the separator-safety property is tested on the key itself.
    .filter((s) => !s.includes('|'))
    .map((s) => `loc:${s}` as LocId),
  phase: fc.constantFrom<Phase>(0, 1, 2, 3),
  crowd: fc.constantFrom<CrowdLevel>(...CROWD_LEVELS),
});

describe('LocationFlavourCache (properties)', () => {
  it('is injective on coords: equal keys imply equal coords', () => {
    fc.assert(
      fc.property(arbCoords, arbCoords, (a, b) => {
        const sameKey = flavourCacheKey(a) === flavourCacheKey(b);
        const sameCoords = a.loc === b.loc && a.phase === b.phase && a.crowd === b.crowd;
        expect(sameKey).toBe(sameCoords);
      }),
      { numRuns: 200 },
    );
  });

  it('getOrProduce yields the first Flavour for a repeated key regardless of a later producer', async () => {
    await fc.assert(
      fc.asyncProperty(arbCoords, fc.array(fc.string()), async (coords, first) => {
        const cache = LocationFlavourCache.empty();
        const produced = await cache.getOrProduce(coords, () => first);
        const again = await cache.getOrProduce(coords, () => [...first, 'extra']);
        expect(again).toEqual(produced);
        expect(again).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });
});
