/**
 * Tests for the four-phase ⇄ eight-phase time mapping (task 5.1 support).
 *
 * The city generator and the pure `crowdLevel` read content curves (authored at
 * the eight-phase, named-weekday grain) at a four-phase engine time, so the
 * mapping must be a total, non-overlapping partition and a stable weekday /
 * month convention (Requirements 21.2, 21.6).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { PHASES, WEEKDAYS } from '@tradecraft/content';

import {
  CONTENT_PHASES_BY_ENGINE_PHASE,
  contentPhasesOf,
  enginePhaseOf,
  monthForDay,
  weekdayForDay,
  DAYS_PER_MONTH,
} from './time-mapping.js';
import type { Phase } from '../model/core.js';

describe('phase mapping', () => {
  it('partitions the eight content phases across the four engine phases', () => {
    const seen = new Set<string>();
    for (const phase of [0, 1, 2, 3] as const) {
      for (const cp of CONTENT_PHASES_BY_ENGINE_PHASE[phase]) {
        expect(seen.has(cp)).toBe(false); // no overlap
        seen.add(cp);
      }
    }
    // Totality: every content phase is covered exactly once.
    expect(seen.size).toBe(PHASES.length);
    for (const cp of PHASES) {
      expect(seen.has(cp)).toBe(true);
    }
  });

  it('enginePhaseOf is the inverse of contentPhasesOf', () => {
    for (const phase of [0, 1, 2, 3] as const) {
      for (const cp of contentPhasesOf(phase)) {
        expect(enginePhaseOf(cp)).toBe(phase);
      }
    }
  });

  it('keeps content phases in authored order within each engine phase', () => {
    for (const phase of [0, 1, 2, 3] as const) {
      const indices = contentPhasesOf(phase).map((cp) => PHASES.indexOf(cp));
      const sorted = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sorted);
    }
  });
});

describe('weekdayForDay', () => {
  it('starts on Monday and cycles every seven days', () => {
    expect(weekdayForDay(0)).toBe('monday');
    expect(weekdayForDay(6)).toBe('sunday');
    expect(weekdayForDay(7)).toBe('monday');
  });

  it('always returns a known weekday for any non-negative day', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100000 }), (day) => {
        expect(WEEKDAYS).toContain(weekdayForDay(day));
      }),
    );
  });

  it('rejects a negative day', () => {
    expect(() => weekdayForDay(-1)).toThrow();
  });
});

describe('monthForDay', () => {
  it('returns the start month on day 0', () => {
    expect(monthForDay(0, 1)).toBe(1);
    expect(monthForDay(0, 6)).toBe(6);
  });

  it('rolls over after a month of days and wraps December to January', () => {
    expect(monthForDay(DAYS_PER_MONTH, 1)).toBe(2);
    expect(monthForDay(DAYS_PER_MONTH, 12)).toBe(1);
    expect(monthForDay(DAYS_PER_MONTH * 2, 11)).toBe(1);
  });

  it('always returns a month in 1..12', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100000 }),
        fc.integer({ min: 1, max: 12 }),
        (day, startMonth) => {
          const m = monthForDay(day, startMonth);
          expect(m).toBeGreaterThanOrEqual(1);
          expect(m).toBeLessThanOrEqual(12);
        },
      ),
    );
  });

  it('rejects an out-of-range start month', () => {
    expect(() => monthForDay(0, 0)).toThrow();
    expect(() => monthForDay(0, 13)).toThrow();
  });
});

// A tiny compile-time nudge that Phase is 0..3 (keeps the import meaningful).
const _phases: readonly Phase[] = [0, 1, 2, 3];
void _phases;
