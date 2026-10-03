import fc from 'fast-check';
import {
  formatAdmiraltyGrade,
  type AdmiraltyGrade,
  type EntityId,
  type GameTime,
  type Literal,
  type LocId,
  type ObservationSource,
  type Proposition,
} from '@tradecraft/engine';

import {
  CaseFile,
  CLAIM_SOURCE_KINDS,
  aliasResolver,
  computeRelations,
  isAliasPredicate,
  MULTI_VALUED_PREDICATES,
  originKey,
  sourceKey,
  type Claim,
  type ClaimInput,
  type ClaimSource,
} from './casefile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0: GameTime = { day: 0, phase: 0 };
const T1: GameTime = { day: 0, phase: 1 };
const T2: GameTime = { day: 1, phase: 0 };

/** A Proposition builder for tests; defaults a unique id. */
let propCounter = 0;
function prop(
  subject: EntityId,
  predicate: string,
  object: EntityId | Literal,
  extra: { place?: LocId } = {},
): Proposition {
  propCounter += 1;
  return {
    id: `prop:${propCounter}`,
    subject,
    predicate,
    object,
    ...(extra.place ? { place: extra.place } : {}),
  };
}

const npcSource = (npc: `npc:${string}`): ClaimSource => ({ kind: 'npc', npc });
const docSource = (id: `doc:${string}`): ClaimSource => ({
  kind: 'document',
  id,
});

function text(value: string): Literal {
  return { kind: 'text', value };
}

const B2: AdmiraltyGrade = { reliability: 'B', credibility: 2 };
const C3: AdmiraltyGrade = { reliability: 'C', credibility: 3 };

// ---------------------------------------------------------------------------
// Source kinds (Glossary: NPC, Intercept, surveillance, document)
// ---------------------------------------------------------------------------

