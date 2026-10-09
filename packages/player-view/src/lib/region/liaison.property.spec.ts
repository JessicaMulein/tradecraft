import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { asTruth, createPrng, emptyHostileBeliefs, liaisonAnswer, reportIsGrounded } from '@tradecraft/engine';
import type { NpcId, Proposition, ServiceState } from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { liaisonViews } from './liaison.js';

function ally(reliability: number, trust: number, promote: readonly string[]): ServiceState {
  const known: Proposition = {
    id: 'prop:known',
    subject: 'npc:agent' as NpcId,
    predicate: 'KNOWS',
    object: { kind: 'text', value: 'desk' },
  };
  return {
    id: 'service:ally',
    kind: 'liaison',
    doctrine: { riskTolerance: 0.4, securityConsciousness: 0.2, deceptionAppetite: 0.2 },
    residencies: {},
    beliefs: { ...emptyHostileBeliefs(), coverSuspicion: 0, watch: asTruth({ persons: [], descriptors: [] }) },
    knowledge: { known: [known], falseBeliefs: [], knownEntities: ['npc:agent'] },
    liaison: {
      reliability: asTruth(reliability),
      agenda: { conceal: [], promote, obtain: [] },
      trust,
      delayPhases: 1,
    },
  };
}

describe('liaison views', () => {
  it('Property 7: Liaison truth isolation', () => {
    // Feature: multi-city, Property 7: Liaison truth isolation
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (reliability, trust, seed) => {
          const service = ally(reliability, trust, ['KNOWS']);
          const reported = liaisonAnswer(service, 'npc:agent', createPrng(seed));
          expect(reportIsGrounded(service, reported)).toBe(true);
          const view = liaisonViews([{
            id: service.id,
            trust,
            reliability: service.liaison?.reliability,
            agenda: service.liaison?.agenda,
            penetratedBy: { service: 'service:hostile', agent: 'npc:mole' },
          }]);
          const file = new CaseFile();
          for (const prop of reported) {
            file.add({
              source: { kind: 'liaison', service: 'service:ally' },
              prop,
              observedAt: { day: 0, phase: 0 },
            });
          }
          const before = JSON.stringify(file.snapshot());
          const truth = { reliability, agenda: service.liaison?.agenda, quality: 0.2, watch: ['npc:agent'] };
          truth.reliability = 0;
          const after = JSON.stringify(file.snapshot());
          const serialized = JSON.stringify({ view, file: file.snapshot() });
          expect(after).toBe(before);
          expect(serialized).not.toContain('"reliability":');
          expect(serialized).not.toContain('"agenda":');
          expect(serialized).not.toContain('"penetratedBy":');
          expect(serialized).not.toContain('"quality":');
          expect(serialized).not.toContain('"watch":');
        },
      ),
      { numRuns: 100 },
    );
  });
});
