import { describe, expect, it } from 'vitest';

import { asTruth, type NpcId } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import { crossingRecords, fallTrust, liaisonShare } from './exchange.js';
import type { ServiceState } from '../region/services.js';

function ally(trust: number): ServiceState {
  return {
    id: 'service:ally',
    kind: 'liaison',
    doctrine: { riskTolerance: 0.4, securityConsciousness: 0.2, deceptionAppetite: 0.2 },
    residencies: {},
    beliefs: { ...emptyHostileBeliefs(), coverSuspicion: 0, watch: asTruth({ persons: [], descriptors: [] }) },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
    liaison: {
      reliability: asTruth(1),
      agenda: { conceal: ['TRAVELS_TO'], promote: [], obtain: [] },
      trust,
      delayPhases: 1,
    },
  };
}

describe('liaison trust', () => {
  it('raises trust for a share and lowers it for a refusal or an arrest', () => {
    const shared = liaisonShare(ally(0.2), [{
      id: 'prop:one',
      subject: 'npc:agent' as NpcId,
      predicate: 'KNOWS',
      object: { kind: 'text', value: 'desk' },
    }]);
    expect(shared.service.liaison?.trust).toBeCloseTo(0.25);
    expect(shared.relayed).toEqual([]);
    expect(fallTrust(shared.service, 'refused').liaison?.trust).toBeCloseTo(0.15);
    expect(fallTrust(shared.service, 'arrest').liaison?.trust).toBeCloseTo(0);
  });

  it('returns a crossing record unless the agenda conceals it', () => {
    const open = ally(0.5);
    const desk = open.liaison;
    if (desk === undefined) {
      throw new Error('expected a liaison desk');
    }
    const shown = crossingRecords(
      { ...open, liaison: { ...desk, agenda: { conceal: [], promote: [], obtain: [] }, reliability: asTruth(1) } },
      [{ npc: 'npc:courier', city: 'city:east', at: { day: 1, phase: 0 } }],
      createPrng('cross'),
    );
    expect(shown.map((prop) => prop.predicate)).toEqual(['TRAVELS_TO']);
    const hidden = crossingRecords(
      open,
      [{ npc: 'npc:courier', city: 'city:east', at: { day: 1, phase: 0 } }],
      createPrng('cross'),
    );
    expect(hidden).toEqual([]);
  });
});
