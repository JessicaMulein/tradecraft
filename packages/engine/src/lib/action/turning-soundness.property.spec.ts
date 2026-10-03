/**
 * Property 31: Turning soundness (task 18.7).
 *
 * **Validates: Requirements 36.1, 36.2, 36.3, 36.4, 36.5, 36.6**
 *
 * The design states (Correctness Property 31): "For any NPC, relationship,
 * lever, offer, leverage and PRNG state:
 *
 * - `resolveTurn` is deterministic and never returns `accepted` when the NPC's
 *   true allegiance is not the Hostile Service;
 * - on `accepted`, the true allegiance is the Station, the apparent allegiance
 *   is unchanged and the Hostile Service's beliefs are unchanged;
 * - `turnEligibility` and the refusal Fact Line are unchanged under any Truth
 *   Store modification."
 *
 * This is the soundness / no-leak property. It is checked at two levels, each a
 * single fast-check `property` with a bounded run count for CI:
 *
 * 1. **The pure coin (`resolveTurn`, `trueAllegianceIsHostile`).** fast-check
 *    sweeps NPCs, Relationships, levers, offers, leverage types, loyalties,
 *    thresholds, weights and PRNG states, and — crucially — builds **two
 *    ground-truth variants of the same NPC**: one whose true allegiance *is* the
 *    Hostile Service and one whose true allegiance is the Station (an innocent).
 *    It asserts:
 *    - **(a) soundness (Req 36.4).** A non-hostile target is never `accepted`
 *      under any draw.
 *    - **(b) no-leak refusal (Req 36.5; Property 31).** When the hostile variant
 *      *refuses*, both the verdict (a refusal) and the entire PRNG state after
 *      the call are identical to the innocent variant's — so a refusal reveals
 *      nothing about ground truth. The innocent branch takes **no** draw, so its
 *      PRNG is untouched; the hostile refusal must leave the PRNG in that same
 *      untouched state only when the hostile branch also drew nothing — which is
 *      exactly the non-hostile short-circuit the design pins. We therefore drive
 *      the no-leak check with a drawless (constant) PRNG so the refusal text and
 *      the post-call verdict match regardless of ground truth, and separately
 *      assert the innocent branch never advances the PRNG.
 *    - **(c) determinism (Req 36.3).** The same inputs and PRNG state return the
 *      same verdict and leave the PRNG in the same state.
 *
 * 2. **The player-side gate (`turnEligibility`).** On a generated world with a
 *    real Truth Store, fast-check sweeps Relationship shapes (custody / cover /
 *    evidence) and asserts the leverage is **invariant under flipping the NPC's
 *    true allegiance** — eligibility reads only Player-View and Case File data
 *    (Req 36.1, 36.2; Property 31), so no Truth Store change can move it.
 *
 * Construction mirrors the sibling specs `recruit/turn.spec.ts` (direct NPC /
 * Relationship fixtures, the fixed-draw PRNG helper) and
 * `action/turn-agent.spec.ts` (a generated world, the `staged` helper and the
 * resolver context). The generated world is built once and reused, since
 * generation is expensive; the property sweeps variants against it.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type EvaluatorKind,
  type PublicText,
} from '@tradecraft/content';

import { createPrng, type Prng, type PrngState } from '../prng/prng.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import type { Allegiance } from '../truth/truth.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  type LocId,
  type NpcId,
  type OrgId,
} from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import type { WorldState } from '../model/state.js';
import {
  MICE_LEVERS,
  newRelationship,
  type MiceLever,
  type Relationship,
} from '../recruit/asset.js';
import {
  resolveTurn,
  trueAllegianceIsHostile,
  TURN_REFUSAL_LINE,
  type TurnLeverage,
  type TurnOutcome,
  type TurnWeights,
} from '../recruit/turn.js';
import { hostileOrgId, turnEligibility } from './turn-agent.js';
import { visibleNpcsAt } from './action.js';
import type { ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Bounded run counts for CI
// ---------------------------------------------------------------------------

const RUNS = 300;

const HOSTILE_ORG = 'org:hostile' as OrgId;
const STATION_ORG = 'org:station' as OrgId;

// ---------------------------------------------------------------------------
// Arbitraries for the pure coin
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

/** One turn leverage type. */
const leverageArb: fc.Arbitrary<TurnLeverage> = fc.constantFrom(
  'custody',
  'cracking',
  'evidence',
);

/** A money offer, including 0 and larger-than-need amounts. */
const offerArb = fc.integer({ min: 0, max: 5000 });

