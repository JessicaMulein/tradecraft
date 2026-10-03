/**
 * The world-advancing clock: {@link advanceWorld}, the stepping core the Turn
 * Pipeline runs in place of the events-only {@link advance} (slice-integration
 * design, "Engine: `advanceWorld`"; Requirements 1.1, 1.4, 1.9, 1.10, 2.1,
 * 2.6, 2.7, 2.8, 7.1, 7.5).
 *
 * ## What it does
 *
 * `advanceWorld(draft, phases, rng, deps)` walks a Draft World State forward
 * one phase at a time. For each phase entered:
 *
 * 1. It computes the entered time `t = addPhases(current, 1)`.
 * 2. If `t` is a **Day Boundary** (phase 0 of a new day): it sets the day's
 *    weather from the daily stream and the city weather tables
 *    ({@link weatherForDay}) and emits a player-visible `day-start` event
 *    carrying it (Req 2.6); it builds a fresh {@link DayScratch}; and it runs
 *    the hooks present in `deps.hooks` in `DAY_BOUNDARY_HOOK_ORDER`, handing
 *    each the state the previous hook returned (Req 2.2). Weather is not a
 *    hook — the clock sets it, exactly as the slice {@link advance} did.
 * 3. It runs the {@link phaseStep} for `t` (after that day's hooks, Req 2.8).
 * 4. It runs {@link detectEnd} after every sub-step (each hook and the Phase
 *    Step). On a result it writes `WorldState.ended`, stops, and reports the
 *    phases actually spent (Req 7.1, 7.5).
 * 5. If the Phase Step opened a talk scene, it surfaces the first one and
 *    stops at that phase (Req 1.4).
 *
 * A multi-day turn runs the full hook sequence once per boundary, in day order
 * (Req 2.7), because the loop handles one phase at a time. Zero phases runs
 * nothing (Req 1.10).
 *
 * ## PRNG streams (Req 5.1)
 *
 * `rng` is the **runtime** stream carried in the Draft, shared with `resolve`:
 * the hooks and the Phase Step draw their non-daily randomness from it, and its
 * final state is threaded back into the returned state's `rng`, matching how
 * the pipeline records `rng.state()` at commit. The **daily** stream for day
 * `d` is derived exactly as the slice clock derives it,
 * `derive(seed, DAILY_STREAM_BASE + d)`, and the weather draw and the
 * daily-stream hooks (Walk-in roll, newspaper selection) build their own Prng
 * from that seed, so a daily draw never perturbs the runtime stream.
 *
 * ## Event ids (design "Event ids")
 *
 * Every event is re-id'd as `evt:<day>:<phase>:<seq>` with one sequence per
 * call, exactly as {@link advance} does, so ids stay unique and ordered within
 * a turn regardless of what a hook or the Phase Step put in `id`.
 *
 * ## Purity (Req 5.6)
 *
 * `advanceWorld`, every hook and the Phase Step read only their arguments and
 * draw only from `rng` (runtime) or a Prng built from the daily stream seed. No
 * `Date`, `process.env`, file or model access. A lint rule (task 5.2) scopes
 * `no-restricted-globals` / `no-restricted-imports` to this directory to keep
 * it so.
 */

