/**
 * Property 10: Corroboration independence (Requirement 7.4).
 *
 * Design, Correctness Properties:
 *
 *   "For any Case File, the `relation` values are unchanged under any
 *    modification of the Truth Store."
 *
 * This is the dedicated, comprehensive property test for Property 10. The basic
 * coverage task 4.4 left in `casefile.spec.ts` (plain order-independence, a
 * pure-function spot check, and group symmetry) stands; this file is the formal
 * version and does not duplicate those.
 *
 * The design statement is a non-interference claim: the Case File's
 * corroboration/conflict computation ({@link computeRelations}) must depend on
 * the set of {@link Claim}s *and nothing else* — not on ground truth, and not on
 * the order the Claims were recorded. The Case File has no handle on the Truth
 * Store at all, so "unchanged under any modification of the Truth Store" is the
 * observable face of three testable facts, which this file asserts together over
 * one rich generator of Claim sets:
 *
 *   (a) Permutation invariance. For any permutation of the Claims, every Claim's
 *       relation is the same. Insertion order (and hence the order a turn
 *       happened to write facts to the Truth Store) cannot change a relation.
 *
 *   (b) Pure function of alias-resolved equivalence classes. Each non-alias
 *       Claim's relation is exactly what an independent reference built from the
 *       alias-resolved (subject, predicate) group and (object, place) signatures
 *       says it is — a function of the Claims alone, never of any external fact.
 *
 *   (c) Conflict precedence. Within a subject+predicate group a Claim is
 *       `conflicted` if any group-mate disagrees, else `corroborated` if any
 *       agrees, else `none`. Conflict wins over corroboration. Only Claims
 *       about the same moment bear on each other; agreement needs an
 *       independent origin (HQ's documents are one voice); and a different
 *       value contradicts only a single-valued predicate.
 *
 *   (d) Truth-Store independence (the literal statement). Building and then
 *       arbitrarily mutating a Truth Store — adding facts, identities,
 *       allegiances, claim-truths that happen to agree or disagree with the
 *       Claims — leaves every relation byte-for-byte identical, because the
 *       computation never reads it.
 *
 * The generator deliberately draws subjects, predicates, objects, places,
 * `unk:`/`npc:` ids and `IS_ALIAS_OF` Claims from small dense pools so groups
 * actually form and aliases actually merge classes, which is where corroboration
 * and conflict live.
 *
 * **Validates: Requirements 7.4**
 */

import fc from 'fast-check';
import {
  TruthStore,
  type Allegiance,
  type EntityId,
  type GameTime,
  type Literal,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type UnkId,
} from '@tradecraft/engine';

import {
  CaseFile,
  aliasResolver,
  MULTI_VALUED_PREDICATES,
  originKey,
  computeRelations,
  isAliasPredicate,
  type AliasResolver,
  type Claim,
  type ClaimInput,
  type ClaimRelation,
  type ClaimSource,
} from './casefile.js';

// ---------------------------------------------------------------------------
// A smart generator over Claim sets
// ---------------------------------------------------------------------------

const T0: GameTime = { day: 0, phase: 0 };
const T1: GameTime = { day: 0, phase: 1 };
const T2: GameTime = { day: 1, phase: 0 };

/** A tiny, dense id pool: `unk:` and `npc:` ids plus org/loc targets, so that
 * subjects collide, objects collide, and aliases have real work to do. */
const SUBJECTS: readonly EntityId[] = [
  'npc:ana',
  'npc:boris',
  'npc:viktor',
  'unk:1',
  'unk:2',
  'unk:3',
];

const ENTITY_OBJECTS: readonly EntityId[] = [
  'org:cell',
  'org:station',
  'npc:ana',
  'npc:viktor',
  'unk:1',
  'unk:2',
  'loc:cafe',
];

const PLACES: readonly (LocId | undefined)[] = [
  undefined,
  'loc:cafe',
  'loc:pier',
  'loc:park',
];

/** Ordinary (non-alias) predicates that group Claims together. */
const PREDICATES: readonly string[] = [
  'MEMBER_OF',
  'PLANS',
  'MEETS_AT',
  // Namespaced spelling: the grouping key compares by local name, so this must
  // group with the bare 'MEETS_AT' above.
  'core/MEETS_AT',
];

const subjectArb = fc.constantFrom<EntityId>(...SUBJECTS);

