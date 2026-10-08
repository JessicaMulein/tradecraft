/**
 * The travel action (design, "Action Resolver" → **Travel**, and "Locations and
 * Movement"; Requirements 21.3, 21.4, 21.5).
 *
 * Travelling moves the player from their current Location to another. The cost
 * is the cheapest route over the District Route graph, computed by the city
 * model's {@link travelCost} (Dijkstra over Routes, each hop `0` or `1` phase),
 * plus one phase when the player chooses a countersurveillance route
 * (Requirement 21.4). That phase count is the quote's `phases` — the design's
 * `ActionQuote` carries a phase and a money cost, travel has no money cost, and
 * `travelCost` returns the phase cost directly, so the mapping is `phases =
 * travelCost(...)`, `money = 0`.
 *
 * On arrival (Requirement 21.4, design "Travel"):
 *
 * - the player's Location moves to the destination;
 * - **Cover Suspicion** rises by `loc.risk × {@link COVER_SUSPICION_RISK_FACTOR}`
 *   *if the player is tailed* — a tail following the player into a risky place
 *   is what exposes them;
 * - a **countersurveillance** route reduces the probability that a hostile tail
 *   *persists*: it is dropped with probability `1 − {@link
 *   COUNTERSURVEILLANCE_TAIL_FACTOR}`, drawn from the passed PRNG.
 *
 * The hostile side that *sets* `player.tailed` is the Hostile Service (task 19);
 * this action only *reads* `player.tailed` and applies the arrival effects, so
 * when the hostile side has not yet run the player is simply never tailed and
 * both effects are no-ops. That is the conservative default the task asks for.
 *
 * `quoteTravel` is pure and draws nothing; `resolveTravel` draws only the tail
 * -persistence coin from the PRNG it is handed, so the same inputs give the same
 * result.
 */

