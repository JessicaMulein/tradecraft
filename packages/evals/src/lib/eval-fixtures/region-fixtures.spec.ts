/**
 * Regional eval fixtures in replay mode (multi-city Req 18). The scripted
 * replies are the recording. The slice harness runs offline and the trip
 * counts are pinned. No model is called.
 */

import { describe, expect, it } from 'vitest';

import { METRIC_ROLES } from '../metrics/index.js';
import { measureRegionFixture, regionEvalFixtures } from './region-fixtures.js';

describe('region eval fixtures', () => {
  it('ships a border inspection, a liaison meeting and a carriage conversation', () => {
    const ids = regionEvalFixtures().map((fixture) => fixture.id);
    expect(ids).toEqual(['border-inspection', 'liaison-meeting', 'carriage-conversation']);
  });

  it('scores the replay with the slice harness', () => {
    const measured = regionEvalFixtures().map((fixture) => measureRegionFixture(fixture));
    expect(measured).toEqual([
      {
        id: 'border-inspection',
        leakGuardTrips: 1,
        specificsGuardTrips: 1,
        roles: [...METRIC_ROLES],
      },
      {
        id: 'liaison-meeting',
        leakGuardTrips: 1,
        specificsGuardTrips: 1,
        roles: [...METRIC_ROLES],
      },
      {
        id: 'carriage-conversation',
        leakGuardTrips: 1,
        specificsGuardTrips: 1,
        roles: [...METRIC_ROLES],
      },
    ]);
  });

  it('is deterministic across two replays', () => {
    const first = regionEvalFixtures().map((fixture) => measureRegionFixture(fixture));
    const second = regionEvalFixtures().map((fixture) => measureRegionFixture(fixture));
    expect(second).toEqual(first);
  });
});
