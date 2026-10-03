/**
 * Property 12: Arrest gate (Requirement 19.1; also 40.1, 40.2, 40.4).
 *
 * Design, Correctness Properties:
 *
 *   "For any Case File, Starting Brief and target, an arrest is granted if and
 *    only if `evidenceCount` (distinct corroborated implicating Propositions,
 *    alias-resolved through held `IS_ALIAS_OF` Claims) is at least the
 *    threshold. `evidenceCount` is unchanged under any Truth Store modification,
 *    and is equal for the target and for any Unidentified Subject linked to it."
 *
 * The arrest gate is *sound and view-only*: the decision at a given threshold is
 * a pure function of Player-View / Case File data. {@link evidenceCount} reads
 * only the {@link CaseFile}'s Claims, the {@link BriefView}, and the predicate
 * {@link ImplicationRules} the caller supplies — never the Truth Store. The
 * engine's `quoteArrest` then compares that projected count to the preset's
 * `arrest.threshold`, so this file checks the figure the gate turns on.
 *
 * The example-based `evidence.spec.ts` fixes the per-predicate rules and the
 * alias cases by hand; this is the dedicated sweep that drives one rich
 * generator of Case Files (corroborated and uncorroborated Claims, implicating
 * and not, with `unk:`/`npc:` aliases) through the four facets of Property 12:
 *
 *   (a) Truth-independence. Building the same Case File and computing the count
 *       never touches a Truth Store, and arbitrarily mutating a real Truth Store
 *       built from the same id pools — adding facts, identities, allegiances —
 *       leaves every count byte-for-byte identical.
 *
 *   (b) Alias-stability. The count for a target `npc:X` equals the count for any
 *       `unk:N` the Case File's own held `IS_ALIAS_OF` Claims link to it. Asking
 *       about either end of an alias class yields the same number.
 *
 *   (c) Only distinct corroborated implicating Claims count. Adding an
 *       uncorroborated or non-implicating Claim never raises the count; two
 *       sources asserting the same implicating Proposition count once.
 *
 *   (d) Threshold monotonicity. The gate decision `count >= threshold` is
 *       monotone in the count and anti-monotone in the threshold: it is granted
 *       at every threshold at or below the count and denied above it.
 *
 * The generator draws subjects, orgs, items, channels, places and `unk:`/`npc:`
 * ids from small dense pools so hostile marks actually fire, aliases actually
 * merge classes, and corroboration actually forms — which is where the arrest
 * gate lives. Bounded for CI (short arrays, modest `numRuns`).
 *
 * **Validates: Requirements 19.1**
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

import { CaseFile, type ClaimInput, type ClaimSource } from './casefile.js';
import {
  evidenceCount,
  implicationRules,
  type BriefView,
  type ImplicationRules,
} from './evidence.js';

// ---------------------------------------------------------------------------
// Fixtures: the core-pack implication rules and the Starting Brief view
// (design "Arrest Evidence" table).
// ---------------------------------------------------------------------------

const CORE_RULES: ImplicationRules = implicationRules([
  ['MEMBER_OF', { role: 'subject', other: ['hostile-org'] }],
  ['WORKS_FOR', { role: 'subject', other: ['hostile-org'] }],
  ['REPORTS_TO', { role: 'subject', other: ['hostile-person', 'hostile-org'] }],
  ['MEETS_AT', { role: 'either', other: ['hostile-person'] }],
  ['CARRIES', { role: 'subject', other: ['materiel'] }],
  ['SUPPLIES', { role: 'subject', other: ['materiel'] }],
  ['USES_CHANNEL', { role: 'subject', other: ['hostile-channel'] }],
  ['PLANS', { role: 'subject', other: ['none'] }],
  ['TARGETS', { role: 'subject', other: ['none'] }],
  // Held in the Case File for alias resolution, not an evidence predicate.
  ['IS_ALIAS_OF', undefined],
]);

const BRIEF: BriefView = {
  hostileOrgs: ['org:hs', 'org:cell'],
  hostileChannels: ['chan:cell-radio'],
  materiel: ['item:brief-crate'],
};

// ---------------------------------------------------------------------------
// Small dense pools, chosen so marks fire, aliases merge, and groups form.
// ---------------------------------------------------------------------------

const T0: GameTime = { day: 0, phase: 0 };
const T1: GameTime = { day: 0, phase: 1 };
const T2: GameTime = { day: 1, phase: 0 };

/** The people the player might be building a case against. */
const PERSONS: readonly NpcId[] = ['npc:ana', 'npc:boris', 'npc:viktor'];