describe('ClaimSource', () => {
  it('covers exactly the four source kinds', () => {
    expect([...CLAIM_SOURCE_KINDS].sort()).toEqual(
      ['document', 'intercept', 'npc', 'surveillance'].sort(),
    );
  });

  it('derives a distinct source key per originating thing and kind', () => {
    const keys = new Set([
      sourceKey({ kind: 'npc', npc: 'npc:ana' }),
      sourceKey({ kind: 'npc', npc: 'npc:boris' }),
      sourceKey({ kind: 'intercept', id: 'int:7' }),
      sourceKey({ kind: 'surveillance', loc: 'loc:pier' }),
      sourceKey({ kind: 'document', id: 'doc:cable-1' }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('separates an npc source from an intercept with a colliding local id', () => {
    // Kinds must disambiguate even if the raw ids were to collide.
    const a = sourceKey({ kind: 'surveillance', loc: 'loc:7' });
    const b = sourceKey({ kind: 'intercept', id: 'int:7' });
    expect(a).not.toBe(b);
  });

  it('records a Claim from each of the four source kinds', () => {
    const cf = new CaseFile();
    const inputs: ClaimInput[] = [
      { source: { kind: 'npc', npc: 'npc:ana' }, prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 },
      { source: { kind: 'intercept', id: 'int:1' }, prop: prop('npc:x', 'MEETS_AT', 'npc:y'), observedAt: T0 },
      { source: { kind: 'surveillance', loc: 'loc:cafe' }, prop: prop('npc:x', 'LOCATED_AT', 'loc:cafe'), observedAt: T0 },
      { source: { kind: 'document', id: 'doc:news-1' }, prop: prop('npc:x', 'TRAVELS_TO', 'loc:port'), observedAt: T0 },
    ];
    for (const input of inputs) {
      cf.add(input);
    }
    const kinds = cf.list().map((c) => c.source.kind);
    expect(new Set(kinds)).toEqual(new Set(CLAIM_SOURCE_KINDS));
  });

  it('mirrors the engine ObservationSource one to one, so a source files unchanged', () => {
    // Checked by the typecheck: same kinds, same field names, same modifiers.
    expectTypeOf<ObservationSource>().toEqualTypeOf<ClaimSource>();
  });
});

// ---------------------------------------------------------------------------
// Recording and ids
// ---------------------------------------------------------------------------

describe('CaseFile.add', () => {
  it('mints distinct ids and starts each Claim ungraded with no links', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'PLANS', text('a bombing')), observedAt: T0 });
    const b = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'PLANS', text('a theft')), observedAt: T0 });
    expect(a.id).not.toBe(b.id);
    expect(a.grade).toBeUndefined();
    expect(a.links).toEqual([]);
    expect(cf.size).toBe(2);
  });

  it('defaults hedged to false and carries an explicit hedge through', () => {
    const cf = new CaseFile();
    const plain = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'KNOWS', 'npc:y'), observedAt: T0 });
    const hedged = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'KNOWS', 'npc:z'), observedAt: T0, hedged: true });
    expect(plain.hedged).toBe(false);
    expect(hedged.hedged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corroboration and conflict (Requirement 7.4)
// ---------------------------------------------------------------------------

describe('corroboration and conflict', () => {
  it('leaves a lone Claim with relation none', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    expect(cf.get(a.id)?.relation).toBe('none');
  });

  it('marks two agreeing Claims as corroborated', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:news-1'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T1 });
    expect(cf.get(a.id)?.relation).toBe('corroborated');
    expect(cf.get(b.id)?.relation).toBe('corroborated');
  });

  it('marks two disagreeing Claims as conflicted', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:news-1'), prop: prop('npc:x', 'MEMBER_OF', 'org:station'), observedAt: T1 });
    expect(cf.get(a.id)?.relation).toBe('conflicted');
    expect(cf.get(b.id)?.relation).toBe('conflicted');
  });

  it('does not relate Claims that differ in subject or predicate', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:y', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const c = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'WORKS_FOR', 'org:cell'), observedAt: T0 });
    expect(cf.get(a.id)?.relation).toBe('none');
    expect(cf.get(b.id)?.relation).toBe('none');
    expect(cf.get(c.id)?.relation).toBe('none');
  });

  it('treats place as part of agreement', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'LOCATED_AT', 'npc:x', { place: 'loc:cafe' }), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:d'), prop: prop('npc:x', 'LOCATED_AT', 'npc:x', { place: 'loc:park' }), observedAt: T0 });
    expect(cf.get(a.id)?.relation).toBe('conflicted');
    expect(cf.get(b.id)?.relation).toBe('conflicted');
  });

  it('lets conflict take precedence when a Claim both agrees and disagrees', () => {
    const cf = new CaseFile();
    const agree1 = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'PLANS', text('bombing')), observedAt: T0 });
    const agree2 = cf.add({ source: docSource('doc:a'), prop: prop('npc:x', 'PLANS', text('bombing')), observedAt: T0 });
    const disagree = cf.add({ source: docSource('doc:b'), prop: prop('npc:x', 'PLANS', text('theft')), observedAt: T0 });
    expect(cf.get(agree1.id)?.relation).toBe('conflicted');
    expect(cf.get(agree2.id)?.relation).toBe('conflicted');
    expect(cf.get(disagree.id)?.relation).toBe('conflicted');
  });

  it('agrees on equal literal objects of each kind', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'SUPPLIES', { kind: 'amount', value: 500 }), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:a'), prop: prop('npc:x', 'SUPPLIES', { kind: 'amount', value: 500 }), observedAt: T0 });
    const c = cf.add({ source: docSource('doc:b'), prop: prop('npc:x', 'SUPPLIES', { kind: 'amount', value: 700 }), observedAt: T0 });
    expect(cf.get(a.id)?.relation).toBe('conflicted'); // c disagrees
    expect(cf.get(b.id)?.relation).toBe('conflicted');
    expect(cf.get(c.id)?.relation).toBe('conflicted');
  });
});

// ---------------------------------------------------------------------------
// Alias awareness (Requirement 7.4: resolve via held IS_ALIAS_OF Claims)
// ---------------------------------------------------------------------------

