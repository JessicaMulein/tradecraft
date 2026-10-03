import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { EvaluatorKind } from '@tradecraft/content';

import {
  type GameTime,
  type NpcId,
  type OrgId,
  type Proposition,
  type UnkId,
  revealTruth,
} from '../model/core.js';
import {
  TruthStore,
  type Allegiance,
  type ClaimTruthRecord,
  type PredicateEvaluatorLookup,
  type TruthStoreData,
} from './truth.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A predicate → evaluator-kind lookup backed by a plain object. The real store
 * is driven by a compiled registry's `evaluators` map; this stand-in exercises
 * exactly the one method the store asks for, so the tests pin dispatch
 * behaviour without pulling the whole content pipeline in.
 */
function lookup(entries: Record<string, EvaluatorKind>): PredicateEvaluatorLookup {
  const map = new Map<string, EvaluatorKind>(Object.entries(entries));
  return { get: (predicate) => map.get(predicate) };
}

/** The evaluator kinds every test predicate uses, by predicate id. */
const KINDS: Record<string, EvaluatorKind> = {
  MEETS_AT: 'fact-match-symmetric',
  WORKS_FOR: 'fact-match',
  MEMBER_OF: 'fact-match',
  REPORTS_TO: 'fact-match',
  IS_ALIAS_OF: 'alias',
  IN_CHAIN_OF: 'membership-transitive',
};

const T = (day: number, phase: 0 | 1 | 2 | 3): GameTime => ({ day, phase });

let propCounter = 0;
/** Mint a Proposition with a unique id so facts never collide by id. */
function prop(p: Omit<Proposition, 'id'>): Proposition {
  propCounter += 1;
  return { id: `p${propCounter}`, ...p };
}

const ANA: NpcId = 'npc:ana';
const BORIS: NpcId = 'npc:boris';
const CHIEF: NpcId = 'npc:chief';
const CELL: OrgId = 'org:cell';
const HOSTILE: OrgId = 'org:hostile';
const PIER = 'loc:pier';

function emptyData(): TruthStoreData {
  return {
    facts: [],
    allegiances: new Map(),
    identities: new Map(),
    claimTruths: [],
  };
}

// ---------------------------------------------------------------------------
// fact-match
// ---------------------------------------------------------------------------

