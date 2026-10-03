/**
 * Property 11: Recruitment and pressure determinism (task 18.4).
 *
 * **Validates: Requirements 6.4, 10.2**
 *
 * The design states (Correctness Property 11): "For any NPC, relationship,
 * lever, evidence set and PRNG state, `resolvePitch` and `pressureCheck` return
 * identical results on repeat calls." Both are pure functions of their inputs
 * and the PRNG state: the same NPC, Relationship, lever/offer/weights (pitch) or
 * evidence (pressure) and the *same* PRNG state must always produce an identical
 * outcome, and each draws the coin exactly once.
 *
 * This spec generates many NPCs, Relationships, levers, offers, weights,
 * evidence sets and PRNG seeds/states with fast-check, and asserts:
 *
 * 1. **Determinism.** Called twice from the same cloned PRNG state,
 *    `resolvePitch` yields a deep-equal {@link PitchOutcome} and `pressureCheck`
 *    yields the same {@link CoverState}.
 * 2. **Single draw.** Each call advances the PRNG by exactly one `next()` step —
 *    re-running from a cloned state and advancing it one step leaves the PRNG in
 *    the same state the call did, so the coin is drawn once and only once.
 * 3. **Probability.** The drawless `pitchProbability`/`pressureProbability` are
 *    deterministic (equal on repeat) and land in `[0, 1]`.
 * 4. **State sensitivity.** Advancing the PRNG one step before the call can
 *    change the outcome (the result tracks the PRNG state, not a constant) —
 *    checked across the sample rather than per-case, since any single draw may
 *    coincide.
 *
 * Everything is built directly from the leaf shapes (`pressureCheck`/
 * `resolvePitch` read only a handful of fields), mirroring `pitch.spec.ts` and
 * `pressure.spec.ts`. The run counts are bounded for CI.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPrng, type PrngState } from '../prng/prng.js';
import {
  asTruth,
  type NpcId,
  type OrgId,
  type Proposition,
} from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import {
  MICE_LEVERS,
  newRelationship,
  type MiceLever,
  type Relationship,
} from './asset.js';
import {
  resolvePitch,
  pitchProbability,
  type PitchWeights,
} from './pitch.js';
import { pressureCheck, pressureProbability } from './pressure.js';

// ---------------------------------------------------------------------------
// Bounded run counts for CI
// ---------------------------------------------------------------------------

const RUNS = 300;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A unit-interval real, kept well-conditioned (no NaN/Infinity). */
const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** A MICE profile with every lever strength in `[0, 1]`. */
const miceArb: fc.Arbitrary<MiceProfile> = fc.record({
  money: unit,
  ideology: unit,
  coercion: unit,
  ego: unit,
});

/** One MICE lever. */
const leverArb: fc.Arbitrary<MiceLever> = fc.constantFrom(...MICE_LEVERS);

/** A money offer, including 0 and larger-than-need amounts. */
const offerArb = fc.integer({ min: 0, max: 5000 });

/** The four pitch weights, in a plausible positive range. */
const weightsArb: fc.Arbitrary<PitchWeights> = fc.record({
  w1: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w2: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w3: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w4: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
});

/** An NPC with the ground-truth and view-adjacent fields the primitives read. */
const npcArb: fc.Arbitrary<Npc> = fc
  .record({
    mice: miceArb,
    moneyNeed: fc.integer({ min: 0, max: 5000 }),
    reliability: unit,
    tradecraft: unit,
    securityConsciousness: unit,
    openness: unit,
    wariness: unit,
  })
  .map(
    (f) =>
      ({
        id: 'npc:target' as NpcId,
        archetype: 'core/civilian',
        role: 'civilian',
        trueAllegiance: asTruth({ org: 'org:x' as OrgId }),
        apparentAllegiance: 'neutral',
        mice: asTruth(f.mice),
        moneyNeed: asTruth(f.moneyNeed),
        reliability: asTruth(f.reliability),
        tradecraft: asTruth(f.tradecraft),
        securityConsciousness: asTruth(f.securityConsciousness),
        persona: {
          name: 'A B',
          given: 'A',
          family: 'B',
          library: 'core/test',
          culture: 'test',
          gender: 'female',
          voiceTraits: [],
          mannerisms: [],
          background: 'x',
          openness: f.openness,
        },
        descriptor: { summary: 's', phrases: [], pools: [] },
        schedule: { entries: [] },
        wariness: f.wariness,
      }) as Npc,
  );

