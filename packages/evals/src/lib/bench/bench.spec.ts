/**
 * Regional bench against Req 19. Thresholds scale by the CI machine factor.
 * No model is called.
 */

import { describe, expect, it } from 'vitest';

import { METRIC_ROLES } from '../metrics/index.js';
import {
  REGION_BUDGETS,
  benchFactor,
  measureFixtureBench,
  percentile,
} from './bench.js';

describe('region bench', () => {
  it('scales a percentile and keeps the reference budgets fixed', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 99)).toBe(4);
    expect(REGION_BUDGETS.generateMs).toBe(8_000);
    expect(REGION_BUDGETS.coarseMedianMs).toBe(5);
    expect(REGION_BUDGETS.coarseP99Ms).toBe(20);
    expect(REGION_BUDGETS.reconcileMs).toBe(300);
    expect(REGION_BUDGETS.travelMs).toBe(1_000);
    expect(REGION_BUDGETS.heapBytes).toBe(1_000_000_000);
    expect(REGION_BUDGETS.saveBytes).toBe(15 * 1024 * 1024);
    expect(benchFactor()).toBeGreaterThan(0);
  });

  it('stays inside the Req 19 budgets on the fixture four-city region', () => {
    const factor = benchFactor();
    const report = measureFixtureBench();
    expect(report.generateMs).toBeLessThanOrEqual(REGION_BUDGETS.generateMs * factor);
    expect(report.coarseMedianMs).toBeLessThanOrEqual(REGION_BUDGETS.coarseMedianMs * factor);
    expect(report.coarseP99Ms).toBeLessThanOrEqual(REGION_BUDGETS.coarseP99Ms * factor);
    expect(report.reconcileMs).toBeLessThanOrEqual(REGION_BUDGETS.reconcileMs * factor);
    expect(report.travelPhases).toBe(8);
    expect(report.travelMs).toBeLessThanOrEqual(REGION_BUDGETS.travelMs * factor);
    expect(report.heapBytes).toBeLessThanOrEqual(REGION_BUDGETS.heapBytes * factor);
    expect(report.saveBytes).toBeLessThanOrEqual(REGION_BUDGETS.saveBytes * factor);
    expect(report.narratorTokens).toBeLessThanOrEqual(report.tokenBudget);
    expect(report.npcTokens).toBeLessThanOrEqual(report.tokenBudget);
    expect(report.roles).toEqual([...METRIC_ROLES]);
    expect(report.purposes).toEqual(
      expect.arrayContaining([
        'region-generate',
        'region-advance-coarse',
        'region-reconcile',
      ]),
    );
  });
});
