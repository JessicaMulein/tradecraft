/**
 * Unit tests for {@link TruthDraft} (Requirements 5.3, 5.4): staged writes are
 * visible through the draft's reads as though committed, reach the store only
 * at `commit()`, and vanish on `discard()`.
 */
import { describe, expect, it } from 'vitest';

import type { EvaluatorKind } from '@tradecraft/content';

import {
  type GameTime,
  type NpcId,
  type OrgId,
  type Proposition,
  revealTruth,
} from '../model/core.js';
import {
  TruthStore,
  type ClaimTruthRecord,
  type PredicateEvaluatorLookup,
} from './truth.js';
import { TruthDraft } from './truth-draft.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function lookup(
  entries: Record<string, EvaluatorKind>,
): PredicateEvaluatorLookup {
  const map = new Map<string, EvaluatorKind>(Object.entries(entries));
  return { get: (predicate) => map.get(predicate) };
}

const KINDS = lookup({
  WORKS_FOR: 'fact-match',
  REPORTS_TO: 'fact-match',
  IS_ALIAS_OF: 'alias',
  IN_CHAIN_OF: 'membership-transitive',
});

const AT: GameTime = { day: 1, phase: 0 };
const ANA: NpcId = 'npc:ana';
const BORIS: NpcId = 'npc:boris';
const CHIEF: NpcId = 'npc:chief';
const CELL: OrgId = 'org:cell';
const HOSTILE: OrgId = 'org:hostile';

const anaWorksForCell: Proposition = {
  id: 'f1',
  subject: ANA,
  predicate: 'WORKS_FOR',
  object: CELL,
};
const borisWorksForHostile: Proposition = {
  id: 'f2',
  subject: BORIS,
  predicate: 'WORKS_FOR',
  object: HOSTILE,
};

const claimRecord: ClaimTruthRecord = {
  claim: { id: 'c1', subject: ANA, predicate: 'WORKS_FOR', object: CELL },
  speaker: BORIS,
  at: AT,
  held: true,
  believed: true,
  lie: false,
};

/** A store holding one fact, one identity and one allegiance. */
function seededStore(): TruthStore {
  const store = TruthStore.create(KINDS);
  store.addFact(anaWorksForCell);
  store.setIdentity('unk:1', ANA);
  store.setAllegiance(ANA, { org: CELL });
  return store;
}

/** Stage one write of every kind on `target` (a draft or a store). */
function writeEveryKind(target: TruthStore | TruthDraft): void {
  target.addFact(borisWorksForHostile);
  target.recordClaimTruth(claimRecord);
  target.setIdentity('unk:2', BORIS);
  target.setAllegiance(BORIS, { org: HOSTILE });
}

// ---------------------------------------------------------------------------
// Reads see staged writes
// ---------------------------------------------------------------------------

