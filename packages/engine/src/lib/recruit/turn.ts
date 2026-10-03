/**
 * The turning primitive (design, "Recruitment and Relationships": "Turning
 * (Req 36)"; Requirements 11.3, 36.3, 36.4, 36.5, 36.6, 36.7).
 *
 * `resolveTurn` is the pure, deterministic coin the **turn-agent** action draws
 * when the player tries to turn a hostile agent they have caught or cornered
 * into a Double Agent working for the Station. The design writes the success
 * probability as
 *
 *     σ(w₁·leverMatch + w₂·L − w₃·loyalty − w₄·suspicion + w₅·trust − resilience)
 *
 * where `σ` is the logistic function (shared with `firstContact`), the
 * `{w₁..w₅}` are the scenario config's `recruitment.turn` weights, `leverMatch`
 * grades the pressed MICE lever against the NPC's hidden profile (money scaled
 * by the offer, exactly as `resolvePitch` does), `loyalty` is the hostile
 * agent's loyalty to their service, `suspicion`/`trust` are read off the
 * player↔NPC {@link Relationship}, `resilience` is the NPC's composure (the same
 * `tradecraft`/`securityConsciousness` average `pressureCheck` reads), and `L`
 * is the leverage strength:
 *
 * - `1.0` when the NPC is in Station Custody (`custody`);
 * - `0.6` when the player has observed the cover crack (`cracking`);
 * - `0.3 × min(1, evidence / arrestThreshold)` when the leverage is a stack of
 *   Implicating Claims in an open talk scene (`evidence`).
 *
 * ## Determinism and the Truth boundary (Req 36.4, 36.5; Property 31)
 *
 * The result is one of `accepted` / `refused` / `refused-reported`:
 *
 * - **If the target's true allegiance is not the Hostile Service** the result is
 *   `refused` immediately, with **no draw taken** — so the outcome, and the
 *   whole PRNG stream after it, is identical whether the NPC is an innocent or a
 *   loyal hostile agent. A refusal therefore leaks nothing about ground truth
 *   (Req 36.5). This is also why `turnEligibility` and the refusal Fact Line are
 *   invariant under any Truth Store change (Property 31).
 * - **Otherwise** the success coin is drawn once against the PRNG. On success the
 *   result is `accepted` (Req 36.6). On failure a second coin decides whether the
 *   failure was *reported*: `refused-reported` with p = `loyalty × (1 − L)` (a
 *   loyal agent with little leverage over them is likeliest to run to their
 *   handler), else `refused`.
 *
 * The draws run in a fixed order — success, then (only on a success-coin
 * failure) the report coin — so the same NPC, Relationship, lever, offer,
 * leverage, evidence, loyalty, weights and PRNG state always return an identical
 * verdict and leave the PRNG in an identical state (design, Property 31; task
 * 18.7). The hostile branch is the *only* place a coin is drawn, so a caller can
 * pin the stream.
 *
 * This module is a dependency-light **leaf** beside `pitch.ts`/`pressure.ts`: it
 * imports only the NPC and {@link Relationship} shapes, the Truth brand (to read
 * the hidden true allegiance), the `leverMatch` scorer from `./pitch.ts`, the
 * `npcResilience` composure read and the `sigmoid` from the recruitment leaves,
 * the core time helpers, and the PRNG — never the Action Resolver — so it forms
 * no import cycle. The effects of a verdict on the {@link WorldState} (the
 * allegiance flip, the Asset status, the custody duration and the release
 * suspicion penalty) are applied by the `turn-agent` resolver in
 * `../action/turn-agent.ts`; this leaf owns only the verdict and the small pure
 * helpers that compute the custody-release penalty.
 */

import { revealTruth, timeToPhases, type GameTime, type OrgId } from '../model/core.js';
import type { Npc } from '../city/npc.js';
import type { Prng } from '../prng/prng.js';
import { sigmoid } from './first-contact.js';
import { leverMatch } from './pitch.js';
import { npcResilience } from './pressure.js';
import type { Custody, MiceLever, Relationship } from './asset.js';

// ---------------------------------------------------------------------------
// Turn leverage (design: TurnLeverage)
// ---------------------------------------------------------------------------

/**
 * The leverage the player holds over the NPC when they attempt a turn (design:
 * `TurnLeverage`). It both gates the attempt ({@link import('../action/turn-agent.js').turnEligibility})
 * and sets the leverage strength `L` in the success σ:
 *
 * - `custody` — the NPC is in Station Custody (`L = 1.0`); the strongest hold.
 * - `cracking` — the player has observed the NPC's cover move to cracking or
 *   blown (`L = 0.6`).
 * - `evidence` — a talk scene with the NPC is open and the Case File holds at
 *   least one corroborated Implicating Claim (`L = 0.3 × min(1, evidence /
 *   arrestThreshold)`).
 */
