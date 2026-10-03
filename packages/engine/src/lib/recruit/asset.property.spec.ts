/**
 * Property 32 — Asset report filtering (task 18.8; Requirements 10.4, 10.6).
 *
 * The design states Property 32 as:
 *
 * > **Property 32: Asset report filtering.** For any Asset, access profile,
 * > reliability and PRNG state, every Proposition in a collect result concerns
 * > an entity within the Asset's access. Every undistorted result from a
 * > non-hostile-controlled Asset holds in the Truth Store, and a
 * > hostile-controlled Asset returns only Propositions from the Hostile
 * > Service's feed selection.
 *
 * `asset.spec.ts` (task 18.1) already covers `reportFacts` / `factInAccess` /
 * `distortProposition` by example; this is the dedicated Property-32 file,
 * sweeping fast-check-generated candidate sets, access reaches, reliabilities
 * and PRNG seeds through the pure {@link reportFacts}.
 *
 * The hostile-controlled-feed half of the design statement is the Hostile
 * Service's job (a later slice replaces the feed before `reportFacts` is
 * reached), so `reportFacts` itself reports honestly from the given access.
 * This file holds the engine-level invariants of that pure core — the ones the
 * function alone is responsible for:
 *
 * - **(access)** every reported Proposition is within the Asset's access
 *   (`factInAccess` holds for it under the same membership lookup) — a distorted
 *   fact's swapped subject stays inside the Asset's own `access.npcs`, so the
 *   report never names an out-of-access entity (Req 10.6);
 * - **(cap)** at most {@link MAX_REPORTED_PROPS} Propositions are returned;
 * - **(determinism)** a given PRNG seed fully determines the report (Req 10.4 —
 *   results come from ground truth through a seeded, reproducible draw);
 * - **(reliability 1)** a perfectly reliable Asset reports every in-access
 *   candidate verbatim, in order, up to the cap, with no distortion;
 * - **(reliability 0)** a zero-reliability Asset reports nothing;
 * - **(subset of ground truth)** every undistorted reported fact is one of the
 *   in-access candidates it was given (the honest, non-hostile case of the
 *   design's "holds in the Truth Store" clause).
 *
 * Test-only — it touches no production source.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPrng } from '../prng/prng.js';
import {
  asTruth,
  type EntityId,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
  type Truth,
} from '../model/core.js';
import {
  factInAccess,
  reportFacts,
  MAX_REPORTED_PROPS,
  type AssetAccess,
  type AssetProfile,
  type OrgMembershipLookup,
} from './asset.js';

// ---------------------------------------------------------------------------
// The fixed small universe the generators draw from
// ---------------------------------------------------------------------------
//
// A handful of people, Locations and orgs is enough to make the access filter
// non-vacuous — generated candidates land both inside and outside the reach —
// while keeping each run tiny for CI. The Asset's access is always drawn as a
// subset of these pools, and candidate facts reference the same pools (plus a
// deliberate out-of-access "stranger"/"elsewhere" so some facts are rejected).

const NPCS = ['npc:a', 'npc:b', 'npc:c', 'npc:d', 'npc:e'] as NpcId[];
const LOCS = ['loc:cafe', 'loc:dock', 'loc:park'] as LocId[];
const ORGS = ['org:cell', 'org:firm'] as OrgId[];

const STRANGER = 'npc:stranger' as NpcId;
const ELSEWHERE = 'loc:elsewhere' as LocId;

/**
 * A membership lookup over a generated membership table. The table maps a
 * subject id to the set of orgs it belongs to; the lookup answers from it. Pure
 * and deterministic, so it does not perturb the report's PRNG stream.
 */
