/**
 * Focused unit tests for the Station mole-report projection (slice-integration
 * task; design, "Turn Pipeline" step 8; Requirement 3.6).
 *
 * {@link projectStationReportable} rebuilds `station.reportable` from the
 * Station Knowledge Slice and the Case File summary. These tests pin:
 *
 *  - the three sources are unioned (Knowledge Slice `known` + `falseBeliefs`,
 *    then the held Case File Claims);
 *  - the union is deduped by Proposition identity, so a Claim repeating a
 *    Knowledge-Slice fact is relayed once;
 *  - a sent `trace` Cable adds nothing new, because the target's facts already
 *    come from the two slices;
 *  - the projection is pure: it returns a new Draft and does not mutate inputs,
 *    and never writes a Truth-branded value (it only relays existing props).
 *
 * The projection reads only `draft.station.{knowledge,pendingCables}` and the
 * Case File, so the fixture is a minimal Station slice rather than a generated
 * world.
 */

import { describe, expect, it } from 'vitest';

import type {
  EntityId,
  GameTime,
  LocId,
  NpcId,
  OrgId,
  PredicateId,
  Proposition,
  WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { projectStationReportable } from './station-reportable.js';

const AT: GameTime = { day: 1, phase: 0 };

/** A bare Proposition with a distinct id (ignored by the dedupe key). */
function prop(
  id: string,
  subject: EntityId,
  predicate: PredicateId,
  object: EntityId,
): Proposition {
  return { id, subject, predicate, object };
}

/**
 * A minimal Draft carrying only the Station slice the projection reads. The
 * cast is safe: {@link projectStationReportable} touches nothing else, and
 * spreads the rest through unchanged.
 */
function draftWith(
  known: readonly Proposition[],
  falseBeliefs: readonly Proposition[],
  pendingCables: WorldState['station']['pendingCables'] = [],
): WorldState {
  return {
    station: {
      org: 'org:station' as OrgId,
      chief: 'npc:chief' as NpcId,
      staff: [],
      knowledge: { known, falseBeliefs, knownEntities: [] },
      directives: [],
      standing: 0,
      ledger: { balance: 0, entries: [] },
      pendingCables,
      reportable: [],
    },
  } as unknown as WorldState;
}

describe('projectStationReportable', () => {
  it('unions the Knowledge Slice (known then falseBeliefs) and the Case File Claims', () => {
    const known = [prop('p:k1', 'npc:boris', 'MEMBER_OF', 'org:cell')];
    const falseBeliefs = [prop('p:f1', 'npc:ana', 'WORKS_FOR', 'org:cover')];
    const draft = draftWith(known, falseBeliefs);

    const caseFile = new CaseFile();
    caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:cafe' as LocId },
      prop: prop('p:c1', 'npc:viktor', 'MEETS_AT', 'loc:cafe'),
      observedAt: AT,
    });

    const result = projectStationReportable(draft, caseFile);
    const subjects = result.station.reportable.map((p) => p.subject);
    expect(subjects).toEqual(['npc:boris', 'npc:ana', 'npc:viktor']);
  });

  it('dedupes a Claim that repeats a Knowledge-Slice fact (one relay per belief key)', () => {
    const shared = prop('p:k1', 'npc:boris', 'MEMBER_OF', 'org:cell');
    const draft = draftWith([shared], []);

    const caseFile = new CaseFile();
    // Same (subject, predicate, object) as the known fact, different Claim id.
    caseFile.add({
      source: { kind: 'npc', npc: 'npc:ana' as NpcId },
      prop: prop('p:c1', 'npc:boris', 'MEMBER_OF', 'org:cell'),
      observedAt: AT,
    });

    const result = projectStationReportable(draft, caseFile);
    expect(result.station.reportable).toHaveLength(1);
    expect(result.station.reportable[0].subject).toBe('npc:boris');
  });

  it('a sent trace Cable adds no new Propositions (its target is already covered)', () => {
    const known = [prop('p:k1', 'npc:boris', 'MEMBER_OF', 'org:cell')];
    const traceCable = {
      id: 'cable:1',
      request: { kind: 'trace' as const, target: 'npc:boris' as EntityId },
      sentAt: AT,
      replyDue: { day: 2, phase: 0 } as GameTime,
      reply: { kind: 'trace' as const, target: 'npc:boris' },
    };
    const draft = draftWith(known, [], [traceCable]);

    const withCable = projectStationReportable(draft, new CaseFile());
    const withoutCable = projectStationReportable(draftWith(known, [], []), new CaseFile());
    expect(withCable.station.reportable).toEqual(withoutCable.station.reportable);
  });

  it('is pure: returns a new Draft and does not mutate the input', () => {
    const draft = draftWith([prop('p:k1', 'npc:boris', 'MEMBER_OF', 'org:cell')], []);
    const before = JSON.stringify(draft);

    const result = projectStationReportable(draft, new CaseFile());

    expect(result).not.toBe(draft);
    expect(result.station).not.toBe(draft.station);
    expect(JSON.stringify(draft)).toBe(before); // input untouched
    expect(draft.station.reportable).toEqual([]); // original stays empty
  });

  it('yields an empty list when the Station knows nothing and the Case File is empty', () => {
    const result = projectStationReportable(draftWith([], []), new CaseFile());
    expect(result.station.reportable).toEqual([]);
  });
});
