/**
 * Unit tests for the Claim Extractor's pure evaluation core (Requirements 5.6,
 * 6.1, 6.5, 7.1, 7.2, 7.3).
 *
 * These exercise {@link evaluateExtraction} against a real {@link TruthStore}
 * (built with a hand-written evaluator-kind map, as the engine's own truth
 * tests do) and a compiled predicate registry. They check the six design steps
 * — truth, belief, lie, truth-record write, Told List append, view-safe Claim —
 * plus the two logged signals: a chance leak (a true Claim the speaker did not
 * know) and a consistency violation (a Claim contradicting the Told List while
 * cover is intact).
 */

import {
  compilePredicateRegistry,
  type EvaluatorKind,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  TruthStore,
  type GameTime,
  type NpcId,
  type Proposition,
} from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  evaluateExtraction,
  type SpeakerKnowledge,
} from './extractor.js';
import type { ExtractionResult } from './schema.js';

const ANA: NpcId = 'npc:ana';
const VIKTOR: NpcId = 'npc:viktor';

const meetsAt: PredicateDefinition = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match-symmetric',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([meetsAt, worksFor]);
  if (!result.ok) throw new Error('test predicates must compile');
  return result.registry;
}

const KINDS: Record<string, EvaluatorKind> = {
  MEETS_AT: 'fact-match-symmetric',
  WORKS_FOR: 'fact-match',
};

function evaluatorLookup(): Map<string, EvaluatorKind> {
  return new Map(Object.entries(KINDS));
}

const AT: GameTime = { day: 3, phase: 1 };

function worksForProp(id: string, subject: NpcId, org: string): Proposition {
  return { id, subject, predicate: 'WORKS_FOR', object: `org:${org}` };
}

function meetsProp(
  id: string,
  subject: NpcId,
  object: NpcId,
  place: string,
): Proposition {
  return {
    id,
    subject,
    predicate: 'MEETS_AT',
    object,
    place: `loc:${place}`,
    window: { from: { day: 0, phase: 0 } },
  };
}

function result(claims: ExtractionResult['claims']): ExtractionResult {
  return { claims };
}

const noKnowledge: SpeakerKnowledge = { known: [], falseBeliefs: [], promote: [] };

describe('evaluateExtraction truth and records (Req 7.1, 7.2)', () => {
  it('writes one truth record per Claim and a view-safe Claim', () => {
    const store = TruthStore.create(evaluatorLookup());
    store.addFact(worksForProp('f1', ANA, 'cell'));

    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: { known: [worksForProp('k1', ANA, 'cell')], falseBeliefs: [], promote: [] },
      toldList: [],
      truth: store,
      predicates: registry(),
    });

    expect(outcome.truthRecords).toHaveLength(1);
    expect(outcome.truthRecords[0].held).toBe(true);
    expect(outcome.truthRecords[0].believed).toBe(true);
    expect(outcome.truthRecords[0].lie).toBe(false);
    expect(outcome.claims).toHaveLength(1);
    // The view-safe Claim carries no held/believed/lie verdict.
    expect(Object.keys(outcome.claims[0])).not.toContain('held');
    // The record was committed to the store.
    expect(store.claimTruths()).toHaveLength(1);
  });

  it('marks a believed-false assertion as a deliberate lie', () => {
    const store = TruthStore.create(evaluatorLookup());
    // The store holds nothing, so WORKS_FOR org:hostile does not hold.
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:hostile', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      // Ana knows she works for the cell, not the hostile service: asserting the
      // hostile is a believed-false statement.
      knowledge: { known: [worksForProp('k1', ANA, 'cell')], falseBeliefs: [], promote: [] },
      toldList: [],
      truth: store,
      predicates: registry(),
    });

    expect(outcome.truthRecords[0].held).toBe(false);
    expect(outcome.truthRecords[0].believed).toBe(false);
    expect(outcome.truthRecords[0].lie).toBe(true);
  });

  it('an honest mistake (sincere false belief) is false but not a lie', () => {
    const store = TruthStore.create(evaluatorLookup());
    const belief = worksForProp('b1', ANA, 'station');
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:station', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: { known: [], falseBeliefs: [belief], promote: [] },
      toldList: [],
      truth: store,
      predicates: registry(),
    });

    expect(outcome.truthRecords[0].held).toBe(false);
    expect(outcome.truthRecords[0].believed).toBe(true);
    expect(outcome.truthRecords[0].lie).toBe(false);
  });

  it('a promoted Proposition that does not hold is a lie', () => {
    const store = TruthStore.create(evaluatorLookup());
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:tradehouse', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      // The predicate itself is promoted (a cover-employment push).
      knowledge: { known: [], falseBeliefs: [], promote: ['WORKS_FOR'] },
      toldList: [],
      truth: store,
      predicates: registry(),
    });
    expect(outcome.truthRecords[0].held).toBe(false);
    expect(outcome.truthRecords[0].lie).toBe(true);
  });
});

