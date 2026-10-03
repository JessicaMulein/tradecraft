import fc from 'fast-check';

import {
  PHASES_PER_DAY,
  timeToPhases,
  type GameTime,
  type Phase,
} from '../model/core.js';

import { addPhases, isDayStart } from './clock.js';

const PHASES = PHASES_PER_DAY;

/** A GameTime arbitrary over a bounded, realistic span. */
const timeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.nat({ max: 400 }),
  phase: fc.integer({ min: 0, max: PHASES - 1 }).map((p) => p as Phase),
});

describe('addPhases', () => {
  it('wraps phases into days using PHASES_PER_DAY', () => {
    expect(addPhases({ day: 0, phase: 0 }, 1)).toEqual({ day: 0, phase: 1 });
    expect(addPhases({ day: 0, phase: 3 }, 1)).toEqual({ day: 1, phase: 0 });
    expect(addPhases({ day: 2, phase: 2 }, PHASES)).toEqual({ day: 3, phase: 2 });
    expect(addPhases({ day: 1, phase: 1 }, 2 * PHASES + 1)).toEqual({
      day: 3,
      phase: 2,
    });
  });

  it('is a no-op for zero phases', () => {
    expect(addPhases({ day: 5, phase: 3 }, 0)).toEqual({ day: 5, phase: 3 });
  });

  it('rejects negative or fractional phases', () => {
    expect(() => addPhases({ day: 0, phase: 0 }, -1)).toThrow(RangeError);
    expect(() => addPhases({ day: 0, phase: 0 }, 1.5)).toThrow(RangeError);
  });

  it('agrees with the flat phase count (property)', () => {
    fc.assert(
      fc.property(timeArb, fc.nat({ max: 10_000 }), (t, k) => {
        const result = addPhases(t, k);
        expect(timeToPhases(result)).toBe(timeToPhases(t) + k);
      }),
    );
  });

  it('composes: advance by k then m equals advance by k+m (property)', () => {
    fc.assert(
      fc.property(
        timeArb,
        fc.nat({ max: 5_000 }),
        fc.nat({ max: 5_000 }),
        (t, k, m) => {
          const stepwise = addPhases(addPhases(t, k), m);
          const combined = addPhases(t, k + m);
          expect(stepwise).toEqual(combined);
        },
      ),
    );
  });
});

describe('isDayStart', () => {
  it('is true only at phase 0', () => {
    expect(isDayStart({ day: 4, phase: 0 })).toBe(true);
    expect(isDayStart({ day: 4, phase: 1 })).toBe(false);
    expect(isDayStart({ day: 4, phase: 3 })).toBe(false);
  });
});
