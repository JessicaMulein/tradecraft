import { describe, expect, it } from 'vitest';

import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import type { HostileServiceState } from '../hostile/service-state.js';
import { revealTruth } from '../model/core.js';
import { SLICE_HOSTILE_SERVICE, sliceServices } from './services.js';

const hostile: HostileServiceState = {
  doctrine: { riskTolerance: 0.2, securityConsciousness: 0.4, deceptionAppetite: 0.6 },
  beliefs: emptyHostileBeliefs(),
};

describe('sliceServices', () => {
  it('maps the slice hostile service to one service record', () => {
    const services = sliceServices(hostile, 0.15);
    const ids = Object.keys(services);

    expect(ids).toEqual([SLICE_HOSTILE_SERVICE]);
    const service = services[SLICE_HOSTILE_SERVICE];
    expect(service.kind).toBe('hostile');
    expect(service.doctrine).toEqual(hostile.doctrine);
    expect(service.beliefs.coverSuspicion).toBe(0.15);
    expect(service.beliefs.credibility).toBe(hostile.beliefs.credibility);
    expect(service.residencies).toEqual({});
    expect(service.liaison).toBeUndefined();
    expect(service.penetratedBy).toBeUndefined();
    expect(revealTruth(service.beliefs.watch)).toEqual({ persons: [], descriptors: [] });
    expect(hostile.beliefs).toEqual(emptyHostileBeliefs());
    expect(sliceServices(hostile, 0.15)).toEqual(services);
  });
});