/** A Relationship with arbitrary trust/suspicion/exposure, cover and recruited flag. */
const relArb: fc.Arbitrary<Relationship> = fc
  .record({
    trust: unit,
    suspicion: unit,
    exposure: unit,
    coverState: fc.constantFrom(
      'intact' as const,
      'strained' as const,
      'cracking' as const,
      'blown' as const,
    ),
    recruited: fc.boolean(),
  })
  .map((f) => ({
    ...newRelationship('npc:target' as NpcId),
    trust: f.trust,
    suspicion: f.suspicion,
    exposure: f.exposure,
    coverState: f.coverState,
    recruited: f.recruited,
  }));

/** A set of contradicting-Claim Propositions; only the count affects the maths. */
const evidenceArb: fc.Arbitrary<Proposition[]> = fc
  .integer({ min: 0, max: 6 })
  .map((n) =>
    Array.from(
      { length: n },
      (_, i) =>
        ({
          id: `prop:e${i}`,
          predicate: 'core/WORKS_FOR',
          subject: 'npc:target' as NpcId,
          object: 'org:x' as OrgId,
        }) as unknown as Proposition,
    ),
  );

/** A serialisable PRNG state, taken from an arbitrary seed string. */
const prngStateArb: fc.Arbitrary<PrngState> = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((seed) => createPrng(seed).state());

// ---------------------------------------------------------------------------
// resolvePitch determinism (Property 11; Req 10.2)
// ---------------------------------------------------------------------------

