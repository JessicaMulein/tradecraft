/**
 * The recruitment pitch primitive (design, "Recruitment": `resolvePitch`;
 * Requirements 10.1, 10.2, 10.5, 28.5).
 *
 * `resolvePitch` is the pure coin the pitch Intent draws: it decides whether an
 * NPC accepts a recruitment pitch pressed on a given MICE lever. The design
 * writes the success probability as
 *
 *     σ(w₁·leverMatch + w₂·trust − w₃·suspicion − w₄·exposureRisk + persona)
 *
 * where `σ` is the logistic function (shared with `firstContact`), the `{w₁..w₄}`
 * are the scenario config's `recruitment.pitch` weights, `trust`, `suspicion`
 * and `exposureRisk` are read off the player↔NPC {@link Relationship}, `persona`
 * is the NPC's sampled sociability (`persona.openness`, the same view-safe field
 * the Cold Approach reads), and `leverMatch` grades how well the pressed lever
 * matches the NPC's hidden MICE profile (Req 10.1 — susceptibility is the hidden
 * MICE profile).
 *
 * **Money offer scaling (Req 28.5; design, "Station, Directives and Budget": the
 * money pitch lever term is `leverMatch × min(1, amount / npc.moneyNeed)`).**
 * For a `money` pitch the raw lever match is scaled down by how far the offered
 * amount falls short of the NPC's money need: a full-need offer leaves it
 * untouched, half-need halves it, and anything at or above the need is capped at
 * the full match. A `0` need (an NPC money does not move at all) scales to `0`.
 * The other three levers (ideology, coercion, ego) take no offer and use the
 * bare lever strength.
 *
 * The success is drawn against the runtime PRNG exactly once: the NPC accepts
 * iff `rng.next() < p`. The same NPC, Relationship, lever, offer, weights and
 * PRNG state therefore always yield the same {@link PitchOutcome} (design,
 * Property 11 — recruitment determinism).
 *
 * This module is a dependency-light **leaf** beside `first-contact.ts`: it owns
 * `resolvePitch`, the pure `leverMatch`/`pitchProbability` scorers it draws
 * against, and the `moneyOfferScale` helper. It imports only the NPC and
 * Relationship shapes, the Truth brand (to read the hidden MICE profile and
 * money need) and the PRNG — never the Action Resolver — so it forms no import
 * cycle. Reading a `Truth`-branded field here is deliberate: `resolvePitch` is a
 * Sim operation that decides an outcome from ground truth; only its result (the
 * `PitchOutcome`) crosses toward the Player View.
 */

import { revealTruth } from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import type { Prng } from '../prng/prng.js';
import { sigmoid } from './first-contact.js';
import type { MiceLever, Relationship } from './asset.js';

// ---------------------------------------------------------------------------
// Pitch weights (Req 10.2)
// ---------------------------------------------------------------------------

/**
 * The `recruitment.pitch` coefficients the σ formula uses (design: the scenario
 * config's `pitch` weights). `w1` scales the lever match, `w2` the trust, `w3`
 * the suspicion, `w4` the Exposure risk.
 */
export interface PitchWeights {
  readonly w1: number;
  readonly w2: number;
  readonly w3: number;
  readonly w4: number;
}

// ---------------------------------------------------------------------------
// leverMatch and the money offer scaling (Req 10.1, 28.5)
// ---------------------------------------------------------------------------

/**
 * The strength of one MICE lever on an NPC: the matching field of the NPC's
 * hidden MICE profile, in `[0, 1]`. A `money` lever reads `mice.money`, and so
 * on. This is the *bare* match, before any money-offer scaling.
 */
export function leverStrength(mice: MiceProfile, lever: MiceLever): number {
  switch (lever) {
    case 'money':
      return mice.money;
    case 'ideology':
      return mice.ideology;
    case 'coercion':
      return mice.coercion;
    case 'ego':
      return mice.ego;
  }
}

/**
 * The money-offer scale factor `min(1, amount / moneyNeed)` (design, "Station,
 * Directives and Budget"; Req 28.5). It is `1` once the offer meets or beats the
 * NPC's money need, falls linearly toward `0` as the offer shrinks, and is `0`
 * for a non-positive offer. A `moneyNeed` of `0` (money does not move this NPC)
 * yields `0` so no offer can buy them — the ratio is undefined, so it is
 * clamped rather than divided.
 *
 * `offer` and `moneyNeed` are plain currency amounts. The result is clamped to
 * `[0, 1]` so a negative offer or need cannot push the lever match out of range.
 */
export function moneyOfferScale(offer: number, moneyNeed: number): number {
  if (offer <= 0 || moneyNeed <= 0) {
    return 0;
  }
  return Math.min(1, offer / moneyNeed);
}

/**
 * The effective lever match the σ formula reads (Req 10.1, 28.5). For a `money`
 * pitch it is `leverStrength × moneyOfferScale(offer, npc.moneyNeed)` — the
 * design's `leverMatch × min(1, amount / npc.moneyNeed)`. For every other lever
 * it is the bare {@link leverStrength}, and the offer is ignored.
 *
 * Reads the NPC's hidden MICE profile and money need (both `Truth`-branded);
 * the branded reads are intentional, see the module docblock.
 */