describe('TruthDraft reads (read-your-writes)', () => {
  it('answers from the store when nothing is staged', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    expect(draft.facts()).toEqual(store.facts());
    expect(draft.holds(anaWorksForCell, AT)).toBe(true);
    expect(draft.identityOf('unk:1')).toBe(ANA);
    expect(draft.allegiance(ANA)).toEqual({ org: CELL });
  });

  it('shows a staged fact in facts() and holds(), but not in the store', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    draft.addFact(borisWorksForHostile);

    expect(draft.facts().map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(draft.holds(borisWorksForHostile, AT)).toBe(true);
    expect(store.holds(borisWorksForHostile, AT)).toBe(false);
    expect(store.facts()).toHaveLength(1);
  });

  it('resolves a staged identity in identityOf() and inside holds()', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    draft.setIdentity('unk:2', BORIS);
    draft.addFact({
      id: 'f3',
      subject: BORIS,
      predicate: 'REPORTS_TO',
      object: CHIEF,
    });

    const identity = draft.identityOf('unk:2');
    expect(identity === undefined ? undefined : revealTruth(identity)).toBe(
      BORIS,
    );
    const alias: Proposition = {
      id: 'q1',
      subject: 'unk:2',
      predicate: 'IS_ALIAS_OF',
      object: BORIS,
    };
    expect(draft.holds(alias, AT)).toBe(true);
    // A transitive rule walks the staged edge from the staged identity.
    const chain: Proposition = {
      id: 'q2',
      subject: 'unk:2',
      predicate: 'IN_CHAIN_OF',
      object: CHIEF,
    };
    expect(draft.holds(chain, AT)).toBe(true);
    expect(store.identityOf('unk:2')).toBeUndefined();
    expect(store.holds(alias, AT)).toBe(false);
  });

  it('lists staged Claim-truths and allegiances, a staged value replacing the stored one', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    draft.recordClaimTruth(claimRecord);
    draft.setAllegiance(ANA, { org: HOSTILE });

    expect(draft.claimTruths()).toEqual([claimRecord]);
    expect(draft.allegiance(ANA)).toEqual({ org: HOSTILE });
    expect(store.claimTruths()).toEqual([]);
    expect(store.allegiance(ANA)).toEqual({ org: CELL });
  });

  it('reads exactly what the store reads once the draft is committed', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    writeEveryKind(draft);
    const queries: Proposition[] = [
      anaWorksForCell,
      borisWorksForHostile,
      { id: 'q1', subject: 'unk:2', predicate: 'WORKS_FOR', object: HOSTILE },
      { id: 'q2', subject: 'unk:1', predicate: 'IS_ALIAS_OF', object: 'unk:2' },
    ];
    const before = {
      facts: draft.facts(),
      claimTruths: draft.claimTruths(),
      holds: queries.map((q) => draft.holds(q, AT)),
      identity: draft.identityOf('unk:2'),
      allegiance: draft.allegiance(BORIS),
    };

    draft.commit();

    expect(store.facts()).toEqual(before.facts);
    expect(store.claimTruths()).toEqual(before.claimTruths);
    expect(queries.map((q) => store.holds(q, AT))).toEqual(before.holds);
    expect(store.identityOf('unk:2')).toEqual(before.identity);
    expect(store.allegiance(BORIS)).toEqual(before.allegiance);
  });
});

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

describe('TruthDraft commit (Req 5.3)', () => {
  it('leaves the store untouched until commit, then applies every write as direct writes would', () => {
    const store = seededStore();
    const before = store.snapshot();
    const draft = TruthDraft.over(store);
    writeEveryKind(draft);
    expect(store.snapshot()).toEqual(before);

    draft.commit();

    const direct = seededStore();
    writeEveryKind(direct);
    expect(store.snapshot()).toEqual(direct.snapshot());
  });

  it('closes the draft: a further write or commit throws, and reads pass through', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    draft.addFact(borisWorksForHostile);
    draft.commit();

    expect(() => draft.addFact(anaWorksForCell)).toThrow(/committed/);
    expect(() => draft.commit()).toThrow(/committed/);
    // Nothing is counted twice now the writes live in the store.
    expect(draft.facts()).toEqual(store.facts());
    expect(store.facts()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

describe('TruthDraft discard (Req 5.4)', () => {
  it('drops every staged write and leaves the store unchanged', () => {
    const store = seededStore();
    const before = store.snapshot();
    const draft = TruthDraft.over(store);
    writeEveryKind(draft);

    draft.discard();

    expect(store.snapshot()).toEqual(before);
    expect(draft.facts()).toEqual(store.facts());
    expect(draft.identityOf('unk:2')).toBeUndefined();
    expect(() => draft.commit()).toThrow(/discarded/);
    expect(() => draft.setIdentity('unk:3', CHIEF)).toThrow(/discarded/);
    // Discarding again is a no-op.
    expect(() => draft.discard()).not.toThrow();
  });

  it('a transaction on the draft that throws stages none of its writes', () => {
    const store = seededStore();
    const draft = TruthDraft.over(store);
    draft.addFact(borisWorksForHostile);

    expect(() =>
      draft.transaction((tx) => {
        tx.setIdentity('unk:9', CHIEF);
        tx.addFact({
          id: 'f9',
          subject: CHIEF,
          predicate: 'WORKS_FOR',
          object: CELL,
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(draft.identityOf('unk:9')).toBeUndefined();
    expect(draft.facts().map((f) => f.id)).toEqual(['f1', 'f2']);
    draft.commit();
    expect(store.facts().map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});
