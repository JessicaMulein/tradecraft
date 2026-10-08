/**
 * The Hostile Service's daily counter-intelligence detection check and the
 * doctrine-driven response selection (design, "Hostile Service AI": `dailyTick`
 * steps 1–2; Requirements 12.2, 12.3).
 *
 * Each day end the service runs a deterministic detection check on every one of
 * the player's running Assets (Req 12.2) and, on a hit, chooses one of three
 * responses — **arrest**, **double** or **feed** — according to doctrine and the
 * current state (Req 12.3). This module is the pure core of both:
 *
 * ## Detection (Req 12.2)
 *
 * For each Asset not already detected, the detection probability is
 *
 * ```
 * p = detectionBase.meeting                       // the preset's per-day base
 *   × (1 + securityConsciousness)                 // a vigilant service hunts harder
 *   × effectiveExposure(beliefs, asset)           // Exposure + agent suspicion
 * ```
 *
 * clamped to `[0, 1]`. `effectiveExposure` (`./beliefs.ts`) is the larger of the
 * service's Exposure mirror for the Asset and its agent suspicion, so an Asset
 * becomes detectable both from visible contact and from a refuted feed. A
 * zero-Exposure, un-suspected Asset has `p = 0` and is never detected — the
 * player who runs an Asset carefully is safe. The check draws one coin per
 * candidate on the passed {@link Prng}, in Asset-id order, so the day's result
 * is fully determined by the seed.
 *
 * ## Response (Req 12.3)
 *
 * On a hit the service picks a response from a deterministic score, not a
 * second coin, so the choice is a pure function of doctrine and state:
 *
 * - **arrest** — favoured by low `deceptionAppetite` and *low* `riskTolerance`
 *   (a cautious service that would rather remove a threat than run it), and
 *   forced when the Asset is a turned agent the service has grown to distrust
 *   (`agentSuspicion` high) — a blown double is arrested, not re-doubled.
 * - **double** — quietly turning the Asset against the player, favoured by a
 *   *high* `riskTolerance` service that wants the Asset left in play, when the
 *   Asset is not already turned by the player.
 * - **feed** — passing the Asset deception rather than flipping it, favoured by
 *   high `deceptionAppetite` — the service keeps the relationship and uses it to
 *   mislead.
 *
 * The response maps to the SimEvents the daily tick emits: `asset-arrested`,
 * `asset-doubled` or `feed-delivered` (the off-screen consequences — a doubled
 * Asset's `hostileControlled` flip, an arrested Asset's missed meetings — are
 * applied by the daily tick / task 19.5, which consumes these decisions).
 *
 * ## Purity
 *
 * {@link runDetection} is pure with respect to its inputs: the only state it
 * touches is the passed {@link Prng}, drawn once per candidate in id order.
 * {@link chooseResponse} and {@link detectionProbability} make no draws at all.
 */

import type { NpcId } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import { effectiveExposure, type HostileBeliefs } from './beliefs.js';

// ---------------------------------------------------------------------------
// Detection probability (Req 12.2)
// ---------------------------------------------------------------------------

/**
 * The preset slice the detection check reads: the per-day base detection rates
 * (`DifficultyPreset.detectionBase`). Only `meeting` is used as the
 * counter-intelligence base — a running Asset's contact with the player is a
 * meeting-shaped signal — but the whole shape is accepted so a caller passes
 * `preset.detectionBase` directly. Structural, so this leaf imports no content
 * types.
 */
export interface DetectionBase {
  readonly surveil: number;
  readonly meeting: number;
  readonly drop: number;
}

/** Clamp a value to `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The per-day detection probability for one Asset (Req 12.2). Pure, no draws:
 * `base.meeting × (1 + securityConsciousness) × effectiveExposure`, clamped to
 * `[0, 1]`. A zero-Exposure, un-suspected Asset yields `0` (never detected); a
 * fully-exposed Asset under a maximally vigilant service approaches `2 × base`,
 * capped at `1`.
 */
export function detectionProbability(
  beliefs: HostileBeliefs,
  npc: NpcId,
  doctrine: Doctrine,
  base: DetectionBase,
  bonus = 0,
): number {
  const exposure = effectiveExposure(beliefs, npc);
  return clamp01(base.meeting * (1 + doctrine.securityConsciousness) * exposure + bonus);
}

// ---------------------------------------------------------------------------
// Response selection (Req 12.3)
// ---------------------------------------------------------------------------

/** A detection response the service chooses on a hit (Req 12.3). */
export type DetectionResponse = 'arrest' | 'double' | 'feed';

/**
 * The per-Asset state {@link chooseResponse} reads: whether the player already
 * turned this agent, and the service's suspicion of it. A turned agent cannot
 * be *doubled* again by the service, and a turned agent the service distrusts
 * is arrested rather than fed.
 */
