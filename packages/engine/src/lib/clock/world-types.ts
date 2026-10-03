/**
 * The shared types of the world-advancing clock (slice-integration design,
 * "Engine: `advanceWorld`"): the context a Day-Boundary Hook runs with, the
 * state-and-events a hook returns, the hook table, the dependencies
 * `advanceWorld` threads through every hook and Phase Step, and the per-day
 * scratch one hook hands to a later one.
 *
 * This module holds types only, plus {@link newDayScratch}. It has no
 * behaviour of its own, so `advanceWorld`, the hooks, the Phase Step and the
 * Hostile Full Tick projection (`../hostile/project.ts`) can all import it
 * without importing one another.
 *
 * ## Hooks are state reducers
 *
 * The slice clock's `DayBoundaryHook` (`./clock.ts`) returns events only. A
 * {@link WorldHook} is a reducer instead: it receives the Draft World State
 * and returns the next one together with the events it raised
 * ({@link HookOutput}). `advanceWorld` runs the hooks present in
 * {@link WorldHooks} in `DAY_BOUNDARY_HOOK_ORDER`, handing each the state the
 * previous one returned, so every hook reads the state the hooks before it
 * left (Requirement 2.2).
 *
 * ## The day scratch
 *
 * Some values pass between hooks on the same day without being World State:
 * the schedules hook's Walk-in events, which the Hostile tick reads, and the
 * Hostile tick's newspaper plants and arrest articles, which the newspaper
 * hook prints (Requirement 3.8). They travel in a {@link DayScratch} that
 * `advanceWorld` creates fresh at each Day Boundary with
 * {@link newDayScratch}. A hook writes its outputs by assigning the scratch's
 * fields. The arrays themselves are never mutated, so a value one hook read
 * is not changed under it by a later one.
 *
 * ## Purity (Requirement 5.6)
 *
 * A hook reads only its arguments: the Draft, the context and the
 * dependencies in it. It draws randomness from `ctx.rng` (the runtime stream)
 * or from a Prng it builds from `ctx.dailyStreamSeed` (the daily stream), and
 * reads no clock, file, environment or model.
 */

import type { CityData, ContentSet } from '@tradecraft/content';

import type { CipherKeyLookup } from '../cipher/spec.js';
import type { NewspaperItem } from '../docs/newspaper.js';
import type { GameTime } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { ObjectiveEvaluator } from '../station/directives.js';
import type { TruthReader } from '../truth/truth.js';
import type { DAY_BOUNDARY_HOOK_ORDER } from './clock.js';

/**
 * The values handed from one Day-Boundary Hook to a later one on the same day.
 * `advanceWorld` creates a fresh scratch at each Day Boundary
 * ({@link newDayScratch}), so nothing in it outlives the day.
 *
 * A hook writes its outputs by assigning a field, and never mutates an array
 * in place.
 */
export interface DayScratch {
  /**
   * The day's events from the schedules hook, including a Walk-in's hidden
   * `walk-in-approach`. The Hostile Full Tick reads them to classify the day's
   * Walk-ins as genuine or Dangles (`FullTickInputs.dayEvents`).
   */
  dayEvents: readonly SimEvent[];
  /**
   * The false stories the Hostile Service planted in the day's paper
   * (`FullTickResult.newspaperPlants`), for the newspaper hook to add to the
   * edition's material (Requirement 3.8).
   */
  newspaperPlants: readonly NewspaperItem[];
  /**
   * The public arrest articles the day's Hostile arrests printed
   * (`FullTickResult.arrestArticles`), for the newspaper hook to add to the
   * edition's material.
   */
  arrestArticles: readonly NewspaperItem[];
}

/** A fresh, empty {@link DayScratch}: the state at the start of each Day Boundary. */
export function newDayScratch(): DayScratch {
  return { dayEvents: [], newspaperPlants: [], arrestArticles: [] };
}

/** The read-only context a {@link WorldHook} runs with. */
export interface WorldHookContext {
  /** Phase 0 of the day entered. */
  readonly time: GameTime;
  /** The daily stream seed for the day, `derive(seed, 0x20000 + day)`, unchanged from the slice. */
  readonly dailyStreamSeed: string;
  /** The runtime stream, shared with `resolve` for the rest of the turn. */
  readonly rng: Prng;
  /** Values handed from one hook to a later one that day. */
  readonly scratch: DayScratch;
  /** The dependencies `advanceWorld` was called with. */
  readonly deps: AdvanceWorldDeps;
}

/** What a {@link WorldHook} returns: the next Draft and the events it raised. */
export interface HookOutput {
  readonly state: WorldState;
  readonly events: readonly SimEvent[];
}

/**
 * A Day-Boundary Hook as a state reducer: the Draft in, the next Draft and the
 * hook's events out.
 */
export type WorldHook = (
  draft: WorldState,
  ctx: WorldHookContext,
) => HookOutput;

/**
 * The Day-Boundary Hooks `advanceWorld` runs, keyed by the names in
 * `DAY_BOUNDARY_HOOK_ORDER` (`plot`, `schedules`, `hostileTick`,
 * `newspaper`). Every hook is optional; an absent hook does not run.
 */
export type WorldHooks = {
  readonly [K in (typeof DAY_BOUNDARY_HOOK_ORDER)[number]]?: WorldHook;
};

/**
 * The dependencies `advanceWorld` threads through every Day-Boundary Hook and
 * Phase Step.
 */
export interface AdvanceWorldDeps {
  /** The loaded Content Set. */
  readonly content: ContentSet;
  /** The loaded city data (weather tables and the rest of `city.yaml`). */
  readonly cityData: CityData;
  /** The Day-Boundary Hooks; `buildWorldHooks()` in production. */
  readonly hooks: WorldHooks;
  /**
   * Builds the Objective Evaluator the Phase Step's Directive check calls, over
   * the Draft. Supplied by player-view, which decides objectives from the Case
   * File and the player's own recorded actions (Requirement 6).
   */
  readonly objectives: (draft: WorldState) => ObjectiveEvaluator;
  /** The cipher key material, for minting Intercepts. */
  readonly cipherKeys: CipherKeyLookup;
  /**
   * The turn's Truth Store, read through its staged writes: the Turn
   * Pipeline passes the turn's `TruthDraft`. The Hostile Full Tick projection
   * (`../hostile/project.ts`) reads it for the Chickenfeed each Asset could
   * pass back, the chickenfeed/deception classification of a delivered feed,
   * and the service's checks of a fed Proposition against its own people.
   *
   * Not in the design's list of dependencies. It is a read interface (the
   * projection reads facts and writes nothing), and it is optional so a caller
   * that builds the dependencies before a turn's draft exists still compiles.
   * Without it the projection sees an empty Truth Store: no Asset has
   * Chickenfeed, and every fed Proposition is classified as deception and
   * checked only against the service's adopted beliefs.
   */
  readonly truth?: TruthReader;
}