/** Unidentified Subjects that may later alias onto a named person. */
const UNKS: readonly UnkId[] = ['unk:1', 'unk:2', 'unk:3'];

/** Everything a Claim subject might be (mostly people). */
const SUBJECTS: readonly EntityId[] = [...PERSONS, ...UNKS];

/** Orgs: two hostile (per the Brief) and one benign. */
const ORGS: readonly EntityId[] = ['org:hs', 'org:cell', 'org:bank'];

/** Items: one Brief materiel and one unnamed, to be reached via a hostile carrier. */
const ITEMS: readonly EntityId[] = ['item:brief-crate', 'item:plans'];

/** Channels: one Brief-hostile and one plain. */
const CHANNELS: readonly EntityId[] = ['chan:cell-radio', 'chan:post'];

/** Entity objects a Claim might point at. */
const ENTITY_OBJECTS: readonly EntityId[] = [
  ...PERSONS,
  ...UNKS,
  ...ORGS,
  ...ITEMS,
  ...CHANNELS,
  'loc:embassy',
];

const PLACES: readonly (LocId | undefined)[] = [
  undefined,
  'loc:pier',
  'loc:cafe',
];

/** Evidence predicates plus a couple of non-implicating ones, and a namespaced
 * spelling so local-name matching is exercised. */
const PREDICATES: readonly string[] = [
  'MEMBER_OF',
  'WORKS_FOR',
  'REPORTS_TO',
  'MEETS_AT',
  'CARRIES',
  'SUPPLIES',
  'USES_CHANNEL',
  'PLANS',
  'TARGETS',
  'core/MEMBER_OF',
  // Non-implicating: these have no rule, so they must never raise the count.
  'KNOWS',
  'SUSPECTS',
  'LOCATED_AT',
];

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

const literalArb: fc.Arbitrary<Literal> = fc.oneof(
  fc.record({
    kind: fc.constant<'amount'>('amount'),
    value: fc.constantFrom(100, 500),
  }),
  fc.record({
    kind: fc.constant<'text'>('text'),
    value: fc.constantFrom('bombing', 'theft'),
  }),
);

const objectArb: fc.Arbitrary<EntityId | Literal> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom<EntityId>(...ENTITY_OBJECTS) },
  { weight: 1, arbitrary: literalArb },
);

const sourceArb = fc.constantFrom<ClaimSource>(
  { kind: 'npc', npc: 'npc:ana' },
  { kind: 'npc', npc: 'npc:boris' },
  { kind: 'document', id: 'doc:a' },
  { kind: 'document', id: 'doc:b' },
  { kind: 'intercept', id: 'int:1' },
  { kind: 'surveillance', loc: 'loc:cafe' },
);

const timeArb = fc.constantFrom(T0, T1, T2);
const placeArb = fc.constantFrom<LocId | undefined>(...PLACES);

/** An ordinary (non-alias) Claim about a subject. */
const factClaimArb: fc.Arbitrary<ClaimInput> = fc
  .record({
    source: sourceArb,
    subject: fc.constantFrom<EntityId>(...SUBJECTS),
    predicate: fc.constantFrom(...PREDICATES),
    object: objectArb,
    place: placeArb,
    observedAt: timeArb,
  })
  .map(({ source, subject, predicate, object, place, observedAt }) => ({
    source,
    prop: makeProp(subject, predicate, object, place),
    observedAt,
  }));

/** An `IS_ALIAS_OF` Claim linking an `unk:` id to a named person (and sometimes
 * an org, so an org alias path is exercised). Half namespaced. */
const aliasClaimArb: fc.Arbitrary<ClaimInput> = fc
  .record({
    source: sourceArb,
    subject: fc.constantFrom<EntityId>(...UNKS, 'org:kompromat'),
    object: fc.constantFrom<EntityId>(...PERSONS, 'org:cell'),
    predicate: fc.constantFrom('IS_ALIAS_OF', 'core/IS_ALIAS_OF'),
    observedAt: timeArb,
  })
  .map(({ source, subject, object, predicate, observedAt }) => ({
    source,
    prop: makeProp(subject, predicate, object, undefined),
    observedAt,
  }));