import { asTruth, revealTruth, type LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { applyRecogniserPass, npcsAt } from '../carry/recognise.js';
import { MADE_FACT_LINE } from './surveil.js';
import { travelCost } from '../city/city.js';
import { effectiveRoutes, observeLocation } from '../ambient/locations.js';
import { scaleHighRiskSuspicion } from '../ambient/cover.js';
import { greetingLine } from '../ambient/memory.js';
import { noticeLines } from '../ambient/news.js';
import type { Prng } from '../prng/prng.js';
import type { ActionQuote, ActionResult } from './result.js';
import type { TravelAction } from './types.js';

// ---------------------------------------------------------------------------
// Preset factors
// ---------------------------------------------------------------------------
//
// The design fixes a default for the tail-persistence multiplier (0.3) and
// leaves the arrival Cover-Suspicion factor to the preset. The Difficulty
// Preset does not (yet) carry either as a named field, so they live here as the
// framework's documented defaults; task 19 can thread preset-driven values
// through `resolveTravel` later without changing the shape of this module.

/**
 * The factor the destination's risk is multiplied by to get the Cover Suspicion
 * a tailed arrival adds (design "Cover Suspicion = Location risk × preset
 * factor"). A conservative default until a preset field drives it.
 */
export const COVER_SUSPICION_RISK_FACTOR = 0.5;

/**
 * How much more often the standing watchers at a risky place spot an untailed
 * arrival than the preset's surveil detection base alone (they are posted
 * there to watch). The spot probability is `detectionBase.surveil × risk ×
 * (1 + securityConsciousness) × WATCHER_SPOT_FACTOR`.
 */
export const WATCHER_SPOT_FACTOR = 2;

/**
 * The Cover Suspicion a watcher's spot adds, as a fraction of the Location's
 * risk: smaller than a tail's (the watcher sees the player once; a tail stays).
 */
export const WATCHER_SUSPICION_FACTOR = 0.25;

/**
 * The factor a countersurveillance route multiplies the tail-persistence
 * probability by (design default `0.3`): with a CS route a hostile tail
 * persists with probability `0.3` (and so is shaken off with probability
 * `0.7`); without one it always persists. Drawn from the passed PRNG.
 */
export const COUNTERSURVEILLANCE_TAIL_FACTOR = 0.3;

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------

/**
 * Quote a {@link TravelAction} (pure, no draws). The cost is
 * {@link travelCost}'s cheapest-route phase count (plus one for a
 * countersurveillance route); money is always `0`. An unreachable destination
 * (`travelCost` returns `Infinity`) is not allowed, as is a trip to a Location
 * that does not exist or to the player's current Location (a no-op the UI
 * should not offer). The Location gate (opening hours) is applied by the caller
 * in `quote`, so `quoteTravel` concentrates on reachability and cost.
 */
export function quoteTravel(state: WorldState, a: TravelAction): ActionQuote {
  const from = state.player.loc;
  const to = a.to;

  if (state.city.locations[to] === undefined) {
    return { allowed: false, reason: `no such Location ${to}`, phases: 0, money: 0 };
  }
  if (to === from) {
    return {
      allowed: false,
      reason: 'already at that Location',
      phases: 0,
      money: 0,
    };
  }

  const overlayRoutes =
    state.ambient !== undefined && state.ambient.overlays.length > 0
      ? effectiveRoutes(state.city.routes, state.ambient.overlays, state.time)
      : undefined;
  const cost = travelCost(state.city, from, to, a.countersurveillance, overlayRoutes);
  if (!Number.isFinite(cost)) {
    return {
      allowed: false,
      reason: `no route from ${from} to ${to}`,
      phases: 0,
      money: 0,
    };
  }

  return { allowed: true, phases: cost, money: 0 };
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link TravelAction}. Moves the player to the destination and
 * applies the arrival Cover-Suspicion and tail-persistence effects. The caller
 * (`resolve`) has already confirmed the action is allowed; travel adds no money
 * cost, and the phase advance is the Turn Pipeline's job, so this returns the
 * next {@link WorldState} with the player relocated and the two tail-driven
 * effects applied.
 *
 * Determinism: the draws are the tail-persistence coin (tailed, on a
 * countersurveillance route) or the watcher coin (untailed, on a direct route
 * to a risky place), each taken from `rng`.
 */
export function resolveTravel(
  state: WorldState,
  a: TravelAction,
  rng: Prng,
): { next: WorldState; result: ActionResult } {
  const to = a.to;
  const dest = state.city.locations[to];

  const tailed = revealTruth(state.player.tailed);

  // Arrival Cover Suspicion: a tail following the player into a place raises
  // suspicion by the Location's risk × the preset factor (Requirement 21.4).
  // Untailed, the Hostile Service's standing watchers at risky places may still
  // spot the player arriving: a coin at the preset's surveil detection base ×
  // the Location's risk, scaled by how security-conscious the service is. A
  // countersurveillance route avoids the watchers, which is what it is for.
  let suspicionDelta =
    tailed && dest !== undefined ? dest.risk * COVER_SUSPICION_RISK_FACTOR : 0;
  if (dest !== undefined && state.ambient !== undefined && state.ambient.overlays.length > 0) {
    const fromLoc = state.city.locations[state.player.loc];
    const hop = fromLoc === undefined
      ? undefined
      : effectiveRoutes(state.city.routes, state.ambient.overlays, state.time).find(
          (route) =>
            (route.a === fromLoc.district && route.b === dest.district) ||
            (route.b === fromLoc.district && route.a === dest.district),
        );
    if (hop?.checkpoint !== undefined) {
      suspicionDelta += hop.checkpoint.coverRisk;
      if (rng.next() < hop.checkpoint.detection) {
        suspicionDelta += hop.checkpoint.coverRisk;
      }
    }
  }
  if (!tailed && dest !== undefined && !a.countersurveillance && dest.risk > 0) {
    const watch =
      state.meta.preset.detectionBase.surveil *
      dest.risk *
      (1 + state.hostile.doctrine.securityConsciousness) *
      WATCHER_SPOT_FACTOR;
    if (rng.next() < Math.min(1, watch)) {
      suspicionDelta = dest.risk * WATCHER_SUSPICION_FACTOR;
    }
  }
  if (state.ambient !== undefined && dest !== undefined) {
    suspicionDelta = scaleHighRiskSuspicion(
      suspicionDelta,
      dest.risk,
      revealTruth(state.ambient.coverStanding),
    );
  }
  const nextCoverSuspicion = revealTruth(state.player.coverSuspicion) + suspicionDelta;

  // Tail persistence: a countersurveillance route gives the player a chance to
  // shake a tail. With CS, the tail persists only with probability
  // COUNTERSURVEILLANCE_TAIL_FACTOR; without CS a tail always persists. When
  // the player is not tailed, there is nothing to persist.
  let nextTailed = tailed;
  if (tailed && a.countersurveillance) {
    // next() is in [0, 1); the tail persists on a draw below the factor.
    nextTailed = rng.next() < COUNTERSURVEILLANCE_TAIL_FACTOR;
  }

  const moved: WorldState = {
    ...state,
    player: {
      ...state.player,
      loc: to,
      coverSuspicion: asTruth(nextCoverSuspicion),
      tailed: asTruth(nextTailed),
    },
  };
  const arrived = observeLocation(moved, to);
  const present = dest === undefined ? [] : npcsAt(arrived, to, state.time);
  const recognised = applyRecogniserPass(
    arrived,
    rng,
    state.meta.preset.detectionBase.surveil,
    present,
    present,
    state.time,
    to,
  );
  const result = travelResult(recognised.next, to, suspicionDelta, recognised);
  return { next: recognised.next, result };
}

/**
 * The {@link ActionResult} of a travel: a single `message` Observation naming
 * the arrival (and the raised Cover Suspicion when a tail followed), the
 * destination's scene descriptor, and no Case File Claims (arriving asserts no
 * Proposition). Built against the *next* state so the scene reflects where the
 * player now is.
 */
function travelResult(
  next: WorldState,
  to: LocId,
  suspicionDelta: number,
  recognised: ReturnType<typeof applyRecogniserPass>,
): ActionResult {
  const loc = next.city.locations[to];
  const name = loc?.name ?? to;
  const line =
    suspicionDelta > 0
      ? `You arrive at ${name}. You sense you may have been followed.`
      : `You arrive at ${name}.`;
  const greeting = greetingLine(next, to);
  const notices = noticeLines(next, to);
  const extra = [
    ...recognised.seenBefore,
    ...(recognised.made ? [MADE_FACT_LINE] : []),
  ];
  const factLines = [line, ...(greeting === undefined ? [] : [greeting]), ...notices, ...extra];
  const observations: ActionResult['observations'] = [
    { kind: 'message', line },
    ...extra.map((text) => ({ kind: 'message' as const, line: text })),
  ];
  return {
    observations,
    factLines,
    scene: sceneDescriptorAt(next, to),
    events: [...recognised.events],
    claimsAdded: [],
  };
}

/**
 * Build the arrival scene descriptor. Kept local (rather than importing
 * `sceneAt` from `./action.js`) to avoid a circular import at module load:
 * `action.ts` imports this module for the travel resolver, so this module
 * builds its own scene from the same `WorldState` fields.
 */
function sceneDescriptorAt(state: WorldState, to: LocId): ActionResult['scene'] {
  const loc = state.city.locations[to];
  if (loc === undefined) {
    return { loc: to, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc: to,
    description: loc.description,
    atmosphere: [...loc.atmosphere],
    risk: loc.risk,
    visible: [],
  };
}