describe('Property 11: resolvePitch determinism', () => {
  it('returns a deep-equal outcome on repeat calls from the same PRNG state', () => {
    fc.assert(
      fc.property(
        npcArb,
        relArb,
        leverArb,
        offerArb,
        weightsArb,
        prngStateArb,
        (npc, rel, lever, offer, weights, state) => {
          const a = resolvePitch(npc, rel, lever, offer, weights, createPrng(state));
          const b = resolvePitch(npc, rel, lever, offer, weights, createPrng(state));
          expect(b).toEqual(a);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('draws the coin exactly once (advances the PRNG one step)', () => {
    fc.assert(
      fc.property(
        npcArb,
        relArb,
        leverArb,
        offerArb,
        weightsArb,
        prngStateArb,
        (npc, rel, lever, offer, weights, state) => {
          const rng = createPrng(state);
          resolvePitch(npc, rel, lever, offer, weights, rng);
          const probe = createPrng(state);
          probe.next();
          expect(rng.state()).toEqual(probe.state());
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('reports a deterministic probability in [0, 1]', () => {
    fc.assert(
      fc.property(npcArb, relArb, leverArb, offerArb, weightsArb, (npc, rel, lever, offer, weights) => {
        const p1 = pitchProbability(npc, rel, lever, offer, weights);
        const p2 = pitchProbability(npc, rel, lever, offer, weights);
        expect(p2).toBe(p1);
        expect(p1).toBeGreaterThanOrEqual(0);
        expect(p1).toBeLessThanOrEqual(1);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// pressureCheck determinism (Property 11; Req 6.4)
// ---------------------------------------------------------------------------

describe('Property 11: pressureCheck determinism', () => {
  it('returns the same cover state on repeat calls from the same PRNG state', () => {
    fc.assert(
      fc.property(npcArb, relArb, evidenceArb, prngStateArb, (npc, rel, evidence, state) => {
        const a = pressureCheck(npc, rel, evidence, createPrng(state));
        const b = pressureCheck(npc, rel, evidence, createPrng(state));
        expect(b).toBe(a);
      }),
      { numRuns: RUNS },
    );
  });

  it('draws the coin exactly once (advances the PRNG one step)', () => {
    fc.assert(
      fc.property(npcArb, relArb, evidenceArb, prngStateArb, (npc, rel, evidence, state) => {
        const rng = createPrng(state);
        pressureCheck(npc, rel, evidence, rng);
        const probe = createPrng(state);
        probe.next();
        expect(rng.state()).toEqual(probe.state());
      }),
      { numRuns: RUNS },
    );
  });

  it('reports a deterministic probability in [0, 1]', () => {
    fc.assert(
      fc.property(npcArb, relArb, evidenceArb, (npc, rel, evidence) => {
        const p1 = pressureProbability(npc, rel, evidence.length);
        const p2 = pressureProbability(npc, rel, evidence.length);
        expect(p2).toBe(p1);
        expect(p1).toBeGreaterThanOrEqual(0);
        expect(p1).toBeLessThanOrEqual(1);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// PRNG-state sensitivity (the outcome tracks the state, not a constant)
// ---------------------------------------------------------------------------

describe('Property 11: outcomes track the PRNG state', () => {
  it('different PRNG states can yield different pitch verdicts', () => {
    // A middling pitch so both a hit and a miss are reachable; sweeping PRNG
    // states shows the verdict tracks the state rather than a constant.
    const weights: PitchWeights = { w1: 4, w2: 2, w3: 3, w4: 2 };
    const verdicts = new Set<boolean>();
    for (let i = 0; i < 200 && verdicts.size < 2; i += 1) {
      const base = createPrng(`sensitivity-${i}`);
      const npcFixture = sampleNpc(0.5);
      const rel = { ...newRelationship('npc:target' as NpcId), trust: 0.5 };
      const out = resolvePitch(npcFixture, rel, 'ideology', 0, weights, base);
      verdicts.add(out.accepted);
    }
    // Across many PRNG states the verdict is not pinned to a single value.
    expect(verdicts.size).toBe(2);
  });

  it('different PRNG states can yield different pressure results', () => {
    const states = new Set<string>();
    for (let i = 0; i < 200 && states.size < 2; i += 1) {
      const rng = createPrng(`pressure-sensitivity-${i}`);
      const npc = sampleNpc(0);
      const rel = { ...newRelationship('npc:target' as NpcId), trust: 1, coverState: 'strained' as const };
      states.add(pressureCheck(npc, rel, evidenceOf(2), rng));
    }
    expect(states.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Small helpers for the deterministic sensitivity sweep
// ---------------------------------------------------------------------------

/** A fixed NPC with a given composure, for the sensitivity sweeps. */
function sampleNpc(composure: number): Npc {
  const mice: MiceProfile = { money: 0.5, ideology: 0.5, coercion: 0.5, ego: 0.5 };
  return {
    id: 'npc:target' as NpcId,
    archetype: 'core/civilian',
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:x' as OrgId }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice),
    moneyNeed: asTruth(1000),
    reliability: asTruth(0.7),
    tradecraft: asTruth(composure),
    securityConsciousness: asTruth(composure),
    persona: {
      name: 'A B',
      given: 'A',
      family: 'B',
      library: 'core/test',
      culture: 'test',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: 'x',
      openness: 0.5,
    },
    descriptor: { summary: 's', phrases: [], pools: [] },
    schedule: { entries: [] },
    wariness: 0.3,
  } as Npc;
}

/** `n` contradicting-Claim Propositions (shape only; count is what matters). */
function evidenceOf(n: number): Proposition[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `prop:e${i}`,
        predicate: 'core/WORKS_FOR',
        subject: 'npc:target' as NpcId,
        object: 'org:x' as OrgId,
      }) as unknown as Proposition,
  );
}