export interface ResponseContext {
  /** The player turned this (formerly hostile) agent — the service cannot double it. */
  readonly turnedByPlayer: boolean;
  /** The service's suspicion of this agent, in `[0, 1]`. */
  readonly agentSuspicion: number;
}

/**
 * The suspicion above which a turned agent is arrested rather than kept in play
 * (design: "a refuted feed can blow the agent"). A service that already
 * distrusts a double removes it.
 */
export const BLOWN_AGENT_SUSPICION = 0.6;

/**
 * Choose the detection response for a hit, deterministically from doctrine and
 * state (Req 12.3). Pure, no draws — the randomness was the detection coin; the
 * response is a function of what the service is and knows, so the same
 * detection on the same state always yields the same response.
 *
 * Priority:
 *
 * 1. **arrest** when the agent is a turned double the service now distrusts
 *    (`agentSuspicion ≥ {@link BLOWN_AGENT_SUSPICION}`) — a blown double is
 *    removed, never re-run.
 * 2. otherwise compare three doctrine-weighted scores and take the largest
 *    (ties resolve arrest > double > feed, the cautious default):
 *    - `arrest = 1 − deceptionAppetite` + a `riskTolerance`-averse bonus;
 *    - `double = riskTolerance`, zeroed when the Asset is already turned by the
 *      player (the service cannot double its own compromised agent twice);
 *    - `feed   = deceptionAppetite`.
 */
export function chooseResponse(
  doctrine: Doctrine,
  ctx: ResponseContext,
): DetectionResponse {
  if (ctx.turnedByPlayer && ctx.agentSuspicion >= BLOWN_AGENT_SUSPICION) {
    return 'arrest';
  }

  const arrest = (1 - doctrine.deceptionAppetite) + (1 - doctrine.riskTolerance) * 0.5;
  const double = ctx.turnedByPlayer ? 0 : doctrine.riskTolerance;
  const feed = doctrine.deceptionAppetite;

  // Largest score wins; ties fall through in the cautious order arrest/double/feed.
  if (arrest >= double && arrest >= feed) {
    return 'arrest';
  }
  if (double >= feed) {
    return 'double';
  }
  return 'feed';
}

// ---------------------------------------------------------------------------
// The daily detection pass (Req 12.2, 12.3)
// ---------------------------------------------------------------------------

/** One Asset the detection pass considers. */
export interface DetectionCandidate {
  /** The Asset's NPC id. */
  readonly npc: NpcId;
  /** Whether the player turned this agent (read by {@link chooseResponse}). */
  readonly turnedByPlayer: boolean;
}

/** A single detection outcome: the Asset detected and the response chosen. */
export interface Detection {
  readonly npc: NpcId;
  readonly response: DetectionResponse;
}

/** The result of a day's detection pass: the detections, in Asset-id order. */
export interface DetectionResult {
  readonly detections: readonly Detection[];
}

/**
 * Run the day's counter-intelligence detection over the player's Assets
 * (Req 12.2, 12.3). Pure with respect to its inputs; draws one coin per
 * candidate on `rng`, in the order the candidates are given (the caller sorts
 * by id for determinism).
 *
 * An Asset already in `beliefs.suspectedAssets` is skipped — it has already
 * drawn a response — so no coin is drawn for it and the stream advances
 * identically whether or not it was previously detected. For each remaining
 * candidate, the detection coin is drawn against {@link detectionProbability};
 * on a hit the response is chosen by {@link chooseResponse} from doctrine and
 * the Asset's turned/suspicion state. The returned detections are in candidate
 * order; the caller (the daily tick) applies their effects and marks the Assets
 * suspected.
 */
export function runDetection(
  rng: Prng,
  candidates: readonly DetectionCandidate[],
  beliefs: HostileBeliefs,
  doctrine: Doctrine,
  base: DetectionBase,
  bonuses: Readonly<Record<string, number>> = {},
): DetectionResult {
  const detections: Detection[] = [];
  for (const candidate of candidates) {
    if (beliefs.suspectedAssets.includes(candidate.npc)) {
      continue; // already detected; no coin, so the stream is history-independent
    }
    const p = detectionProbability(
      beliefs,
      candidate.npc,
      doctrine,
      base,
      bonuses[candidate.npc] ?? 0,
    );
    if (!rng.bool(p)) {
      continue;
    }
    const response = chooseResponse(doctrine, {
      turnedByPlayer: candidate.turnedByPlayer,
      agentSuspicion: beliefs.agentSuspicion[candidate.npc] ?? 0,
    });
    detections.push({ npc: candidate.npc, response });
  }
  return { detections };
}