describe('fact-match evaluator', () => {
  it('holds when a stored fact matches subject, object and overlapping window', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({
        subject: ANA,
        predicate: 'WORKS_FOR',
        object: CELL,
        window: { from: T(0, 0), to: T(5, 0) },
      }),
    );
    const query = prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL });
    expect(store.holds(query, T(2, 0))).toBe(true);
  });

  it('does not hold outside the fact window', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({
        subject: ANA,
        predicate: 'WORKS_FOR',
        object: CELL,
        window: { from: T(1, 0), to: T(3, 0) },
      }),
    );
    const query = prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL });
    expect(store.holds(query, T(0, 3))).toBe(false);
    // `to` is exclusive.
    expect(store.holds(query, T(3, 0))).toBe(false);
    expect(store.holds(query, T(2, 3))).toBe(true);
  });

  it('is not symmetric: a swapped fact does not match', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: BORIS }));
    const swapped = prop({ subject: BORIS, predicate: 'WORKS_FOR', object: ANA });
    expect(store.holds(swapped, T(0, 0))).toBe(false);
  });

  it('distinguishes a different object, predicate or place', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({ subject: ANA, predicate: 'MEETS_AT', object: BORIS, place: PIER }),
    );
    const otherPlace = prop({
      subject: ANA,
      predicate: 'MEETS_AT',
      object: BORIS,
      place: 'loc:cafe',
    });
    // MEETS_AT is symmetric here, but place still has to match.
    expect(store.holds(otherPlace, T(0, 0))).toBe(false);
  });

  it('an open-ended fact window holds at every later time', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL, window: { from: T(1, 0) } }),
    );
    const query = prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL });
    expect(store.holds(query, T(0, 0))).toBe(false);
    expect(store.holds(query, T(1, 0))).toBe(true);
    expect(store.holds(query, T(99, 3))).toBe(true);
  });

  it('a literal object matches by value', () => {
    const store = TruthStore.create(lookup({ PAID: 'fact-match' }));
    store.addFact(
      prop({ subject: ANA, predicate: 'PAID', object: { kind: 'amount', value: 500 } }),
    );
    const match = prop({
      subject: ANA,
      predicate: 'PAID',
      object: { kind: 'amount', value: 500 },
    });
    const miss = prop({
      subject: ANA,
      predicate: 'PAID',
      object: { kind: 'amount', value: 400 },
    });
    expect(store.holds(match, T(0, 0))).toBe(true);
    expect(store.holds(miss, T(0, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fact-match-symmetric
// ---------------------------------------------------------------------------

describe('fact-match-symmetric evaluator', () => {
  it('holds in the stored orientation', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({ subject: ANA, predicate: 'MEETS_AT', object: BORIS, place: PIER }),
    );
    const query = prop({ subject: ANA, predicate: 'MEETS_AT', object: BORIS, place: PIER });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });

  it('holds in the swapped orientation', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({ subject: ANA, predicate: 'MEETS_AT', object: BORIS, place: PIER }),
    );
    const swapped = prop({ subject: BORIS, predicate: 'MEETS_AT', object: ANA, place: PIER });
    expect(store.holds(swapped, T(0, 0))).toBe(true);
  });

  it('does not swap a literal into the subject position', () => {
    const store = TruthStore.create(lookup({ SEEN_WITH: 'fact-match-symmetric' }));
    // A fact with a literal object can never match a swapped query, because a
    // literal cannot be a subject.
    store.addFact(
      prop({
        subject: ANA,
        predicate: 'SEEN_WITH',
        object: { kind: 'text', value: 'a stranger' },
      }),
    );
    const direct = prop({
      subject: ANA,
      predicate: 'SEEN_WITH',
      object: { kind: 'text', value: 'a stranger' },
    });
    expect(store.holds(direct, T(0, 0))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// alias
// ---------------------------------------------------------------------------

describe('alias evaluator', () => {
  it('holds when an unk id and a named id resolve to the same NPC', () => {
    const store = TruthStore.create(lookup(KINDS));
    const unk: UnkId = 'unk:3';
    store.setIdentity(unk, ANA);
    const query = prop({ subject: unk, predicate: 'IS_ALIAS_OF', object: ANA });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });

  it('does not hold for two different people', () => {
    const store = TruthStore.create(lookup(KINDS));
    const unk: UnkId = 'unk:3';
    store.setIdentity(unk, ANA);
    const query = prop({ subject: unk, predicate: 'IS_ALIAS_OF', object: BORIS });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });

  it('does not hold for an unmapped unk id', () => {
    const store = TruthStore.create(lookup(KINDS));
    const query = prop({ subject: 'unk:7', predicate: 'IS_ALIAS_OF', object: ANA });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });

  it('holds for two unk ids that resolve to the same NPC', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.setIdentity('unk:1', ANA);
    store.setIdentity('unk:2', ANA);
    const query = prop({ subject: 'unk:1', predicate: 'IS_ALIAS_OF', object: 'unk:2' });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });

  it('does not hold against a literal object', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.setIdentity('unk:1', ANA);
    const query = prop({
      subject: 'unk:1',
      predicate: 'IS_ALIAS_OF',
      object: { kind: 'text', value: 'ana' },
    });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// membership-transitive
// ---------------------------------------------------------------------------

describe('membership-transitive evaluator', () => {
  it('follows a MEMBER_OF then REPORTS_TO chain to the target', () => {
    const store = TruthStore.create(lookup(KINDS));
    // ana MEMBER_OF cell, cell REPORTS_TO chief  => ana IN_CHAIN_OF chief
    store.addFact(prop({ subject: ANA, predicate: 'MEMBER_OF', object: CELL }));
    store.addFact(prop({ subject: CELL, predicate: 'REPORTS_TO', object: CHIEF }));
    const query = prop({ subject: ANA, predicate: 'IN_CHAIN_OF', object: CHIEF });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });

  it('holds for a direct edge', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'REPORTS_TO', object: BORIS }));
    const query = prop({ subject: ANA, predicate: 'IN_CHAIN_OF', object: BORIS });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });

  it('does not hold when no chain reaches the target', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'MEMBER_OF', object: CELL }));
    const query = prop({ subject: ANA, predicate: 'IN_CHAIN_OF', object: CHIEF });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });

  it('ignores edges outside the query window', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({
        subject: ANA,
        predicate: 'MEMBER_OF',
        object: CELL,
        window: { from: T(0, 0), to: T(2, 0) },
      }),
    );
    store.addFact(prop({ subject: CELL, predicate: 'REPORTS_TO', object: CHIEF }));
    const query = prop({ subject: ANA, predicate: 'IN_CHAIN_OF', object: CHIEF });
    expect(store.holds(query, T(1, 0))).toBe(true);
    expect(store.holds(query, T(3, 0))).toBe(false);
  });

  it('terminates on a cycle in the data', () => {
    const store = TruthStore.create(lookup(KINDS));
    // A mutual-membership cycle that does not reach the chief.
    store.addFact(prop({ subject: ANA, predicate: 'MEMBER_OF', object: CELL }));
    store.addFact(prop({ subject: CELL, predicate: 'MEMBER_OF', object: ANA }));
    const query = prop({ subject: ANA, predicate: 'IN_CHAIN_OF', object: CHIEF });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });

  it('resolves an unk subject before walking the chain', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.setIdentity('unk:5', ANA);
    store.addFact(prop({ subject: ANA, predicate: 'REPORTS_TO', object: CHIEF }));
    const query = prop({ subject: 'unk:5', predicate: 'IN_CHAIN_OF', object: CHIEF });
    expect(store.holds(query, T(0, 0))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unk resolution in holds
// ---------------------------------------------------------------------------

describe('unk resolution before evaluation', () => {
  it('a fact about an unk subject is judged against its NPC', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
    store.setIdentity('unk:9', ANA);
    const viaUnk = prop({ subject: 'unk:9', predicate: 'WORKS_FOR', object: CELL });
    expect(store.holds(viaUnk, T(0, 0))).toBe(true);
  });

  it('an unk object is resolved too', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(
      prop({ subject: ANA, predicate: 'MEETS_AT', object: BORIS, place: PIER }),
    );
    store.setIdentity('unk:2', BORIS);
    const viaUnk = prop({
      subject: ANA,
      predicate: 'MEETS_AT',
      object: 'unk:2',
      place: PIER,
    });
    expect(store.holds(viaUnk, T(0, 0))).toBe(true);
  });

  it('an unmapped unk subject matches nothing but itself', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
    const viaUnk = prop({ subject: 'unk:9', predicate: 'WORKS_FOR', object: CELL });
    expect(store.holds(viaUnk, T(0, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown predicate
// ---------------------------------------------------------------------------

describe('unknown predicate', () => {
  it('never holds when the predicate has no evaluator kind', () => {
    const store = TruthStore.create(lookup(KINDS));
    const query = prop({ subject: ANA, predicate: 'NO_SUCH_RULE', object: CELL });
    expect(store.holds(query, T(0, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// allegiance and identityOf
// ---------------------------------------------------------------------------

describe('allegiance and identityOf', () => {
  it('returns a recorded allegiance, branded Truth', () => {
    const store = TruthStore.create(lookup(KINDS));
    const allegiance: Allegiance = { org: HOSTILE };
    store.setAllegiance(ANA, allegiance);
    const result = store.allegiance(ANA);
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('unreachable');
    expect(revealTruth(result)).toEqual({ org: HOSTILE });
  });

  it('returns undefined for an NPC with no recorded allegiance', () => {
    const store = TruthStore.create(lookup(KINDS));
    expect(store.allegiance(ANA)).toBeUndefined();
  });

  it('returns a recorded identity mapping, branded Truth', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.setIdentity('unk:1', ANA);
    const result = store.identityOf('unk:1');
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('unreachable');
    expect(revealTruth(result)).toBe(ANA);
  });

  it('returns undefined for an unmapped unk id', () => {
    const store = TruthStore.create(lookup(KINDS));
    expect(store.identityOf('unk:42')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// facts() isolation
// ---------------------------------------------------------------------------

describe('facts view isolation', () => {
  it('returns a copy that cannot mutate the store', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
    const snapshot = store.facts();
    expect(snapshot).toHaveLength(1);
    // Mutating the returned array must not change the store.
    (snapshot as unknown as Proposition[]).pop();
    expect(store.facts()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Transaction atomicity
// ---------------------------------------------------------------------------

describe('transaction atomicity', () => {
  it('commits every write together on success', () => {
    const store = TruthStore.create(lookup(KINDS));
    const fact = prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL });
    const record: ClaimTruthRecord = {
      claim: prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }),
      speaker: BORIS,
      at: T(0, 0),
      held: true,
      believed: true,
      lie: false,
    };
    store.transaction((tx) => {
      tx.addFact(fact);
      tx.setIdentity('unk:1', ANA);
      tx.setAllegiance(ANA, { org: CELL });
      tx.recordClaimTruth(record);
    });
    expect(store.facts()).toHaveLength(1);
    expect(store.identityOf('unk:1')).toBeDefined();
    expect(store.allegiance(ANA)).toBeDefined();
    expect(store.claimTruths()).toHaveLength(1);
  });

  it('discards all writes when the callback throws, leaving state unchanged', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
    store.setAllegiance(ANA, { org: CELL });
    const before = store.snapshot();

    expect(() =>
      store.transaction((tx) => {
        tx.addFact(prop({ subject: BORIS, predicate: 'WORKS_FOR', object: HOSTILE }));
        tx.setIdentity('unk:9', BORIS);
        tx.setAllegiance(BORIS, { org: HOSTILE });
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const after = store.snapshot();
    expect(after.facts).toEqual(before.facts);
    expect([...after.identities]).toEqual([...before.identities]);
    expect([...after.allegiances]).toEqual([...before.allegiances]);
    expect(after.claimTruths).toEqual(before.claimTruths);
    // The partial writes never landed.
    expect(store.identityOf('unk:9')).toBeUndefined();
    expect(store.allegiance(BORIS)).toBeUndefined();
    expect(store.facts()).toHaveLength(1);
  });

  it('returns the callback result on commit', () => {
    const store = TruthStore.create(lookup(KINDS));
    const result = store.transaction(() => 42);
    expect(result).toBe(42);
  });

  it('single-write mutators are each atomic', () => {
    const store = TruthStore.create(lookup(KINDS));
    store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
    store.setIdentity('unk:1', ANA);
    expect(store.facts()).toHaveLength(1);
    expect(store.identityOf('unk:1')).toBeDefined();
  });

  it('property: a thrown transaction never changes the snapshot (Req 16.4)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subject: fc.constantFrom(ANA, BORIS, CHIEF),
            object: fc.constantFrom(CELL, HOSTILE),
          }),
          { maxLength: 8 },
        ),
        (writes) => {
          const store = TruthStore.from(lookup(KINDS), emptyData());
          store.addFact(prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL }));
          const before = store.snapshot();

          try {
            store.transaction((tx) => {
              for (const w of writes) {
                tx.addFact(prop({ subject: w.subject, predicate: 'WORKS_FOR', object: w.object }));
              }
              throw new Error('fail');
            });
          } catch {
            // expected
          }

          const after = store.snapshot();
          return (
            after.facts.length === before.facts.length &&
            after.facts.every((f, i) => f === before.facts[i])
          );
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Construction from data / snapshot round-trip
// ---------------------------------------------------------------------------

describe('from and snapshot', () => {
  it('builds a store from existing data and round-trips through snapshot', () => {
    const data: TruthStoreData = {
      facts: [prop({ subject: ANA, predicate: 'WORKS_FOR', object: CELL })],
      allegiances: new Map<NpcId, Allegiance>([[ANA, { org: HOSTILE }]]),
      identities: new Map<UnkId, NpcId>([['unk:1', ANA]]),
      claimTruths: [],
    };
    const store = TruthStore.from(lookup(KINDS), data);
    expect(store.facts()).toHaveLength(1);
    const allegiance = store.allegiance(ANA);
    const identity = store.identityOf('unk:1');
    if (allegiance === undefined || identity === undefined) {
      throw new Error('unreachable');
    }
    expect(revealTruth(allegiance)).toEqual({ org: HOSTILE });
    expect(revealTruth(identity)).toBe(ANA);

    const snap = store.snapshot();
    expect(snap.facts).toHaveLength(1);
    expect([...snap.identities]).toEqual([['unk:1', ANA]]);
    // The snapshot is a copy: mutating it must not affect the store.
    (snap.identities as Map<UnkId, NpcId>).set('unk:2', BORIS);
    expect(store.identityOf('unk:2')).toBeUndefined();
  });
});