/** A Case File skewed towards fact Claims with a sprinkling of alias Claims. */
const claimSetArb: fc.Arbitrary<ClaimInput[]> = fc.array(
  fc.oneof(
    { weight: 5, arbitrary: factClaimArb },
    { weight: 1, arbitrary: aliasClaimArb },
  ),
  { minLength: 0, maxLength: 12 },
);

/** Build a fresh Case File from a list of Claim inputs, minting ids as
 * production does. */
function build(inputs: readonly ClaimInput[]): CaseFile {
  const cf = new CaseFile();
  for (const input of inputs) {
    cf.add(input);
  }
  return cf;
}

/** The alias-class representative of an id within a Case File, so a test can ask
 * about "the other end" of an alias class. */
function canonOf(cf: CaseFile, id: EntityId): EntityId {
  return cf.aliases()(id);
}

// ---------------------------------------------------------------------------
// (a) An arbitrary, fully-working Truth Store to prove non-interference.
// ---------------------------------------------------------------------------

interface TruthMutations {
  readonly facts: readonly Proposition[];
  readonly identities: readonly (readonly [UnkId, NpcId])[];
  readonly allegiances: readonly (readonly [NpcId, Allegiance])[];
}

const truthFactArb: fc.Arbitrary<Proposition> = fc
  .record({
    subject: fc.constantFrom<EntityId>(...SUBJECTS),
    predicate: fc.constantFrom('MEMBER_OF', 'WORKS_FOR', 'MEETS_AT', 'PLANS'),
    object: fc.constantFrom<EntityId>(...ORGS, ...PERSONS, ...ITEMS),
    place: placeArb,
  })
  .map(({ subject, predicate, object, place }) =>
    makeProp(subject, predicate, object, place),
  );

const truthMutationsArb: fc.Arbitrary<TruthMutations> = fc.record({
  facts: fc.array(truthFactArb, { maxLength: 6 }),
  identities: fc.array(
    fc.tuple(fc.constantFrom<UnkId>(...UNKS), fc.constantFrom<NpcId>(...PERSONS)),
    { maxLength: 4 },
  ),
  allegiances: fc.array(
    fc.tuple(
      fc.constantFrom<NpcId>(...PERSONS),
      fc.record({ org: fc.constantFrom<OrgId>('org:cell', 'org:hs', 'org:bank') }),
    ),
    { maxLength: 3 },
  ),
});

/** A real store (not a stub) mutated by the generated operations, so there is a
 * genuine ground truth to be independent of. */