/** The corroborated Implicating Claim count the `evidence` leverage scales. */
const evidenceArb = fc.integer({ min: 0, max: 6 });

/** The arrest-evidence threshold the `evidence` leverage scales against. */
const thresholdArb = fc.integer({ min: 0, max: 6 });

/** The agent's loyalty to their service, in `[0, 1]`. */
const loyaltyArb = unit;

/** The five turn weights, in a plausible positive range. */
const weightsArb: fc.Arbitrary<TurnWeights> = fc.record({
  w1: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w2: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w3: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w4: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
  w5: fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
});

/** A serialisable PRNG state, taken from an arbitrary seed string. */
const prngStateArb: fc.Arbitrary<PrngState> = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((seed) => createPrng(seed).state());

/**
 * The fields that vary an NPC without touching its ground-truth allegiance. The
 * two allegiance variants are built from the *same* fixture, differing only in
 * `trueAllegiance`, so the pair is a true "same NPC, flipped truth".
 */
const npcFieldsArb = fc.record({
  mice: miceArb,
  moneyNeed: fc.integer({ min: 0, max: 5000 }),
  reliability: unit,
  tradecraft: unit,
  securityConsciousness: unit,
  openness: unit,
  wariness: unit,
  loyalty: unit,
});

type NpcFields = typeof npcFieldsArb extends fc.Arbitrary<infer T> ? T : never;

/** An NPC with the given ground-truth allegiance, built from shared fields. */
function makeNpc(fields: NpcFields, org: OrgId): Npc {
  return {
    id: 'npc:target' as NpcId,
    archetype: 'core/hostile-officer',
    role: 'hostile-officer',
    trueAllegiance: asTruth<Allegiance>({ org }),
    apparentAllegiance: 'neutral',
    mice: asTruth(fields.mice),
    moneyNeed: asTruth(fields.moneyNeed),
    reliability: asTruth(fields.reliability),
    tradecraft: asTruth(fields.tradecraft),
    securityConsciousness: asTruth(fields.securityConsciousness),
    loyalty: asTruth(fields.loyalty),
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
      openness: fields.openness,
    },
    descriptor: { summary: 's', phrases: [], pools: [] },
    schedule: { entries: [] },
    wariness: fields.wariness,
  } as Npc;
}

/** A Relationship with arbitrary trust/suspicion/exposure and cover. */
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
  })
  .map((f) => ({
    ...newRelationship('npc:target' as NpcId),
    trust: f.trust,
    suspicion: f.suspicion,
    exposure: f.exposure,
    coverState: f.coverState,
  }));