describe('alias-aware corroboration', () => {
  it('recognises the IS_ALIAS_OF predicate whatever pack namespaces it', () => {
    expect(isAliasPredicate('IS_ALIAS_OF')).toBe(true);
    expect(isAliasPredicate('core/IS_ALIAS_OF')).toBe(true);
    expect(isAliasPredicate('core/is_alias_of')).toBe(true);
    expect(isAliasPredicate('core/MEMBER_OF')).toBe(false);
  });

  it('does not relate unk and npc Claims until an alias Claim links them', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('unk:3', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:a'), prop: prop('npc:viktor', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    expect(cf.get(a.id)?.relation).toBe('none');
    expect(cf.get(b.id)?.relation).toBe('none');

    // Player identifies unk:3 as npc:viktor.
    cf.add({ source: npcSource('npc:ana'), prop: prop('unk:3', 'core/IS_ALIAS_OF', 'npc:viktor'), observedAt: T1 });
    expect(cf.get(a.id)?.relation).toBe('corroborated');
    expect(cf.get(b.id)?.relation).toBe('corroborated');
  });

  it('resolves aliases on the object side too', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'REPORTS_TO', 'unk:3'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:a'), prop: prop('npc:x', 'REPORTS_TO', 'npc:viktor'), observedAt: T0 });
    // Same subject and predicate but (as yet) different objects: a conflict.
    expect(cf.get(a.id)?.relation).toBe('conflicted');
    expect(cf.get(b.id)?.relation).toBe('conflicted');
    // Once unk:3 is identified as npc:viktor, the two objects are the same
    // entity, so the conflict resolves into corroboration.
    cf.add({ source: npcSource('npc:ana'), prop: prop('npc:viktor', 'IS_ALIAS_OF', 'unk:3'), observedAt: T1 });
    expect(cf.get(a.id)?.relation).toBe('corroborated');
    expect(cf.get(b.id)?.relation).toBe('corroborated');
  });

  it('resolves transitive alias chains', () => {
    const claims: Claim[] = [];
    const resolver = aliasResolver(claims);
    expect(resolver('unk:1')).toBe('unk:1');

    const cf = new CaseFile();
    cf.add({ source: npcSource('npc:ana'), prop: prop('unk:1', 'IS_ALIAS_OF', 'unk:2'), observedAt: T0 });
    cf.add({ source: npcSource('npc:ana'), prop: prop('unk:2', 'IS_ALIAS_OF', 'npc:viktor'), observedAt: T0 });
    const canon = cf.aliases();
    expect(canon('unk:1')).toBe(canon('npc:viktor'));
    expect(canon('unk:2')).toBe(canon('npc:viktor'));
    // Representative is the lexicographically smallest id in the class.
    expect(canon('unk:1')).toBe('npc:viktor');
  });
});

// ---------------------------------------------------------------------------
// Admiralty grading (Requirement 8.1)
// ---------------------------------------------------------------------------

describe('grading', () => {
  it('assigns and clears a grade', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    cf.grade(a.id, B2);
    expect(cf.get(a.id)?.grade).toEqual(B2);
    expect(formatAdmiraltyGrade(B2)).toBe('B2');
    cf.ungrade(a.id);
    expect(cf.get(a.id)?.grade).toBeUndefined();
  });

  it('keeps the grade across a later relation recompute', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    cf.grade(a.id, C3);
    // Adding a corroborating Claim recomputes relations.
    cf.add({ source: docSource('doc:a'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T1 });
    expect(cf.get(a.id)?.grade).toEqual(C3);
    expect(cf.get(a.id)?.relation).toBe('corroborated');
  });

  it('throws when grading an unknown Claim', () => {
    const cf = new CaseFile();
    expect(() => cf.grade('claim:999', B2)).toThrow(/no Claim/);
  });
});

// ---------------------------------------------------------------------------
// Links (player-created associations)
// ---------------------------------------------------------------------------

describe('links', () => {
  it('links symmetrically and unlinks', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:a'), prop: prop('npc:y', 'WORKS_FOR', 'org:cell'), observedAt: T0 });
    cf.link(a.id, b.id);
    expect(cf.get(a.id)?.links).toContain(b.id);
    expect(cf.get(b.id)?.links).toContain(a.id);
    cf.unlink(a.id, b.id);
    expect(cf.get(a.id)?.links).not.toContain(b.id);
    expect(cf.get(b.id)?.links).not.toContain(a.id);
  });

  it('ignores self-links and duplicate links', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const b = cf.add({ source: docSource('doc:a'), prop: prop('npc:y', 'WORKS_FOR', 'org:cell'), observedAt: T0 });
    cf.link(a.id, a.id);
    expect(cf.get(a.id)?.links).toEqual([]);
    cf.link(a.id, b.id);
    cf.link(a.id, b.id);
    expect(cf.get(a.id)?.links).toEqual([b.id]);
  });

  it('throws when linking an unknown Claim', () => {
    const cf = new CaseFile();
    const a = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    expect(() => cf.link(a.id, 'claim:999')).toThrow(/no Claim/);
  });
});