function lookupFrom(
  table: ReadonlyMap<EntityId, ReadonlySet<OrgId>>,
): OrgMembershipLookup {
  return (subject, org) => table.get(subject)?.has(org) ?? false;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A subset (possibly empty) of a pool, as a de-duplicated array. */
function subsetArb<T>(pool: readonly T[]): fc.Arbitrary<T[]> {
  return fc
    .uniqueArray(fc.constantFrom(...pool), { maxLength: pool.length })
    .map((xs) => [...xs]);
}

/** An Asset's access reach: subsets of the three pools. */
const accessArb: fc.Arbitrary<AssetAccess> = fc.record({
  locs: subsetArb(LOCS),
  orgs: subsetArb(ORGS),
  npcs: subsetArb(NPCS),
});

/**
 * A candidate ground-truth fact. Its subject is drawn from the people pool plus
 * the out-of-access stranger; its object is either an entity (a person or the
 * stranger) or a text literal; its place is a pool Location, the out-of-access
 * `elsewhere`, or absent. The spread of reaches means a generated candidate set
 * reliably contains both in-access and out-of-access facts for a given access.
 */
function candidateArb(index: number): fc.Arbitrary<Truth<Proposition>> {
  const entity = fc.constantFrom<EntityId>(...NPCS, STRANGER);
  const object = fc.oneof(
    entity,
    fc.record({ kind: fc.constant('text' as const), value: fc.string() }),
  );
  const place = fc.option(fc.constantFrom(...LOCS, ELSEWHERE), {
    nil: undefined,
  });
  return fc
    .record({
      subject: fc.constantFrom<EntityId>(...NPCS, STRANGER),
      object,
      place,
    })
    .map(({ subject, object: obj, place: pl }) =>
      asTruth<Proposition>({
        id: `c${index}`,
        subject,
        predicate: 'LOCATED_AT',
        object: obj,
        ...(pl === undefined ? {} : { place: pl }),
      }),
    );
}

/** A list of 0..8 candidate facts, each with a distinct id. */
const candidatesArb: fc.Arbitrary<Truth<Proposition>[]> = fc
  .nat({ max: 8 })
  .chain((n) =>
    n === 0
      ? fc.constant<Truth<Proposition>[]>([])
      : fc.tuple(...Array.from({ length: n }, (_, i) => candidateArb(i))),
  );

/** A membership table over the universe: each subject gets a subset of orgs. */
const membershipArb: fc.Arbitrary<ReadonlyMap<EntityId, ReadonlySet<OrgId>>> = fc
  .array(
    fc.tuple(
      fc.constantFrom<EntityId>(...NPCS, STRANGER),
      subsetArb(ORGS),
    ),
    { maxLength: NPCS.length + 1 },
  )
  .map((pairs) => {
    const table = new Map<EntityId, Set<OrgId>>();
    for (const [subject, orgs] of pairs) {
      table.set(subject, new Set(orgs));
    }
    return table;
  });

/** A reliability value, biased to include the exact [0, 1] extremes. */
const reliabilityArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constantFrom(0, 1), weight: 1 },
  { arbitrary: fc.double({ min: 0, max: 1, noNaN: true }), weight: 3 },
);

/** A PRNG seed string. */
const seedArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 12 });

function profileFor(access: AssetAccess, reliability: number): AssetProfile {
  return {
    access: asTruth(access),
    reliability: asTruth(reliability),
    turned: false,
    hostileControlled: asTruth(false),
  };
}

const NUM_RUNS = 300;

// ---------------------------------------------------------------------------
// Property 32
// ---------------------------------------------------------------------------

describe('Property 32: Asset report filtering', () => {
  it('reports only facts within the Asset access (distorted subjects stay in reach)', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        reliabilityArb,
        membershipArb,
        seedArb,
        (candidates, access, reliability, members, seed) => {
          const lookup = lookupFrom(members);
          const report = reportFacts(
            candidates,
            profileFor(access, reliability),
            lookup,
            createPrng(seed),
          );
          for (const fact of report) {
            expect(factInAccess(fact, access, lookup)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns at most MAX_REPORTED_PROPS Propositions', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        reliabilityArb,
        membershipArb,
        seedArb,
        (candidates, access, reliability, members, seed) => {
          const report = reportFacts(
            candidates,
            profileFor(access, reliability),
            lookupFrom(members),
            createPrng(seed),
          );
          expect(report.length).toBeLessThanOrEqual(MAX_REPORTED_PROPS);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic for a given PRNG seed', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        reliabilityArb,
        membershipArb,
        seedArb,
        (candidates, access, reliability, members, seed) => {
          const lookup = lookupFrom(members);
          const profile = profileFor(access, reliability);
          const a = reportFacts(candidates, profile, lookup, createPrng(seed));
          const b = reportFacts(candidates, profile, lookup, createPrng(seed));
          expect(a).toEqual(b);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports every in-access candidate verbatim, in order, up to the cap at reliability 1', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        membershipArb,
        seedArb,
        (candidates, access, members, seed) => {
          const lookup = lookupFrom(members);
          const report = reportFacts(
            candidates,
            profileFor(access, 1),
            lookup,
            createPrng(seed),
          );
          const expected = candidates
            .filter((fact) => factInAccess(fact, access, lookup))
            .slice(0, MAX_REPORTED_PROPS)
            // revealTruth is the identity at runtime; strip the brand for the
            // structural compare against the (unbranded) reported facts.
            .map((fact) => fact as Proposition);
          expect(report).toEqual(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports nothing at reliability 0', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        membershipArb,
        seedArb,
        (candidates, access, members, seed) => {
          const report = reportFacts(
            candidates,
            profileFor(access, 0),
            lookupFrom(members),
            createPrng(seed),
          );
          expect(report).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('every undistorted reported fact is one of the in-access candidates', () => {
    fc.assert(
      fc.property(
        candidatesArb,
        accessArb,
        reliabilityArb,
        membershipArb,
        seedArb,
        (candidates, access, reliability, members, seed) => {
          const lookup = lookupFrom(members);
          const report = reportFacts(
            candidates,
            profileFor(access, reliability),
            lookup,
            createPrng(seed),
          );
          const inAccessIds = new Set(
            candidates
              .filter((fact) => factInAccess(fact, access, lookup))
              .map((fact) => (fact as Proposition).id),
          );
          for (const fact of report) {
            // A distorted fact carries the `~distort` suffix and a swapped
            // subject; an undistorted one must be an in-access candidate as-is.
            if (!fact.id.endsWith('~distort')) {
              expect(inAccessIds.has(fact.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
