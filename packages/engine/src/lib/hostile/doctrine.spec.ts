/**
 * Tests for the Hostile Service doctrine draw (task 19.1; Requirement 12.1).
 *
 * These pin the design's "Doctrine values are drawn from the preset's ranges":
 *
 * - {@link drawDoctrine} is deterministic — the same seed and ranges always
 *   yield the same doctrine (Requirement 1.2);
 * - every drawn dimension lies within its preset `{ min, max }` range (the
 *   preset-range-bounds property, Requirement 12.1);
 * - a degenerate point range yields exactly that value and still advances the
 *   stream so draw order is range-width-independent.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPrng } from '../prng/prng.js';
import { drawDoctrine, type DoctrineRanges } from './doctrine.js';

/** The `standard` preset's doctrine ranges, from `difficulty.yaml`. */
const STANDARD: DoctrineRanges = {
  risk: { min: 0.3, max: 0.6 },
  security: { min: 0.3, max: 0.6 },
  deception: { min: 0.3, max: 0.6 },
};

describe('drawDoctrine', () => {
  it('is deterministic for the same seed and ranges', () => {
    const a = drawDoctrine(createPrng('seed-xyz'), STANDARD);
    const b = drawDoctrine(createPrng('seed-xyz'), STANDARD);
    expect(a).toEqual(b);
  });

  it('draws every dimension within the preset range', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const d = drawDoctrine(createPrng(seed), STANDARD);
        expect(d.riskTolerance).toBeGreaterThanOrEqual(STANDARD.risk.min);
        expect(d.riskTolerance).toBeLessThanOrEqual(STANDARD.risk.max);
        expect(d.securityConsciousness).toBeGreaterThanOrEqual(STANDARD.security.min);
        expect(d.securityConsciousness).toBeLessThanOrEqual(STANDARD.security.max);
        expect(d.deceptionAppetite).toBeGreaterThanOrEqual(STANDARD.deception.min);
        expect(d.deceptionAppetite).toBeLessThanOrEqual(STANDARD.deception.max);
      }),
    );
  });

  it('respects a different preset range (hard draws higher)', () => {
    const hard: DoctrineRanges = {
      risk: { min: 0.5, max: 0.8 },
      security: { min: 0.5, max: 0.8 },
      deception: { min: 0.5, max: 0.8 },
    };
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const d = drawDoctrine(createPrng(seed), hard);
        expect(d.riskTolerance).toBeGreaterThanOrEqual(0.5);
        expect(d.riskTolerance).toBeLessThanOrEqual(0.8);
        expect(d.securityConsciousness).toBeGreaterThanOrEqual(0.5);
        expect(d.deceptionAppetite).toBeLessThanOrEqual(0.8);
      }),
    );
  });

  it('returns exactly the point value for a degenerate range', () => {
    const point: DoctrineRanges = {
      risk: { min: 0.4, max: 0.4 },
      security: { min: 0.7, max: 0.7 },
      deception: { min: 0.1, max: 0.1 },
    };
    const d = drawDoctrine(createPrng('any'), point);
    expect(d.riskTolerance).toBe(0.4);
    expect(d.securityConsciousness).toBe(0.7);
    expect(d.deceptionAppetite).toBe(0.1);
  });

  it('still advances the stream for a point range (draw order is width-independent)', () => {
    // A point range draws (and discards) a float, so a following draw sees the
    // same stream position whether the range was a point or wide.
    const point: DoctrineRanges = {
      risk: { min: 0.5, max: 0.5 },
      security: { min: 0.5, max: 0.5 },
      deception: { min: 0.5, max: 0.5 },
    };
    const rng = createPrng('stream');
    drawDoctrine(rng, point);
    const afterPoint = rng.next();

    const rng2 = createPrng('stream');
    drawDoctrine(rng2, STANDARD);
    const afterWide = rng2.next();

    expect(afterPoint).toBe(afterWide);
  });

  it('the riskTolerance satisfies the abort module\u2019s one-field Doctrine', () => {
    // Structural supertype check: the drawn doctrine is accepted where the
    // abort maths' { riskTolerance } is expected.
    const d = drawDoctrine(createPrng('s'), STANDARD);
    const abortDoctrine: { readonly riskTolerance: number } = d;
    expect(typeof abortDoctrine.riskTolerance).toBe('number');
  });
});
