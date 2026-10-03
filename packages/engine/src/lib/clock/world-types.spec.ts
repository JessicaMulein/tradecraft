/**
 * Tests for the shared world-clock types (slice-integration task 4.2): a fresh
 * Day Scratch is empty and unshared, and the hook table is keyed by exactly
 * the names in `DAY_BOUNDARY_HOOK_ORDER`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { DAY_BOUNDARY_HOOK_ORDER } from './clock.js';
import { newDayScratch, type WorldHooks } from './world-types.js';

describe('newDayScratch', () => {
  it('starts every Day Boundary empty, with no state shared between days', () => {
    const first = newDayScratch();
    expect(first).toEqual({
      dayEvents: [],
      newspaperPlants: [],
      arrestArticles: [],
    });

    first.arrestArticles = [
      {
        id: 'arrest/x/1',
        source: 'city-event',
        headline: 'h',
        summary: 's',
        asserts: [],
      },
    ];
    expect(newDayScratch().arrestArticles).toEqual([]);
  });
});

describe('WorldHooks', () => {
  it('is keyed by the Day-Boundary Hook names, in firing order', () => {
    expectTypeOf<keyof WorldHooks>().toEqualTypeOf<
      (typeof DAY_BOUNDARY_HOOK_ORDER)[number]
    >();
    expect([...DAY_BOUNDARY_HOOK_ORDER]).toEqual([
      'plot',
      'schedules',
      'hostileTick',
      'newspaper',
    ]);
  });
});