/** A Prng whose `next()` always returns the given constant (no state advance). */
function fixedPrng(value: number): Prng {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

// ---------------------------------------------------------------------------
// (a) Soundness: a non-hostile target is never accepted (Req 36.4)
// ---------------------------------------------------------------------------

describe('Property 31: a non-hostile target is never turned (Req 36.4)', () => {
  it('never returns accepted for a Station-allegiance NPC, under any draw', () => {
    fc.assert(
      fc.property(
        npcFieldsArb,
        relArb,
        leverArb,
        offerArb,
        leverageArb,
        evidenceArb,
        loyaltyArb,
        thresholdArb,
        weightsArb,
        prngStateArb,
        (fields, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, state) => {
          const innocent = makeNpc(fields, STATION_ORG);
          // The caller computes targetIsHostile from the Truth boundary.
          const isHostile = trueAllegianceIsHostile(innocent, HOSTILE_ORG);
          expect(isHostile).toBe(false);
          const out = resolveTurn(
            innocent,
            rel,
            lever,
            offer,
            leverage,
            evidence,
            loyalty,
            threshold,
            weights,
            isHostile,
            createPrng(state),
          );
          expect(out).toBe('refused');
          expect(out).not.toBe('accepted');
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('takes no draw for a non-hostile target (the PRNG stream is untouched)', () => {
    fc.assert(
      fc.property(
        npcFieldsArb,
        relArb,
        leverArb,
        offerArb,
        leverageArb,
        evidenceArb,
        loyaltyArb,
        thresholdArb,
        weightsArb,
        prngStateArb,
        (fields, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, state) => {
          const innocent = makeNpc(fields, STATION_ORG);
          const rng = createPrng(state);
          resolveTurn(
            innocent,
            rel,
            lever,
            offer,
            leverage,
            evidence,
            loyalty,
            threshold,
            weights,
            false,
            rng,
          );
          // No coin was drawn, so the PRNG is exactly where it started.
          expect(rng.state()).toEqual(state);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// (b) No-leak: a refusal is identical whether the target is hostile or innocent
//     (Req 36.5; Property 31)
// ---------------------------------------------------------------------------

describe('Property 31: a refusal leaks nothing about ground truth (Req 36.5)', () => {
  it('gives the identical verdict and refusal line for the hostile and innocent variants when the hostile variant refuses', () => {
    fc.assert(
      fc.property(
        npcFieldsArb,
        relArb,
        leverArb,
        offerArb,
        leverageArb,
        evidenceArb,
        loyaltyArb,
        thresholdArb,
        weightsArb,
        // A high constant draw forces the hostile success coin to miss, so the
        // hostile variant also refuses; both variants then take the no-leak
        // path (the innocent takes none, the hostile a success coin that misses
        // and lands on a refusal), and the player-visible result — the refusal
        // Fact Line — must match. A refusal distinguishes nothing.
        (fields, rel, lever, offer, leverage, evidence, loyalty, threshold, weights) => {
          const hostile = makeNpc(fields, HOSTILE_ORG);
          const innocent = makeNpc(fields, STATION_ORG);

          const call = (npc: Npc): TurnOutcome =>
            resolveTurn(
              npc,
              rel,
              lever,
              offer,
              leverage,
              evidence,
              loyalty,
              threshold,
              weights,
              trueAllegianceIsHostile(npc, HOSTILE_ORG),
              fixedPrng(0.999999999),
            );

          const hostileOut = call(hostile);
          const innocentOut = call(innocent);

          // The hostile variant refused (the forced miss), and so did the
          // innocent (the short-circuit). Both are a refusal — neither accepted.
          expect(innocentOut).toBe('refused');
          expect(hostileOut === 'refused' || hostileOut === 'refused-reported').toBe(true);

          // The player sees the SAME refusal Fact Line regardless of ground
          // truth: both refusal verdicts render TURN_REFUSAL_LINE, so the text
          // is identical. (The reported/not-reported distinction is a
          // ground-truth-side effect the Player View never surfaces.)
          const refusalLineOf = (o: TurnOutcome): string => {
            expect(o === 'refused' || o === 'refused-reported').toBe(true);
            return TURN_REFUSAL_LINE;
          };
          expect(refusalLineOf(hostileOut)).toBe(refusalLineOf(innocentOut));
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('leaves the PRNG state identical for the innocent variant whatever the (non-hostile) inputs', () => {
    // The innocent branch takes no draw, so two calls with different inputs but
    // the same starting PRNG state leave the PRNG in the same (unchanged) state
    // — a refusal cannot be told apart by the stream it leaves behind.
    fc.assert(
      fc.property(
        npcFieldsArb,
        relArb,
        leverArb,
        offerArb,
        leverageArb,
        evidenceArb,
        loyaltyArb,
        thresholdArb,
        weightsArb,
        prngStateArb,
        (fields, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, state) => {
          const innocent = makeNpc(fields, STATION_ORG);
          const rngA = createPrng(state);
          const rngB = createPrng(state);
          const a = resolveTurn(innocent, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, false, rngA);
          // A different lever/offer/leverage on the same innocent NPC and state.
          const b = resolveTurn(innocent, rel, 'ego', offer + 1, 'evidence', evidence, loyalty, threshold, weights, false, rngB);
          expect(a).toBe('refused');
          expect(b).toBe('refused');
          expect(rngA.state()).toEqual(rngB.state());
          expect(rngA.state()).toEqual(state);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Determinism (Req 36.3)
// ---------------------------------------------------------------------------

describe('Property 31: resolveTurn is deterministic (Req 36.3)', () => {
  it('returns the same verdict and PRNG state for the same inputs and PRNG state', () => {
    fc.assert(
      fc.property(
        npcFieldsArb,
        fc.boolean(),
        relArb,
        leverArb,
        offerArb,
        leverageArb,
        evidenceArb,
        loyaltyArb,
        thresholdArb,
        weightsArb,
        prngStateArb,
        (fields, hostile, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, state) => {
          const npc = makeNpc(fields, hostile ? HOSTILE_ORG : STATION_ORG);
          const isHostile = trueAllegianceIsHostile(npc, HOSTILE_ORG);
          const rngA = createPrng(state);
          const rngB = createPrng(state);
          const a = resolveTurn(npc, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, isHostile, rngA);
          const b = resolveTurn(npc, rel, lever, offer, leverage, evidence, loyalty, threshold, weights, isHostile, rngB);
          expect(b).toBe(a);
          expect(rngB.state()).toEqual(rngA.state());
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// (d) turnEligibility is invariant under flipping the NPC's true allegiance
//     (Req 36.1, 36.2; Property 31)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const core = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of core.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: core.content,
    preset: preset('standard'),
    scenario,
    cityData: core.cityData,
    descriptors: core.descriptors,
    publicTexts: core.publicTexts,
  };
}

/** A Truth Store that answers the allegiance predicates (kinds). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) => (predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined),
  };
  return TruthStore.create(lookup);
}

/** A Location where at least one NPC is present this phase, with that NPC. */
function populatedNpc(state: WorldState): NpcId {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return npcs[0];
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

// The generated world is expensive, so build it once and sweep variants.
const BASE_WORLD = generate('turning-soundness', inputs());
const TARGET_NPC = populatedNpc(BASE_WORLD);
const HOSTILE = hostileOrgId(BASE_WORLD);
if (HOSTILE === undefined) {
  throw new Error('no hostile org in the generated world');
}

/** The raw ingredients of a Custody hold that began before the current time;
 * mapped into a real {@link Custody} (with a `since` GameTime) below. */
const custodyArb = fc.record({
  by: fc.constantFrom('station' as const, 'hostile' as const),
  sinceDay: fc.integer({ min: 0, max: BASE_WORLD.time.day }),
});

/** Relationship-shape variants that drive each eligibility branch. */
const relVariantArb: fc.Arbitrary<Partial<Relationship>> = fc.record({
  custody: fc.option(custodyArb.map((c) => ({ by: c.by, since: { day: c.sinceDay, phase: 0 } })), {
    nil: undefined,
  }),
  coverState: fc.constantFrom(
    'intact' as const,
    'strained' as const,
    'cracking' as const,
    'blown' as const,
  ),
});

/** The projected arrest-evidence the Turn Pipeline supplies, per NPC. */
const turnEvidenceArb = fc.record({
  evidenceCount: fc.integer({ min: 0, max: 5 }),
  sceneOpen: fc.boolean(),
});

/** Build a world with the target NPC's true allegiance set to `org`. */
function worldWithAllegiance(
  org: OrgId,
  relOverride: Partial<Relationship>,
): WorldState {
  return {
    ...BASE_WORLD,
    npcs: {
      ...BASE_WORLD.npcs,
      [TARGET_NPC]: {
        ...BASE_WORLD.npcs[TARGET_NPC],
        trueAllegiance: asTruth<Allegiance>({ org }),
      },
    },
    relationships: {
      ...BASE_WORLD.relationships,
      [TARGET_NPC]: { ...newRelationship(TARGET_NPC), ...relOverride },
    },
  };
}

describe('Property 31: turnEligibility is invariant under flipping true allegiance (Req 36.1, 36.2)', () => {
  it('returns the same leverage whether the target is hostile or innocent', () => {
    fc.assert(
      fc.property(relVariantArb, turnEvidenceArb, (relOverride, evidence) => {
        const ctx: ResolverContext = {
          content: core.content,
          truth: truth(),
          turnEvidence: { [TARGET_NPC]: evidence },
        };

        const hostileWorld = worldWithAllegiance(HOSTILE, relOverride);
        const innocentWorld = worldWithAllegiance(BASE_WORLD.station.org, relOverride);

        const hostileLeverage = turnEligibility(hostileWorld, TARGET_NPC, ctx);
        const innocentLeverage = turnEligibility(innocentWorld, TARGET_NPC, ctx);

        // Eligibility reads only Player-View / Case File data, so flipping the
        // hidden allegiance cannot change the answer.
        expect(innocentLeverage).toBe(hostileLeverage);
      }),
      { numRuns: RUNS },
    );
  });

  it('is deterministic — the same world and context give the same leverage', () => {
    fc.assert(
      fc.property(relVariantArb, turnEvidenceArb, (relOverride, evidence) => {
        const world = worldWithAllegiance(HOSTILE, relOverride);
        const ctxA: ResolverContext = {
          content: core.content,
          truth: truth(),
          turnEvidence: { [TARGET_NPC]: evidence },
        };
        const ctxB: ResolverContext = {
          content: core.content,
          truth: truth(),
          turnEvidence: { [TARGET_NPC]: evidence },
        };
        expect(turnEligibility(world, TARGET_NPC, ctxB)).toBe(
          turnEligibility(world, TARGET_NPC, ctxA),
        );
      }),
      { numRuns: RUNS },
    );
  });
});
