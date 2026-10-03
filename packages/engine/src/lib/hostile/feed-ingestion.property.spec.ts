/**
 * Property 30: Feed ingestion (task 19.7).
 *
 * **Validates: Requirements 37.3, 37.4**
 *
 * The design states (Correctness Property 30): "For any Hostile Service state,
 * turned agent, feed and Truth Store:
 *
 * - `ingestFeed` is deterministic;
 * - each Proposition is classified as Chickenfeed if and only if it holds in
 *   the Truth Store at delivery;
 * - a confirmed Proposition never lowers the agent's credibility, and a refuted
 *   one never raises it;
 * - a Proposition is adopted if and only if it is unverifiable and credibility
 *   meets the adoption threshold."
 *
 * This spec sweeps `ingestFeed` with fast-check over arbitrary belief models,
 * deliveries and doctrines and pins each clause as a bounded property:
 *
 * 1. **Determinism** — the same `(beliefs, delivery, doctrine, at)` always
 *    yields a deep-equal result (the leaf is a pure function; no draws).
 * 2. **Classification** — `classes[i] === 'chickenfeed'` iff `items[i].holdsInTruth`.
 * 3. **Credibility monotonicity** — a confirm-only feed never lowers the agent's
 *    credibility; a refute-only feed never raises it and never lowers its agent
 *    suspicion. Both are checked against the agent's seeded starting credibility.
 * 4. **Clamping** — the agent's credibility and suspicion stay in `[0, 1]`.
 * 5. **Adoption threshold** — every adopted Proposition is an *unverifiable*
 *    item (neither confirmed nor refuted), and when nothing was adopted the
 *    starting credibility is below the doctrine threshold; adoption only ever
 *    happens at a point where the running credibility meets the threshold.
 * 6. **Dedupe** — the adopted list and the belief model carry no duplicate
 *    belief keys.
 *
 * Construction mirrors the example-based sibling `ingest-feed.spec.ts` (the
 * `prop` / `item` / `delivery` helpers) and the hostile property specs' bounded
 * `numRuns` convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  ChannelId,
  EntityId,
  GameTime,
  NpcId,
  Proposition,
} from '../model/core.js';
import type { Doctrine } from './doctrine.js';
import {
  emptyHostileBeliefs,
  beliefKey,
  type HostileBeliefs,
} from './beliefs.js';
import {
  ingestFeed,
  adoptionThreshold,
  CONFIRM_CREDIBILITY,
  REFUTE_CREDIBILITY,
  type FedProposition,
  type FeedDelivery,
} from './ingest-feed.js';

// ---------------------------------------------------------------------------
// Bounded run count for CI
// ---------------------------------------------------------------------------

const RUNS = 300;

const AT: GameTime = { day: 5, phase: 1 };
const AGENT = 'npc:double' as NpcId;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A unit-interval real, well-conditioned (no NaN/Infinity). */
const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** A `KNOWS(station, object)` Proposition keyed by its object id. */
function prop(object: string): Proposition {
  return {
    id: `prop:${object}`,
    subject: 'org:station' as EntityId,
    predicate: 'core/KNOWS',
    object: object as EntityId,
  };
}

/**
 * A pool of distinct Proposition objects. Drawing items from a small pool makes
 * duplicate belief keys *likely* across a feed, so the dedupe property is
 * actually exercised rather than hoped for.
 */
const OBJECTS = ['npc:a', 'npc:b', 'npc:c', 'npc:d', 'chan:plot'] as const;
const propArb: fc.Arbitrary<Proposition> = fc
  .constantFrom(...OBJECTS)
  .map((o) => prop(o));

/** A doctrine; only `securityConsciousness` steers adoption, but all three vary. */
const doctrineArb: fc.Arbitrary<Doctrine> = fc.record({
  riskTolerance: unit,
  securityConsciousness: unit,
  deceptionAppetite: unit,
});

/**
 * A fed item with independent holds/confirm/refute reads. `confirmed` and
 * `refuted` are allowed to co-occur (a degenerate caller) so the leaf's fixed
 * confirm-then-refute order is swept too; the adoption clause excludes any item
 * that is confirmed or refuted, so a both-set item is never adopted regardless.
 */
const itemArb: fc.Arbitrary<FedProposition> = fc.record({
  prop: propArb,
  holdsInTruth: fc.boolean(),
  confirmed: fc.boolean(),
  refuted: fc.boolean(),
});

