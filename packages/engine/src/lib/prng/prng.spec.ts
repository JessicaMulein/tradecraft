import fc from 'fast-check';
import { z } from 'zod';

import {
  createPrng,
  derive,
  parsePrngState,
  seedState,
  type PrngState,
} from './prng.js';

const MASK32 = 0xffffffffn;

/**
 * The published xoshiro128** step transcribed with BigInt arithmetic. This is
 * kept deliberately naive so it acts as an independent check on the `Math.imul`
 * and `>>> 0` arithmetic the real implementation uses.
 */
function referenceStep(words: readonly bigint[]): {
  result: number;
  next: bigint[];
} {
  const rot = (x: bigint, k: bigint): bigint =>
    ((x << k) | (x >> (32n - k))) & MASK32;
  let [s0, s1, s2, s3] = words;
  const result = (rot((s1 * 5n) & MASK32, 7n) * 9n) & MASK32;
  const t = (s1 << 9n) & MASK32;
  s2 ^= s0;
  s3 ^= s1;
  s1 ^= s2;
  s0 ^= s3;
  s2 ^= t;
  s3 = rot(s3, 11n);
  return { result: Number(result), next: [s0, s1, s2, s3] };
}

function draw(seed: string | PrngState, count: number): number[] {
  const rng = createPrng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe('createPrng', () => {
  it('matches a BigInt reference implementation of xoshiro128**', () => {
    for (const seed of ['tradecraft', 'pier', '', 'ана', '0']) {
      const rng = createPrng(seed);
      let words: bigint[] = seedState(seed).map((word) => BigInt(word));
      for (let i = 0; i < 32; i += 1) {
        const expected = referenceStep(words);
        words = expected.next;
        expect(rng.nextUint32()).toBe(expected.result);
      }
    }
  });

  it('holds a frozen stream for a fixed seed', () => {
    // Regression guard: a change here means every existing save and golden
    // replay is invalidated and generatorVersion must be bumped.
    expect(seedState('tradecraft')).toEqual([
      4096227804, 2060667007, 978072123, 857799232,
    ]);
    expect(draw('tradecraft', 8)).toEqual([
      2447321931, 743497307, 3498719755, 3441795208, 600211478, 1462398625,
      3071930810, 49228579,
    ]);
  });

  it('produces the same stream for the same seed', () => {
    expect(draw('pier', 16)).toEqual(draw('pier', 16));
  });

  it('produces different streams for different seeds', () => {
    expect(draw('pier', 16)).not.toEqual(draw('pier ', 16));
    expect(draw('viktor', 16)).not.toEqual(draw('ana', 16));
  });

  it('rejects a state that is not four words', () => {
    expect(() => createPrng([1, 2, 3] as unknown as PrngState)).toThrow(
      /exactly 4 words/,
    );
  });

  it('rejects an all-zero state', () => {
    expect(() => createPrng([0, 0, 0, 0])).toThrow(/all zero/);
  });

  it('rejects state words outside 32-bit unsigned range', () => {
    expect(() => createPrng([-1, 2, 3, 4])).toThrow(/integers in \[0, 2\^32\)/);
    expect(() => createPrng([2 ** 32, 2, 3, 4])).toThrow(
      /integers in \[0, 2\^32\)/,
    );
    expect(() => createPrng([1.5, 2, 3, 4])).toThrow(
      /integers in \[0, 2\^32\)/,
    );
  });
});

describe('parsePrngState', () => {
  it('accepts a state that has been through JSON', () => {
    const saved = createPrng('save-file').state();
    expect(parsePrngState(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('rejects anything that is not four 32-bit words', () => {
    for (const malformed of [
      null,
      'nope',
      [1, 2, 3],
      [1, 2, 3, 4, 5],
      [0, 0, 0, 0],
      ['1', 2, 3, 4],
    ]) {
      expect(() => parsePrngState(malformed)).toThrow(z.ZodError);
    }
  });
});

describe('Prng.state', () => {
  it('resumes the identical stream from a saved state', () => {
    const rng = createPrng('mole');
    rng.nextUint32();
    rng.nextUint32();
    const saved = rng.state();

    const remainder = Array.from({ length: 8 }, () => rng.nextUint32());
    expect(draw(saved, 8)).toEqual(remainder);
  });

  it('survives a JSON round-trip', () => {
    const rng = createPrng('chickenfeed');
    rng.int(0, 100);
    const restored = JSON.parse(JSON.stringify(rng.state())) as PrngState;

    expect(restored).toEqual(rng.state());
    expect(draw(restored, 8)).toEqual(
      Array.from({ length: 8 }, () => rng.nextUint32()),
    );
  });

  it('returns a snapshot rather than a live reference', () => {
    const rng = createPrng('dangle');
    const before = rng.state();
    rng.nextUint32();

    expect(rng.state()).not.toEqual(before);
    expect(before).toEqual(createPrng('dangle').state());
  });
});

describe('Prng.next', () => {
  it('stays within [0, 1)', () => {
    const rng = createPrng('unit-interval');
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('Prng.int', () => {
  it('stays within the inclusive bounds', () => {
    const rng = createPrng('bounds');
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(-3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('returns the only value when the range is a single point', () => {
    const rng = createPrng('single');
    expect(rng.int(4, 4)).toBe(4);
  });

  it('reaches every value in a small range', () => {
    const rng = createPrng('coverage');
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      seen.add(rng.int(0, 3));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('rejects an inverted or non-integer range', () => {
    const rng = createPrng('invalid');
    expect(() => rng.int(5, 4)).toThrow(/max must be >= min/);
    expect(() => rng.int(0.5, 4)).toThrow(/bounds must be integers/);
    expect(() => rng.int(0, Number.NaN)).toThrow(/bounds must be integers/);
  });
});

describe('Prng.bool', () => {
  it('honours the degenerate probabilities', () => {
    const rng = createPrng('certainty');
    for (let i = 0; i < 100; i += 1) {
      expect(rng.bool(0)).toBe(false);
      expect(rng.bool(1)).toBe(true);
    }
  });

  it('returns both outcomes at the default probability', () => {
    const rng = createPrng('coin');
    const results = new Set(Array.from({ length: 50 }, () => rng.bool()));
    expect(results).toEqual(new Set([true, false]));
  });

  it('rejects a probability outside [0, 1]', () => {
    const rng = createPrng('odds');
    expect(() => rng.bool(-0.1)).toThrow(/probability must be in/);
    expect(() => rng.bool(1.1)).toThrow(/probability must be in/);
  });
});

describe('Prng.pick', () => {
  it('returns a member of the array', () => {
    const rng = createPrng('pick');
    const locations = ['pier', 'tram-depot', 'embassy', 'market'];
    for (let i = 0; i < 200; i += 1) {
      expect(locations).toContain(rng.pick(locations));
    }
  });

  it('throws on an empty array', () => {
    const rng = createPrng('pick-empty');
    expect(() => rng.pick([])).toThrow(/empty array/);
  });
});

describe('Prng.shuffle', () => {
  it('returns a permutation without mutating the input', () => {
    const rng = createPrng('shuffle');
    const roster = ['ana', 'viktor', 'tomas', 'lena', 'pavel'];
    const frozen = [...roster];

    const shuffled = rng.shuffle(roster);
    expect(roster).toEqual(frozen);
    expect([...shuffled].sort()).toEqual([...frozen].sort());
  });

  it('handles empty and single-element arrays', () => {
    const rng = createPrng('shuffle-edge');
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['ana'])).toEqual(['ana']);
  });

  it('actually reorders a long enough array', () => {
    const rng = createPrng('shuffle-order');
    const ordered = Array.from({ length: 20 }, (_, i) => i);
    expect(rng.shuffle(ordered)).not.toEqual(ordered);
  });
});

describe('derive', () => {
  it('is deterministic', () => {
    expect(derive('tradecraft', 3)).toBe(derive('tradecraft', 3));
  });

  it('holds a frozen value for a fixed seed', () => {
    expect(derive('tradecraft', 0)).toBe('bad641e1a2b6ed45');
    expect(derive('tradecraft', 1)).toBe('c74a092dae7cf5e2');
  });

  it('returns 16 lowercase hex characters', () => {
    for (let n = 0; n < 32; n += 1) {
      expect(derive('tradecraft', n)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('gives a distinct seed for every attempt', () => {
    const derived = new Set(
      Array.from({ length: 256 }, (_, n) => derive('tradecraft', n)),
    );
    expect(derived.size).toBe(256);
  });

  it('gives distinct seeds for distinct base seeds', () => {
    expect(derive('ana', 1)).not.toBe(derive('viktor', 1));
  });

  it('produces a stream unrelated to the base seed', () => {
    expect(draw(derive('tradecraft', 0), 16)).not.toEqual(
      draw('tradecraft', 16),
    );
  });

  it('rejects an invalid attempt number', () => {
    expect(() => derive('tradecraft', -1)).toThrow(/integer in \[0, 2\^32\)/);
    expect(() => derive('tradecraft', 1.5)).toThrow(/integer in \[0, 2\^32\)/);
    expect(() => derive('tradecraft', 2 ** 32)).toThrow(
      /integer in \[0, 2\^32\)/,
    );
  });
});

/**
 * Randomised checks over the whole seed space rather than the handful of seeds
 * above. These also confirm the fast-check toolchain runs under strict ESM.
 */
describe('prng randomised checks', () => {
  it('replays the same stream for any seed string', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 1, max: 64 }),
        (seed, count) => {
          expect(draw(seed, count)).toEqual(draw(seed, count));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('resumes from a saved state for any seed and draw count', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: 32 }),
        fc.integer({ min: 1, max: 16 }),
        (seed, consumed, remaining) => {
          const rng = createPrng(seed);
          for (let i = 0; i < consumed; i += 1) {
            rng.nextUint32();
          }
          const saved = rng.state();
          const tail = Array.from({ length: remaining }, () =>
            rng.nextUint32(),
          );
          expect(draw(saved, remaining)).toEqual(tail);
        },
      ),
      { numRuns: 200 },
    );
  });
});
