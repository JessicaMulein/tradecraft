/**
 * The game clock: the four-phase daily time line's pure time arithmetic and the
 * day-boundary hook contract (design, "Clock, Plot and Schedules"; Requirement
 * 3.1).
 *
 * The world-advancing clock the Turn Pipeline runs is `advanceWorld`
 * (`./advance-world.ts`), which steps the Draft phase by phase, runs the
 * Day-Boundary Hooks and the Phase Step, draws the day's weather from the daily
 * stream itself, and stops early on an End Condition. This module owns the two
 * pieces that live below `advanceWorld`:
 *
 * - **Time arithmetic.** {@link addPhases} is the one place phase/day wrap-around
 *   is computed, and {@link isDayStart} answers "is this the first phase of a
 *   day?". `advanceWorld`, the Phase Step and the resolver phase-cost accounting
 *   all build on these rather than re-deriving the wrap.
 * - **The day-boundary hook contract.** {@link DayBoundaryHook},
 *   {@link HookContext}, {@link ClockHooks} and {@link DAY_BOUNDARY_HOOK_ORDER}
 *   are the shapes the deprecated events-only day-boundary adapters
 *   (`plotDayBoundaryHook`, `schedulesDayBoundaryHook`, `hostileDayBoundaryHook`,
 *   `newspaperDayBoundaryHook`) match, and `DAY_BOUNDARY_HOOK_ORDER` fixes the
 *   firing order `advanceWorld` reuses for its own hooks.
 *
 * Everything here is pure: {@link addPhases} draws no randomness and never
 * mutates its inputs, and the hook types are data.
 */

import {
  PHASES_PER_DAY,
  timeToPhases,
  type GameTime,
  type Phase,
} from '../model/core.js';
import type { SimEvent } from '../model/state.js';

// ---------------------------------------------------------------------------
// Time arithmetic (built on the core helpers; nothing re-derived here)
// ---------------------------------------------------------------------------

/**
 * The game time `phases` phases after `time`.
 *
 * Time is a flat phase count under the hood ({@link timeToPhases}), so this adds
 * and splits back into `{ day, phase }` using {@link PHASES_PER_DAY} — the one
 * place phase/day wrap-around is computed, so no caller re-derives it. `phases`
 * must be a non-negative integer: the clock never runs backwards, and a
 * fractional step is not a thing the four-phase model has.
 */
export function addPhases(time: GameTime, phases: number): GameTime {
  if (!Number.isInteger(phases) || phases < 0) {
    throw new RangeError(
      `addPhases(): phases must be a non-negative integer, received ${String(phases)}`,
    );
  }
  const total = timeToPhases(time) + phases;
  return {
    day: Math.floor(total / PHASES_PER_DAY),
    phase: (total % PHASES_PER_DAY) as Phase,
  };
}

/** True when `time` is the first phase of a day (phase 0). */
export function isDayStart(time: GameTime): boolean {
  return time.phase === 0;
}

// ---------------------------------------------------------------------------
// The day-boundary hook seam
// ---------------------------------------------------------------------------

/**
 * The read-only context a {@link DayBoundaryHook} is handed when it fires.
 *
 * It carries the new {@link GameTime} (the first phase of the day just entered),
 * the world {@link seed}, and the pre-derived {@link dailyStreamSeed} for that
 * day (`derive(seed, DAILY_STREAM_BASE + day)`). A hook that needs randomness
 * creates its PRNG from `dailyStreamSeed` so every day-boundary draw rides the
 * one deterministic daily stream (the same stream the weather draw uses), and
 * the clock stays pure. Hooks must treat this as read-only.
 */
export interface HookContext {
  /** The new game time: the first phase (phase 0) of the day just entered. */
  readonly time: GameTime;
  /** The world seed, for any hook that derives its own sub-stream. */
  readonly seed: string;
  /**
   * The daily PRNG stream seed for `time.day` (`derive(seed, 0x20000 + day)`).
   * A hook that needs deterministic randomness should build its PRNG from this.
   */
  readonly dailyStreamSeed: string;
}

/**
 * A hook that runs once at each day boundary the clock crosses and
 * contributes {@link SimEvent}s to the stream.
 *
 * The contract is intentionally minimal so later tasks can plug in without this
 * module learning their mechanics: a hook receives the new {@link GameTime}
 * (via {@link HookContext}) and returns the events it wants appended, in the
 * order it wants them. Returning an empty array is the no-op case. A hook must
 * be pure with respect to its inputs — any randomness comes from the context's
 * daily stream — so the clock stays deterministic.
 */
export type DayBoundaryHook = (ctx: HookContext) => readonly SimEvent[];

/**
 * The day-boundary hooks the clock fires, keyed by the task that owns each.
 * Every field is optional, so an advance with no hooks still emits a bare
 * `day-start` per boundary. The clock calls the present hooks in a fixed order
 * ({@link DAY_BOUNDARY_HOOK_ORDER}) so the event stream stays deterministic.
 *
 * The fixed firing order at each boundary is the field order below: Plot, then
 * schedules/walk-ins, then the hostile tick, then the newspaper. That order is a
 * convention this task fixes so the later tasks' events sort predictably; it can
 * be revisited when those tasks land, but it must stay deterministic.
 */
export interface ClockHooks {
  /**
   * Plot Stage execution for the day: advances the Plot through its stages by
   * deadline/prerequisite and turns executed-stage traces into Sim events
   * (meetings, transmissions, drop loads, movements).
   */
  readonly plot?: DayBoundaryHook;
  /**
   * NPC schedule advancement and Walk-ins on the daily stream: steps NPC
   * schedules deterministically and emits `walk-in`/`npc-moved` style events.
   */
  readonly schedules?: DayBoundaryHook;
  /**
   * The Hostile Service daily tick: adaptation, detection, tailing and the
   * `abortCheck` the design runs in the daily tick.
   */
  readonly hostileTick?: DayBoundaryHook;
  /**
   * Newspaper minting: composes the day's newspaper Document and emits the
   * `newspaper` event. The real weather summary text a `day-start` event carries
   * is drawn by `advanceWorld` from the daily stream, not by this hook.
   */
  readonly newspaper?: DayBoundaryHook;
}

/**
 * The order the clock fires the hooks in at each boundary. Fixed here so the
 * event stream is deterministic regardless of how {@link ClockHooks} is built,
 * and reused by `advanceWorld` for its own hooks. See {@link ClockHooks} for
 * what each hook contributes.
 */
export const DAY_BOUNDARY_HOOK_ORDER = [
  'plot',
  'schedules',
  'hostileTick',
  'newspaper',
] as const satisfies readonly (keyof ClockHooks)[];