export function leverMatch(npc: Npc, lever: MiceLever, offer: number): number {
  const strength = leverStrength(revealTruth(npc.mice), lever);
  if (lever !== 'money') {
    return strength;
  }
  return strength * moneyOfferScale(offer, revealTruth(npc.moneyNeed));
}

// ---------------------------------------------------------------------------
// The pitch σ probability (Req 10.2)
// ---------------------------------------------------------------------------

/**
 * The recruitment success probability (design: `σ(w₁·leverMatch + w₂·trust −
 * w₃·suspicion − w₄·exposureRisk + persona)`; Req 10.2). Pure and drawless, so a
 * quote or a test can read the probability without committing a coin.
 *
 * `trust`, `suspicion` and `exposureRisk` come off the {@link Relationship}
 * (`exposure` fills the `exposureRisk` term); `persona` is the NPC's sampled
 * `persona.openness`. The result rises with lever match, trust and openness and
 * falls with suspicion and Exposure (for positive weights), as the design's
 * balance intends.
 */
export function pitchProbability(
  npc: Npc,
  rel: Relationship,
  lever: MiceLever,
  offer: number,
  weights: PitchWeights,
): number {
  const match = leverMatch(npc, lever, offer);
  const x =
    weights.w1 * match +
    weights.w2 * rel.trust -
    weights.w3 * rel.suspicion -
    weights.w4 * rel.exposure +
    npc.persona.openness;
  return sigmoid(x);
}

// ---------------------------------------------------------------------------
// PitchOutcome and resolvePitch (Req 10.2, 10.5)
// ---------------------------------------------------------------------------

/**
 * The Cover-Suspicion-style delta a failed pitch adds to the NPC's suspicion of
 * the player (Req 10.5 — a bad pitch raises the NPC's suspicion). A soft refusal
 * (the draw just missed) adds {@link PITCH_FAIL_SUSPICION}; a *bad* refusal (the
 * draw missed by a wide margin, below {@link PITCH_BAD_THRESHOLD} of the
 * probability) adds {@link PITCH_BAD_SUSPICION} and flags the pitch as reportable
 * to the Hostile Service.
 */
export const PITCH_FAIL_SUSPICION = 0.1;

/** The suspicion a *badly* failed pitch adds (Req 10.5). */
export const PITCH_BAD_SUSPICION = 0.25;

/**
 * How far below the success probability a draw must fall for the refusal to
 * count as *bad* (Req 10.5 — "IF a pitch fails badly"). The draw is a uniform in
 * `[0, 1)`; a refusal is bad when `draw ≥ p + (1 − p)·threshold`, i.e. it landed
 * in the upper part of the failing range, well clear of acceptance. At
 * `threshold = 0.5` the worst half of the failing range is "bad".
 */
export const PITCH_BAD_THRESHOLD = 0.5;

/**
 * The result of a pitch (design: `PitchOutcome`). `accepted` is the coin's
 * verdict (Req 10.3 — on success the NPC becomes an Asset, applied by the
 * caller). On a refusal, `suspicionDelta` is the rise to add to the NPC's
 * suspicion of the player and `reported` says whether the Hostile Service should
 * be alerted (Req 10.5). `probability` and `draw` are exposed so a caller or a
 * test can see the maths behind the verdict without redrawing.
 */
export interface PitchOutcome {
  readonly accepted: boolean;
  /** `true` only for a *bad* refusal (Req 10.5 — MAY report the approach). */
  readonly reported: boolean;
  /** The rise to add to the NPC's suspicion (`0` on acceptance). */
  readonly suspicionDelta: number;
  /** The σ success probability the draw was taken against. */
  readonly probability: number;
  /** The single `[0, 1)` draw taken from the PRNG. */
  readonly draw: number;
}

/**
 * The pure recruitment coin (design: `resolvePitch(npc, rel, lever, offer,
 * rng): PitchOutcome`; Req 10.2). Computes the σ probability
 * ({@link pitchProbability}) and draws it against the passed {@link Prng} once:
 * the NPC accepts iff the draw falls under the probability.
 *
 * On acceptance the outcome carries no suspicion rise and `reported = false`;
 * the caller flips `rel.recruited` and mints the {@link AssetProfile} (Req 10.3,
 * 10.6). On a refusal the NPC's suspicion rises — {@link PITCH_BAD_SUSPICION}
 * and `reported = true` for a *bad* refusal (the draw cleared the probability by
 * {@link PITCH_BAD_THRESHOLD} of the failing range, Req 10.5), else
 * {@link PITCH_FAIL_SUSPICION} and `reported = false`.
 *
 * Deterministic: the single `rng.next()` draw is the only randomness, so the
 * same inputs and PRNG state always return an identical outcome (Property 11).
 */
export function resolvePitch(
  npc: Npc,
  rel: Relationship,
  lever: MiceLever,
  offer: number,
  weights: PitchWeights,
  rng: Prng,
): PitchOutcome {
  const probability = pitchProbability(npc, rel, lever, offer, weights);
  const draw = rng.next();
  const accepted = draw < probability;
  if (accepted) {
    return { accepted: true, reported: false, suspicionDelta: 0, probability, draw };
  }
  const badCutoff = probability + (1 - probability) * PITCH_BAD_THRESHOLD;
  const reported = draw >= badCutoff;
  return {
    accepted: false,
    reported,
    suspicionDelta: reported ? PITCH_BAD_SUSPICION : PITCH_FAIL_SUSPICION,
    probability,
    draw,
  };
}