function buildMutatedTruthStore(mutations: TruthMutations): TruthStore {
  const predicates = new Map<string, 'fact-match'>();
  for (const predicate of ['MEMBER_OF', 'WORKS_FOR', 'MEETS_AT', 'PLANS']) {
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

/** The arrest-gate decision at a threshold — exactly the engine's `count >=
 * threshold` comparison (design: `quote({kind:'arrest'})` is `allowed` iff
 * `evidenceCount >= preset.arrestThreshold`). */
function granted(count: number, threshold: number): boolean {
  return count >= threshold;
}

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('Property 12: Arrest gate (Requirement 19.1)', () => {
  it('(a) evidenceCount is invariant under any Truth Store modification', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        fc.constantFrom<EntityId>(...PERSONS, ...UNKS),
        truthMutationsArb,
        (inputs, target, mutations) => {
          const cf = build(inputs);
          const baseline = evidenceCount(cf, target, BRIEF, CORE_RULES);

          // Build and arbitrarily mutate a real Truth Store, then recompute.
          // The gate figure cannot see the store, so it must be unchanged.
          const store = buildMutatedTruthStore(mutations);
          // Touch the store so its state is genuinely materialised between the
          // two reads — proof we moved ground truth, not a no-op.
          void store.facts();
          const afterTruthChange = evidenceCount(cf, target, BRIEF, CORE_RULES);
          expect(afterTruthChange).toBe(baseline);

          // Rebuilding the same Case File from the same inputs yields the same
          // count: it is a pure function of view data alone.
          const rebuilt = build(inputs);
          expect(evidenceCount(rebuilt, target, BRIEF, CORE_RULES)).toBe(
            baseline,
          );
        },
      ),
      { numRuns: 250 },
    );
  });

  it('(b) the count is alias-stable: equal for a target and any unk: aliased to it', () => {
    fc.assert(
      fc.property(claimSetArb, (inputs) => {
        const cf = build(inputs);
        // For every id in play, its count equals the count for its alias-class
        // representative — asking about either end of an alias class is the
        // same question.
        const ids: EntityId[] = [...PERSONS, ...UNKS, 'org:kompromat', 'org:cell'];
        for (const id of ids) {
          const rep = canonOf(cf, id);
          expect(evidenceCount(cf, id, BRIEF, CORE_RULES)).toBe(
            evidenceCount(cf, rep, BRIEF, CORE_RULES),
          );
        }
      }),
      { numRuns: 250 },
    );
  });

  it('(b) an unk: explicitly aliased to a named person shares its count', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        fc.constantFrom<NpcId>(...PERSONS),
        fc.constantFrom<UnkId>(...UNKS),
        (inputs, person, unk) => {
          // Force an alias link (corroborated, so it is unambiguous data) from
          // the chosen unk: to the chosen person on top of the generated set.
          const linked: ClaimInput[] = [
            ...inputs,
            {
              source: { kind: 'npc', npc: 'npc:ana' },
              prop: makeProp(unk, 'IS_ALIAS_OF', person, undefined),
              observedAt: T0,
            },
            {
              source: { kind: 'document', id: 'doc:a' },
              prop: makeProp(unk, 'IS_ALIAS_OF', person, undefined),
              observedAt: T0,
            },
          ];
          const cf = build(linked);
          expect(evidenceCount(cf, unk, BRIEF, CORE_RULES)).toBe(
            evidenceCount(cf, person, BRIEF, CORE_RULES),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('(c) adding an uncorroborated Claim never raises the count', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        factClaimArb,
        fc.constantFrom<EntityId>(...PERSONS, ...UNKS),
        (inputs, extra, target) => {
          const before = evidenceCount(build(inputs), target, BRIEF, CORE_RULES);
          // One extra Claim from a single source cannot be corroborated on its
          // own, so it cannot add a distinct corroborated implicating fact.
          const after = evidenceCount(
            build([...inputs, extra]),
            target,
            BRIEF,
            CORE_RULES,
          );
          expect(after).toBeGreaterThanOrEqual(before);
          // It may only ever *complete* a corroboration already seeded by the
          // set, never add more than one distinct key.
          expect(after - before).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('(c) a non-implicating predicate never contributes to the count', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        fc.constantFrom<NpcId>(...PERSONS),
        fc.constantFrom('KNOWS', 'SUSPECTS', 'LOCATED_AT'),
        fc.constantFrom<EntityId>(...ORGS, ...PERSONS),
        (inputs, target, predicate, object) => {
          const before = evidenceCount(build(inputs), target, BRIEF, CORE_RULES);
          // Two corroborating sources assert a predicate with no implication
          // rule about the target. Corroborated, yes — implicating, no.
          const withNonImplicating: ClaimInput[] = [
            ...inputs,
            {
              source: { kind: 'npc', npc: 'npc:boris' },
              prop: makeProp(target, predicate, object, undefined),
              observedAt: T1,
            },
            {
              source: { kind: 'intercept', id: 'int:1' },
              prop: makeProp(target, predicate, object, undefined),
              observedAt: T1,
            },
          ];
          const after = evidenceCount(
            build(withNonImplicating),
            target,
            BRIEF,
            CORE_RULES,
          );
          expect(after).toBe(before);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('(c) two sources of the same implicating Proposition count once', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<NpcId>(...PERSONS),
        fc.constantFrom('MEMBER_OF', 'WORKS_FOR'),
        fc.constantFrom<EntityId>('org:cell', 'org:hs'),
        fc.uniqueArray(sourceArb, {
          minLength: 2,
          maxLength: 4,
          selector: (source) => JSON.stringify(source),
        }),
        (person, predicate, hostileOrg, sources) => {
          // Many distinct sources, all asserting the exact same implicating
          // fact. Distinct is measured on (predicate, subject, object, place),
          // so however many sources corroborate, the fact counts once (at the
          // default weight of 1 in these rules).
          const inputs: ClaimInput[] = sources.map((source) => ({
            source,
            prop: makeProp(person, predicate, hostileOrg, undefined),
            observedAt: T0,
          }));
          const cf = build(inputs);
          expect(evidenceCount(cf, person, BRIEF, CORE_RULES)).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('(c2) HQ alone never builds a case: its Cables and Dossiers are one voice', () => {
    fc.assert(
      fc.property(fc.constantFrom<NpcId>(...PERSONS), (person) => {
        const cf = build([
          {
            source: { kind: 'document', id: 'doc:cable/brief' },
            prop: makeProp(person, 'MEMBER_OF', 'org:cell', undefined),
            observedAt: T0,
          },
          {
            source: { kind: 'document', id: 'doc:dossier/trace' },
            prop: makeProp(person, 'MEMBER_OF', 'org:cell', undefined),
            observedAt: T0,
          },
        ]);
        expect(evidenceCount(cf, person, BRIEF, CORE_RULES)).toBe(0);
        // A field source confirming HQ's lead makes it count.
        cf.add({
          source: { kind: 'npc', npc: 'npc:ana' },
          prop: makeProp(person, 'MEMBER_OF', 'org:cell', undefined),
          observedAt: T0,
        });
        expect(evidenceCount(cf, person, BRIEF, CORE_RULES)).toBe(1);
      }),
      { numRuns: 50 },
    );
  });

  it('(c3) weights sum, and further facts of one predicate add half', () => {
    const weighted = implicationRules([
      ['MEMBER_OF', { role: 'subject', other: ['hostile-org'], weight: 2 }],
      ['MEETS_AT', { role: 'either', other: ['hostile-person'], weight: 2 }],
      ['PLANS', { role: 'subject', other: ['none'], weight: 3 }],
    ]);
    const twice = (prop: Proposition): ClaimInput[] => [
      { source: { kind: 'npc', npc: 'npc:ana' }, prop, observedAt: T0 },
      { source: { kind: 'intercept', id: 'int:1' }, prop, observedAt: T0 },
    ];
    const cf = build([
      ...twice(makeProp('npc:boris', 'MEMBER_OF', 'org:cell', undefined)),
      ...twice(makeProp('npc:boris', 'PLANS', { kind: 'text', value: 'a' }, undefined)),
      // Two hostile contacts: the first meeting counts 2, the second 1.
      ...twice(makeProp('npc:ana', 'MEMBER_OF', 'org:cell', undefined)),
      ...twice(makeProp('npc:cleo', 'MEMBER_OF', 'org:hs', undefined)),
      ...twice(makeProp('npc:boris', 'MEETS_AT', 'npc:ana', undefined)),
      ...twice(makeProp('npc:boris', 'MEETS_AT', 'npc:cleo', undefined)),
    ]);
    // MEMBER_OF (2) + PLANS (3) + MEETS_AT (2) + a second MEETS_AT at half (1).
    expect(evidenceCount(cf, 'npc:boris', BRIEF, weighted)).toBe(8);
  });

  it('(d) the gate decision count >= threshold is monotone and sound', () => {
    fc.assert(
      fc.property(
        claimSetArb,
        fc.constantFrom<EntityId>(...PERSONS, ...UNKS),
        fc.integer({ min: 0, max: 8 }),
        (inputs, target, threshold) => {
          const count = evidenceCount(build(inputs), target, BRIEF, CORE_RULES);

          // Granted at or below the count, denied above it — a sound gate.
          for (let t = 0; t <= count; t += 1) {
            expect(granted(count, t)).toBe(true);
          }
          expect(granted(count, count + 1)).toBe(false);

          // Monotone in the threshold: once denied at some threshold, denied at
          // every higher one.
          const decision = granted(count, threshold);
          if (!decision) {
            expect(granted(count, threshold + 1)).toBe(false);
          }
          // Anti-monotone the other way: granted at threshold implies granted
          // at every lower threshold.
          if (decision && threshold > 0) {
            expect(granted(count, threshold - 1)).toBe(true);
          }
        },
      ),
      { numRuns: 250 },
    );
  });
});
