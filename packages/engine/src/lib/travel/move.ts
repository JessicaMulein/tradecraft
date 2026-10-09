/**
 * City changes go through a departure on the spine tick (Requirements 12.1, 12.3).
 * `spineTick` draws the departure city's spine stream, then the placement is rewritten.
 */

import type { GameTime, LocId } from '../model/core.js';
import type { CityId } from '../fidelity/types.js';
import { spineTick } from '../fidelity/clock.js';
import { createPrng, type PrngState } from '../prng/prng.js';
import type { LocationOf, Placement, TransitId } from '../region/world.js';

export interface SpineMove {
  readonly city: CityId;
  readonly who: string;
  readonly transit: TransitId;
  readonly board: boolean;
  readonly dest?: { readonly city: CityId; readonly loc: LocId };
  readonly at: GameTime;
  readonly duration: number;
}

/** Board or alight on the departure city's spine tick. */
export function moveOnSpine(
  current: LocationOf,
  spine: PrngState,
  move: SpineMove,
): { readonly locationOf: LocationOf; readonly spine: PrngState } {
  const rng = createPrng(spine);
  let next: Placement | undefined;
  if (move.board) {
    next = { transit: move.transit };
  } else if (move.dest !== undefined) {
    next = { city: move.dest.city, loc: move.dest.loc };
  }
  const placed = next === undefined
    ? spineTick(move.city, rng)
    : spineTick(move.city, rng, { locationOf: current, who: move.who, next });
  return { locationOf: placed ?? current, spine: rng.state() };
}

/** Phases between two game times. Negative when `later` is before `earlier`. */
export function phasesBetween(earlier: GameTime, later: GameTime): number {
  return later.day * 4 + later.phase - (earlier.day * 4 + earlier.phase);
}

/** Every id has one placement, and every transit occupant is on that transit's list. */
export function placementsMatch(
  locationOf: LocationOf,
  transits: Readonly<Record<string, { readonly travellers: readonly string[] }>>,
): boolean {
  const seen = new Set<string>();
  for (const [who, place] of Object.entries(locationOf)) {
    if (seen.has(who)) {
      return false;
    }
    seen.add(who);
    if ('transit' in place && !(transits[place.transit]?.travellers ?? []).includes(who)) {
      return false;
    }
  }
  return true;
}

