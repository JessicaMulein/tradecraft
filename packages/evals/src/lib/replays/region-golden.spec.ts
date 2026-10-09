/**
 * Regional golden replays (multi-city task 14.3). One session per starter
 * region in the fixture pack. Slice sessions are left to the slice loader.
 */

import { describe, expect, it } from 'vitest';

import { listFixtureIds } from './fixtures.js';
import {
  listRegionalGoldenIds,
  loadRegionalGolden,
  replayRegionalGolden,
  starterRegionCount,
} from './region-replay.js';

describe('regional golden replays', () => {
  it('keeps one golden per starter region out of the slice loader', () => {
    const regional = listRegionalGoldenIds();
    expect(regional.length).toBe(starterRegionCount());
    expect(regional.length).toBeGreaterThan(0);
    const slice = new Set(listFixtureIds());
    for (const id of regional) {
      expect(slice.has(id)).toBe(false);
    }
  });

  it('replays each starter region to its checked-in state', () => {
    for (const id of listRegionalGoldenIds()) {
      const golden = loadRegionalGolden(id);
      const first = replayRegionalGolden(golden);
      const second = replayRegionalGolden(golden);
      expect(second.stateHash).toBe(first.stateHash);
      expect(first.cities.length).toBeGreaterThanOrEqual(2);
      expect(first.stateHash).toBe(golden.stateHash);
    }
  });
});
