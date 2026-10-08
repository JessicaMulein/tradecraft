/**
 * Ambient eval fixtures in replay mode (Req 24.4). The scripted replies are
 * the recording. The guards run offline and the trip counts are pinned.
 */

import { describe, expect, it } from 'vitest';

import { ambientEvalFixtures, measureAmbientFixture } from './ambient-fixtures.js';

describe('ambient eval fixtures', () => {
  it('ships gossiping-waiter and festival-arrival', () => {
    const ids = ambientEvalFixtures().map((fixture) => fixture.id);
    expect(ids).toEqual(['gossiping-waiter', 'festival-arrival']);
  });

  it('measures guard trips and unheld recollections from the replay', () => {
    const measured = ambientEvalFixtures().map((fixture) => measureAmbientFixture(fixture));
    expect(measured).toEqual([
      { id: 'gossiping-waiter', leakTrips: 1, specificsTrips: 1, unheldRecollections: 1 },
      { id: 'festival-arrival', leakTrips: 1, specificsTrips: 1, unheldRecollections: 1 },
    ]);
  });

  it('is deterministic across two replays', () => {
    const first = ambientEvalFixtures().map((fixture) => measureAmbientFixture(fixture));
    const second = ambientEvalFixtures().map((fixture) => measureAmbientFixture(fixture));
    expect(second).toEqual(first);
  });
});
