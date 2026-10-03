/**
 * The Cold Approach primitive (design, "Recruitment": `firstContact`; design
 * "Action Resolver" → **Approach**; Requirements 22.2, 22.3).
 *
 * `firstContact` is the pure recruitment coin the Cold Approach action draws: a
 * first, unarranged contact with an NPC the player has no Contact Channel to.
 * The design writes the success probability as
 *
 *     σ(a·coverFit(cover, locType, archetype) − b·wariness − c·suspicion + d·persona.openness)
 *
 * where `σ` is the logistic function `1 / (1 + e^−x)`, `{a, b, c, d}` are the
 * scenario config's `recruitment.firstContact` weights, `wariness` and
 * `persona.openness` are view-adjacent NPC fields, and `suspicion` is the
 * player's current Cover Suspicion (or an NPC's suspicion of the player — the
 * caller passes whichever it holds). The success is drawn against the runtime
 * PRNG: the NPC accepts the approach iff `rng.next() < p`.
 *
 * This module is a dependency-light **leaf**: it owns `firstContact`, the pure
 * `coverFit` scorer, and `firstContactProbability` (the σ value `firstContact`
 * draws against, exposed so a quote or a test can read the probability without
 * drawing a coin). It imports only the Cover Identity shape, the city
 * `Location`, the NPC shape and the PRNG — never the Action Resolver — so it
 * forms no import cycle and later Recruitment work (`resolvePitch`,
 * `pressureCheck`, `turn-agent`) can land beside it in `recruit/`.
 *
 * ## coverFit (design: `coverFit(cover, locType, archetype)`)
 *
 * `coverFit` scores how well the player's Cover Identity fits the place they are
 * approaching the NPC in. The design keys it on the Cover Identity's
 * `fitLocationTypes`: a cover fits a Location when the Location's Type is one of
 * the cover's fit Types. The score is a simple graded value in `[0, 1]`:
 *
 * - `1` when the Location's Type is in the cover's `fitLocationTypes` (the cover
 *   belongs here — a cultural attaché in a kaffeehaus);
 * - `0` otherwise (the cover is out of place — that attaché in a warehouse).
 *
 * The `{fits: 1, else: 0}` scale is the simplest faithful reading of the design
 * (a Location Type either is or is not in the fit set); it is documented as a
 * constant pair so a later task can grade it (a partial fit, say) without
 * reshaping the formula. The archetype argument the design names is accepted but
 * does not yet bend the score — archetype-specific cover affinity is a later
 * recruitment refinement; it is threaded through so the signature matches the
 * design and the refinement needs no call-site change.
 */

import type { CoverIdentity } from '../city/starting-brief.js';
import type { Location } from '../city/city.js';
import type { Prng } from '../prng/prng.js';

// ---------------------------------------------------------------------------
// coverFit (Req 22.2)
// ---------------------------------------------------------------------------

/** The coverFit score when the Location's Type is in the cover's fit set. */
export const COVER_FIT_HIGH = 1;

/** The coverFit score when the Location's Type is not in the cover's fit set. */
export const COVER_FIT_LOW = 0;

/**
 * Resolve a Location's Type to the bare local id the cover's `fitLocationTypes`
 * are recorded under. The cover's fit set is narrowed to the city's stamped
 * local Type ids (`generateCoverIdentity`), and a Location's `type` is that same
 * bare id, so a direct membership test suffices; the namespaced-suffix match
 * keeps a defensive path when a Location carries a `<pack>/<name>` form.
 */
function fitsCover(cover: CoverIdentity, locType: string): boolean {
  for (const fit of cover.fitLocationTypes) {
    if (fit === locType || fit.endsWith(`/${locType}`) || locType.endsWith(`/${fit}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Score how well a Cover Identity fits the Location an NPC is approached in
 * (design, `coverFit(cover, locType, archetype)`; Req 22.2). Returns
 * {@link COVER_FIT_HIGH} when the Location's Type is one of the cover's fit
 * Types (the cover belongs there), {@link COVER_FIT_LOW} otherwise. Pure: it
 * reads only the cover's fit set and the Location's Type.
 *
 * `archetype` is the NPC's archetype id, accepted to match the design's
 * signature; archetype-specific cover affinity is a later refinement and does
 * not yet move the score.
 */
export function coverFit(
  cover: CoverIdentity,
  loc: Location,
  archetype: string,
): number {
  void archetype;
  return fitsCover(cover, loc.type) ? COVER_FIT_HIGH : COVER_FIT_LOW;
}

// ---------------------------------------------------------------------------
// The firstContact weights and the σ probability (Req 22.2, 22.3)
// ---------------------------------------------------------------------------

/**
 * The `recruitment.firstContact` coefficients the σ formula uses (design: the
 * scenario config's `firstContact` weights). `a` scales the cover fit, `b` the
 * NPC's wariness, `c` the suspicion, `d` the NPC's openness.
 */
export interface FirstContactWeights {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** The inputs the σ formula reads from the NPC being approached. */
export interface FirstContactNpc {
  /** How guarded the NPC is before any pitch, `[0, 1]` (view-adjacent). */
  readonly wariness: number;
  /** The NPC's sampled sociability, `[0, 1]` (view-safe persona field). */
  readonly openness: number;
  /** The NPC's archetype id, passed through to {@link coverFit}. */
  readonly archetype: string;
}

/** The logistic function `σ(x) = 1 / (1 + e^−x)`, mapping any real to `(0, 1)`. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * The Cold Approach success probability (design: `σ(a·coverFit − b·wariness −
 * c·suspicion + d·persona.openness)`; Req 22.2). Pure and drawless, so a quote
 * or a test can read the probability without committing a coin. `suspicion` is
 * the value the caller holds against the player — the player's current Cover
 * Suspicion, or the NPC's suspicion of them — in `[0, 1]`.
 *
 * The result is monotonic as the design's balance intends: it rises with cover
 * fit and NPC openness, and falls with NPC wariness and suspicion (for positive
 * weights).
 */
export function firstContactProbability(
  npc: FirstContactNpc,
  cover: CoverIdentity,
  loc: Location,
  weights: FirstContactWeights,
  suspicion: number,
): number {
  const fit = coverFit(cover, loc, npc.archetype);
  const x =
    weights.a * fit -
    weights.b * npc.wariness -
    weights.c * suspicion +
    weights.d * npc.openness;
  return sigmoid(x);
}

/**
 * The pure Cold Approach coin (design: `firstContact(npc, cover, loc, rel,
 * rng): boolean`; Req 22.2, 22.3). Computes the σ probability
 * ({@link firstContactProbability}) and draws it against the passed {@link Prng}:
 * the NPC accepts the first contact iff the draw falls under the probability.
 *
 * The only randomness is the single `rng.next()` draw, so the same NPC, cover,
 * Location, weights, suspicion and PRNG state always yield the same outcome
 * (Req 22.3 — the approach is deterministic against the runtime stream). The
 * `rel` the design names is folded into `suspicion` by the caller (the player's
 * Cover Suspicion or the NPC's suspicion of the player), so it is not a separate
 * argument here.
 */
export function firstContact(
  npc: FirstContactNpc,
  cover: CoverIdentity,
  loc: Location,
  weights: FirstContactWeights,
  suspicion: number,
  rng: Prng,
): boolean {
  const p = firstContactProbability(npc, cover, loc, weights, suspicion);
  return rng.next() < p;
}