const literalArb: fc.Arbitrary<Literal> = fc.oneof(
  fc.record({ kind: fc.constant<'text'>('text'), value: fc.constantFrom('bombing', 'theft') }),
  fc.record({ kind: fc.constant<'amount'>('amount'), value: fc.constantFrom(500, 700) }),
);

const objectArb: fc.Arbitrary<EntityId | Literal> = fc.oneof(
  fc.constantFrom<EntityId>(...ENTITY_OBJECTS),
  literalArb,
);

const placeArb = fc.constantFrom<LocId | undefined>(...PLACES);
const timeArb = fc.constantFrom(T0, T1, T2);

const sourceArb = fc.constantFrom<ClaimSource>(
  { kind: 'npc', npc: 'npc:ana' },
  { kind: 'npc', npc: 'npc:boris' },
  { kind: 'document', id: 'doc:a' },
  { kind: 'intercept', id: 'int:1' },
  { kind: 'surveillance', loc: 'loc:cafe' },
);

let propCounter = 0;
function makeProp(
  subject: EntityId,
  predicate: string,
  object: EntityId | Literal,
  place: LocId | undefined,
): Proposition {
  propCounter += 1;
  return {
    id: `prop:${propCounter}`,
    subject,
    predicate,
    object,
    ...(place === undefined ? {} : { place }),
  };
}

/** An ordinary Claim: a grouped fact about a subject, with an object and place. */
const factClaimArb: fc.Arbitrary<ClaimInput> = fc
  .record({
    source: sourceArb,
    subject: subjectArb,
    predicate: fc.constantFrom(...PREDICATES),
    object: objectArb,
    place: placeArb,
    observedAt: timeArb,
    hedged: fc.boolean(),
  })
  .map(({ source, subject, predicate, object, place, observedAt, hedged }) => ({
    source,
    prop: makeProp(subject, predicate, object, place),
    observedAt,
    hedged,
  }));

/** An `IS_ALIAS_OF` Claim linking two entity ids, half the time namespaced, so
 * the resolver's pack-independence is exercised too. */
const aliasClaimArb: fc.Arbitrary<ClaimInput> = fc
  .record({
    source: sourceArb,
    subject: fc.constantFrom<EntityId>(...SUBJECTS, ...ENTITY_OBJECTS),
    object: fc.constantFrom<EntityId>(...SUBJECTS, ...ENTITY_OBJECTS),
    predicate: fc.constantFrom('IS_ALIAS_OF', 'core/IS_ALIAS_OF'),
    observedAt: timeArb,
  })
  .map(({ source, subject, object, predicate, observedAt }) => ({
    source,
    prop: makeProp(subject, predicate, object, undefined),
    observedAt,
  }));

/** A Claim set skewed towards fact Claims, with a sprinkling of alias Claims. */
const claimSetArb: fc.Arbitrary<ClaimInput[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: factClaimArb },
    { weight: 1, arbitrary: aliasClaimArb },
  ),
  { minLength: 1, maxLength: 10 },
);

/** Materialise a Claim set into real Claims via a Case File, so ids are minted
 * exactly as production does. Returns the Claims in insertion order. */
function materialise(inputs: readonly ClaimInput[]): Claim[] {
  const cf = new CaseFile();
  return inputs.map((input) => cf.add(input));
}