// ---------------------------------------------------------------------------
// Per-source history (Requirement 8.2)
// ---------------------------------------------------------------------------

describe('per-source history', () => {
  it('groups Claims, grades and corroboration/conflict counts by source', () => {
    const cf = new CaseFile();
    // Ana makes two Claims about npc:x being in the cell; a document agrees
    // with the first and a second document disagrees with it.
    const anaA = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T0 });
    const anaB = cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'MEMBER_OF', 'org:station'), observedAt: T1 });
    cf.add({ source: docSource('doc:a'), prop: prop('npc:x', 'MEMBER_OF', 'org:cell'), observedAt: T1 });
    cf.grade(anaA.id, B2);

    const history = cf.sourceHistory(npcSource('npc:ana'));
    expect(history).toBeDefined();
    expect(history?.claims.map((c) => c.id)).toEqual([anaA.id, anaB.id]);
    expect(history?.grades.get(anaA.id)).toEqual(B2);
    expect(history?.grades.has(anaB.id)).toBe(false);
    // Both of Ana's Claims are now part of a conflicting group about
    // (npc:x, MEMBER_OF).
    expect(history?.conflictedCount).toBe(2);
    expect(history?.corroboratedCount).toBe(0);
  });

  it('returns undefined for a source with no Claims', () => {
    const cf = new CaseFile();
    expect(cf.sourceHistory(npcSource('npc:nobody'))).toBeUndefined();
  });

  it('reports one history entry per distinct source', () => {
    const cf = new CaseFile();
    cf.add({ source: npcSource('npc:ana'), prop: prop('npc:x', 'KNOWS', 'npc:y'), observedAt: T0 });
    cf.add({ source: npcSource('npc:boris'), prop: prop('npc:z', 'KNOWS', 'npc:y'), observedAt: T0 });
    cf.add({ source: { kind: 'intercept', id: 'int:1' }, prop: prop('npc:x', 'USES_CHANNEL', 'chan:1'), observedAt: T0 });
    expect(cf.sourceHistories().size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

/** A small arbitrary over Claims drawn from a tiny, dense id space, so that
 * subjects, predicates and objects collide often and relations actually form. */
const subjectArb = fc.constantFrom<EntityId>('npc:x', 'npc:y', 'unk:1', 'unk:2');
const objectArb = fc.oneof(
  fc.constantFrom<EntityId>('org:cell', 'org:station', 'npc:y', 'unk:2'),
  fc.record({ kind: fc.constant<'text'>('text'), value: fc.constantFrom('a', 'b') }),
);
const predicateArb = fc.constantFrom('MEMBER_OF', 'PLANS', 'MEETS_AT');
const timeArb = fc.constantFrom(T0, T1, T2);

const claimInputArb: fc.Arbitrary<ClaimInput> = fc.record({
  source: fc.constantFrom<ClaimSource>(
    { kind: 'npc', npc: 'npc:ana' },
    { kind: 'document', id: 'doc:a' },
    { kind: 'intercept', id: 'int:1' },
    { kind: 'surveillance', loc: 'loc:cafe' },
  ),
  prop: fc
    .record({ subject: subjectArb, predicate: predicateArb, object: objectArb })
    .map(({ subject, predicate, object }) => prop(subject, predicate, object)),
  observedAt: timeArb,
});

describe('computeRelations (properties)', () => {
  it('is independent of insertion order (Property 10 basic coverage)', () => {
    fc.assert(
      fc.property(
        fc.array(claimInputArb, { minLength: 1, maxLength: 8 }),
        fc.array(fc.integer(), { minLength: 0, maxLength: 8 }),
        (inputs, shuffleKeys) => {
          // Build two Case Files from the same inputs in different orders.
          const forward = new CaseFile();
          const added: Claim[] = inputs.map((i) => forward.add(i));

          // Reorder the *same* Claim objects and recompute purely.
          const order = added
            .map((claim, i) => ({ claim, key: shuffleKeys[i] ?? i }))
            .sort((a, b) => a.key - b.key)
            .map((e) => e.claim);

          const relForward = computeRelations(added);
          const relShuffled = computeRelations(order);

          // Same per-claim relation regardless of array order.
          for (const claim of added) {
            expect(relShuffled.get(claim.id)).toBe(relForward.get(claim.id));
          }
        },
      ),
    );
  });

  it('never consults anything but the Claims: relation is a function of (subject,predicate,object,place) classes', () => {
    fc.assert(
      fc.property(fc.array(claimInputArb, { minLength: 2, maxLength: 8 }), (inputs) => {
        const cf = new CaseFile();
        const claims = inputs.map((i) => cf.add(i));
        const canon = aliasResolver(claims);
        const relations = computeRelations(claims);

        for (const claim of claims) {
          const group = claims.filter(
            (other) =>
              canon(other.prop.subject) === canon(claim.prop.subject) &&
              localPred(other.prop.predicate) === localPred(claim.prop.predicate) &&
              !isAliasPredicate(other.prop.predicate),
          );
          const relation = relations.get(claim.id);
          if (isAliasPredicate(claim.prop.predicate)) {
            continue; // alias claims form their own groups; checked elsewhere
          }
          if (group.length === 1) {
            expect(relation).toBe('none');
          } else {
            // A Claim that shares subject+predicate with another is related
            // exactly when some group-mate bears on it: an agreeing Claim from
            // an independent origin, or a different value of a single-valued
            // predicate (the generated Claims are timeless, so every pair is
            // about the same moment).
            const mates = group.filter((o) => o.id !== claim.id);
            const bears = mates.some((o) =>
              sameFact(o, claim, canon)
                ? originKey(o.source) !== originKey(claim.source)
                : !MULTI_VALUED_PREDICATES.has(localPred(claim.prop.predicate).toUpperCase()),
            );
            expect(relation !== 'none').toBe(bears);
          }
        }
      }),
    );
  });

  it('relation is symmetric within a group: if a conflicts, something in its group disagrees', () => {
    fc.assert(
      fc.property(fc.array(claimInputArb, { minLength: 2, maxLength: 8 }), (inputs) => {
        const cf = new CaseFile();
        const claims = inputs.map((i) => cf.add(i));
        const relations = computeRelations(claims);
        const canon = aliasResolver(claims);

        for (const claim of claims) {
          if (relations.get(claim.id) !== 'corroborated') {
            continue;
          }
          // A corroborated Claim must have a same-group Claim that agrees and
          // none that disagree.
          const sameGroup = claims.filter(
            (o) =>
              o.id !== claim.id &&
              canon(o.prop.subject) === canon(claim.prop.subject) &&
              localPred(o.prop.predicate) === localPred(claim.prop.predicate),
          );
          // A corroborating mate comes from an independent origin; a mate with
          // a different value disagrees only on a single-valued predicate.
          const multi = MULTI_VALUED_PREDICATES.has(
            localPred(claim.prop.predicate).toUpperCase(),
          );
          const agree = sameGroup.filter(
            (o) => sameFact(o, claim, canon) && originKey(o.source) !== originKey(claim.source),
          );
          const disagree = sameGroup.filter((o) => !multi && !sameFact(o, claim, canon));
          expect(agree.length).toBeGreaterThan(0);
          expect(disagree.length).toBe(0);
        }
      }),
    );
  });
});

function localPred(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  return (slash === -1 ? predicate : predicate.slice(slash + 1)).toLowerCase();
}

function sameFact(a: Claim, b: Claim, canon: (id: EntityId) => EntityId): boolean {
  const key = (c: Claim): string => {
    const o = c.prop.object;
    const ok = typeof o === 'string' ? `e:${canon(o)}` : `${o.kind}:${JSON.stringify(o.value)}`;
    const pk = c.prop.place === undefined ? '' : `p:${canon(c.prop.place)}`;
    return `${ok}|${pk}`;
  };
  return key(a) === key(b);
}