/** 0–6 fed items in delivery order. */
const itemsArb: fc.Arbitrary<readonly FedProposition[]> = fc.array(itemArb, {
  minLength: 0,
  maxLength: 6,
});

/** A delivery for the fixed agent, with an arbitrary (possibly out-of-range) prior trust. */
const deliveryArb: fc.Arbitrary<FeedDelivery> = fc.record({
  agent: fc.constant(AGENT),
  items: itemsArb,
  priorTrust: fc.double({ min: -0.5, max: 1.5, noNaN: true, noDefaultInfinity: true }),
});

/**
 * A starting belief model: empty, or one where the agent already has a running
 * credibility and/or suspicion (so the seed-ignored path is swept too).
 */
const beliefsArb: fc.Arbitrary<HostileBeliefs> = fc.oneof(
  fc.constant(emptyHostileBeliefs()),
  fc.record({ credibility: unit, suspicion: unit }).map(({ credibility, suspicion }) => ({
    ...emptyHostileBeliefs(),
    credibility: { [AGENT]: credibility },
    agentSuspicion: { [AGENT]: suspicion },
  })),
);

/** A confirm-only item (never refuted); still varies holds and the Proposition. */
const confirmOnlyItemArb: fc.Arbitrary<FedProposition> = fc.record({
  prop: propArb,
  holdsInTruth: fc.boolean(),
  confirmed: fc.boolean(),
  refuted: fc.constant(false),
});

/** A refute-only item (never confirmed). */
const refuteOnlyItemArb: fc.Arbitrary<FedProposition> = fc.record({
  prop: propArb,
  holdsInTruth: fc.boolean(),
  confirmed: fc.constant(false),
  refuted: fc.boolean(),
});