import { DAILY_STREAM_BASE, weatherForDay } from '../city/city.js';
import { detectEnd, type EndCondition } from '../endings/end-conditions.js';
import type { GameTime } from '../model/core.js';
import type {
  EventId,
  SimEvent,
  Weather,
  WorldState,
} from '../model/state.js';
import { derive, type Prng } from '../prng/prng.js';
import type { TalkSceneRequest } from '../action/result.js';
import { addPhases, isDayStart, DAY_BOUNDARY_HOOK_ORDER } from './clock.js';
import { phaseStep } from './phase-step.js';
import { newDayScratch, type AdvanceWorldDeps } from './world-types.js';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * What one {@link advanceWorld} call produces (slice-integration design,
 * `AdvanceWorldResult`):
 *
 * - `state` — the Draft after the advance, with `time` at the last phase
 *   entered and `rng` threaded back to the runtime stream's final state.
 * - `events` — the turn's events in event-time order, re-id'd like
 *   {@link advance} (Req 1.9).
 * - `phasesSpent` — the phases actually entered, at most the `phases`
 *   requested; fewer when the advance stopped early at an End Condition or a
 *   meeting slot (Req 1.4, 7.5).
 * - `openScene` — the talk scene the first kept meeting opened, if the advance
 *   stopped at one (Req 1.4).
 * - `ended` — the End Condition `detectEnd` reported, if the game ended during
 *   the advance (Req 7.1).
 */
export interface AdvanceWorldResult {
  /** The Draft after the advance. */
  readonly state: WorldState;
  /** The turn's events, in event-time order, re-id'd as `evt:<day>:<phase>:<seq>`. */
  readonly events: readonly SimEvent[];
  /** The phases actually entered (≤ the requested count). */
  readonly phasesSpent: number;
  /** The talk scene a kept meeting opened, if the advance stopped at one. */
  readonly openScene?: TalkSceneRequest;
  /** The End Condition the advance detected, if the game ended. */
  readonly ended?: EndCondition;
}

// ---------------------------------------------------------------------------
// advanceWorld
// ---------------------------------------------------------------------------

/**
 * Advance the Draft World State by `phases` phases, running the Day-Boundary
 * Hooks at each boundary and the Phase Step at each phase, and stopping early
 * on an End Condition or an opened talk scene (slice-integration design,
 * "Engine: `advanceWorld`").
 *
 * See the module documentation for the per-phase order, the PRNG streams and
 * the event-id scheme. `phases` must be a non-negative integer.
 */
export function advanceWorld(
  draft: WorldState,
  phases: number,
  rng: Prng,
  deps: AdvanceWorldDeps,
): AdvanceWorldResult {
  if (!Number.isInteger(phases) || phases < 0) {
    throw new RangeError(
      `advanceWorld(): phases must be a non-negative integer, received ${String(phases)}`,
    );
  }

  const seed = draft.meta.seed;
  const minted: SimEvent[] = [];
  let seq = 0;
  /** Re-id and append the events a sub-step raised, in order. */
  const push = (events: readonly SimEvent[]): void => {
    for (const event of events) {
      minted.push({ ...event, id: eventId(event.at, seq) });
      seq += 1;
    }
  };

  let state = draft;
  let current = state.time;
  let phasesSpent = 0;
  let openScene: TalkSceneRequest | undefined;
  let ended: EndCondition | undefined;

  for (let step = 0; step < phases; step += 1) {
    const t = addPhases(current, 1);
    phasesSpent += 1;

    // Day Boundary: weather on the daily stream, then the hooks in order. The
    // Phase Step runs after that day's hooks (Req 2.8).
    if (isDayStart(t)) {
      state = setWeather(state, deps, seed, t, push);
      const dayStop = runDayBoundaryHooks(state, rng, deps, seed, t, push);
      state = dayStop.state;
      if (dayStop.ended !== undefined) {
        ended = dayStop.ended;
        current = t;
        break;
      }
    }

    // The Phase Step for `t`, on the state the hooks (if any) left.
    const stepResult = phaseStep(state, current, t, rng, deps);
    state = stepResult.state;
    push(stepResult.events);
    current = t;

    // `detectEnd` after the Phase Step (Req 7.1). The hooks already write
    // `ended` on an abort; `detectEnd` reports it (idempotent) or a fresh end
    // (a completed Plot, a burn, a leader arrest) the Phase Step produced.
    const end = detectEnd(state);
    if (end !== undefined && end !== null) {
      ended = end;
      state = writeEnded(state, end);
      break;
    }

    // A kept meeting opened a scene: stop at this slot and report it (Req 1.4).
    if (stepResult.openScene !== undefined) {
      openScene = stepResult.openScene;
      break;
    }
  }

  // Thread the runtime stream's final state back into the Draft, as the
  // pipeline records at commit (design step 7).
  const result: WorldState = { ...state, time: current, rng: rng.state() };
  return {
    state: result,
    events: minted,
    phasesSpent,
    ...(openScene !== undefined ? { openScene } : {}),
    ...(ended !== undefined ? { ended } : {}),
  };
}