/** A deterministic permutation of `items` driven by a list of sort keys. */
function permute<T>(items: readonly T[], keys: readonly number[]): T[] {
  return items
    .map((item, i) => ({ item, key: keys[i] ?? i, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// An independent reference for the relation of a Claim
// ---------------------------------------------------------------------------

/** The alias-resolved signature deciding whether two Claims in a group agree:
 * their object and place, both resolved through the alias classes. Written
 * independently of `computeRelations` so it is a genuine cross-check. */
function signature(claim: Claim, canon: AliasResolver): string {
  const object = claim.prop.object;
  const objectKey =
    typeof object === 'string'
      ? `e:${canon(object)}`
      : object.kind === 'time'
        ? `w:${object.value.day}.${object.value.phase}`
        : `${object.kind}:${object.value}`;
  const placeKey = claim.prop.place === undefined ? '' : `p:${canon(claim.prop.place)}`;
  return `${objectKey}\u0000${placeKey}`;
}

/** The alias-resolved subject+predicate (local name) group key. */
function group(claim: Claim, canon: AliasResolver): string {
  const slash = claim.prop.predicate.lastIndexOf('/');
  const local =
    slash === -1 ? claim.prop.predicate : claim.prop.predicate.slice(slash + 1);
  return `${canon(claim.prop.subject)}\u0000${local.toLowerCase()}`;
}

/** A game time as a phase ordinal. */
function ord(t: { readonly day: number; readonly phase: number }): number {
  return t.day * 4 + t.phase;
}

/** Whether two Claims can be about the same moment: timeless overlaps all; a
 * `from`-only window is that one phase; otherwise `[from, to)` ranges. */
function sameMoment(a: Claim, b: Claim): boolean {
  const wa = a.prop.window;
  const wb = b.prop.window;
  if (wa === undefined || wb === undefined) {
    return true;
  }
  const [a0, a1] = [ord(wa.from), wa.to === undefined ? ord(wa.from) + 1 : ord(wa.to)];
  const [b0, b1] = [ord(wb.from), wb.to === undefined ? ord(wb.from) + 1 : ord(wb.to)];
  return a0 < b1 && b0 < a1;
}

/** The local name of a Claim's predicate. */
function local(claim: Claim): string {
  const p = claim.prop.predicate;
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * Whether `mate` agrees with / disagrees with `claim` under the design rule:
 * only Claims about the same moment bear on each other; agreement needs an
 * independent origin (HQ's Cables and Dossiers are one voice); a different
 * value contradicts only a single-valued predicate.
 */
function bearing(
  claim: Claim,
  mate: Claim,
  canon: AliasResolver,
): { readonly agrees: boolean; readonly disagrees: boolean } {
  if (!sameMoment(claim, mate)) {
    return { agrees: false, disagrees: false };
  }
  if (signature(mate, canon) === signature(claim, canon)) {
    return { agrees: originKey(mate.source) !== originKey(claim.source), disagrees: false };
  }
  return { agrees: false, disagrees: !MULTI_VALUED_PREDICATES.has(local(claim)) };
}

/** The relation each Claim should have, derived from scratch from the Claim set
 * alone — a reference implementation of the design's rule (b)+(c). */
function referenceRelations(claims: readonly Claim[]): Map<string, ClaimRelation> {
  const canon = aliasResolver(claims);
  const out = new Map<string, ClaimRelation>();
  for (const claim of claims) {
    const mates = claims.filter(
      (other) => other.id !== claim.id && group(other, canon) === group(claim, canon),
    );
    const agrees = mates.some((m) => bearing(claim, m, canon).agrees);
    const disagrees = mates.some((m) => bearing(claim, m, canon).disagrees);
    out.set(claim.id, disagrees ? 'conflicted' : agrees ? 'corroborated' : 'none');
  }
  return out;
}

// ---------------------------------------------------------------------------
// A Truth Store that varies arbitrarily, to prove non-interference
// ---------------------------------------------------------------------------

/** A fuzzed Proposition for the Truth Store, drawn from the same id pools so it
 * genuinely could agree or disagree with the Claims if the Case File ever
 * looked. */
const truthFactArb: fc.Arbitrary<Proposition> = fc
  .record({
    subject: subjectArb,
    predicate: fc.constantFrom(...PREDICATES),
    object: objectArb,
    place: placeArb,
  })
  .map(({ subject, predicate, object, place }) =>
    makeProp(subject, predicate, object, place),
  );

const npcIdArb = fc.constantFrom<NpcId>('npc:ana', 'npc:boris', 'npc:viktor');
const unkIdArb = fc.constantFrom<UnkId>('unk:1', 'unk:2', 'unk:3');

/** An arbitrary series of mutations to apply to a Truth Store. */
interface TruthMutations {
  readonly facts: readonly Proposition[];
  readonly identities: readonly (readonly [UnkId, NpcId])[];
  readonly allegiances: readonly (readonly [NpcId, Allegiance])[];
}

const truthMutationsArb: fc.Arbitrary<TruthMutations> = fc.record({
  facts: fc.array(truthFactArb, { maxLength: 6 }),
  identities: fc.array(fc.tuple(unkIdArb, npcIdArb), { maxLength: 4 }),
  allegiances: fc.array(
    fc.tuple(
      npcIdArb,
      fc.record({ org: fc.constantFrom<OrgId>('org:cell', 'org:station') }),
    ),
    { maxLength: 3 },
  ),
});

/** Apply the mutations to a store. The predicate lookup maps our predicates to
 * `fact-match` so the store is a fully working one, not a stub. */
function buildMutatedTruthStore(mutations: TruthMutations): TruthStore {
  const predicates = new Map<string, 'fact-match'>();
  for (const predicate of PREDICATES) {
    predicates.set(predicate, 'fact-match');
  }
  const store = TruthStore.create(predicates);
  for (const fact of mutations.facts) {
    store.addFact(fact);
  }
  for (const [unk, npc] of mutations.identities) {
    store.setIdentity(unk, npc);
  }
  for (const [npc, allegiance] of mutations.allegiances) {
    store.setAllegiance(npc, allegiance);
  }
  return store;
}

/** The relation of every Claim, as a plain map keyed by id, for comparison. */
function relationsById(claims: readonly Claim[]): Map<string, ClaimRelation> {
  return computeRelations(claims);
}

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: Corroboration independence (Requirement 7.4)', () => {
  it('relations depend only on the Claim set — invariant to order, Truth Store, and derivable from alias classes', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        fc.array(fc.integer(), { maxLength: 10 }),
        truthMutationsArb,
        (inputs, shuffleKeys, mutations) => {
          const claims = materialise(inputs);
          const baseline = relationsById(claims);

          // (a) Permutation invariance: any order yields the same relations.
          const shuffled = permute(claims, shuffleKeys);
          const afterShuffle = relationsById(shuffled);
          for (const claim of claims) {
            expect(afterShuffle.get(claim.id)).toBe(baseline.get(claim.id));
          }

          // (d) Truth-Store independence: build and arbitrarily mutate a Truth
          // Store, then recompute. The computation cannot see the store, so the
          // relations must be identical to the baseline.
          const store = buildMutatedTruthStore(mutations);
          // Touch the store so the mutations are real and observable, proving
          // we actually changed ground truth between the two computations.
          void store.facts();
          const afterTruthChange = relationsById(claims);
          for (const claim of claims) {
            expect(afterTruthChange.get(claim.id)).toBe(baseline.get(claim.id));
          }

          // (b)+(c) The relation of each non-alias Claim equals the independent
          // reference built from alias-resolved (subject,predicate) groups and
          // (object,place) signatures, with conflict taking precedence.
          const reference = referenceRelations(claims);
          for (const claim of claims) {
            if (isAliasPredicate(claim.prop.predicate)) {
              // Alias Claims group among themselves; the reference handles them
              // the same way computeRelations does, so this still holds, but we
              // assert it explicitly to document the intent.
              expect(baseline.get(claim.id)).toBe(reference.get(claim.id));
              continue;
            }
            expect(baseline.get(claim.id)).toBe(reference.get(claim.id));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('conflict strictly takes precedence: a Claim that both agrees and disagrees is conflicted', () => {
    fc.assert(
      fc.property(claimSetArb, (inputs) => {
        const claims = materialise(inputs);
        const relations = relationsById(claims);
        const canon = aliasResolver(claims);

        for (const claim of claims) {
          const mates = claims.filter(
            (other) =>
              other.id !== claim.id && group(other, canon) === group(claim, canon),
          );
          const agrees = mates.some((m) => bearing(claim, m, canon).agrees);
          const disagrees = mates.some((m) => bearing(claim, m, canon).disagrees);

          const relation = relations.get(claim.id);
          if (disagrees) {
            // Precedence: any disagreement makes it conflicted, even if some
            // other group-mate agrees.
            expect(relation).toBe('conflicted');
          } else if (agrees) {
            expect(relation).toBe('corroborated');
          } else {
            expect(relation).toBe('none');
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('a Truth Store that agrees with a Claim never upgrades it to corroborated', () => {
    // A sharper non-interference check: a lone Claim with no Case File group-mate
    // stays `none` even when the Truth Store holds exactly that fact. If the
    // computation ever consulted ground truth, this is where it would show.
    fc.assert(
      fc.property(factClaimArb, (input) => {
        const claims = materialise([input]);
        const [claim] = claims;
        expect(relationsById(claims).get(claim.id)).toBe('none');

        const predicates = new Map<string, 'fact-match'>([
          [claim.prop.predicate, 'fact-match'],
        ]);
        const store = TruthStore.create(predicates);
        store.addFact(claim.prop);
        // The store now holds the Claim's own fact; a leak would read it.
        expect(store.holds(claim.prop, claim.observedAt)).toBe(true);

        // Relation is still `none`: the lone Claim has no Case File corroborator.
        expect(relationsById(claims).get(claim.id)).toBe('none');
      }),
      { numRuns: 200 },
    );
  });
});