describe('Told List (Req 6.1)', () => {
  it('appends each Claim to the Told List in order', () => {
    const store = TruthStore.create(evaluatorLookup());
    const prior = worksForProp('prior', ANA, 'cell');
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:station', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [prior],
      truth: store,
      predicates: registry(),
    });
    expect(outcome.toldList).toHaveLength(2);
    expect(outcome.toldList[0]).toBe(prior);
    expect(outcome.toldList[1].predicate).toBe('WORKS_FOR');
  });
});

describe('chance leaks (Req 5.6)', () => {
  it('logs a Claim that holds but the speaker did not know', () => {
    const store = TruthStore.create(evaluatorLookup());
    // The meeting really happens, but Ana's slice does not contain it.
    store.addFact(meetsProp('f1', ANA, VIKTOR, 'pier'));

    const outcome = evaluateExtraction({
      result: result([
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'npc:viktor',
          place: 'loc:pier',
          when: { from: { day: 0, phase: 0 } },
          hedged: false,
        },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [],
      truth: store,
      predicates: registry(),
    });

    expect(outcome.chanceLeaks).toHaveLength(1);
    expect(outcome.chanceLeaks[0].prop.predicate).toBe('MEETS_AT');
  });

  it('does not log a leak when the speaker knows the true Claim', () => {
    const store = TruthStore.create(evaluatorLookup());
    const fact = meetsProp('f1', ANA, VIKTOR, 'pier');
    store.addFact(fact);
    const outcome = evaluateExtraction({
      result: result([
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'npc:viktor',
          place: 'loc:pier',
          when: { from: { day: 0, phase: 0 } },
          hedged: false,
        },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: { known: [fact], falseBeliefs: [], promote: [] },
      toldList: [],
      truth: store,
      predicates: registry(),
    });
    expect(outcome.chanceLeaks).toEqual([]);
  });

  it('does not log a leak for a Claim that does not hold', () => {
    const store = TruthStore.create(evaluatorLookup());
    const outcome = evaluateExtraction({
      result: result([
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'npc:viktor',
          place: 'loc:pier',
          when: { from: { day: 0, phase: 0 } },
          hedged: false,
        },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [],
      truth: store,
      predicates: registry(),
    });
    expect(outcome.chanceLeaks).toEqual([]);
  });
});

describe('consistency violations (Req 6.5)', () => {
  it('logs a Claim that contradicts the Told List while cover is intact', () => {
    const store = TruthStore.create(evaluatorLookup());
    // Told earlier: works for the cell. Now says the station — a contradiction.
    const told = worksForProp('t1', ANA, 'cell');
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:station', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [told],
      coverIntact: true,
      truth: store,
      predicates: registry(),
    });

    expect(outcome.consistencyViolations).toHaveLength(1);
    expect(outcome.consistencyViolations[0].contradicts).toBe('t1');
  });

  it('does not log a violation when cover has cracked', () => {
    const store = TruthStore.create(evaluatorLookup());
    const told = worksForProp('t1', ANA, 'cell');
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:station', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [told],
      coverIntact: false,
      truth: store,
      predicates: registry(),
    });
    expect(outcome.consistencyViolations).toEqual([]);
  });

  it('does not log a violation for repeating the same assertion', () => {
    const store = TruthStore.create(evaluatorLookup());
    const told = worksForProp('t1', ANA, 'cell');
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [told],
      coverIntact: true,
      truth: store,
      predicates: registry(),
    });
    expect(outcome.consistencyViolations).toEqual([]);
  });

  it('catches an in-turn self-contradiction across two Claims', () => {
    const store = TruthStore.create(evaluatorLookup());
    const outcome = evaluateExtraction({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:station', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [],
      coverIntact: true,
      truth: store,
      predicates: registry(),
    });
    expect(outcome.consistencyViolations).toHaveLength(1);
  });
});

describe('unknown-party resolution (Req 7.2)', () => {
  it('allocates a stable unk id for an "unknown" argument', () => {
    const store = TruthStore.create(evaluatorLookup());
    const outcome = evaluateExtraction({
      result: result([
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'unknown',
          place: 'loc:pier',
          when: { from: { day: 0, phase: 0 } },
          hedged: false,
        },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [],
      truth: store,
      predicates: registry(),
      allocateUnk: (index: number): `unk:${number}` => `unk:${100 + index}`,
    });
    expect(outcome.claims[0].prop.object).toBe('unk:100');
  });
});

describe('determinism', () => {
  it('produces identical records on repeated runs', () => {
    const inputs = () => ({
      result: result([
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
      ]),
      speaker: ANA,
      at: AT,
      knowledge: noKnowledge,
      toldList: [],
      truth: TruthStore.create(evaluatorLookup()),
      predicates: registry(),
    });
    const a = evaluateExtraction(inputs());
    const b = evaluateExtraction(inputs());
    expect(a.claims).toEqual(b.claims);
    expect(a.truthRecords).toEqual(b.truthRecords);
  });
});