// ---------------------------------------------------------------------------
// Day Boundary
// ---------------------------------------------------------------------------

/**
 * Set the entered day's weather from the daily stream and the city weather
 * tables ({@link weatherForDay}) and emit the player-visible `day-start` event
 * carrying it (Req 2.6). The weather draw rides the day's daily stream, so it
 * cannot perturb the runtime stream `rng`.
 *
 * The `day-start` event carries the state `Weather` (`{ summary }`): the city
 * weather's human label, so the summary reads as the day's condition.
 */
function setWeather(
  state: WorldState,
  deps: AdvanceWorldDeps,
  seed: string,
  t: GameTime,
  push: (events: readonly SimEvent[]) => void,
): WorldState {
  const city = weatherForDay(seed, state.city, deps.cityData, t.day);
  const weather: Weather = { summary: city.label };
  push([
    {
      id: '' as EventId,
      at: t,
      visibility: 'player',
      kind: 'day-start',
      weather,
    },
  ]);
  return state;
}

/** What a boundary's hooks left: the state, and the End Condition if one fired. */
interface DayBoundaryStop {
  readonly state: WorldState;
  readonly ended?: EndCondition;
}

/**
 * Run the present Day-Boundary Hooks in `DAY_BOUNDARY_HOOK_ORDER`, each reading
 * the state the previous one returned (Req 2.2), with a fresh {@link DayScratch}
 * for the day. Each hook's events are appended in order (Req 1.9).
 *
 * {@link detectEnd} runs after each hook (the hooks encapsulate their own abort
 * check and write `WorldState.ended` on a trigger); on an end the sequence
 * stops and the End Condition is returned, so a later hook does not run past a
 * decided game.
 */
function runDayBoundaryHooks(
  state: WorldState,
  rng: Prng,
  deps: AdvanceWorldDeps,
  seed: string,
  t: GameTime,
  push: (events: readonly SimEvent[]) => void,
): DayBoundaryStop {
  const scratch = newDayScratch();
  const ctx = {
    time: t,
    dailyStreamSeed: derive(seed, DAILY_STREAM_BASE + t.day),
    rng,
    scratch,
    deps,
  } as const;

  let current = state;
  for (const key of DAY_BOUNDARY_HOOK_ORDER) {
    const hook = deps.hooks[key];
    if (hook === undefined) {
      continue;
    }
    const output = hook(current, ctx);
    current = output.state;
    push(output.events);

    const end = detectEnd(current);
    if (end !== undefined && end !== null) {
      return { state: writeEnded(current, end), ended: end };
    }
  }
  return { state: current };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write an End Condition to `WorldState.ended`, keeping the first one: a game
 * already ended stays ended (Req 7.1). {@link detectEnd} is idempotent once
 * `ended` is set, so this never overwrites a recorded end.
 */
function writeEnded(state: WorldState, end: EndCondition): WorldState {
  if (state.ended !== undefined) {
    return state;
  }
  return { ...state, ended: end };
}

/**
 * Deterministically mint an {@link EventId} from the event's time and a
 * per-call sequence number, exactly as {@link advance} does. Same inputs ⇒
 * same ids in the same order; the `evt:` prefix keeps clock-minted ids visibly
 * distinct from other id families.
 */
function eventId(at: GameTime, seq: number): EventId {
  return `evt:${at.day}:${at.phase}:${seq}`;
}