/** The agent's seeded starting credibility for a given beliefs + delivery. */
function startingCredibility(beliefs: HostileBeliefs, delivery: FeedDelivery): number {
  const existing = beliefs.credibility[delivery.agent];
  if (existing !== undefined) {
    return existing;
  }
  const t = delivery.priorTrust;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The agent's starting suspicion. */
function startingSuspicion(beliefs: HostileBeliefs): number {
  return beliefs.agentSuspicion[AGENT] ?? 0;
}

// ---------------------------------------------------------------------------
// 1. Determinism (Property 30)
// ---------------------------------------------------------------------------

describe('Property 30: ingestFeed is deterministic (Req 37.3, 37.4)', () => {
  it('returns a deep-equal result for the same (beliefs, delivery, doctrine)', () => {
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const a = ingestFeed(beliefs, delivery, doctrine, AT);
        const b = ingestFeed(beliefs, delivery, doctrine, AT);
        expect(b).toEqual(a);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Classification (Req 37.3)
// ---------------------------------------------------------------------------

describe('Property 30: classification matches holdsInTruth (Req 37.3)', () => {
  it('classes[i] === chickenfeed iff items[i].holdsInTruth, in delivery order', () => {
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const { classes } = ingestFeed(beliefs, delivery, doctrine, AT);
        expect(classes).toHaveLength(delivery.items.length);
        delivery.items.forEach((item, i) => {
          expect(classes[i]).toBe(item.holdsInTruth ? 'chickenfeed' : 'deception');
        });
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Credibility monotonicity (Req 37.4)
// ---------------------------------------------------------------------------

describe('Property 30: credibility monotonicity (Req 37.4)', () => {
  it('a confirm-only feed never lowers the agent credibility', () => {
    fc.assert(
      fc.property(
        beliefsArb,
        fc.array(confirmOnlyItemArb, { minLength: 0, maxLength: 6 }),
        fc.double({ min: -0.5, max: 1.5, noNaN: true, noDefaultInfinity: true }),
        doctrineArb,
        (beliefs, items, priorTrust, doctrine) => {
          const delivery: FeedDelivery = { agent: AGENT, items, priorTrust };
          const start = startingCredibility(beliefs, delivery);
          const result = ingestFeed(beliefs, delivery, doctrine, AT);
          expect(result.beliefs.credibility[AGENT]).toBeGreaterThanOrEqual(start);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('a refute-only feed never raises the agent credibility and never lowers suspicion', () => {
    fc.assert(
      fc.property(
        beliefsArb,
        fc.array(refuteOnlyItemArb, { minLength: 0, maxLength: 6 }),
        fc.double({ min: -0.5, max: 1.5, noNaN: true, noDefaultInfinity: true }),
        doctrineArb,
        (beliefs, items, priorTrust, doctrine) => {
          const delivery: FeedDelivery = { agent: AGENT, items, priorTrust };
          const startCred = startingCredibility(beliefs, delivery);
          const startSusp = startingSuspicion(beliefs);
          const result = ingestFeed(beliefs, delivery, doctrine, AT);
          expect(result.beliefs.credibility[AGENT]).toBeLessThanOrEqual(startCred);
          expect(result.beliefs.agentSuspicion[AGENT]).toBeGreaterThanOrEqual(startSusp);
          // A refute present ⇒ suspicion strictly rose (until clamped at 1).
          if (items.some((i) => i.refuted) && startSusp < 1) {
            expect(result.beliefs.agentSuspicion[AGENT]).toBeGreaterThan(startSusp);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Clamping to [0, 1] (Req 37.4)
// ---------------------------------------------------------------------------

describe('Property 30: credibility and suspicion stay in [0, 1] (Req 37.4)', () => {
  it('keeps the agent credibility and suspicion within [0, 1]', () => {
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const result = ingestFeed(beliefs, delivery, doctrine, AT);
        const cred = result.beliefs.credibility[AGENT];
        const susp = result.beliefs.agentSuspicion[AGENT];
        expect(cred).toBeGreaterThanOrEqual(0);
        expect(cred).toBeLessThanOrEqual(1);
        expect(susp).toBeGreaterThanOrEqual(0);
        expect(susp).toBeLessThanOrEqual(1);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Adoption threshold rule (Req 37.4)
// ---------------------------------------------------------------------------

describe('Property 30: adoption obeys the doctrine threshold (Req 37.4)', () => {
  it('every adopted Proposition is an unverifiable item (neither confirmed nor refuted)', () => {
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const result = ingestFeed(beliefs, delivery, doctrine, AT);
        const adoptedKeys = new Set(result.adopted.map(beliefKey));
        // The only keys that could be adopted are those of unverifiable items.
        const unverifiableKeys = new Set(
          delivery.items
            .filter((i) => !i.confirmed && !i.refuted)
            .map((i) => beliefKey(i.prop)),
        );
        for (const key of adoptedKeys) {
          expect(unverifiableKeys.has(key)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('adopts nothing when the running credibility never reaches the threshold', () => {
    // Replay the leaf's own running credibility and assert: an item is in the
    // adopted set iff it is unverifiable, its running credibility meets the
    // threshold, and its key had not already been adopted (dedupe).
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const result = ingestFeed(beliefs, delivery, doctrine, AT);
        const threshold = adoptionThreshold(doctrine);

        const adoptedKeys = new Set(result.adopted.map(beliefKey));
        const expected = new Set<string>();
        const already = new Set<string>(beliefs.adoptedKeys);
        let cred = startingCredibility(beliefs, delivery);
        const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

        for (const item of delivery.items) {
          if (item.confirmed) {
            cred = clamp(cred + CONFIRM_CREDIBILITY);
          }
          if (item.refuted) {
            cred = clamp(cred - REFUTE_CREDIBILITY);
          }
          if (!item.confirmed && !item.refuted && cred >= threshold) {
            const key = beliefKey(item.prop);
            if (!already.has(key)) {
              expected.add(key);
              already.add(key);
            }
          }
        }

        expect([...adoptedKeys].sort()).toEqual([...expected].sort());
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Dedupe — adopted carries no duplicate belief keys (Req 37.4)
// ---------------------------------------------------------------------------

describe('Property 30: adoption is deduped once per belief key (Req 37.4)', () => {
  it('the adopted list and the belief model hold no duplicate belief keys', () => {
    fc.assert(
      fc.property(beliefsArb, deliveryArb, doctrineArb, (beliefs, delivery, doctrine) => {
        const result = ingestFeed(beliefs, delivery, doctrine, AT);
        const adoptedKeys = result.adopted.map(beliefKey);
        expect(new Set(adoptedKeys).size).toBe(adoptedKeys.length);
        // The belief model's own key list is also distinct.
        const modelKeys = result.beliefs.adoptedKeys;
        expect(new Set(modelKeys).size).toBe(modelKeys.length);
        // compromisedChannels returned this ingestion are distinct too.
        const chans = result.compromisedChannels as readonly ChannelId[];
        expect(new Set(chans).size).toBe(chans.length);
      }),
      { numRuns: RUNS },
    );
  });
});
