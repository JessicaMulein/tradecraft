import { describe, expect, it } from 'vitest';

import type { Prng } from '../prng/prng.js';
import { accumulatedDeadlineDays, scopeStageRequires, worstCaseDeadlineDay, type DeadlineStage } from './deadlines.js';

function scripted(draws: readonly number[]): Prng {
  let index = 0;
  const rng = {
    int(min: number, max: number): number {
      const value = draws[index] ?? min;
      index += 1;
      if (value < min || value > max) {
        throw new Error(`draw ${value} outside [${min}, ${max}]`);
      }
      return value;
    },
  };
  return rng as Prng;
}

const CHAIN: readonly DeadlineStage[] = [
  { id: 'open', requires: [], deadline: { min: 12, max: 20 } },
  { id: 'west', requires: ['open'], deadline: { min: 14, max: 22 } },
  { id: 'east', requires: ['open'], deadline: { min: 14, max: 22 } },
];

describe('accumulatedDeadlineDays', () => {
  it('accumulates a chain and keeps sibling alternatives on the same branch point', () => {
    const days = accumulatedDeadlineDays(CHAIN, 2, scripted([12, 14, 22]));
    expect(days.get('open')).toBe(14);
    expect(days.get('west')).toBe(30);
    expect(days.get('east')).toBe(38);
  });

  it('scopes a subplot requirement onto the expanded stage path', () => {
    expect(scopeStageRequires('cross/confirm', ['begin'])).toEqual(['cross/begin']);
    expect(scopeStageRequires('confirm', ['begin'])).toEqual(['begin']);
    const stages: readonly DeadlineStage[] = [
      { id: 'cross/begin', requires: [], deadline: { min: 12, max: 12 } },
      { id: 'cross/confirm', requires: scopeStageRequires('cross/confirm', ['begin']), deadline: { min: 1, max: 1 } },
    ];
    const days = accumulatedDeadlineDays(stages, 3, scripted([12, 1]));
    expect(days.get('cross/confirm')).toBe(12 + 3 + 1 + 3);
  });

  it('treats a pipe list as the earliest known predecessor', () => {
    const stages: readonly DeadlineStage[] = [
      { id: 'open', requires: [], deadline: { min: 4, max: 4 } },
      { id: 'late', requires: ['open'], deadline: { min: 10, max: 10 } },
      { id: 'early', requires: ['open'], deadline: { min: 2, max: 2 } },
      { id: 'join', requires: ['late | early'], deadline: { min: 3, max: 3 } },
    ];
    const days = accumulatedDeadlineDays(stages, 0, scripted([4, 10, 2, 3]));
    expect(days.get('join')).toBe(4 + 2 + 3);
  });
});

describe('worstCaseDeadlineDay', () => {
  it('uses each window maximum plus slack, and siblings do not stack', () => {
    expect(worstCaseDeadlineDay(CHAIN, 2)).toBe(20 + 2 + 22 + 2);
  });
});