export type TurnLeverage = 'custody' | 'cracking' | 'evidence';

/** The verdict `resolveTurn` returns (design: `resolveTurn` return union). */
export type TurnOutcome = 'accepted' | 'refused' | 'refused-reported';

// ---------------------------------------------------------------------------
// Turn weights (design: scenario `recruitment.turn`)
// ---------------------------------------------------------------------------

/**
 * The `recruitment.turn` coefficients the σ formula uses (design: the scenario
 * config's `turn` weights). `w1` scales the lever match, `w2` the leverage
 * strength `L`, `w3` the loyalty, `w4` the suspicion, `w5` the trust.
 */
export interface TurnWeights {
  readonly w1: number;
  readonly w2: number;
  readonly w3: number;
  readonly w4: number;
  readonly w5: number;
}

// ---------------------------------------------------------------------------
// Leverage strength L (design: L = 1.0 / 0.6 / 0.3·min(1, evidence/threshold))
// ---------------------------------------------------------------------------

/** The leverage strength `L` for Station Custody (design: `L = 1.0`). */
export const LEVERAGE_CUSTODY = 1.0;

/** The leverage strength `L` for an observed cover crack (design: `L = 0.6`). */
export const LEVERAGE_CRACKING = 0.6;

/** The leverage-strength ceiling the `evidence` leverage scales (design: `0.3`). */
export const LEVERAGE_EVIDENCE_MAX = 0.3;

/**
 * The leverage strength `L` the success σ reads (design: `L = 1.0` custody,
 * `0.6` cracking, `0.3 × min(1, evidence / arrestThreshold)` evidence). For the
 * `evidence` leverage the ceiling is approached as the corroborated Implicating
 * Claim count reaches the arrest evidence threshold; a non-positive threshold is
 * treated as a full stack so the leverage still carries its ceiling.
 */
export function leverageStrength(
  leverage: TurnLeverage,
  evidence: number,
  arrestThreshold: number,
): number {
  switch (leverage) {
    case 'custody':
      return LEVERAGE_CUSTODY;
    case 'cracking':
      return LEVERAGE_CRACKING;
    case 'evidence': {
      const ratio =
        arrestThreshold > 0 ? Math.min(1, Math.max(0, evidence) / arrestThreshold) : 1;
      return LEVERAGE_EVIDENCE_MAX * ratio;
    }
  }
}

// ---------------------------------------------------------------------------
// The turn σ probability (drawless)
// ---------------------------------------------------------------------------

/**
 * The turn success probability (drawless, so a quote or a test can read it
 * without committing the coin). The logistic
 * `σ(w₁·leverMatch + w₂·L − w₃·loyalty − w₄·suspicion + w₅·trust − resilience)`
 * on the scenario `recruitment.turn` weights. Rises with lever match, leverage
 * and rapport, falls with the agent's loyalty, the NPC's suspicion of the player
 * and the NPC's composure, as the design's balance intends.
 *
 * Reads the NPC's hidden MICE profile and money need through {@link leverMatch}
 * and the composure ground truth through {@link npcResilience}; the branded
 * reads are deliberate (a Sim operation deciding an outcome from ground truth —
 * only the verdict crosses toward the Player View).
 */
export function turnProbability(
  npc: Npc,
  rel: Relationship,
  lever: MiceLever,
  offer: number,
  leverage: TurnLeverage,
  evidence: number,
  loyalty: number,
  arrestThreshold: number,
  weights: TurnWeights,
): number {
  const match = leverMatch(npc, lever, offer);
  const strength = leverageStrength(leverage, evidence, arrestThreshold);
  const x =
    weights.w1 * match +
    weights.w2 * strength -
    weights.w3 * loyalty +
    weights.w5 * rel.trust -
    weights.w4 * rel.suspicion -
    npcResilience(npc);
  return sigmoid(x);
}

// ---------------------------------------------------------------------------
// Hostile-allegiance test
// ---------------------------------------------------------------------------

/**
 * Whether an NPC's *true* allegiance is the Hostile Service, given the hostile
 * org's id (design, Req 36.4 — the turn can only succeed against a true hostile
 * agent). Reads the branded `trueAllegiance` deliberately: `resolveTurn` is a
 * Sim operation and only its verdict crosses toward the Player View; and the
 * non-hostile branch takes **no** draw, so this read cannot shift the PRNG
 * stream and a refusal leaks nothing (Req 36.5).
 */
export function trueAllegianceIsHostile(npc: Npc, hostileOrg: OrgId): boolean {
  return revealTruth(npc.trueAllegiance).org === hostileOrg;
}

// ---------------------------------------------------------------------------
// resolveTurn (Req 36.3, 36.4, 36.5, 36.6)
// ---------------------------------------------------------------------------

/**
 * The pure turning coin (design: `resolveTurn(npc, rel, lever, offer, leverage,
 * evidence, rng): 'accepted' | 'refused' | 'refused-reported'`; Req 36.3, 36.4,
 * 36.5, 36.6).
 *
 * If `targetIsHostile` is `false` (the NPC's true allegiance is not the Hostile
 * Service) the result is `refused` with **no draw taken** (Req 36.4), so the
 * verdict and the PRNG stream are identical whatever the ground truth — a
 * refusal distinguishes nothing (Req 36.5). The caller computes
 * `targetIsHostile` from {@link trueAllegianceIsHostile}.
 *
 * Otherwise it computes the σ success probability ({@link turnProbability}) and
 * draws it against the passed {@link Prng} once: `accepted` iff the draw falls
 * under the probability (Req 36.6). On a success-coin failure a second draw
 * decides `refused-reported` with p = `loyalty × (1 − L)` (else `refused`).
 *
 * Deterministic: the draws are the only randomness, in a fixed order (success,
 * then the report coin only when the success coin missed), so the same inputs
 * and PRNG state always return the same verdict and leave the PRNG identical
 * (Property 31; task 18.7).
 */
export function resolveTurn(
  npc: Npc,
  rel: Relationship,
  lever: MiceLever,
  offer: number,
  leverage: TurnLeverage,
  evidence: number,
  loyalty: number,
  arrestThreshold: number,
  weights: TurnWeights,
  targetIsHostile: boolean,
  rng: Prng,
): TurnOutcome {
  // Req 36.4: a non-hostile target refuses with no draw, so the outcome and the
  // PRNG stream are independent of ground truth (Req 36.5; Property 31).
  if (!targetIsHostile) {
    return 'refused';
  }

  const probability = turnProbability(
    npc,
    rel,
    lever,
    offer,
    leverage,
    evidence,
    loyalty,
    arrestThreshold,
    weights,
  );
  if (rng.next() < probability) {
    return 'accepted';
  }

  // Failed: a loyal agent with weak leverage over them is likeliest to report
  // the overture (design: p = loyalty × (1 − L)).
  const strength = leverageStrength(leverage, evidence, arrestThreshold);
  const reportProbability = clamp01(loyalty) * (1 - strength);
  return rng.next() < reportProbability ? 'refused-reported' : 'refused';
}

// ---------------------------------------------------------------------------
// The refusal Fact Line (Req 36.5)
// ---------------------------------------------------------------------------

/**
 * The single refusal Fact Line every failed turn renders (Req 36.5 — "the same
 * refusal Fact Line regardless of the target's true allegiance"). Both
 * `refused` and `refused-reported` play it, and it is a plain string that reads
 * no ground truth, so a refusal distinguishes an innocent from a loyal agent in
 * neither its text nor its presence.
 */
export const TURN_REFUSAL_LINE =
  'They refuse, with a flat denial that gives you nothing to work with.';

// ---------------------------------------------------------------------------
// Custody release suspicion penalty (Req 36.7)
// ---------------------------------------------------------------------------

/**
 * The per-phase factor the custody-release suspicion penalty scales (design: "A
 * custody release then adds `0.1 × phases in custody` to the Hostile Service's
 * suspicion of the agent"; Req 36.7).
 */
export const CUSTODY_RELEASE_SUSPICION_PER_PHASE = 0.1;

/**
 * The number of phases an NPC has spent in Station Custody as of `now` (design:
 * "phases in custody"). The {@link Custody} record carries the `since` time; the
 * span is the phase difference to `now`, floored at `0` (a release recorded
 * before it began contributes nothing).
 */
export function phasesInCustody(custody: Custody, now: GameTime): number {
  return Math.max(0, timeToPhases(now) - timeToPhases(custody.since));
}

/**
 * The suspicion the Hostile Service gains about a turned agent when the Station
 * releases them from Custody (Req 36.7): `0.1 × phases in custody`. Pure in the
 * custody span, so the penalty is deterministic from the custody record and the
 * release time. The Hostile Service belief model is a later task; this leaf
 * computes the magnitude the `turn-agent`/release path applies.
 */
export function custodyReleaseSuspicion(custody: Custody, now: GameTime): number {
  return CUSTODY_RELEASE_SUSPICION_PER_PHASE * phasesInCustody(custody, now);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
